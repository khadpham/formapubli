import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { pullShopeeOrders } from '@/services/shopee/order-sync';
import { getShopeeConfig, resolveShopeeShopId } from '@/services/shopee/shop-config';

export const dynamic = 'force-dynamic';

/**
 * POST /api/shopee/sync { hours? } - kéo đơn Shopee chủ động (UI nút bấm tay
 * và job định kỳ dùng chung). Mặc định quét 24 giờ qua; tối đa 15 ngày
 * (cửa sổ get_order_list của Shopee).
 */
export async function POST(req: NextRequest) {
  try {
    await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
      'ROLE_SHOPEE_OPS',
    ] as UserRole[]);
    const body = (await req.json().catch(() => ({}))) as { hours?: number };
    const hours = Math.min(Math.max(Number(body.hours || 24) || 24, 1), 15 * 24);
    const partnerId = Number(process.env.SHOPEE_PARTNER_ID || '0');
    const partnerKey = `${process.env.SHOPEE_PARTNER_KEY || ''}`;
    const baseUrl =
      `${process.env.SHOPEE_BASE_URL || 'https://partner.shopeemobile.com'}`.replace(/\/$/, '');
    const shopId = (await resolveShopeeShopId()).shopId;
    const shopCfg = await getShopeeConfig();
    if (!partnerId || !partnerKey || !shopId) {
      return NextResponse.json(
        { success: false, error: 'Chưa cấu hình Shopee (partner/shop).' },
        { status: 400 }
      );
    }
    const timeTo = Math.floor(Date.now() / 1000);
    const timeFrom = timeTo - hours * 3600;
    const result = await pullShopeeOrders(
      { shopId, partnerId, partnerKey, baseUrl, warehouseId: shopCfg.warehouseId, codEnabled: shopCfg.codEnabled },
      timeFrom,
      timeTo
    );
    return NextResponse.json({ success: true, data: { ...result, hours } });
  } catch (error) {
    return handleApiError(error);
  }
}
