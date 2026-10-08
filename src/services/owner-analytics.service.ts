import { and, eq, gte, lt, sql } from 'drizzle-orm';
import {
  db,
  inventoryLedger,
  orders,
  orderItems,
  deliveryOrders,
  deliveryOrderItems,
  partnerReceipts,
  shopeeOrderFinance,
  bankAccounts,
  warehouses,
  products,
  partners,
  loans,
} from '@/db';
import { AppError } from './app-error';
import { PartnerDebtService } from './partner-debt.service';
import { allocateFifoCogs, vnMonthRangeUtc, type LotMovement } from './owner-finance.service';
import type { UserRole } from '../lib/roles';

function assertOwner(role: UserRole) {
  if (role !== 'ROLE_OWNER') throw AppError.forbidden('Chỉ chủ mới được xem phân tích tài chính.');
}

const num = (v: unknown) => Number(v ?? 0);

/**
 * Giá vốn hàng bán trong kỳ cho 1 sản phẩm — phát lại sổ cái qua FIFO.
 * (Wrapper DB của allocateFifoCogs thuần logic.)
 */
export async function computeCogsForPeriod(params: {
  productId: string;
  startUtc: string;
  endUtc: string;
}) {
  const rows = await db
    .select({
      lotId: inventoryLedger.lotId,
      unitCost: inventoryLedger.unitCostSnapshot,
      qty: inventoryLedger.quantityDelta,
      at: inventoryLedger.effectiveAt,
    })
    .from(inventoryLedger)
    .where(eq(inventoryLedger.productId, params.productId))
    .orderBy(sql`${inventoryLedger.effectiveAt} ASC`);
  const movements: LotMovement[] = rows.map((r) => ({
    lotId: r.lotId,
    unitCost: r.unitCost === null ? null : Number(r.unitCost),
    qty: Number(r.qty),
    at: `${r.at}`,
  }));
  return allocateFifoCogs(movements, params.startUtc, params.endUtc);
}

export interface MarginRow {
  channel: 'ONLINE' | 'RETAIL' | 'WHOLESALE' | 'AGENCY' | 'SHOPEE';
  productId: string | null;
  name: string;
  qty: number;
  revenue: number;
  cogs: number;
  unknownCostQty: number;
  grossProfit: number;
  /** null khi không có doanh thu hoặc còn giá vốn chưa xác định. */
  margin: number | null;
}

/**
 * Pivot biên lợi nhuận theo kênh × đầu sách trong tháng VN.
 * Doanh thu từ dòng hàng bán trong kỳ; giá vốn FIFO tính theo sản phẩm rồi
 * phân bổ về từng dòng theo tỷ lệ số lượng (FIFO không tách được lô theo kênh
 * nếu không ghi lúc xuất — phân bổ là đáp án thực tế chuẩn).
 * Đại lý tính theo phiếu xuất (phải thu) — tiến độ thực thu xem riêng.
 */
export async function getMarginPivot(month: string, actorRole: UserRole): Promise<MarginRow[]> {
  assertOwner(actorRole);
  const [start, end] = vnMonthRangeUtc(month);
  const nameOf = new Map<string, string>();
  const productName = async (pid: string) => {
    if (!nameOf.has(pid)) {
      const [p] = await db.select({ name: products.name }).from(products).where(eq(products.id, pid)).limit(1);
      nameOf.set(pid, p?.name || pid);
    }
    return nameOf.get(pid) as string;
  };

  interface RawRow { channel: MarginRow['channel']; productId: string | null; qty: number; revenue: number }
  const raw: RawRow[] = [];

  // Đơn lẻ: ONLINE riêng; bán lẻ = FAIR_EVENT + RETAIL_OFFICE; bán sỉ = WHOLESALE_PARTNER.
  const itemRows = await db
    .select({
      channel: orders.channel,
      productId: orderItems.productId,
      qty: sql<number>`coalesce(sum(${orderItems.quantity}), 0)`,
      revenue: sql<number>`coalesce(sum(${orderItems.totalAmount}), 0)`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(
      and(
        eq(orders.status, 'COMPLETED'),
        sql`${orders.channel} IN ('ONLINE', 'FAIR_EVENT', 'RETAIL_OFFICE', 'WHOLESALE_PARTNER')`,
        gte(orders.createdAt, start),
        lt(orders.createdAt, end)
      )
    )
    .groupBy(orders.channel, orderItems.productId);

  // Đại lý: dòng phiếu xuất đã khóa sổ (bán đứt).
  const agencyRows = await db
    .select({
      productId: deliveryOrderItems.editionId,
      qty: sql<number>`coalesce(sum(${deliveryOrderItems.quantity}), 0)`,
      revenue: sql<number>`coalesce(sum(${deliveryOrderItems.totalAmount}), 0)`,
    })
    .from(deliveryOrderItems)
    .innerJoin(deliveryOrders, eq(deliveryOrderItems.deliveryOrderId, deliveryOrders.id))
    .where(
      and(
        eq(deliveryOrders.status, 'DISPATCHED_LOCKED'),
        eq(deliveryOrders.fiscalScope, 'COMMERCIAL_WHOLESALE'),
        gte(sql`coalesce(${deliveryOrders.dispatchedAt}, ${deliveryOrders.createdAt})`, start),
        lt(sql`coalesce(${deliveryOrders.dispatchedAt}, ${deliveryOrders.createdAt})`, end)
      )
    )
    .groupBy(deliveryOrderItems.editionId);

  for (const r of itemRows) {
    const ch: MarginRow['channel'] =
      r.channel === 'ONLINE' ? 'ONLINE' : r.channel === 'WHOLESALE_PARTNER' ? 'WHOLESALE' : 'RETAIL';
    raw.push({
      channel: ch,
      productId: r.productId,
      qty: num(r.qty),
      revenue: num(r.revenue),
    });
  }
  for (const r of agencyRows) {
    raw.push({ channel: 'AGENCY', productId: r.productId, qty: num(r.qty), revenue: num(r.revenue) });
  }

  // Shopee: một dòng kênh (không tách đầu sách), giá vốn từ cột cogs nếu có.
  const [sh] = await db
    .select({
      orders: sql<number>`count(*)`,
      escrow: sql<number>`coalesce(sum(${shopeeOrderFinance.escrowAmount}), 0)`,
      cogs: sql<number>`coalesce(sum(${shopeeOrderFinance.cogs}), 0)`,
      cogsRows: sql<number>`coalesce(sum(CASE WHEN ${shopeeOrderFinance.cogs} IS NOT NULL THEN 1 ELSE 0 END), 0)`,
    })
    .from(shopeeOrderFinance)
    .where(and(gte(shopeeOrderFinance.syncedAt, start), lt(shopeeOrderFinance.syncedAt, end)));

  // Giá vốn FIFO theo sản phẩm (1 lần/sản phẩm), rồi phân bổ theo SL từng dòng.
  const fifoCache = new Map<string, { cogs: number; unknownCostQty: number }>();
  const fifoOf = async (pid: string) => {
    if (!fifoCache.has(pid)) {
      const r = await computeCogsForPeriod({ productId: pid, startUtc: start, endUtc: end });
      fifoCache.set(pid, { cogs: r.cogs, unknownCostQty: r.unknownQty });
    }
    return fifoCache.get(pid)!;
  };

  const rows: MarginRow[] = [];
  // Tổng SL xuất trong kỳ theo sản phẩm (mẫu số phân bổ) = tổng SL các dòng.
  const qtyByProduct = new Map<string, number>();
  for (const r of raw) {
    if (r.productId) qtyByProduct.set(r.productId, (qtyByProduct.get(r.productId) || 0) + r.qty);
  }

  for (const r of raw) {
    const fifo = r.productId ? await fifoOf(r.productId) : null;
    const denom = r.productId ? qtyByProduct.get(r.productId) || 0 : 0;
    const share = fifo && denom > 0 ? r.qty / denom : 0;
    const cogs = fifo ? Math.round(fifo.cogs * share) : 0;
    const unknownCostQty = fifo ? Math.round(fifo.unknownCostQty * share) : 0;
    const grossProfit = r.revenue - cogs;
    rows.push({
      channel: r.channel,
      productId: r.productId,
      name: r.productId ? await productName(r.productId) : 'Shopee (tổng)',
      qty: r.qty,
      revenue: r.revenue,
      cogs,
      unknownCostQty,
      grossProfit,
      margin: r.revenue > 0 && unknownCostQty === 0 ? grossProfit / r.revenue : null,
    });
  }

  if (num(sh?.orders) > 0) {
    const hasCogs = num(sh?.cogsRows) > 0;
    const revenue = num(sh?.escrow);
    const cogs = hasCogs ? num(sh?.cogs) : 0;
    rows.push({
      channel: 'SHOPEE',
      productId: null,
      name: 'Shopee (tổng)',
      qty: num(sh?.orders),
      revenue,
      cogs,
      unknownCostQty: hasCogs ? 0 : -1, // -1 = chưa có dữ liệu giá vốn kênh
      grossProfit: revenue - cogs,
      margin: hasCogs && revenue > 0 ? (revenue - cogs) / revenue : null,
    });
  }

  rows.sort((a, b) => b.revenue - a.revenue);
  return rows;
}

export interface CashBucket {
  accountId: string | null;
  label: string;
  amount: number;
  sources: string[];
}

/**
 * Dòng tiền thực thu trong tháng theo nơi tiền đang nằm.
 * Thứ tự ưu tiên xác định tài khoản: dest_account_id → kho mặc định →
 * tiền mặt tại quầy → chưa phân loại.
 */
export async function getCashByAccount(month: string, actorRole: UserRole): Promise<CashBucket[]> {
  assertOwner(actorRole);
  const [start, end] = vnMonthRangeUtc(month);
  const buckets = new Map<string, CashBucket>();
  const add = (key: string, label: string, accountId: string | null, amount: number, source: string) => {
    if (!(amount > 0)) return;
    const cur = buckets.get(key) || { accountId, label, amount: 0, sources: [] };
    cur.amount += amount;
    if (!cur.sources.includes(source)) cur.sources.push(source);
    buckets.set(key, cur);
  };
  const acctLabel = new Map<string, string>();
  const labelOf = async (id: string | null) => {
    if (!id) return null;
    if (!acctLabel.has(id)) {
      const [a] = await db.select({ label: bankAccounts.label }).from(bankAccounts).where(eq(bankAccounts.id, id)).limit(1);
      acctLabel.set(id, a?.label || id);
    }
    return acctLabel.get(id) as string;
  };

  // Đơn lẻ.
  const ordRows = await db
    .select({
      paymentMethod: orders.paymentMethod,
      destAccountId: orders.destAccountId,
      warehouseId: orders.warehouseId,
      revenue: sql<number>`coalesce(sum(${orders.finalAmount}), 0)`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.status, 'COMPLETED'),
        gte(orders.createdAt, start),
        lt(orders.createdAt, end)
      )
    )
    .groupBy(orders.paymentMethod, orders.destAccountId, orders.warehouseId);
  const whDefault = new Map<string, string | null>();
  for (const r of ordRows) {
    let accountId: string | null = r.destAccountId;
    let label: string;
    if (accountId) {
      label = (await labelOf(accountId)) || accountId;
    } else if (r.paymentMethod === 'CASH') {
      label = 'Tiền mặt tại quầy';
    } else {
      if (!whDefault.has(r.warehouseId)) {
        const [w] = await db.select({ d: warehouses.defaultBankAccountId }).from(warehouses).where(eq(warehouses.id, r.warehouseId)).limit(1);
        whDefault.set(r.warehouseId, w?.d || null);
      }
      accountId = whDefault.get(r.warehouseId) || null;
      label = accountId ? (await labelOf(accountId)) || 'Tài khoản kho' : 'Chưa phân loại (CK/QR)';
    }
    // Gộp theo tài khoản (không theo nguồn) để thấy tổng tiền đang nằm ở đâu.
    add(`acct:${accountId || label}`, label, accountId, num(r.revenue), r.paymentMethod === 'CASH' ? 'Bán lẻ tiền mặt' : 'Bán lẻ CK/QR');
  }

  // Tiền đại lý thực thu.
  const rcRows = await db
    .select({
      destAccountId: partnerReceipts.destAccountId,
      amount: sql<number>`coalesce(sum(${partnerReceipts.amount}), 0)`,
    })
    .from(partnerReceipts)
    .where(
      and(
        eq(partnerReceipts.status, 'ACTIVE'),
        sql`${partnerReceipts.paidAt} LIKE ${month + '%'}`
      )
    )
    .groupBy(partnerReceipts.destAccountId);
  for (const r of rcRows) {
    const label = r.destAccountId ? (await labelOf(r.destAccountId)) || r.destAccountId : 'Chưa phân loại (đại lý)';
    add(`acct:${r.destAccountId || label}`, label, r.destAccountId, num(r.amount), 'Đại lý thực thu');
  }

  // Shopee: tiền trong escrow chờ rút.
  const [sh] = await db
    .select({ escrow: sql<number>`coalesce(sum(${shopeeOrderFinance.escrowAmount}), 0)` })
    .from(shopeeOrderFinance)
    .where(and(gte(shopeeOrderFinance.syncedAt, start), lt(shopeeOrderFinance.syncedAt, end)));
  add('sh:escrow', 'Shopee (chờ rút)', null, num(sh?.escrow), 'Shopee');

  // Vốn vay giải ngân trong tháng — dòng tiền vào.
  const loanRows = await db
    .select({
      lender: loans.lender,
      amount: sql<number>`coalesce(sum(${loans.principal}), 0)`,
    })
    .from(loans)
    .where(
      and(
        sql`${loans.borrowedAt} LIKE ${month + '%'}`,
        sql`${loans.status} != 'CANCELLED'`
      )
    )
    .groupBy(loans.lender);
  for (const r of loanRows) {
    add(`acct:vay:${r.lender}`, `Vốn vay — ${r.lender}`, null, num(r.amount), 'Vốn vay');
  }

  return [...buckets.values()].sort((a, b) => b.amount - a.amount);
}

export interface AgencyPaymentRow {
  partnerId: string;
  partnerName: string;
  receivable: number;
  received: number;
  balance: number;
  overdue: number;
  overdueCount: number;
}

/** Tiến độ thanh toán đại lý — công nợ còn lại + cảnh báo quá hạn (lũy kế). */
export async function getAgencyPaymentProgress(actorRole: UserRole): Promise<AgencyPaymentRow[]> {
  assertOwner(actorRole);
  const partnerRows = await db
    .selectDistinct({ partnerId: deliveryOrders.partnerId })
    .from(deliveryOrders)
    .where(
      and(
        eq(deliveryOrders.status, 'DISPATCHED_LOCKED'),
        eq(deliveryOrders.fiscalScope, 'COMMERCIAL_WHOLESALE')
      )
    );
  const out: AgencyPaymentRow[] = [];
  for (const { partnerId } of partnerRows) {
    const s = await PartnerDebtService.summary(partnerId);
    const [p] = await db.select({ name: partners.name }).from(partners).where(eq(partners.id, partnerId)).limit(1);
    out.push({
      partnerId,
      partnerName: p?.name || partnerId,
      receivable: s.receivable,
      received: s.received,
      balance: s.balance,
      overdue: s.overdue,
      overdueCount: s.overdueCount,
    });
  }
  out.sort((a, b) => b.overdue - a.overdue || b.balance - a.balance);
  return out;
}
