import { eq, ne, or } from 'drizzle-orm';
import { orders } from '@/db';

/**
 * Guard doanh thu Shopee — MỘT CHỖ duy nhất.
 *
 * Đơn Shopee (`channel='SHOPEE'`) mới đóng gói (shippingStatus != 'DELIVERED')
 * CHƯA phải doanh thu: khách có thể hủy, bưu tá có thể giao thất bại. Mọi báo
 * cáo doanh thu phải AND thêm điều kiện này — nếu không số phồng ảo mà test
 * cũ vẫn xanh (test cũ không có đơn SHOPEE nào).
 */
export function shopeeDeliveredOnly() {
  return or(ne(orders.channel, 'SHOPEE'), eq(orders.shippingStatus, 'DELIVERED'));
}

/** Bản JS thuần cho code lọc trong bộ nhớ (getSalesSummary). */
export function isCountedRevenue(o: { channel?: string | null; shippingStatus?: string | null }): boolean {
  if ((o.channel || '') !== 'SHOPEE') return true;
  return (o.shippingStatus || '') === 'DELIVERED';
}
