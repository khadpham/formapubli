import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { generateShopeeSign } from '@/services/shopee/sign';

export const dynamic = 'force-dynamic';

/**
 * GET /api/shopee/auth-url — link ủy quyền gian hàng cho Anh bấm (chủ only).
 * Chưa cấu hình key → 400 rõ ràng, không sinh link hỏng.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER'] as UserRole[]);
    const partnerId = Number(process.env.SHOPEE_PARTNER_ID || '0');
    const partnerKey = `${process.env.SHOPEE_PARTNER_KEY || ''}`;
    const baseUrl =
      `${process.env.SHOPEE_BASE_URL || 'https://partner.shopeemobile.com'}`.replace(/\/$/, '');
    if (!partnerId || !partnerKey) {
      return NextResponse.json(
        { success: false, error: 'Chưa cấu hình key Shopee — liên hệ kỹ thuật.' },
        { status: 400 }
      );
    }
    const redirect = `${new URL(req.url).origin}/api/shopee/callback`;
    const apiPath = '/api/v2/shop/auth_partner';
    const { timestamp, sign } = generateShopeeSign({ partnerId, partnerKey, apiPath });
    const url =
      `${baseUrl}${apiPath}?partner_id=${partnerId}&timestamp=${timestamp}` +
      `&sign=${sign}&redirect=${encodeURIComponent(redirect)}`;
    return NextResponse.json({ success: true, data: { url } });
  } catch (error) {
    return handleApiError(error);
  }
}
