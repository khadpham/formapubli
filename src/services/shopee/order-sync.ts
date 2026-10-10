import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, editions, orders, orderItems, shopeeQuarantine } from '@/db';
import { withDbRetry } from '@/lib/db-retry';
import { vnDayOf } from '@/lib/vn-time';
import { allocateOrderCode } from '../order-code';
import { InventoryService } from '../inventory.service';
import { generateShopeeSign } from './sign';
import { TursoTokenStorage } from './token-store';
import { refreshShopeeTokenOnce } from './auth';
import { getShopeeConfig } from './shop-config';

export interface ShopeeSyncConfig {
  shopId: number;
  partnerId: number;
  partnerKey: string;
  baseUrl: string;
  /** Kho xuất hàng Shopee (cấu hình - hiện tại kho Âu Cơ). CẤM hardcode. */
  warehouseId: string;
  /**
   * COD đang bật? Mặc định TẮT (Anh chốt) - đơn COD khi tắt sẽ vào cách ly
   * với lý do rõ ràng thay vì lọt vào kho. Bật sau không cần migration.
   */
  codEnabled?: boolean;
  fetchFn?: typeof fetch;
}

export interface ShopeeQuarantine {
  orderSn: string;
  sku: string;
  reason: string;
}

export interface PullResult {
  pulled: number;
  skipped: number;
  quarantined: ShopeeQuarantine[];
}

interface ShopeeOrderDetail {
  order_sn: string;
  order_status: string;
  payment_method: 'PREPAID' | 'COD' | string;
  shipping_carrier?: string;
  recipient_address?: { name?: string; phone?: string; full_address?: string };
  item_list?: Array<{
    item_sku?: string;
    model_sku?: string;
    model_quantity_purchased: number;
    model_original_price: number;
    model_discounted_price: number;
  }>;
}

async function shopeeGet(
  cfg: ShopeeSyncConfig,
  apiPath: string,
  query: Record<string, string>
): Promise<any> {
  const fetchFn = cfg.fetchFn ?? globalThis.fetch;
  const store = new TursoTokenStorage(cfg.shopId);
  let token = await store.get();
  // Token sắp hết (đệm 5 phút) thì refresh đúng 1 lần.
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
  const res = await fetchFn(`${cfg.baseUrl}${apiPath}?${qs.toString()}`, { method: 'GET' });
  const data = (await res.json()) as any;
  if (data?.error) {
    throw new Error(`Shopee API lỗi: ${data.error} - ${data.message || ''}`);
  }
  return data.response;
}

/**
 * Kéo đơn Shopee về, trừ kho, lưu đơn nội bộ.
 * - Chỉ xử lý READY_TO_SHIP; trạng thái khác bỏ qua (skipped).
 * - SKU không khớp ISBN/code → cách ly cả đơn, không trừ kho, không crash.
 * - Idempotent theo `shopee-+order_sn`: kéo lại không tạo trùng.
 * - CẤM đi qua OrderService.confirmOrder (bẫy paymentProof).
 */
export async function pullShopeeOrders(
  cfg: ShopeeSyncConfig,
  timeFrom: number,
  timeTo: number
): Promise<PullResult> {
  // Cấu hình runtime (DB) làm nền; giá trị truyền tường minh luôn thắng -
  // nhờ vậy test và cron dùng chung một đường mà không hardcode kho.
  const shopCfg = await getShopeeConfig();
  const eff: ShopeeSyncConfig = {
    ...cfg,
    warehouseId: cfg.warehouseId || shopCfg.warehouseId,
    codEnabled: cfg.codEnabled ?? shopCfg.codEnabled,
  };
  if (!eff.warehouseId) {
    throw new Error('Thiếu warehouseId: kho xuất Shopee phải cấu hình rõ.');
  }
  const result: PullResult = { pulled: 0, skipped: 0, quarantined: [] };

  // Danh mục ISBN/code để map SKU - đọc 1 lần cho cả đợt kéo.
  const editionOf = await buildCatalogResolver();

  let cursor = '';
  for (;;) {
    const page = await shopeeGet(cfg, '/api/v2/order/get_order_list', {
      time_range_field: 'create_time',
      time_from: String(timeFrom),
      time_to: String(timeTo),
      page_size: '100',
      cursor,
    });
    const list: Array<{ order_sn: string; order_status: string }> = page.order_list ?? [];
    const ready = list.filter((o) => o.order_status === 'READY_TO_SHIP');
    result.skipped += list.length - ready.length;
    if (ready.length > 0) {
      await ingestShopeeOrderSns(eff, ready.map((o) => o.order_sn), editionOf, result);
    }
    if (!page.more) break;
    cursor = page.next_cursor || '';
  }
  return result;
}

/** Kéo chi tiết + nhập N đơn theo mã - dùng chung cho sync định kỳ và webhook. */
export async function ingestShopeeOrderSns(
  cfg: ShopeeSyncConfig,
  orderSns: string[],
  editionOf?: (sku: string) => string | null,
  result?: PullResult
): Promise<PullResult> {
  const out = result ?? { pulled: 0, skipped: 0, quarantined: [] };
  const shopCfg = await getShopeeConfig();
  const eff: ShopeeSyncConfig = {
    ...cfg,
    warehouseId: cfg.warehouseId || shopCfg.warehouseId,
    codEnabled: cfg.codEnabled ?? shopCfg.codEnabled,
  };
  if (!eff.warehouseId) throw new Error('Thiếu warehouseId: kho xuất Shopee phải cấu hình rõ.');
  const resolve = editionOf ?? (await buildCatalogResolver());
  for (let i = 0; i < orderSns.length; i += 50) {
    const batch = orderSns.slice(i, i + 50);
    const detail = await shopeeGet(cfg, '/api/v2/order/get_order_detail', {
      order_sn_list: batch.join(','),
    });
    const details: ShopeeOrderDetail[] = detail.order_list ?? [];
    for (const d of details) {
      await ingestOne(eff, resolve, d, out);
    }
  }
  return out;
}

async function buildCatalogResolver(): Promise<(sku: string) => string | null> {
  const catalog = await withDbRetry(async () =>
    db.select({ id: editions.id, isbn: editions.isbn, code: editions.code }).from(editions)
  );
  return (sku: string) => {
    // ISBN không UNIQUE (tái bản trùng ISBN): lấy id nhỏ nhất, ổn định.
    const hit = catalog
      .filter((e) => e.isbn === sku || e.code === sku)
      .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
    return hit ? hit.id : null;
  };
}

/** Ghi đơn lỗi vào hàng đợi để UI hiển thị - đã có dòng chưa xử lý thì thôi. */
async function quarantine(orderSn: string, sku: string, reason: string): Promise<ShopeeQuarantine> {
  const q = { orderSn, sku, reason };
  const existing = await withDbRetry(async () =>
    db
      .select({ id: shopeeQuarantine.id })
      .from(shopeeQuarantine)
      .where(
        and(
          eq(shopeeQuarantine.orderSn, orderSn),
          eq(shopeeQuarantine.sku, sku),
          eq(shopeeQuarantine.resolved, 0)
        )
      )
      .limit(1)
  );
  if (existing.length === 0) {
    await withDbRetry(async () =>
      db.insert(shopeeQuarantine).values({ id: randomUUID(), orderSn, sku, reason })
    );
  }
  return q;
}

async function ingestOne(
  cfg: ShopeeSyncConfig,
  editionOf: (sku: string) => string | null,
  d: ShopeeOrderDetail,
  result: PullResult
): Promise<void> {
  const idemKey = `shopee-${d.order_sn}`;
  const dup = await withDbRetry(async () =>
    db.select({ id: orders.id }).from(orders).where(eq(orders.idempotencyKey, idemKey)).limit(1)
  );
  if (dup.length > 0) return; // Kéo lại: bỏ qua tuyệt đối.

  const items = d.item_list ?? [];
  const resolved: Array<{
    editionId: string;
    qty: number;
    original: number;
    discounted: number;
  }> = [];
  for (const it of items) {
    const sku = it.model_sku || it.item_sku || '';
    const editionId = editionOf(sku);
    if (!editionId) {
      result.quarantined.push(await quarantine(d.order_sn, sku, 'SKU không khớp ISBN/code'));
      return; // Cách ly CẢ đơn - không trừ nửa vời.
    }
    resolved.push({
      editionId,
      qty: it.model_quantity_purchased,
      original: it.model_original_price,
      discounted: it.model_discounted_price,
    });
  }
  if (resolved.length === 0) {
    result.quarantined.push(await quarantine(d.order_sn, '', 'Đơn không có dòng hàng'));
    return;
  }

  const isCod = d.payment_method === 'COD';
  if (isCod && !cfg.codEnabled) {
    result.quarantined.push(await quarantine(d.order_sn, '', 'COD đang tắt - bật cờ mới xử lý'));
    return;
  }
  const finalAmount = resolved.reduce((s, r) => s + r.qty * r.discounted, 0);
  const subtotal = resolved.reduce((s, r) => s + r.qty * r.original, 0);
  const addr = d.recipient_address;
  // Đơn vị vận chuyển do khách chọn lúc checkout - giữ để lúc ship khỏi đoán.
  const carrier = (d.shipping_carrier || '').trim().toUpperCase().slice(0, 32) || null;

  await withDbRetry(async () =>
    db.transaction(async (tx) => {
      const day = vnDayOf(new Date()) || new Date().toISOString().slice(0, 10);
      const orderCode = await allocateOrderCode(tx as any, day);
      const orderId = randomUUID();
      await tx.insert(orders).values({
        id: orderId,
        orderCode,
        warehouseId: cfg.warehouseId,
        channel: 'SHOPEE',
        customerName: addr?.name || 'Khách Shopee',
        subtotal,
        finalAmount,
        paymentMethod: isCod ? 'COD' : 'BANK_TRANSFER',
        status: 'COMPLETED',
        shippingStatus: 'CREATED',
        carrier,
        codAmount: isCod ? finalAmount : 0,
        codStatus: isCod ? 'PENDING' : 'NONE',
        cashierId: 'system-shopee-sync',
        idempotencyKey: idemKey,
        note: `Đơn Shopee #${d.order_sn} - ${addr?.full_address || ''} - ${addr?.phone || ''}`,
      });
      await tx.insert(orderItems).values(
        resolved.map((r) => ({
          id: randomUUID(),
          orderId,
          editionId: r.editionId,
          productId: r.editionId,
          quantity: r.qty,
          unitCoverPrice: r.original,
          unitDiscountRate: r.original > 0 ? (r.original - r.discounted) / r.original : 0,
          unitSellingPrice: r.discounted,
          totalAmount: r.qty * r.discounted,
        }))
      );
      await InventoryService.recordMovementsBatch(
        resolved.map((r) => ({ editionId: r.editionId, quantityDelta: -r.qty })),
        {
          warehouseId: cfg.warehouseId,
          eventType: 'DISPATCH_SALE',
          documentRef: `SHOPEE_${d.order_sn}`,
          note: `Xuất kho giao Shopee đơn #${d.order_sn}`,
          actorId: 'system-shopee-sync',
          correlationId: orderId,
          idempotencyPrefix: `idem-shopee-${orderId}`,
        },
        tx as any
      );
    })
  );
  result.pulled += 1;
}
