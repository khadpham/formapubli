import { and, eq } from 'drizzle-orm';
import { db, shopeeItemMap } from '@/db';
import { InventoryService } from '../inventory.service';
import type { ShopeeSyncConfig } from './order-sync';
import { generateShopeeSign } from './sign';
import { TursoTokenStorage } from './token-store';
import { refreshShopeeTokenOnce } from './auth';

/** Tồn giữ lại phục vụ quầy POS - không đẩy lên sàn. */
export const SHOPEE_SAFETY_BUFFER = 2;

export interface StockPushResult {
  pushed: number;
  itemId: number;
  skipped?: boolean;
}

/**
 * Đẩy tồn 1 ấn bản lên Shopee: max(0, tồn Âu Cơ − buffer).
 * Ấn bản chưa map item_id sàn → skipped, không gọi API.
 */
export async function pushStockToShopee(
  cfg: ShopeeSyncConfig,
  editionId: string
): Promise<StockPushResult> {
  const maps = await db
    .select()
    .from(shopeeItemMap)
    .where(and(eq(shopeeItemMap.shopId, cfg.shopId), eq(shopeeItemMap.editionId, editionId)))
    .limit(1);
  if (maps.length === 0) return { pushed: 0, itemId: 0, skipped: true };
  const map = maps[0];

  const onHand = await InventoryService.getBalance(editionId, cfg.warehouseId);
  const display = Math.max(0, onHand - SHOPEE_SAFETY_BUFFER);

  const fetchFn = cfg.fetchFn ?? globalThis.fetch;
  const store = new TursoTokenStorage(cfg.shopId);
  let token = await store.get();
  if (!token || token.expired_at <= Date.now() + 5 * 60 * 1000) {
    token = await refreshShopeeTokenOnce(cfg);
  }
  const apiPath = '/api/v2/product/update_stock';
  const { timestamp, sign } = generateShopeeSign({
    partnerId: cfg.partnerId,
    partnerKey: cfg.partnerKey,
    apiPath,
    accessToken: token.access_token,
    shopId: cfg.shopId,
  });
  const qs = new URLSearchParams({
    partner_id: String(cfg.partnerId),
    timestamp: String(timestamp),
    access_token: token.access_token,
    shop_id: String(cfg.shopId),
    sign,
  });
  const res = await fetchFn(`${cfg.baseUrl}${apiPath}?${qs.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      item_id: map.itemId,
      stock_list: [{ model_id: map.modelId, seller_stock: [{ stock: display }] }],
    }),
  });
  const data = (await res.json()) as any;
  if (data?.error) throw new Error(`Shopee API lỗi: ${data.error} - ${data.message || ''}`);
  return { pushed: display, itemId: map.itemId };
}
