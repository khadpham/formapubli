import { db, orders, orderItems, editions, stockBalances, warehouses, inventoryLedger, sponsorshipDrawdowns, returnOrders } from '../db';
import { eq, and, gte, lte, sql, like, inArray } from 'drizzle-orm';
import { businessDateOf, VN_UTC_OFFSET_MIN } from './order.service';

// Bước 5 — OLAP read-only: mọi số liệu băm trực tiếp từ single source of truth
// (orders/order_items/ledger). Không copy ngày→tuần→tháng, không bảng mới.

export interface DateRange {
  startDate?: string;
  endDate?: string;
}

/**
 * So sánh mốc thời gian AN TOÀN cho cột text đang chứa CẢ HAI họ timestamp.
 *
 * Mọi cột thời gian trong CSDL đều là text và đang tồn tại song song:
 *   - SQLite `CURRENT_TIMESTAMP` -> 'YYYY-MM-DD HH:mm:ss'   (dùng khi app KHÔNG
 *     truyền createdAt, ví dụ SponsorshipService.draw tại sponsorship.service.ts:113)
 *   - ISO của app               -> 'YYYY-MM-DDTHH:mm:ss.sssZ' (order.service.ts:563)
 *
 * So CHUỖI THÔ giữa hai họ là vô nghĩa: byte 0x20 (' ') < 0x54 ('T') nên
 *   - mọi dòng ISO trong ngày đều ">= cutoff" dù thực ra đã qua mốc,
 *   - mọi dòng SQLite lại luôn "<= cutoff" dù thực ra còn trong kỳ.
 * `datetime()` của SQLite chuẩn hoá được cả hai họ về cùng một định dạng.
 * Chuẩn này khớp gotcha 7 trong docs/superpowers/plans/2026-09-25-handoff-state.md.
 */
function tsGte(col: any, bound: string) {
  return sql`datetime(${col}) >= datetime(${bound})`;
}
function tsLte(col: any, bound: string) {
  return sql`datetime(${col}) <= datetime(${bound})`;
}

function rangeConds(table: typeof orders, range: DateRange) {
  const conds = [eq(table.status, 'COMPLETED')];
  if (range.startDate) conds.push(tsGte(table.createdAt, range.startDate));
  if (range.endDate) conds.push(tsLte(table.createdAt, range.endDate));
  return and(...conds);
}

/**
 * Thứ 2 đầu tuần hiện tại (giờ VIỆT NAM), ISO string để so sánh `created_at`.
 *
 * Trước đây dùng `getDay`/`setHours`/`setDate` — tức GIỜ CỦA MÁY CHỦ. Máy chủ
 * dev chạy GMT+7 còn Cloudflare Workers chạy UTC, nên cùng một ngày mà "tuần
 * này" lệch nhau 7 tiếng giữa dev và production: cùng dữ liệu, hai kết quả khác
 * nhau, và không ai hiểu vì sao. Dựng thẳng từ ngày nghiệp vụ VN rồi trừ 7 giờ.
 */
function mondayOf(offsetWeeks = 0): Date {
  const now = new Date();
  // Ngày nghiệp vụ VN hôm nay.
  const vnDay = businessDateOf(now);
  const [y, mo, d] = vnDay.split('-').map(Number);
  // getUTCDay trên mốc đã dịch +7h là đúng ngày VN ⇒ Thứ 2 = 0.
  const dow = (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7;
  return new Date(Date.UTC(y, mo - 1, d - dow + offsetWeeks * 7) - VN_UTC_OFFSET_MIN * 60_000);
}

export class AnalyticsService {
  /** Doanh thu + số đơn theo kênh (COMPLETED). SPONSORSHIP hiện 0đ nhưng vẫn liệt kê minh bạch. */
  static async byChannel(range: DateRange = {}) {
    const rows = await db
      .select({
        channel: orders.channel,
        orders: sql<number>`COUNT(*)`,
        revenue: sql<number>`COALESCE(SUM(${orders.finalAmount}), 0)`,
        subtotal: sql<number>`COALESCE(SUM(${orders.subtotal}), 0)`,
      })
      .from(orders)
      .where(rangeConds(orders, range))
      .groupBy(orders.channel);
    const totalRevenue = rows.reduce((s, r) => s + Number(r.revenue || 0), 0);
    return rows.map((r) => ({
      channel: r.channel,
      orders: Number(r.orders || 0),
      revenue: Number(r.revenue || 0),
      subtotal: Number(r.subtotal || 0),
      share: totalRevenue > 0 ? Number(r.revenue || 0) / totalRevenue : 0,
    })).sort((a, b) => b.revenue - a.revenue);
  }

  /** Top sách tuần này (T2–CN) + tăng trưởng WoW so với tuần trước. */
  static async trending(topN = 20) {
    const thisMon = mondayOf(0).toISOString();
    const lastMon = mondayOf(-1).toISOString();
    const agg = async (from: string, to: string) => {
      const rows = await db
        .select({
          editionId: orderItems.editionId,
          qty: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)`,
          revenue: sql<number>`COALESCE(SUM(${orderItems.totalAmount}), 0)`,
        })
        .from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .where(and(eq(orders.status, 'COMPLETED'), tsGte(orders.createdAt, from), tsLte(orders.createdAt, to)))
        .groupBy(orderItems.editionId);
      const map = new Map<string, { qty: number; revenue: number }>();
      for (const r of rows) map.set(r.editionId, { qty: Number(r.qty || 0), revenue: Number(r.revenue || 0) });
      return map;
    };
    const cur = await agg(thisMon, new Date().toISOString());
    const prev = await agg(lastMon, thisMon);
    const ids = Array.from(new Set([...Array.from(cur.keys()), ...Array.from(prev.keys())]));
    const meta = ids.length > 0
      ? await db.select({ id: editions.id, code: editions.code, title: editions.title }).from(editions).where(
          // drizzle inArray import cycle-safe: dùng sql IN
          sql`${editions.id} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`
        )
      : [];
    const metaMap = new Map(meta.map((m) => [m.id, m]));
    const rows = ids.map((id) => {
      const c = cur.get(id) || { qty: 0, revenue: 0 };
      const p = prev.get(id) || { qty: 0, revenue: 0 };
      const wow = p.qty > 0 ? (c.qty - p.qty) / p.qty : c.qty > 0 ? 1 : 0;
      return {
        editionId: id,
        code: metaMap.get(id)?.code || '?',
        title: metaMap.get(id)?.title || '?',
        qtyThisWeek: c.qty,
        qtyLastWeek: p.qty,
        revenueThisWeek: c.revenue,
        wow: Math.round(wow * 1000) / 1000,
      };
    });
    rows.sort((a, b) => b.qtyThisWeek - a.qtyThisWeek || b.revenueThisWeek - a.revenueThisWeek);
    return rows.slice(0, Math.max(1, Math.min(100, topN)));
  }

  /** Ký gửi đa điểm: mỗi kho wh-consign-* đang giữ bao nhiêu + đã bán kỳ này. */
  static async consignment(range: DateRange = {}) {
    const whs = await db.select().from(warehouses).where(like(warehouses.id, 'wh-consign-%'));
    if (whs.length === 0) return [];
    // Số truy vấn cố định (3) bất kể bao nhiêu kho ký gửi và bao nhiêu SKU.
    // Trước đây: mỗi kho × mỗi dòng tồn lại một SELECT editions ⇒ 3 kho × 60 SKU
    // là 127 truy vấn cho một bảng điều khiển read-only.
    const bals = await db
      .select({
        warehouseId: stockBalances.warehouseId,
        editionId: stockBalances.editionId,
        qty: stockBalances.physicalQuantity,
        coverPrice: editions.coverPrice,
      })
      .from(stockBalances)
      .leftJoin(editions, eq(stockBalances.editionId, editions.id))
      .where(inArray(stockBalances.warehouseId, whs.map((w) => w.id)));

    const soldConds = [inArray(inventoryLedger.warehouseId, whs.map((w) => w.id)), eq(inventoryLedger.eventType, 'CONSIGNMENT_SOLD')];
    if (range.startDate) soldConds.push(tsGte(inventoryLedger.recordedAt, range.startDate));
    if (range.endDate) soldConds.push(tsLte(inventoryLedger.recordedAt, range.endDate));
    const soldRows = await db
      .select({
        warehouseId: inventoryLedger.warehouseId,
        qty: sql<number>`COALESCE(SUM(${inventoryLedger.quantityDelta}), 0)`,
      })
      .from(inventoryLedger)
      .where(and(...soldConds))
      .groupBy(inventoryLedger.warehouseId);
    const soldByWh = new Map(soldRows.map((r) => [r.warehouseId, Math.abs(Number(r.qty || 0))]));

    const agg = new Map<string, { heldQty: number; heldValue: number; skuCount: number }>();
    for (const wh of whs) agg.set(wh.id, { heldQty: 0, heldValue: 0, skuCount: 0 });
    for (const b of bals) {
      const slot = agg.get(b.warehouseId);
      if (!slot) continue;
      const qty = Number(b.qty || 0);
      slot.heldQty += qty;
      // Giá trị tồn theo giá bìa (ước tính quản trị)
      slot.heldValue += qty * Number(b.coverPrice || 0);
      if (qty > 0) slot.skuCount++;
    }

    const out = whs.map((wh) => {
      const slot = agg.get(wh.id)!;
      return {
        warehouseId: wh.id,
        warehouseName: wh.name,
        heldQty: slot.heldQty,
        heldValue: slot.heldValue,
        soldQty: soldByWh.get(wh.id) ?? 0,
        skuCount: slot.skuCount,
      };
    });
    return out.sort((a, b) => b.heldValue - a.heldValue);
  }

  /** Sách bán chạy theo kỳ tùy chọn: group order_items của đơn COMPLETED trong range.
   * Trả lời "cuốn nào bán chạy nhất hôm nay / tuần này / tháng này" cho Owner/Manager.
   * - JOIN truc tiep editions (khong IN-list → khong vuot 999 bien SQLite).
   * - Loai tang/tai tro/0d nhu salesByEdition. Loc kho qua orders.warehouseId. */
  static async topEditions(range: DateRange = {}, topN = 20, warehouseId?: string) {
    const conds = [
      eq(orders.status, 'COMPLETED'),
      sql`${orders.discountRate} < 1`,
      sql`${orders.channel} != 'SPONSORSHIP'`,
      sql`${orders.finalAmount} > 0`,
    ];
    if (range.startDate) conds.push(tsGte(orders.createdAt, range.startDate));
    if (range.endDate) conds.push(tsLte(orders.createdAt, range.endDate));
    if (warehouseId) conds.push(eq(orders.warehouseId, warehouseId));
    const rows = await db
      .select({
        editionId: orderItems.editionId,
        code: editions.code,
        title: editions.title,
        qty: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)`,
        revenue: sql<number>`COALESCE(SUM(${orderItems.totalAmount}), 0)`,
        orders: sql<number>`COUNT(DISTINCT ${orderItems.orderId})`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .leftJoin(editions, eq(orderItems.editionId, editions.id))
      .where(and(...conds))
      .groupBy(orderItems.editionId);
    const totalQty = rows.reduce((s, r) => s + Number(r.qty || 0), 0);
    const totalRevenue = rows.reduce((s, r) => s + Number(r.revenue || 0), 0);
    const out = rows.map((r) => ({
      editionId: r.editionId,
      code: r.code || '?',
      title: r.title || '?',
      qty: Number(r.qty || 0),
      orders: Number(r.orders || 0),
      revenue: Number(r.revenue || 0),
      qtyShare: totalQty > 0 ? Number(r.qty || 0) / totalQty : 0,
      revenueShare: totalRevenue > 0 ? Number(r.revenue || 0) / totalRevenue : 0,
    }));
    out.sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);
    return { items: out.slice(0, Math.max(1, Math.min(100, topN))), totalQty, totalRevenue };
  }

  /** Ma trận dòng tiền: doanh thu theo kênh + COD phải thu/đã về + tài trợ đã rút. */
  static async cashflow(range: DateRange = {}) {
    const channels = await this.byChannel(range);
    const codConds = [eq(orders.status, 'COMPLETED')];
    if (range.startDate) codConds.push(tsGte(orders.createdAt, range.startDate));
    if (range.endDate) codConds.push(tsLte(orders.createdAt, range.endDate));
    const codRows = await db
      .select({ codStatus: orders.codStatus, total: sql<number>`COALESCE(SUM(${orders.codAmount}), 0)` })
      .from(orders)
      .where(and(...codConds))
      .groupBy(orders.codStatus);
    let codPending = 0;
    let codReceived = 0;
    for (const r of codRows) {
      if (r.codStatus === 'PENDING') codPending = Number(r.total || 0);
      if (r.codStatus === 'RECEIVED') codReceived = Number(r.total || 0);
    }
    const spfConds = [];
    if (range.startDate) spfConds.push(tsGte(sponsorshipDrawdowns.createdAt, range.startDate));
    if (range.endDate) spfConds.push(tsLte(sponsorshipDrawdowns.createdAt, range.endDate));
    const spfRows = await db
      .select({
        value: sql<number>`COALESCE(SUM(${sponsorshipDrawdowns.drawnValue}), 0)`,
        qty: sql<number>`COALESCE(SUM(${sponsorshipDrawdowns.quantity}), 0)`,
      })
      .from(sponsorshipDrawdowns)
      .where(spfConds.length > 0 ? and(...spfConds) : undefined);
    const sponsorshipDrawnValue = Number(spfRows[0]?.value || 0);
    const sponsorshipDrawnQty = Number(spfRows[0]?.qty || 0);
    const refundConds = [eq(returnOrders.status, 'COMPLETED')];
    if (range.startDate) refundConds.push(tsGte(returnOrders.createdAt, range.startDate));
    if (range.endDate) refundConds.push(tsLte(returnOrders.createdAt, range.endDate));
    const refundRows = await db
      .select({ total: sql<number>`COALESCE(SUM(${returnOrders.refundAmount}), 0)` })
      .from(returnOrders)
      .where(and(...refundConds));
    const completedRefunds = Number(refundRows[0]?.total || 0);

    const salesRevenue = channels.filter((c) => c.channel !== 'SPONSORSHIP').reduce((s, c) => s + c.revenue, 0);
    const netRevenue = salesRevenue - completedRefunds;
    return { channels, salesRevenue, netRevenue, codPending, codReceived, sponsorshipDrawnValue, sponsorshipDrawnQty };
  }
}
