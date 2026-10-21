import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { db, editions } from '@/db';
import { generateShopeeSign } from '@/services/shopee/sign';
import { TursoTokenStorage } from '@/services/shopee/token-store';
import { refreshShopeeTokenOnce } from '@/services/shopee/auth';
import { resolveShopeeShopId } from '@/services/shopee/shop-config';

export const dynamic = 'force-dynamic';

/**
 * GET /api/shopee/products
 * Danh sách sản phẩm đang bán trên shop Shopee (gọi live API, tiết kiệm quota:
 * 1 lần khi mở tab). Kèm cột đối chiếu ERP: item_sku khớp editions.code thì
 * đã map, ngược lại badge "Chưa đối chiếu".
 */
async function shopeeGet(
  cfg: { shopId: number; partnerId: number; partnerKey: string; baseUrl: string },
  apiPath: string,
  query: Record<string, string>
): Promise<any> {
  const store = new TursoTokenStorage(cfg.shopId);
  let token = await store.get();
  if (!token || token.expired_at <= Date.now() + 5 * 60 * 1000) {
    token = await refreshShopeeTokenOnce(cfg);
  }
  const { timestamp, sign } = generateShopeeSign({
    partnerId: cfg.partnerId,
    partnerKey: cfg.partnerKey,
    apiPath,
    accessToken: token.access_token,
    shopId: cfg.shopId,
  });
  const qs = new URLSearchParams({
    ...query,
    partner_id: String(cfg.partnerId),
    timestamp: String(timestamp),
    access_token: token.access_token,
    shop_id: String(cfg.shopId),
    sign,
  });
  const res = await fetch(`${cfg.baseUrl}${apiPath}?${qs.toString()}`, { method: 'GET' });
  const data = (await res.json()) as any;
  if (data?.error) throw new Error(`Shopee API lỗi: ${data.error} - ${data.message || ''}`);
  return data.response;
}

export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
      'ROLE_SHOPEE_OPS',
    ] as UserRole[]);

    const partnerId = Number(process.env.SHOPEE_PARTNER_ID || '0');
    const partnerKey = `${process.env.SHOPEE_PARTNER_KEY || ''}`;
    const baseUrl = `${process.env.SHOPEE_BASE_URL || 'https://partner.shopeemobile.com'}`.replace(/\/$/, '');
    if (!partnerId || !partnerKey) {
      return NextResponse.json(
        { success: false, error: 'Chưa cấu hình key Shopee.' },
        { status: 400 }
      );
    }
    const { shopId } = await resolveShopeeShopId();
    if (!shopId) {
      return NextResponse.json(
        { success: false, error: 'Chưa kết nối gian hàng Shopee.' },
        { status: 400 }
      );
    }
    const cfg = { shopId, partnerId, partnerKey, baseUrl };

    // 1. Lấy danh sách item (tối đa 100, chỉ hàng đang bán).
    const listRes = await shopeeGet(cfg, '/api/v2/product/get_item_list', {
      offset: '0',
      page_size: '100',
      item_status: 'NORMAL',
    });
    const items: Array<{ item_id: number }> = listRes?.item ?? [];
    if (items.length === 0) {
      return NextResponse.json({ success: true, data: { products: [], total: 0 } });
    }

    // 2. Lấy thông tin chi tiết theo lô 50 (giới hạn API).
    const ids = items.map((i) => i.item_id);
    const details: any[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const infoRes = await shopeeGet(cfg, '/api/v2/product/get_item_base_info', {
        item_id_list: batch.join(','),
      });
      const batchItems = infoRes?.item_list ?? [];
      details.push(...batchItems);
    }

    // 3. Đối chiếu với ERP qua item_sku ↔ editions.code.
    const erpEditions = await db.select({ id: editions.id, code: editions.code, title: editions.title }).from(editions);
    const byCode = new Map(erpEditions.map((e) => [String(e.code || '').trim(), e]));

    const products = details.map((d: any) => {
      const sku = String(d.item_sku || '').trim();
      const erp = sku ? byCode.get(sku) : undefined;
      return {
        itemId: d.item_id,
        name: d.item_name || '',
        sku,
        price: Number(d.price_info?.current_price || d.price || 0),
        stock: Number(d.stock_info?.stock ?? 0),
        status: d.item_status || '',
        image: d.image?.image_url_list?.[0] || '',
        erpMapped: !!erp,
        erpTitle: erp?.title || null,
      };
    });

    return NextResponse.json({
      success: true,
      data: { products, total: products.length },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
