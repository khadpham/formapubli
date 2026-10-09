import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { db, orders, orderItems, editions, works, products } from '@/db';
import { eq, and, inArray } from 'drizzle-orm';
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

    // Lấy đơn ONLINE đang PENDING (chưa hoàn tất). LIMIT chống 1102 — panel
    // chỉ cần đợi xử lý, không cần 100 đơn cùng lúc.
    const pendingOrders = await db
      .select({
        id: orders.id,
        orderCode: orders.orderCode,
        portalRef: orders.portalRef,
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
      .orderBy(orders.createdAt)
      .limit(50);

    // Gộp items của MỌI đơn thành 1 query (N+1 cũ gọi ~40 lần Turso mỗi poll
    // 5s — nguyên nhân gần CPU limit ⇒ 1102). Rồi gộp editions/products 1 lần.
    const allItems = pendingOrders.length
      ? await db
          .select({
            orderId: orderItems.orderId,
            editionId: orderItems.editionId,
            quantity: orderItems.quantity,
            isGiftLine: orderItems.isGiftLine,
          })
          .from(orderItems)
          .where(inArray(orderItems.orderId, pendingOrders.map((o) => o.id)))
      : [];

    const editionIds = [...new Set(allItems.map((i) => i.editionId).filter(Boolean))] as string[];
    const edRows = editionIds.length
      ? await db
          .select({ id: editions.id, code: editions.code, title: editions.title, workTitle: works.title })
          .from(editions)
          .leftJoin(works, eq(editions.workId, works.id))
          .where(inArray(editions.id, editionIds))
      : [];
    const prodRows = editionIds.length
      ? await db
          .select({ id: products.id, code: products.code, name: products.name })
          .from(products)
          .where(inArray(products.id, editionIds))
      : [];
    const edMap = new Map(edRows.map((e) => [e.id, e]));
    const prodMap = new Map(prodRows.map((p) => [p.id, p]));

    const itemsByOrder = new Map<string, Array<Record<string, any>>>();
    for (const it of allItems) {
      let code = '';
      let name = '';
      if (it.editionId) {
        const ed = edMap.get(it.editionId);
        const p = prodMap.get(it.editionId);
        if (ed) {
          code = `${ed.code || ''}`;
          name = `${ed.title || ed.workTitle || ''}`;
        } else if (p) {
          code = `${p.code || ''}`;
          name = `${p.name || ''}`;
        }
      }
      const arr = itemsByOrder.get(it.orderId) || [];
      arr.push({ editionId: it.editionId, code, name, quantity: Number(it.quantity), isGift: !!it.isGiftLine });
      itemsByOrder.set(it.orderId, arr);
    }

    const result = [];
    for (const ord of pendingOrders) {
      const enriched = itemsByOrder.get(ord.id) || [];

      // Parse SĐT + địa chỉ từ note (format: "SĐT: ..., Địa chỉ: ...")
      const note = ord.note || '';
      const phoneMatch = note.match(/SĐT:\s*([^.]+)/);
      const addrMatch = note.match(/Địa chỉ:\s*([^.]+)/);

      result.push({
        id: ord.id,
        orderCode: ord.orderCode,
        portalRef: ord.portalRef || null,
        customerName: ord.customerName,
        phone: phoneMatch?.[1]?.trim() || '',
        address: addrMatch?.[1]?.trim() || '',
        paymentMethod: ord.paymentMethod,
        shippingStatus: ord.shippingStatus,
        trackingCode: ord.trackingCode,
        createdAt: ord.createdAt,
        items: enriched,
      });
    }

    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    return handleApiError(e);
  }
}
