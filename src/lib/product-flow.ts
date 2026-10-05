/**
 * Nhịp Bán — insight thuần túy từ buckets ngày + sự kiện bán (quy tắc cố định,
 * không AI). Mọi con số chủ đọc được đều từ hàm này mà ra.
 */

export interface FlowBucket {
  date: string;
  qty: number;
  revenue: number;
  orders: number;
}

export interface FlowEvent {
  createdAt: string | null;
  qty: number;
  orderId: string;
  orderCode: string;
  warehouseId: string;
  channel: string | null;
}

export interface FlowInsights {
  totalQty: number;
  totalRevenue: number;
  totalOrders: number;
  activeDays: number;
  quietDays: number;
  /** Ngày bán nhiều cuốn nhất (hòa theo tiền). */
  peakDay: FlowBucket | null;
  /** Giờ VN bán nhiều cuốn nhất (0-23, null khi chưa có sự kiện). */
  peakHour: number | null;
  /** Tỷ trọng bán tại kho đang xem (0-1). */
  fairShare: number;
  /** Kênh có tổng cuốn lớn nhất. */
  topChannel: string | null;
  /** Tốc độ bán: cuốn / số ngày có bán. */
  pacePerDay: number;
}

export function buildFlowInsights(
  buckets: FlowBucket[],
  events: FlowEvent[],
  focusWarehouseId?: string
): FlowInsights {
  const list = Array.isArray(buckets) ? buckets : [];
  const evts = Array.isArray(events) ? events : [];
  let totalQty = 0;
  let totalRevenue = 0;
  let totalOrders = 0;
  let activeDays = 0;
  let peakDay: FlowBucket | null = null;
  for (const b of list) {
    const q = Number(b.qty || 0);
    totalQty += q;
    totalRevenue += Number(b.revenue || 0);
    totalOrders += Number(b.orders || 0);
    if (q > 0) {
      activeDays += 1;
      if (!peakDay || q > peakDay.qty || (q === peakDay.qty && b.revenue > peakDay.revenue)) peakDay = b;
    }
  }
  const byHour = new Array<number>(24).fill(0);
  let focusQty = 0;
  const byChannel = new Map<string, number>();
  for (const e of evts) {
    const q = Number(e.qty || 0);
    const d = e.createdAt ? new Date(e.createdAt) : null;
    if (d && !Number.isNaN(d.getTime())) {
      byHour[(d.getUTCHours() + 7) % 24] += q;
    }
    if (focusWarehouseId && e.warehouseId === focusWarehouseId) focusQty += q;
    const ch = e.channel || '—';
    byChannel.set(ch, (byChannel.get(ch) || 0) + q);
  }
  let peakHour: number | null = null;
  byHour.forEach((q, h) => {
    if (q > 0 && (peakHour == null || q > byHour[peakHour])) peakHour = h;
  });
  let topChannel: string | null = null;
  byChannel.forEach((q, ch) => {
    if (topChannel == null || q > (byChannel.get(topChannel) || 0)) topChannel = ch;
  });
  return {
    totalQty,
    totalRevenue,
    totalOrders,
    activeDays,
    quietDays: Math.max(0, list.length - activeDays),
    peakDay,
    peakHour,
    fairShare: totalQty > 0 ? focusQty / totalQty : 0,
    topChannel,
    pacePerDay: activeDays > 0 ? Math.round((totalQty / activeDays) * 10) / 10 : 0,
  };
}

/** Giờ VN (0-23) của 1 mốc ISO, không phụ thuộc múi giờ máy. */
export function vnHourOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return (d.getUTCHours() + 7) % 24;
}

/** Ngày VN 'YYYY-MM-DD' của 1 mốc ISO, không phụ thuộc múi giờ máy. */
export function vnDayOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** Nhãn tiền gọn cho cột biểu đồ (Tr/N), đầy đủ để ở tooltip/dải số. */
export function moneyShort(n: number): string {
  if (n >= 1_000_000) {
    const v = Math.round((n / 1_000_000) * 10) / 10;
    return `${v.toLocaleString('vi-VN')}Tr`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)}N`;
  return `${n}`;
}
