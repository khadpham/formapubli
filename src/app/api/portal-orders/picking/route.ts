import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { db, orders, orderItems, customers } from '@/db';
import { eq, and } from 'drizzle-orm';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

/**
 * GET /api/portal-orders/picking — Danh sách soạn hàng cho thủ kho.
 *
 * Chỉ trả về thông tin đóng gói (KHÔNG có giá/doanh thu):
 * - Tên, SĐT, địa chỉ khách
 * - Danh sách sách + số lượng
 * - Trạng thái shipping hiện tại
 *
 * Quyền: ROLE_WAREHOUSE, ROLE_MANAGER, ROLE_OWNER
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
    ] as UserRole[]);

    // Lấy đơn ONLINE đang PENDING (chưa hoàn tất)
    const pendingOrders = await db
      .select({
        id: orders.id,
        orderCode: orders.orderCode,
        customerName: orders.customerName,
        shippingStatus: orders.shippingStatus,
        trackingCode: orders.trackingCode,
        paymentMethod: orders.paymentMethod,
        note: orders.note,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(
        and(eq(orders.channel, 'ONLINE'), eq(orders.status, 'PENDING_CONFIRMATION')),
      )
      .orderBy(orders.createdAt);

    // Lấy items + thông tin customer cho từng đơn
    const result = [];
    for (const ord of pendingOrders) {
      const items = await db
        .select({
          editionId: orderItems.editionId,
          quantity: orderItems.quantity,
          isGiftLine: orderItems.isGiftLine,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, ord.id));

      // Parse SĐT + địa chỉ từ note (format: "SĐT: ..., Địa chỉ: ...")
      const note = ord.note || '';
      const phoneMatch = note.match(/SĐT:\s*([^.]+)/);
      const addrMatch = note.match(/Địa chỉ:\s*([^.]+)/);

      result.push({
        id: ord.id,
        orderCode: ord.orderCode,
        customerName: ord.customerName,
        phone: phoneMatch?.[1]?.trim() || '',
        address: addrMatch?.[1]?.trim() || '',
        paymentMethod: ord.paymentMethod,
        shippingStatus: ord.shippingStatus,
        trackingCode: ord.trackingCode,
        createdAt: ord.createdAt,
        items: items.map((it) => ({
          editionId: it.editionId,
          quantity: Number(it.quantity),
          isGift: !!it.isGiftLine,
        })),
      });
    }

    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    return handleApiError(e);
  }
}
