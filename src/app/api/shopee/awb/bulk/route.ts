import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { getShopeeConfig } from '@/services/shopee/shop-config';
import { db, orders } from '@/db';
import { inArray } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/**
 * GET /api/shopee/awb/bulk?ids=... - In phiếu hàng loạt (thermal A6).
 * ids: danh sách order id (ERP) cách nhau bởi dấu phẩy.
 * Trả về PDF gộp nhiều vận đơn.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
      'ROLE_SHOPEE_OPS',
    ] as UserRole[]);
    const idsParam = `${new URL(req.url).searchParams.get('ids') || ''}`.trim();
    const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      return NextResponse.json({ success: false, error: 'Thiếu danh sách đơn.' }, { status: 400 });
    }
    if (ids.length > 50) {
      return NextResponse.json({ success: false, error: 'Tối đa 50 đơn một lần in.' }, { status: 400 });
    }

    // Lấy orderSn và tracking từ ERP
    const rows = await db.select().from(orders).where(inArray(orders.id, ids));
    const valid = rows.filter(r =>
      r.channel === 'SHOPEE' &&
      r.idempotencyKey?.startsWith('shopee-') &&
      r.trackingCode
    );

    if (valid.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Không có đơn nào có mã vận đơn. Hãy bấm "Chuẩn bị đơn hàng" trước để Shopee điều phối shipper.'
      }, { status: 400 });
    }

    // Gọi Shopee API bulk
    const { getBulkAwbPdf } = await import('@/services/shopee/shipment');
    const partnerId = Number(process.env.SHOPEE_PARTNER_ID || '0');
    const partnerKey = `${process.env.SHOPEE_PARTNER_KEY || ''}`;
    const baseUrl = `${process.env.SHOPEE_BASE_URL || 'https://partner.shopeemobile.com'}`.replace(/\/$/, '');
    const shopId = Number(process.env.SHOPEE_SHOP_ID || '0') || 0;
    const shopCfg = await getShopeeConfig();

    const orderList = valid.map(r => ({
      order_sn: r.idempotencyKey!.replace('shopee-', ''),
      tracking_number: r.trackingCode!,
    }));

    const pdf = await getBulkAwbPdf(
      { shopId, partnerId, partnerKey, baseUrl, warehouseId: shopCfg.warehouseId, codEnabled: shopCfg.codEnabled },
      orderList
    );

    return new Response(pdf as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="shopee-awb-bulk-${Date.now()}.pdf"`,
      },
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}
