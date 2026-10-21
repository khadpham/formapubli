import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { db, orders, orderItems, products } from '@/db';
import { getShopeeOpsWarehouses } from '@/services/shopee/shop-config';

export const dynamic = 'force-dynamic';

/**
 * GET /api/shopee/orders?tab=all|to_confirm|to_ship|shipping|delivered|returns&q=&carrier=
 * Hub đơn Shopee: đọc từ DB (đơn đã sync), phân tab theo shippingStatus.
 * - to_confirm (Chờ xác nhận): CREATED - cần đóng gói
 * - to_ship (Chờ lấy hàng): PICKED_UP - đã giao ĐVVC chờ lấy
 * - shipping (Đang giao): IN_TRANSIT
 * - delivered (Đã giao): DELIVERED
 * - returns (Trả hàng/Hủy): RETURNED, FAILED hoặc status CANCELLED
 */
const TAB_FILTER: Record<string, any> = {
  to_confirm: eq(orders.shippingStatus, 'CREATED'),
  to_ship: eq(orders.shippingStatus, 'PICKED_UP'),
  shipping: eq(orders.shippingStatus, 'IN_TRANSIT'),
  delivered: eq(orders.shippingStatus, 'DELIVERED'),
  returns: or(
    inArray(orders.shippingStatus, ['RETURNED', 'FAILED']),
    eq(orders.status, 'CANCELLED')
  ),
};

export async function GET(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
      'ROLE_SHOPEE_OPS',
    ] as UserRole[]);
    const sp = req.nextUrl.searchParams;
    const tab = sp.get('tab') || 'all';
    const q = (sp.get('q') || '').trim();
    const carrier = (sp.get('carrier') || '').trim();

    const conds: any[] = [eq(orders.channel, 'SHOPEE')];
    if (session.role === 'ROLE_SHOPEE_OPS') {
      conds.push(inArray(orders.warehouseId, await getShopeeOpsWarehouses()));
    }
    if (TAB_FILTER[tab]) conds.push(TAB_FILTER[tab]);
    if (q) {
      conds.push(
        or(
          like(orders.idempotencyKey, `%${q}%`),
          like(orders.orderCode, `%${q}%`),
          like(orders.customerName, `%${q}%`)
        )
      );
    }
    if (carrier) conds.push(eq(orders.carrier, carrier));

    const rows = await db
      .select({
        id: orders.id,
        orderCode: orders.orderCode,
        orderSn: sql<string>`REPLACE(${orders.idempotencyKey}, 'shopee-', '')`,
        customerName: orders.customerName,
        finalAmount: orders.finalAmount,
        paymentMethod: orders.paymentMethod,
        status: orders.status,
        shippingStatus: orders.shippingStatus,
        carrier: orders.carrier,
        trackingCode: orders.trackingCode,
        invoiceStatus: orders.invoiceStatus,
        deliveryConfirmedAt: orders.deliveryConfirmedAt,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(and(...conds))
      .orderBy(desc(orders.createdAt))
      .limit(100);

    // Đếm từng tab để hiện badge số lượng.
    const counts: Record<string, number> = {};
    for (const [key, filter] of Object.entries(TAB_FILTER)) {
      const base = [eq(orders.channel, 'SHOPEE')];
      if (session.role === 'ROLE_SHOPEE_OPS') {
        base.push(inArray(orders.warehouseId, await getShopeeOpsWarehouses()));
      }
      const r = await db
        .select({ c: sql<number>`COUNT(*)` })
        .from(orders)
        .where(and(...base, filter as any));
      counts[key] = Number(r[0]?.c || 0);
    }
    const totalR = await db
      .select({ c: sql<number>`COUNT(*)` })
      .from(orders)
      .where(
        session.role === 'ROLE_SHOPEE_OPS'
          ? and(
              eq(orders.channel, 'SHOPEE'),
              inArray(orders.warehouseId, await getShopeeOpsWarehouses())
            )
          : eq(orders.channel, 'SHOPEE')
      );
    counts.all = Number(totalR[0]?.c || 0);

    // Lấy dòng hàng cho các đơn trong trang.
    const orderIds = rows.map((r) => r.id);
    let itemsByOrder: Record<string, Array<{ name: string; quantity: number }>> = {};
    if (orderIds.length > 0) {
      const items = await db
        .select({
          orderId: orderItems.orderId,
          name: products.name,
          quantity: orderItems.quantity,
        })
        .from(orderItems)
        .innerJoin(products, eq(orderItems.productId, products.id))
        .where(inArray(orderItems.orderId, orderIds));
      for (const it of items) {
        (itemsByOrder[it.orderId] ||= []).push({ name: it.name, quantity: it.quantity });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        orders: rows.map((r) => ({ ...r, items: itemsByOrder[r.id] || [] })),
        counts,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
