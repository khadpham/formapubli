import { NextRequest, NextResponse } from 'next/server';
import { desc, eq, and } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { db, shopeeReturns, orders } from '@/db';
import { pullShopeeReturns } from '@/services/shopee/returns-sync';
import { getShopeeConfig, resolveShopeeShopId } from '@/services/shopee/shop-config';

export const dynamic = 'force-dynamic';

const RETURN_LABEL: Record<string, string> = {
  REQUESTED: 'Chờ xử lý',
  PROCESSING: 'Đang xử lý',
  ACCEPTED: 'Đã chấp nhận',
  COMPLETED: 'Hoàn tất',
  CANCELLED: 'Đã hủy',
};

/**
 * GET /api/shopee/returns?type=RETURN_REFUND|FAILED_DELIVERY|CANCELLATION - danh sách theo luồng.
 * - RETURN_REFUND / FAILED_DELIVERY: từ bảng shopee_returns
 * - CANCELLATION: từ bảng orders (đơn SHOPEE bị hủy, không có mã yêu cầu riêng)
 * POST /api/shopee/returns { hours? } - đồng bộ từ Shopee về.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
      'ROLE_SHOPEE_OPS',
    ] as UserRole[]);
    const type = new URL(req.url).searchParams.get('type') || 'RETURN_REFUND';

    if (type === 'CANCELLATION') {
      // Hủy đơn: đơn SHOPEE có status CANCELLED, không có mã yêu cầu riêng
      const rows = await db
        .select({
          orderSn: orders.idempotencyKey,
          orderCode: orders.orderCode,
          status: orders.status,
          shippingStatus: orders.shippingStatus,
          trackingCode: orders.trackingCode,
          finalAmount: orders.finalAmount,
          createdAt: orders.createdAt,
          packedAt: orders.packedAt,
        })
        .from(orders)
        .where(and(eq(orders.channel, 'SHOPEE'), eq(orders.status, 'CANCELLED')))
        .orderBy(desc(orders.createdAt))
        .limit(100);
      return NextResponse.json({
        success: true,
        data: rows.map((r) => ({
          ...r,
          // Bóc mã đơn Shopee từ idempotency_key (dạng shopee-<order_sn>)
          orderSn: String(r.orderSn || '').replace(/^shopee-/, ''),
          // Đã in vận đơn nhưng chưa bàn giao = cần giữ kiện hàng
          needHold: !!r.trackingCode && r.shippingStatus !== 'DELIVERED',
        })),
      });
    }

    const rows = await db
      .select()
      .from(shopeeReturns)
      .where(eq(shopeeReturns.returnType, type))
      .orderBy(desc(shopeeReturns.createdAt))
      .limit(100);
    return NextResponse.json({
      success: true,
      data: rows.map((r) => ({ ...r, statusLabel: RETURN_LABEL[r.status] || r.status })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
      'ROLE_SHOPEE_OPS',
    ] as UserRole[]);
    const body = (await req.json().catch(() => ({}))) as { hours?: number };
    const hours = Math.min(Math.max(Number(body.hours || 72) || 72, 1), 15 * 24);
    const partnerId = Number(process.env.SHOPEE_PARTNER_ID || '0');
    const partnerKey = `${process.env.SHOPEE_PARTNER_KEY || ''}`;
    const baseUrl = `${process.env.SHOPEE_BASE_URL || 'https://partner.shopeemobile.com'}`.replace(/\/$/, '');
    const { shopId } = await resolveShopeeShopId();
    const shopCfg = await getShopeeConfig();
    if (!partnerId || !partnerKey || !shopId) {
      return NextResponse.json({ success: false, error: 'Chưa cấu hình Shopee.' }, { status: 400 });
    }
    const timeTo = Math.floor(Date.now() / 1000);
    const timeFrom = timeTo - hours * 3600;
    const result = await pullShopeeReturns(
      { shopId, partnerId, partnerKey, baseUrl, warehouseId: shopCfg.warehouseId, codEnabled: shopCfg.codEnabled },
      timeFrom,
      timeTo
    );
    return NextResponse.json({ success: true, data: { ...result, hours } });
  } catch (error) {
    return handleApiError(error);
  }
}
