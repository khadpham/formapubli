import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForToken } from '@/services/shopee/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/shopee/callback?code=XYZ&shop_id=123
 * Shopee điều hướng về đây sau khi Anh bấm ủy quyền gian hàng.
 * Đổi code lấy token và lưu DB — xong đưa Anh về Cài Đặt.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code') || '';
  const shopId = Number(req.nextUrl.searchParams.get('shop_id') || '0');
  const partnerId = Number(process.env.SHOPEE_PARTNER_ID || '0');
  const partnerKey = `${process.env.SHOPEE_PARTNER_KEY || ''}`;
  const baseUrl =
    `${process.env.SHOPEE_BASE_URL || 'https://partner.shopeemobile.com'}`.replace(/\/$/, '');
  if (!code || !shopId || !partnerId || !partnerKey) {
    return NextResponse.json(
      { success: false, code: 'SHOPEE_AUTH_EXPIRED', error: 'Thiếu code/shop/key Shopee.' },
      { status: 400 }
    );
  }
  try {
    await exchangeCodeForToken({ code, shopId, partnerId, partnerKey, baseUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ủy quyền Shopee thất bại.';
    return NextResponse.json(
      { success: false, code: 'SHOPEE_AUTH_EXPIRED', error: message },
      { status: 502 }
    );
  }
  return NextResponse.redirect(new URL('/settings?shopee=ok', req.url));
}
