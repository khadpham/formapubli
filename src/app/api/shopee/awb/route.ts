import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { getAwbPdf } from '@/services/shopee/shipment';
import { getShopeeConfig, isShopeeOrderInScope } from '@/services/shopee/shop-config';

export const dynamic = 'force-dynamic';

/**
 * GET /api/shopee/awb?orderSn=... — PDF vận đơn A6.
 * Cùng allowlist + chặn phạm vi kho như /api/shopee/ship.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
      'ROLE_SHOPEE_OPS',
    ] as UserRole[]);
    const orderSn = `${new URL(req.url).searchParams.get('orderSn') || ''}`.trim();
    if (!orderSn) {
      return NextResponse.json({ success: false, error: 'Thiếu mã đơn Shopee.' }, { status: 400 });
    }
    if (!(await isShopeeOrderInScope(orderSn, session.role))) {
      return NextResponse.json({ success: false, error: 'Đơn ngoài kho được cấp.' }, { status: 403 });
    }
    const partnerId = Number(process.env.SHOPEE_PARTNER_ID || '0');
    const partnerKey = `${process.env.SHOPEE_PARTNER_KEY || ''}`;
    const baseUrl =
      `${process.env.SHOPEE_BASE_URL || 'https://partner.shopeemobile.com'}`.replace(/\/$/, '');
    const shopId = Number(process.env.SHOPEE_SHOP_ID || '0') || 0;
    const shopCfg = await getShopeeConfig();
    const pdf = await getAwbPdf(
      {
        shopId,
        partnerId,
        partnerKey,
        baseUrl,
        warehouseId: shopCfg.warehouseId,
        codEnabled: shopCfg.codEnabled,
      },
      orderSn
    );
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="shopee-${orderSn}.pdf"`,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
