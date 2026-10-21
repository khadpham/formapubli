import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { db, orders } from '@/db';
import { TursoTokenStorage } from '@/services/shopee/token-store';
import { resolveShopeeShopId } from '@/services/shopee/shop-config';

export const dynamic = 'force-dynamic';

/**
 * GET /api/shopee/overview
 * Tổng quan hub Đơn online: đơn hôm nay theo kênh, doanh thu, hàng đợi xử lý,
 * cảnh báo vận hành. Dữ liệu từ DB (nhanh), token check từ shopee_shop_tokens.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_WAREHOUSE', 'ROLE_SHOPEE_OPS'] as UserRole[]);
    const today = new Date().toISOString().slice(0, 10);

    // Đơn hôm nay theo kênh (giờ VN)
    const todayByChannel = await db
      .select({
        channel: orders.channel,
        count: sql<number>`COUNT(*)`,
        revenue: sql<number>`COALESCE(SUM(${orders.finalAmount}), 0)`,
      })
      .from(orders)
      .where(
        and(
          inArray(orders.channel, ['ONLINE', 'SHOPEE']),
          sql`date(datetime(${orders.createdAt}, '+7 hours')) = ${today}`,
          eq(orders.status, 'COMPLETED')
        )
      )
      .groupBy(orders.channel);

    // Hàng đợi: đơn Shopee chờ xử lý theo vòng đời
    const queues = await db
      .select({
        shippingStatus: orders.shippingStatus,
        count: sql<number>`COUNT(*)`,
      })
      .from(orders)
      .where(
        and(
          eq(orders.channel, 'SHOPEE'),
          eq(orders.status, 'COMPLETED'),
          inArray(orders.shippingStatus, ['CREATED', 'PICKED_UP', 'IN_TRANSIT'])
        )
      )
      .groupBy(orders.shippingStatus);

    // Đơn portal chờ xử lý (chưa giao)
    const portalPending = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(orders)
      .where(
        and(
          eq(orders.channel, 'ONLINE'),
          eq(orders.status, 'COMPLETED'),
          inArray(orders.shippingStatus, ['CREATED', 'PICKED_UP', 'IN_TRANSIT'])
        )
      );

    // Cảnh báo: token sắp hết hạn (dưới 1 giờ)
    let tokenAlert: string | null = null;
    try {
      const shopId = await resolveShopeeShopId();
      if (shopId) {
        const store = new TursoTokenStorage(shopId);
        const token = await store.get();
        if (token && token.expired_at) {
          const remainMs = Number(token.expired_at) - Date.now();
          if (remainMs < 60 * 60 * 1000) {
            tokenAlert = remainMs <= 0 ? 'Token Shopee đã hết hạn - cần ủy quyền lại.' : 'Token Shopee sắp hết hạn (dưới 1 giờ).';
          }
        }
      }
    } catch {
      /* bỏ qua cảnh báo token nếu không đọc được */
    }

    // Đơn sắp quá hạn gửi (Shopee: CREATED quá 2 ngày chưa chuẩn bị)
    const overdue = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(orders)
      .where(
        and(
          eq(orders.channel, 'SHOPEE'),
          eq(orders.status, 'COMPLETED'),
          eq(orders.shippingStatus, 'CREATED'),
          sql`datetime(${orders.createdAt}, '+7 hours') < datetime('now', '+7 hours', '-2 days')`
        )
      );

    return NextResponse.json({
      success: true,
      data: {
        todayByChannel: todayByChannel.map((r) => ({
          channel: r.channel,
          count: Number(r.count),
          revenue: Number(r.revenue),
        })),
        queues: queues.map((r) => ({
          shippingStatus: r.shippingStatus,
          count: Number(r.count),
        })),
        portalPending: Number(portalPending[0]?.count || 0),
        alerts: {
          token: tokenAlert,
          overdueShip: Number(overdue[0]?.count || 0),
        },
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
