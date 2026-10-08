import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { db, deliveryOrders, partnerReceipts, orders, inventoryLedger } from '@/db';
import { AppError } from './app-error';
import { withDbRetry } from '../lib/db-retry';
import { recordAuditLog } from '../lib/rbac-guard';
import type { UserRole } from '../lib/roles';

export interface AgencyChannel {
  orders: number;
  /** Phải thu: tổng phiếu đã khóa sổ trong tháng (chưa chắc đã thu tiền). */
  receivable: number;
  /** Thực thu: tiền đại lý thực trả trong tháng (ghi nhận doanh thu theo quyết định của chủ). */
  received: number;
  balance: number;
}

export interface SimpleChannel {
  orders: number;
  revenue: number;
}

export interface RetailChannel extends SimpleChannel {
  cash: number;
  bankQr: number;
}

export interface WholesaleChannel extends SimpleChannel {}

export interface ChannelRevenue {
  agency: AgencyChannel;
  online: SimpleChannel;
  retail: RetailChannel;
  /** Bán sỉ tại quầy (WHOLESALE_PARTNER) — bán đứt thu tiền ngay, tách khỏi đại lý công nợ. */
  wholesale: WholesaleChannel;
}

/**
 * Khoảng UTC [start, end) của tháng nghiệp vụ VN 'YYYY-MM'.
 * createdAt/dispatchedAt lưu UTC ('YYYY-MM-DD HH:MM:SS') nên phải trừ 7 tiếng
 * để biên tháng khớp giờ VN — dùng LIKE 'YYYY-MM%' trực tiếp sẽ lệch ở rìa tháng.
 */
export function vnMonthRangeUtc(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number);
  const fmt = (t: number) => new Date(t).toISOString().slice(0, 19).replace('T', ' ');
  const start = Date.UTC(y, m - 1, 1) - 7 * 3600 * 1000;
  const end = Date.UTC(y, m, 1) - 7 * 3600 * 1000;
  return [fmt(start), fmt(end)];
}

const num = (v: unknown) => Number(v ?? 0);

/**
 * Tổng hợp doanh thu theo kênh cho tab Chủ (GĐ3-P1). Chưa có giá vốn/biên —
 * chỉ doanh thu ghi nhận + tiền thực thu. Mọi con số đều theo tháng VN.
 */
export async function getChannelRevenue(month: string): Promise<ChannelRevenue> {
  const [start, end] = vnMonthRangeUtc(month);

  // Đại lý: phải thu theo ngày khóa sổ phiếu (dispatchedAt, fallback createdAt).
  const [agency] = await db
    .select({
      orders: sql<number>`count(*)`,
      receivable: sql<number>`coalesce(sum(${deliveryOrders.finalAmount}), 0)`,
    })
    .from(deliveryOrders)
    .where(
      and(
        eq(deliveryOrders.status, 'DISPATCHED_LOCKED'),
        eq(deliveryOrders.fiscalScope, 'COMMERCIAL_WHOLESALE'),
        gte(sql`coalesce(${deliveryOrders.dispatchedAt}, ${deliveryOrders.createdAt})`, start),
        lt(sql`coalesce(${deliveryOrders.dispatchedAt}, ${deliveryOrders.createdAt})`, end)
      )
    );
  // Thực thu đại lý: paidAt lưu 'YYYY-MM-DD' nên LIKE theo tháng là chính xác.
  const [receipts] = await db
    .select({ received: sql<number>`coalesce(sum(${partnerReceipts.amount}), 0)` })
    .from(partnerReceipts)
    .where(
      and(
        eq(partnerReceipts.status, 'ACTIVE'),
        sql`${partnerReceipts.paidAt} LIKE ${month + '%'}`
      )
    );

  // Đơn lẻ theo kênh: ONLINE riêng; bán lẻ = FAIR_EVENT + RETAIL_OFFICE.
  const [online] = await db
    .select({
      orders: sql<number>`count(*)`,
      revenue: sql<number>`coalesce(sum(${orders.finalAmount}), 0)`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.channel, 'ONLINE'),
        eq(orders.status, 'COMPLETED'),
        gte(orders.createdAt, start),
        lt(orders.createdAt, end)
      )
    );
  const retailRows = await db
    .select({
      paymentMethod: orders.paymentMethod,
      orders: sql<number>`count(*)`,
      revenue: sql<number>`coalesce(sum(${orders.finalAmount}), 0)`,
    })
    .from(orders)
    .where(
      and(
        sql`${orders.channel} IN ('FAIR_EVENT', 'RETAIL_OFFICE')`,
        eq(orders.status, 'COMPLETED'),
        gte(orders.createdAt, start),
        lt(orders.createdAt, end)
      )
    )
    .groupBy(orders.paymentMethod);

  const retailOrders = retailRows.reduce((s, r) => s + num(r.orders), 0);
  const retailRevenue = retailRows.reduce((s, r) => s + num(r.revenue), 0);
  const cash = retailRows
    .filter((r) => r.paymentMethod === 'CASH')
    .reduce((s, r) => s + num(r.revenue), 0);

  // Bán sỉ tại quầy — kênh riêng, không gộp vào bán lẻ hay đại lý công nợ.
  const [wholesale] = await db
    .select({
      orders: sql<number>`count(*)`,
      revenue: sql<number>`coalesce(sum(${orders.finalAmount}), 0)`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.channel, 'WHOLESALE_PARTNER'),
        eq(orders.status, 'COMPLETED'),
        gte(orders.createdAt, start),
        lt(orders.createdAt, end)
      )
    );

  const receivable = num(agency?.receivable);
  const received = num(receipts?.received);
  return {
    agency: {
      orders: num(agency?.orders),
      receivable,
      received,
      balance: receivable - received,
    },
    online: { orders: num(online?.orders), revenue: num(online?.revenue) },
    retail: {
      orders: retailOrders,
      revenue: retailRevenue,
      cash,
      bankQr: retailRevenue - cash,
    },
    wholesale: { orders: num(wholesale?.orders), revenue: num(wholesale?.revenue) },
  };
}

export interface PendingCostLot {
  lotId: string;
  productId: string;
  editionId: string | null;
  warehouseId: string;
  receivedQty: number;
  firstReceivedAt: string | null;
}

function assertOwner(role: UserRole) {
  if (role !== 'ROLE_OWNER') throw AppError.forbidden('Chỉ chủ mới được xem và nhập giá vốn.');
}

/**
 * Các lô hàng đã nhập kho nhưng chưa có giá vốn (bút toán RECEIPT có lotId
 * mà unitCostSnapshot NULL). Chủ thấy thẻ nhắc và nhập giá vốn sau.
 */
export async function listPendingCostLots(actorRole: UserRole): Promise<PendingCostLot[]> {
  assertOwner(actorRole);
  const rows = await db
    .select({
      lotId: inventoryLedger.lotId,
      productId: inventoryLedger.productId,
      editionId: inventoryLedger.editionId,
      warehouseId: inventoryLedger.warehouseId,
      receivedQty: sql<number>`coalesce(sum(${inventoryLedger.quantityDelta}), 0)`,
      firstReceivedAt: sql<string | null>`min(${inventoryLedger.effectiveAt})`,
    })
    .from(inventoryLedger)
    .where(
      and(
        eq(inventoryLedger.eventType, 'RECEIPT'),
        sql`${inventoryLedger.lotId} IS NOT NULL`,
        sql`${inventoryLedger.unitCostSnapshot} IS NULL`
      )
    )
    .groupBy(
      inventoryLedger.lotId,
      inventoryLedger.productId,
      inventoryLedger.editionId,
      inventoryLedger.warehouseId
    )
    .orderBy(sql`min(${inventoryLedger.effectiveAt})`);
  return rows.map((r) => ({
    lotId: `${r.lotId}`,
    productId: `${r.productId}`,
    editionId: r.editionId,
    warehouseId: `${r.warehouseId}`,
    receivedQty: Number(r.receivedQty),
    firstReceivedAt: r.firstReceivedAt,
  }));
}

/**
 * Chủ nhập/sửa giá vốn cho một lô (áp cho các bút toán RECEIPT của lô).
 * Mặc định chỉ điền chỗ đang NULL; force=true để ghi đè khi sửa sai.
 * Ghi audit log cũ → mới để đối soát.
 */
export async function setLotCost(params: {
  lotId: string;
  unitCost: number;
  force?: boolean;
  actorRole: UserRole;
  actorId: string;
}) {
  assertOwner(params.actorRole);
  const lotId = `${params.lotId || ''}`.trim();
  if (!lotId) throw AppError.invalid('Thiếu lotId.');
  const cost = Number(params.unitCost);
  if (!Number.isFinite(cost) || cost < 0) throw AppError.invalid('Giá vốn phải là số không âm.');

  return withDbRetry(async () => {
    const existing = await db
      .select({
        unitCostSnapshot: inventoryLedger.unitCostSnapshot,
        quantityDelta: inventoryLedger.quantityDelta,
      })
      .from(inventoryLedger)
      .where(
        and(
          eq(inventoryLedger.lotId, lotId),
          eq(inventoryLedger.eventType, 'RECEIPT')
        )
      );
    if (existing.length === 0) throw AppError.invalid(`Lô ${lotId} không tồn tại.`);
    const nullCount = existing.filter((e) => e.unitCostSnapshot === null).length;
    const oldCost = existing.find((e) => e.unitCostSnapshot !== null)?.unitCostSnapshot;
    if (nullCount === 0 && !params.force) {
      throw AppError.conflict(`Lô ${lotId} đã có giá vốn ${Number(oldCost)}. Truyền force để ghi đè.`);
    }
    const conds: any[] = [
      eq(inventoryLedger.lotId, lotId),
      eq(inventoryLedger.eventType, 'RECEIPT'),
    ];
    if (!params.force) conds.push(sql`${inventoryLedger.unitCostSnapshot} IS NULL`);
    await db.transaction(async (tx) => {
      await tx
        .update(inventoryLedger)
        .set({ unitCostSnapshot: cost })
        .where(and(...conds));
    });
    const qty = existing.reduce((s, e) => s + Number(e.quantityDelta || 0), 0);
    await recordAuditLog({
      action: 'LOT_COST' as any,
      actorRole: params.actorRole,
      actorId: params.actorId,
      resource: '/api/owner/lots',
      details: `Nhập giá vốn lô ${lotId}: ${oldCost === undefined || oldCost === null ? 'chưa có' : Number(oldCost)} → ${cost} (${qty} cuốn${params.force ? ', ghi đè' : ''}).`,
    });
    return { lotId, unitCost: cost, updatedEntries: params.force ? existing.length : nullCount };
  });
}

export interface LotMovement {
  lotId: string | null;
  unitCost: number | null;
  /** Dương = nhập, âm = xuất. */
  qty: number;
  /** Mốc thời gian ISO để sắp xếp phát lại. */
  at: string;
}

export interface FifoCogsResult {
  dispatchedQty: number;
  /** Giá vốn xác định được trong kỳ. */
  cogs: number;
  /** Số cuốn xuất ra nhưng lô chưa có giá vốn (hiện "chưa có giá vốn", không tính bừa 0). */
  unknownQty: number;
}

/**
 * Tính giá vốn hàng bán trong kỳ theo FIFO — phát lại sổ cái theo thứ tự thời gian.
 * Lô về trước xuất trước; lô chưa có giá vốn thì đếm vào unknownQty chứ không
 * gán 0 (gán 0 sẽ làm biên lợi nhuận ảo cao).
 * Thuần logic — test trực tiếp không cần DB.
 */
export function allocateFifoCogs(
  movements: LotMovement[],
  startIso: string,
  endIso: string
): FifoCogsResult {
  // Chuẩn hóa 'YYYY-MM-DDTHH:MM:SS.sssZ' và 'YYYY-MM-DD HH:MM:SS' về cùng dạng
  // trước khi so sánh chuỗi — 'T' (0x54) > ' ' (0x20) nên so trực tiếp sẽ xếp
  // sai thứ tự và lọt kỳ (bug biên tháng).
  const norm = (s: string) => `${s || ''}`.replace('T', ' ').slice(0, 19);
  const start = norm(startIso);
  const end = norm(endIso);
  const sorted = [...movements].sort((a, b) => {
    const x = norm(a.at);
    const y = norm(b.at);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const queue: Array<{ lotId: string | null; unitCost: number | null; remaining: number }> = [];
  let dispatchedQty = 0;
  let cogs = 0;
  let unknownQty = 0;

  const consume = (qty: number, inPeriod: boolean) => {
    let need = qty;
    while (need > 0 && queue.length > 0) {
      const lot = queue[0];
      const take = Math.min(need, lot.remaining);
      if (inPeriod) {
        if (lot.unitCost === null || !Number.isFinite(lot.unitCost)) unknownQty += take;
        else cogs += take * lot.unitCost;
      }
      lot.remaining -= take;
      need -= take;
      if (lot.remaining <= 0) queue.shift();
    }
    // Xuất vượt tồn (lẽ ra bị chặn ở recordMovement) → tính vào chưa rõ giá vốn.
    if (need > 0 && inPeriod) unknownQty += need;
  };

  for (const m of sorted) {
    if (!Number.isInteger(m.qty) || m.qty === 0) continue;
    if (m.qty > 0) {
      queue.push({ lotId: m.lotId, unitCost: m.unitCost, remaining: m.qty });
    } else {
      const nat = norm(m.at);
      const inPeriod = nat >= start && nat < end;
      if (inPeriod) dispatchedQty += -m.qty;
      consume(-m.qty, inPeriod);
    }
  }
  return { dispatchedQty, cogs: Math.round(cogs), unknownQty };
}
