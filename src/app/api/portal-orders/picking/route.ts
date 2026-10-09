import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { db, orders, orderItems, editions, works, products } from '@/db';
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

    // Lấy items + tên sản phẩm cho từng đơn (sách: editions+works; hàng hóa: products)
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

      const enriched = [];
      for (const it of items) {
        let code = '';
        let name = '';
        if (it.editionId) {
          const ed = (
            await db
              .select({ code: editions.code, title: editions.title, workTitle: works.title })
              .from(editions)
              .leftJoin(works, eq(editions.workId, works.id))
              .where(eq(editions.id, it.editionId))
              .limit(1)
          )[0];
          if (ed) {
            code = `${ed.code || ''}`;
            name = `${ed.title || ed.workTitle || ''}`;
          } else {
            const p = (
              await db
                .select({ code: products.code, name: products.name })
                .from(products)
                .where(eq(products.id, it.editionId))
                .limit(1)
            )[0];
            if (p) {
              code = `${p.code || ''}`;
              name = `${p.name || ''}`;
            }
          }
        }
        enriched.push({ ...it, code, name });
      }

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
        items: enriched.map((it) => ({
          editionId: it.editionId,
          code: it.code,
          name: it.name,
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
