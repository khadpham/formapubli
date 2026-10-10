import { NextRequest, NextResponse } from 'next/server';
import { handleShopeePush, verifyShopeeWebhook } from '@/services/shopee/webhook';

export const dynamic = 'force-dynamic';

/**
 * POST /api/shopee/push - nhận tin realtime từ Shopee.
 * 1. Verify chữ ký HMAC (sai → 401, không chạm DB).
 * 2. Đúng → xử lý nhanh (kéo 1 đơn) rồi trả 200. Shopee retry nếu quá ~3s nên
 *    handler này CẤM làm việc nặng trước khi trả lời.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('authorization') || '';
  const partnerKey = `${process.env.SHOPEE_PARTNER_KEY || ''}`;
  const webhookUrl = req.url;
  if (!verifyShopeeWebhook(rawBody, signature, webhookUrl, partnerKey)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }
  const partnerId = Number(process.env.SHOPEE_PARTNER_ID || '0');
  const baseUrl =
    `${process.env.SHOPEE_BASE_URL || 'https://partner.shopeemobile.com'}`.replace(/\/$/, '');
  const warehouseId = `${process.env.SHOPEE_WAREHOUSE_ID || ''}`;
  let payload: any = {};
  try {
    payload = JSON.parse(rawBody || '{}');
  } catch {
    return NextResponse.json({ status: 'ok' });
  }
  const shopId = Number(payload.shop_id || 0);
  if (!partnerId || !partnerKey || !warehouseId || !shopId) {
    return NextResponse.json({ status: 'ok' });
  }
  try {
    await handleShopeePush(
      { shopId, partnerId, partnerKey, baseUrl, warehouseId },
      payload
    );
  } catch (err) {
    console.error('[shopee-push] xử lý lỗi:', err instanceof Error ? err.message : err);
  }
  // Luôn 200 để Shopee không retry bão - lỗi đã log để xử lý bù.
  return NextResponse.json({ status: 'ok' });
}
