import { randomUUID } from 'node:crypto';
import { sql, and, eq, gte, inArray, ne } from 'drizzle-orm';
import { db } from '@/db';
import {
  workCosts,
  contractDocuments,
  inventoryLedger,
  editions,
  works,
  orderItems,
  orders,
  expenseEntries,
} from '@/db/schema';

// Lớp giá vốn theo đầu sách - quyết định 2026-10-21 (anh Kha duyệt).
// Quy tắc:
//   1. Chi phí vào giá vốn: 5 HĐ giai đoạn (gross) + tiền in ấn. KHÔNG cộng chi phí chung.
//   2. Giá trị HĐ tính GROSS (trước khấu trừ TNCN 10%).
//   3. Tái bản nhiều đợt -> giá vốn bình quân gia quyền.
//   6. Chỉ tính từ 01/01/2026 trở đi.
const COST_FROM_DATE = '2026-01-01';

// Nhóm kênh theo quyết định 8: POS (FAIR_EVENT, RETAIL_OFFICE), portal (ONLINE),
// Shopee (SHOPEE), đại lý/ký gửi (WHOLESALE_PARTNER).
export const CHANNEL_GROUPS: Record<string, string[]> = {
  pos: ['FAIR_EVENT', 'RETAIL_OFFICE'],
  online: ['ONLINE'],
  shopee: ['SHOPEE'],
  wholesale: ['WHOLESALE_PARTNER'],
};

export interface CostBreakdown {
  id: string;
  costType: string;
  sourceType: string | null;
  sourceId: string | null;
  amount: number;
  costDate: string;
  notes: string | null;
  label: string;
}

/** Đồng bộ chi phí từ hợp đồng vào work_costs. Idempotent: bỏ qua HĐ đã có. */
export async function syncContractCosts(): Promise<{ added: number; skipped: number }> {
  const docs = await db
    .select({
      id: contractDocuments.id,
      contractNumber: contractDocuments.contractNumber,
      title: contractDocuments.title,
      workId: contractDocuments.workId,
      totalAmount: contractDocuments.totalAmount,
      signedDate: contractDocuments.signedDate,
      status: contractDocuments.status,
    })
    .from(contractDocuments)
    .where(
      and(
        sql`${contractDocuments.workId} IS NOT NULL`,
        sql`${contractDocuments.totalAmount} > 0`,
        sql`${contractDocuments.signedDate} >= ${COST_FROM_DATE}`,
        ne(contractDocuments.status, 'CANCELLED'),
      ),
    );

  let added = 0;
  let skipped = 0;
  for (const d of docs) {
    const exists = await db
      .select({ id: workCosts.id })
      .from(workCosts)
      .where(and(eq(workCosts.sourceType, 'contract_documents'), eq(workCosts.sourceId, d.id)))
      .limit(1);
    if (exists.length > 0) {
      skipped++;
      continue;
    }
    await db.insert(workCosts).values({
      id: `wcost-${randomUUID()}`,
      workId: d.workId as string,
      costType: 'CONTRACT',
      sourceType: 'contract_documents',
      sourceId: d.id,
      amount: d.totalAmount,
      costDate: (d.signedDate || '').slice(0, 10),
      notes: `${d.contractNumber} - ${d.title}`,
    });
    added++;
  }
  return { added, skipped };
}

/** Thêm chi phí thủ công (tiền in ấn). */
export async function addManualCost(input: {
  workId: string;
  costType: 'PRINTING';
  amount: number;
  costDate: string;
  notes?: string;
}): Promise<{ id: string }> {
  if (!input.workId || !(input.amount > 0)) throw new Error('Thiếu workId hoặc số tiền không hợp lệ.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.costDate || '')) throw new Error('Ngày phải dạng YYYY-MM-DD.');
  const id = `wcost-${randomUUID()}`;
  await db.insert(workCosts).values({
    id,
    workId: input.workId,
    costType: 'PRINTING',
    sourceType: 'manual',
    sourceId: id,
    amount: input.amount,
    costDate: input.costDate,
    notes: input.notes || null,
  });
  return { id };
}

/** Chi tiết cấu thành giá vốn của 1 đầu sách. */
export async function getWorkCostBreakdown(workId: string): Promise<{
  work: { id: string; code: string; title: string } | null;
  items: CostBreakdown[];
  totalCost: number;
  contractTotal: number;
  printingTotal: number;
}> {
  const w = await db.select({ id: works.id, code: works.code, title: works.title }).from(works).where(eq(works.id, workId)).limit(1);
  const rows = await db
    .select()
    .from(workCosts)
    .where(eq(workCosts.workId, workId))
    .orderBy(workCosts.costDate);
  const items: CostBreakdown[] = rows.map((r) => ({
    id: r.id,
    costType: r.costType,
    sourceType: r.sourceType,
    sourceId: r.sourceId,
    amount: r.amount,
    costDate: r.costDate,
    notes: r.notes,
    label: r.costType === 'CONTRACT' ? 'Hợp đồng' : 'In ấn',
  }));
  const totalCost = items.reduce((s, i) => s + i.amount, 0);
  return {
    work: w[0] || null,
    items,
    totalCost,
    contractTotal: items.filter((i) => i.costType === 'CONTRACT').reduce((s, i) => s + i.amount, 0),
    printingTotal: items.filter((i) => i.costType === 'PRINTING').reduce((s, i) => s + i.amount, 0),
  };
}

/** Tổng số bản đã nhập kho của 1 đầu sách (mọi đợt, mọi kho). */
export async function getWorkReceivedQty(workId: string): Promise<number> {
  const r = await db.execute(sql`
    SELECT COALESCE(SUM(l.quantity_delta), 0) AS qty
    FROM inventory_ledger l
    JOIN editions e ON e.id = l.edition_id
    WHERE e.work_id = ${workId}
      AND l.event_type IN ('RECEIPT', 'RETURN_INBOUND', 'OPENING_BALANCE')
  `);
  return Number((r.rows[0] as { qty: number }).qty || 0);
}

/** Giá vốn/bản (bình quân gia quyền) của 1 đầu sách. */
export async function getUnitCost(workId: string): Promise<{
  totalCost: number;
  receivedQty: number;
  unitCost: number | null;
}> {
  const { totalCost } = await getWorkCostBreakdown(workId);
  const receivedQty = await getWorkReceivedQty(workId);
  return { totalCost, receivedQty, unitCost: receivedQty > 0 ? totalCost / receivedQty : null };
}

export interface PnlFilters {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  channelGroup: 'all' | 'pos' | 'online' | 'shopee' | 'wholesale';
  workId?: string;
  book: 'TAX' | 'INTERNAL' | 'ALL';
}

export interface PnlRow {
  workId: string;
  workCode: string;
  workTitle: string;
  qty: number;
  revenue: number;
  unitCost: number | null;
  cogs: number | null;
  gross: number | null;
  marginPct: number | null;
}

function bookScope(book: 'TAX' | 'INTERNAL'): string {
  return book === 'TAX' ? 'OFFICIAL_TAX' : 'INTERNAL_MANAGEMENT';
}

/** P&L 1 sổ: doanh thu theo order_items -> edition -> work, giá vốn theo unit_cost. */
async function pnlOneBook(f: Omit<PnlFilters, 'book'> & { book: 'TAX' | 'INTERNAL' }): Promise<{
  rows: PnlRow[];
  totalQty: number;
  totalRevenue: number;
  totalCogs: number;
  totalGross: number;
}> {
  const channels = f.channelGroup === 'all' ? null : CHANNEL_GROUPS[f.channelGroup];
  const conds = [
    ne(orders.status, 'CANCELLED'),
    eq(orders.fiscalScope, bookScope(f.book)),
    sql`date(datetime(${orders.createdAt}, '+7 hours')) >= ${f.from}`,
    sql`date(datetime(${orders.createdAt}, '+7 hours')) <= ${f.to}`,
  ];
  if (channels) conds.push(inArray(orders.channel, channels));

  const saleRows = await db
    .select({
      workId: editions.workId,
      qty: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)`,
      revenue: sql<number>`COALESCE(SUM(${orderItems.totalAmount}), 0)`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .innerJoin(editions, eq(orderItems.editionId, editions.id))
    .where(and(...conds))
    .groupBy(editions.workId);

  const rows: PnlRow[] = [];
  for (const s of saleRows) {
    if (f.workId && s.workId !== f.workId) continue;
    const w = await db.select({ code: works.code, title: works.title }).from(works).where(eq(works.id, s.workId)).limit(1);
    const { unitCost } = await getUnitCost(s.workId);
    const qty = Number(s.qty) || 0;
    const revenue = Number(s.revenue) || 0;
    const cogs = unitCost != null ? qty * unitCost : null;
    const gross = cogs != null ? revenue - cogs : null;
    rows.push({
      workId: s.workId,
      workCode: w[0]?.code || '',
      workTitle: w[0]?.title || s.workId,
      qty,
      revenue,
      unitCost,
      cogs,
      gross,
      marginPct: gross != null && revenue > 0 ? (gross / revenue) * 100 : null,
    });
  }
  rows.sort((a, b) => (b.gross ?? -Infinity) - (a.gross ?? -Infinity));

  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalCogs = rows.reduce((s, r) => s + (r.cogs || 0), 0);
  const totalGross = rows.reduce((s, r) => s + (r.gross || 0), 0);
  return { rows, totalQty, totalRevenue, totalCogs, totalGross };
}

/** Chi phí chung (không phân bổ) trong kỳ - tầng 2 của P&L. */
export async function getOperatingExpenses(from: string, to: string): Promise<{ total: number; byCategory: { category: string; total: number }[] }> {
  const rows = await db
    .select({
      category: expenseEntries.category,
      total: sql<number>`COALESCE(SUM(${expenseEntries.amount}), 0)`,
    })
    .from(expenseEntries)
    .where(and(gte(expenseEntries.entryDate, from), sql`${expenseEntries.entryDate} <= ${to}`))
    .groupBy(expenseEntries.category);
  const byCategory = rows.map((r) => ({ category: r.category, total: Number(r.total) || 0 }));
  return { total: byCategory.reduce((s, r) => s + r.total, 0), byCategory };
}

export async function getPnl(f: PnlFilters) {
  const books = f.book === 'ALL' ? (['TAX', 'INTERNAL'] as const) : ([f.book] as const);
  const result: Record<string, Awaited<ReturnType<typeof pnlOneBook>>> = {};
  for (const b of books) result[b] = await pnlOneBook({ ...f, book: b });
  const expenses = await getOperatingExpenses(f.from, f.to);
  const net: Record<string, number> = {};
  for (const b of books) net[b] = result[b].totalGross - expenses.total;
  return { books: result, expenses, net };
}
