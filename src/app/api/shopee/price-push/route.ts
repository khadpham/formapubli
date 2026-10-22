import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { db, editions, shopeeItemMap, shopeeSkuComponents } from '@/db';
import { updatePriceOnShopee } from '@/services/shopee/product';
import { getShopeeConfig, resolveShopeeShopId } from '@/services/shopee/shop-config';

export const dynamic = 'force-dynamic';

/**
 * POST /api/shopee/price-push { itemId, sku }
 * Đẩy giá bán ERP lên Shopee cho 1 sản phẩm.
 * - Sách lẻ: lấy cover_price của edition khớp SKU.
 * - Combo: cộng dồn cover_price * số lượng các thành phần trong shopee_sku_components.
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

    // Tính giá ERP: ưu tiên combo (nhiều thành phần), fallback sách lẻ theo code.
    let erpPrice = 0;
    const comps = await db.select().from(shopeeSkuComponents).where(eq(shopeeSkuComponents.shopeeSku, sku));
    if (comps.length > 0) {
      for (const c of comps) {
        const eds = await db.select().from(editions).where(eq(editions.id, c.editionId)).limit(1);
        if (eds.length > 0) erpPrice += Number(eds[0].coverPrice || 0) * Number(c.quantity || 1);
      }
    } else {
      const eds = await db.select().from(editions).where(eq(editions.code, sku)).limit(1);
      if (eds.length === 0) {
        return NextResponse.json(
          { success: false, error: `SKU ${sku} chưa đối chiếu với sản phẩm nào trong ERP.` },
          { status: 400 }
        );
      }
      erpPrice = Number(eds[0].coverPrice || 0);
    }
    if (erpPrice <= 0) {
      return NextResponse.json(
        { success: false, error: `Giá ERP của SKU ${sku} chưa có (giá bìa = 0).` },
        { status: 400 }
      );
    }

    // model_id từ map (mặc định 0 cho sản phẩm không phân loại).
    const maps = await db
      .select()
      .from(shopeeItemMap)
      .where(and(eq(shopeeItemMap.shopId, shopId), eq(shopeeItemMap.itemId, itemId)))
      .limit(1);
    const modelId = maps.length > 0 ? Number(maps[0].modelId || 0) : 0;

    await updatePriceOnShopee(cfg, itemId, modelId, erpPrice);
    return NextResponse.json({ success: true, data: { itemId, sku, price: Math.round(erpPrice) } });
  } catch (error) {
    return handleApiError(error);
  }
}
