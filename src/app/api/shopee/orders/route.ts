import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { db, orders, orderItems, products } from '@/db';
import { getShopeeOpsWarehouses } from '@/services/shopee/shop-config';

export const dynamic = 'force-dynamic';

/**
 * GET /api/shopee/orders?tab=all|moi|ban_giao|dang_giao|hoan_thanh|huy_hoan_tra&channel=all|ONLINE|SHOPEE&q=
 *
 * Hub Đơn online: MỘT danh sách đơn hợp nhất 2 kênh (portal ONLINE + Shopee),
 * theo khung trạng thái vòng đời hợp nhất (tài liệu phan-tich-shopee-hoa-don-escrow-tab-hub-2026-10-20.md mục 3.2):
 * - moi (Mới): CREATED - vừa về, chờ đóng gói
 * - ban_giao (Đã bàn giao VC): PICKED_UP - đã giao đơn vị vận chuyển
 * - dang_giao (Đang giao): IN_TRANSIT
 * - hoan_thanh (Hoàn thành): DELIVERED
 * - huy_hoan_tra (Hủy/Hoàn trả): CANCELLED / FAILED / RETURNED
 */
const TAB_FILTER: Record<string, any> = {
  moi: eq(orders.shippingStatus, 'CREATED'),
  ban_giao: eq(orders.shippingStatus, 'PICKED_UP'),
  dang_giao: eq(orders.shippingStatus, 'IN_TRANSIT'),
  hoan_thanh: eq(orders.shippingStatus, 'DELIVERED'),
  huy_hoan_tra: or(
    inArray(orders.shippingStatus, ['RETURNED', 'FAILED']),
    eq(orders.status, 'CANCELLED')
  ),
};

const ONLINE_CHANNELS = ['ONLINE', 'SHOPEE'];

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
    const channel = sp.get('channel') || 'all';
    const q = (sp.get('q') || '').trim();

    const conds: any[] = [inArray(orders.channel, ONLINE_CHANNELS)];
    if (channel === 'ONLINE' || channel === 'SHOPEE') {
      conds.push(eq(orders.channel, channel));
    }
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

    const rows = await db
      .select({
        id: orders.id,
        orderCode: orders.orderCode,
        channel: orders.channel,
        orderSn: sql<string>`CASE WHEN ${orders.channel} = 'SHOPEE' THEN REPLACE(${orders.idempotencyKey}, 'shopee-', '') ELSE ${orders.orderCode} END`,
        customerName: orders.customerName,
        finalAmount: orders.finalAmount,
        paymentMethod: orders.paymentMethod,
        status: orders.status,
        shippingStatus: orders.shippingStatus,
        carrier: orders.carrier,
        trackingCode: orders.trackingCode,
        invoiceStatus: orders.invoiceStatus,
        deliveryConfirmedAt: orders.deliveryConfirmedAt,
        packedAt: orders.packedAt,
        awbPrintedAt: orders.awbPrintedAt,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(and(...conds))
      .orderBy(desc(orders.createdAt))
      .limit(100);

    // Đếm từng tab vòng đời (theo kênh đang lọc).
    const counts: Record<string, number> = {};
    for (const [key, filter] of Object.entries(TAB_FILTER)) {
      const base: any[] = [inArray(orders.channel, ONLINE_CHANNELS)];
      if (channel === 'ONLINE' || channel === 'SHOPEE') base.push(eq(orders.channel, channel));
      if (session.role === 'ROLE_SHOPEE_OPS') {
        base.push(inArray(orders.warehouseId, await getShopeeOpsWarehouses()));
      }
      const r = await db
        .select({ c: sql<number>`COUNT(*)` })
        .from(orders)
        .where(and(...base, filter as any));
      counts[key] = Number(r[0]?.c || 0);
    }
    const totalConds: any[] = [inArray(orders.channel, ONLINE_CHANNELS)];
    if (channel === 'ONLINE' || channel === 'SHOPEE') totalConds.push(eq(orders.channel, channel));
    if (session.role === 'ROLE_SHOPEE_OPS') {
      totalConds.push(inArray(orders.warehouseId, await getShopeeOpsWarehouses()));
    }
    const totalR = await db
      .select({ c: sql<number>`COUNT(*)` })
      .from(orders)
      .where(and(...totalConds));
    counts.all = Number(totalR[0]?.c || 0);

    // Dòng hàng cho các đơn trong trang.
    const orderIds = rows.map((r) => r.id);
    const itemsByOrder: Record<string, Array<{ name: string; quantity: number }>> = {};
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
