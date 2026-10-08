import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { db, deliveryOrders, partnerReceipts, orders } from '@/db';

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

export interface ChannelRevenue {
  agency: AgencyChannel;
  online: SimpleChannel;
  retail: RetailChannel;
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
  };
}
