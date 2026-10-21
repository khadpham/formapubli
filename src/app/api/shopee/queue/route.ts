import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { db, orders, shopeeQuarantine } from '@/db';
import { getShopeeOpsWarehouses } from '@/services/shopee/shop-config';

export const dynamic = 'force-dynamic';

/**
 * GET /api/shopee/queue - đơn chờ gói (CREATED) + đơn lỗi chờ xử lý.
 * Chủ/quản lý thấy hết; nhân viên Shopee chỉ thấy kho được cấp.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
      'ROLE_SHOPEE_OPS',
    ] as UserRole[]);
    const wherePack =
      session.role === 'ROLE_SHOPEE_OPS'
        ? and(
            eq(orders.channel, 'SHOPEE'),
            eq(orders.shippingStatus, 'CREATED'),
            inArray(orders.warehouseId, await getShopeeOpsWarehouses())
          )
        : and(eq(orders.channel, 'SHOPEE'), eq(orders.shippingStatus, 'CREATED'));
    const toPack = await db
      .select({
        id: orders.id,
        idempotencyKey: orders.idempotencyKey,
        customerName: orders.customerName,
        finalAmount: orders.finalAmount,
        paymentMethod: orders.paymentMethod,
        carrier: orders.carrier,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(wherePack)
      .orderBy(desc(orders.createdAt))
      .limit(100);
    // D1: đơn đã giao cho vận chuyển (PICKED_UP) nhưng chưa xác nhận khách
    // nhận hàng - hóa đơn của các đơn này đang bị giữ lại chờ xác nhận.
    const whereConfirm =
      session.role === 'ROLE_SHOPEE_OPS'
        ? and(
            eq(orders.channel, 'SHOPEE'),
            eq(orders.shippingStatus, 'PICKED_UP'),
            inArray(orders.warehouseId, await getShopeeOpsWarehouses())
          )
        : and(eq(orders.channel, 'SHOPEE'), eq(orders.shippingStatus, 'PICKED_UP'));
    const shipped = await db
      .select({
        id: orders.id,
        idempotencyKey: orders.idempotencyKey,
        customerName: orders.customerName,
        finalAmount: orders.finalAmount,
        paymentMethod: orders.paymentMethod,
        carrier: orders.carrier,
        trackingCode: orders.trackingCode,
        deliveryConfirmedAt: orders.deliveryConfirmedAt,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(whereConfirm)
      .orderBy(desc(orders.createdAt))
      .limit(100);
    const bad = await db
      .select()
      .from(shopeeQuarantine)
      .where(eq(shopeeQuarantine.resolved, 0))
      .orderBy(desc(shopeeQuarantine.createdAt))
      .limit(100);
    return NextResponse.json({
      success: true,
      data: {
        toPack: toPack.map((o) => ({
          id: o.id,
          orderSn: `${o.idempotencyKey || ''}`.replace(/^shopee-/, ''),
          customerName: o.customerName,
          finalAmount: o.finalAmount,
          paymentMethod: o.paymentMethod,
          carrier: o.carrier,
          createdAt: o.createdAt,
        })),
        toConfirm: shipped
          .filter((o) => !o.deliveryConfirmedAt)
          .map((o) => ({
            id: o.id,
            orderSn: `${o.idempotencyKey || ''}`.replace(/^shopee-/, ''),
            customerName: o.customerName,
            finalAmount: o.finalAmount,
            paymentMethod: o.paymentMethod,
            carrier: o.carrier,
            trackingCode: o.trackingCode,
            createdAt: o.createdAt,
          })),
        quarantine: bad,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
