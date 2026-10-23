import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { getShopeeConfig } from '@/services/shopee/shop-config';
import { getTrackingNumber } from '@/services/shopee/shipment';
import { db, orders } from '@/db';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/**
 * POST /api/shopee/sync-tracking - Lấy mã vận đơn từ Shopee cho đơn thiếu.
 * Body: { orderSn }
 */
export async function POST(req: NextRequest) {
  try {
    await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
      'ROLE_SHOPEE_OPS',
    ] as UserRole[]);
    const body = await req.json().catch(() => ({}));
    const orderSn = `${body.orderSn || ''}`.trim();
    if (!orderSn) {
      return NextResponse.json({ success: false, error: 'Thiếu mã đơn.' }, { status: 400 });
    }

    const partnerId = Number(process.env.SHOPEE_PARTNER_ID || '0');
    const partnerKey = `${process.env.SHOPEE_PARTNER_KEY || ''}`;
    const baseUrl = `${process.env.SHOPEE_BASE_URL || 'https://partner.shopeemobile.com'}`.replace(/\/$/, '');
    const shopId = Number(process.env.SHOPEE_SHOP_ID || '0') || 0;
    const shopCfg = await getShopeeConfig();

    const trackingCode = await getTrackingNumber(
      { shopId, partnerId, partnerKey, baseUrl, warehouseId: shopCfg.warehouseId, codEnabled: shopCfg.codEnabled },
      orderSn
    );

    if (!trackingCode) {
      return NextResponse.json({ success: false, error: 'Shopee chưa có mã vận đơn cho đơn này.' }, { status: 404 });
    }

    // Cập nhật vào DB
    await db.update(orders)
      .set({ trackingCode })
      .where(eq(orders.idempotencyKey, `shopee-${orderSn}`));

    return NextResponse.json({ success: true, data: { trackingCode } });
  } catch (error: any) {
    return handleApiError(error);
  }
}
