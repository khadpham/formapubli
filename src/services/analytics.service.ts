import { db, orders, orderItems, editions, stockBalances, warehouses, inventoryLedger, sponsorshipDrawdowns } from '../db';
import { eq, and, gte, lte, sql, like } from 'drizzle-orm';

// Bước 5 — OLAP read-only: mọi số liệu băm trực tiếp từ single source of truth
// (orders/order_items/ledger). Không copy ngày→tuần→tháng, không bảng mới.

export interface DateRange {
  startDate?: string;
  endDate?: string;
}

function rangeConds(table: typeof orders, range: DateRange) {
  const conds = [eq(table.status, 'COMPLETED')];
  if (range.startDate) conds.push(gte(table.createdAt, range.startDate));
  if (range.endDate) conds.push(lte(table.createdAt, range.endDate));
  return and(...conds);
}

/** Thứ 2 đầu tuần hiện tại (giờ server), ISO string để so sánh createdAt. */
function mondayOf(offsetWeeks = 0): Date {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // Mon=0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day + offsetWeeks * 7);
  return d;
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
        .where(and(eq(orders.status, 'COMPLETED'), gte(orders.createdAt, from), lte(orders.createdAt, to)))
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
    const out = [];
    for (const wh of whs) {
      const bals = await db.select().from(stockBalances).where(eq(stockBalances.warehouseId, wh.id));
      const heldQty = bals.reduce((s, b) => s + (b.physicalQuantity || 0), 0);
      const conds = [eq(inventoryLedger.warehouseId, wh.id), eq(inventoryLedger.eventType, 'CONSIGNMENT_SOLD')];
      if (range.startDate) conds.push(gte(inventoryLedger.recordedAt, range.startDate));
      if (range.endDate) conds.push(lte(inventoryLedger.recordedAt, range.endDate));
      const soldRows = await db
        .select({ qty: sql<number>`COALESCE(SUM(${inventoryLedger.quantityDelta}), 0)` })
        .from(inventoryLedger)
        .where(and(...conds));
      // Giá trị tồn theo giá bìa (ước tính quản trị)
      let heldValue = 0;
      for (const b of bals) {
        const ed = await db.select({ coverPrice: editions.coverPrice }).from(editions).where(eq(editions.id, b.editionId)).limit(1);
        heldValue += (b.physicalQuantity || 0) * (ed[0]?.coverPrice || 0);
      }
      out.push({
        warehouseId: wh.id,
        warehouseName: wh.name,
        heldQty,
        heldValue,
        soldQty: Math.abs(Number(soldRows[0]?.qty || 0)),
        skuCount: bals.filter((b) => (b.physicalQuantity || 0) > 0).length,
      });
    }
    return out.sort((a, b) => b.heldValue - a.heldValue);
  }

  /** Ma trận dòng tiền: doanh thu theo kênh + COD phải thu/đã về + tài trợ đã rút. */
  static async cashflow(range: DateRange = {}) {
    const channels = await this.byChannel(range);
    const codConds = [eq(orders.status, 'COMPLETED')];
    if (range.startDate) codConds.push(gte(orders.createdAt, range.startDate));
    if (range.endDate) codConds.push(lte(orders.createdAt, range.endDate));
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
    if (range.startDate) spfConds.push(gte(sponsorshipDrawdowns.createdAt, range.startDate));
    if (range.endDate) spfConds.push(lte(sponsorshipDrawdowns.createdAt, range.endDate));
    const spfRows = await db
      .select({
        value: sql<number>`COALESCE(SUM(${sponsorshipDrawdowns.drawnValue}), 0)`,
        qty: sql<number>`COALESCE(SUM(${sponsorshipDrawdowns.quantity}), 0)`,
      })
      .from(sponsorshipDrawdowns)
      .where(spfConds.length > 0 ? and(...spfConds) : undefined);
    const sponsorshipDrawnValue = Number(spfRows[0]?.value || 0);
    const sponsorshipDrawnQty = Number(spfRows[0]?.qty || 0);
    const salesRevenue = channels.filter((c) => c.channel !== 'SPONSORSHIP').reduce((s, c) => s + c.revenue, 0);
    return { channels, salesRevenue, codPending, codReceived, sponsorshipDrawnValue, sponsorshipDrawnQty };
  }
}
