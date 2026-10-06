import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { db, orders } from '@/db';
import { shipShopeeOrder } from '@/services/shopee/shipment';
import { getShopeeConfig, getShopeeOpsWarehouses } from '@/services/shopee/shop-config';

export const dynamic = 'force-dynamic';

/**
 * POST /api/shopee/ship { orderSn } — thủ kho bấm giao + lấy tracking.
 * Role và trạng thái chặn trong service; route chỉ bóc session.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
      'ROLE_SHOPEE_OPS',
    ] as UserRole[]);
    const body = (await req.json().catch(() => ({}))) as { orderSn?: string };
    const orderSn = `${body.orderSn || ''}`.trim();
    if (!orderSn) {
      return NextResponse.json({ success: false, error: 'Thiếu mã đơn Shopee.' }, { status: 400 });
    }
    if (session.role === 'ROLE_SHOPEE_OPS') {
      const found = await db
        .select({ warehouseId: orders.warehouseId })
        .from(orders)
        .where(eq(orders.idempotencyKey, `shopee-${orderSn}`))
        .limit(1);
      const scope = await getShopeeOpsWarehouses();
      if (found.length === 0 || !scope.includes(found[0].warehouseId)) {
        return NextResponse.json({ success: false, error: 'Đơn ngoài kho được cấp.' }, { status: 403 });
      }
    }
    const partnerId = Number(process.env.SHOPEE_PARTNER_ID || '0');
    const partnerKey = `${process.env.SHOPEE_PARTNER_KEY || ''}`;
    const baseUrl =
      `${process.env.SHOPEE_BASE_URL || 'https://partner.shopeemobile.com'}`.replace(/\/$/, '');
    const shopId = Number(process.env.SHOPEE_SHOP_ID || '0') || 0;
    const shopCfg = await getShopeeConfig();
    const out = await shipShopeeOrder(
      {
        shopId,
        partnerId,
        partnerKey,
        baseUrl,
        warehouseId: shopCfg.warehouseId,
        codEnabled: shopCfg.codEnabled,
      },
      orderSn,
      session.role,
      session.actorId
    );
    return NextResponse.json({ success: true, data: out });
  } catch (error) {
    return handleApiError(error);
  }
}
