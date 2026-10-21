import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { db, editions, shopeeItemMap } from '@/db';
import { pushStockToShopee } from '@/services/shopee/stock-push';
import { getShopeeConfig, resolveShopeeShopId } from '@/services/shopee/shop-config';

export const dynamic = 'force-dynamic';

/**
 * POST /api/shopee/stock-push { itemId }
 * Đẩy tồn kho ERP lên Shopee cho 1 sản phẩm. Tìm edition qua SKU (item_sku),
 * tự tạo map nếu chưa có, rồi đẩy tồn (trừ buffer an toàn).
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
    const itemId = Number(body.itemId || 0);
    const sku = String(body.sku || '').trim();
    if (!itemId || !sku) {
      return NextResponse.json({ success: false, error: 'Thiếu itemId hoặc SKU.' }, { status: 400 });
    }

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

    // Tìm edition theo SKU.
    const eds = await db.select().from(editions).where(eq(editions.code, sku)).limit(1);
    if (eds.length === 0) {
      return NextResponse.json(
        { success: false, error: `SKU ${sku} chưa đối chiếu với sách nào trong ERP.` },
        { status: 400 }
      );
    }
    const editionId = eds[0].id;

    // Tự tạo map nếu chưa có.
    const existing = await db
      .select()
      .from(shopeeItemMap)
      .where(and(eq(shopeeItemMap.shopId, shopId), eq(shopeeItemMap.editionId, editionId)))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(shopeeItemMap).values({ shopId, editionId, itemId, modelId: 0 });
    }

    const result = await pushStockToShopee(cfg, editionId);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return handleApiError(error);
  }
}
