import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { db, orders, shopeeOrderFinance } from '@/db';
import { syncEscrow } from '@/services/shopee/escrow-sync';
import { getShopeeConfig, resolveShopeeShopId } from '@/services/shopee/shop-config';

export const dynamic = 'force-dynamic';

/**
 * POST /api/shopee/finance/sync
 * Đồng bộ escrow cho các đơn DELIVERED chưa có dữ liệu tài chính.
 * Chỉ OWNER/MANAGER. Chạy tuần tự từng đơn (API Shopee giới hạn tốc độ).
 */
export async function POST(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);

    const partnerId = Number(process.env.SHOPEE_PARTNER_ID || '0');
    const partnerKey = `${process.env.SHOPEE_PARTNER_KEY || ''}`;
    const baseUrl = `${process.env.SHOPEE_BASE_URL || 'https://partner.shopeemobile.com'}`.replace(/\/$/, '');
    if (!partnerId || !partnerKey) {
      return NextResponse.json({ success: false, error: 'Chưa cấu hình key Shopee.' }, { status: 400 });
    }
    const { shopId } = await resolveShopeeShopId();
    if (!shopId) {
      return NextResponse.json({ success: false, error: 'Chưa kết nối gian hàng.' }, { status: 400 });
    }
    const shopCfg = await getShopeeConfig();
    const cfg = { shopId, partnerId, partnerKey, baseUrl, warehouseId: shopCfg.warehouseId || '' };

    // Đơn DELIVERED chưa có dòng tài chính.
    const delivered = await db
      .select({ id: orders.id, idempotencyKey: orders.idempotencyKey })
      .from(orders)
      .where(and(eq(orders.channel, 'SHOPEE'), eq(orders.shippingStatus, 'DELIVERED')))
      .limit(50);
    const existing = await db.select({ orderSn: shopeeOrderFinance.orderSn }).from(shopeeOrderFinance);
    const hasFinance = new Set(existing.map((e) => e.orderSn));

    let synced = 0;
    let failed = 0;
    const errors: string[] = [];
    for (const o of delivered) {
      const orderSn = String(o.idempotencyKey || '').replace(/^shopee-/, '');
      if (!orderSn || hasFinance.has(orderSn)) continue;
      try {
        await syncEscrow(cfg, orderSn);
        synced++;
      } catch (e) {
        failed++;
        if (errors.length < 5) errors.push(`#${orderSn}: ${e instanceof Error ? e.message : 'lỗi'}`);
      }
    }

    return NextResponse.json({
      success: true,
      data: { synced, failed, skipped: delivered.length - synced - failed, errors },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
