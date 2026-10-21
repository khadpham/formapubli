import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, editions, orders, orderItems, shopeeQuarantine, shopeeSkuComponents } from '@/db';
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
 * Mapping Shopee order_status → trạng thái ERP.
 * - deductInventory=true: đơn "thật" cần trừ kho (đã thanh toán / đang giao).
 * - deductInventory=false: chưa thanh toán (UNPAID), đang xin hủy (IN_CANCEL),
 *   hoặc đã hủy (CANCELLED) - không trừ kho.
 */
function mapShopeeStatus(shopeeStatus: string): {
  orderStatus: 'COMPLETED' | 'CANCELLED';
  shippingStatus: string;
  deductInventory: boolean;
} {
  switch ((shopeeStatus || '').toUpperCase()) {
    case 'UNPAID':
      return { orderStatus: 'COMPLETED', shippingStatus: 'NONE', deductInventory: false };
    case 'READY_TO_SHIP':
    case 'PROCESSED':
      return { orderStatus: 'COMPLETED', shippingStatus: 'CREATED', deductInventory: true };
    case 'SHIPPED':
      return { orderStatus: 'COMPLETED', shippingStatus: 'IN_TRANSIT', deductInventory: true };
    case 'COMPLETED':
    case 'TO_CONFIRM_RECEIVE':
      return { orderStatus: 'COMPLETED', shippingStatus: 'DELIVERED', deductInventory: true };
    case 'CANCELLED':
      return { orderStatus: 'CANCELLED', shippingStatus: 'FAILED', deductInventory: false };
    case 'IN_CANCEL':
      return { orderStatus: 'COMPLETED', shippingStatus: 'NONE', deductInventory: false };
    default:
      return { orderStatus: 'COMPLETED', shippingStatus: 'NONE', deductInventory: false };
  }
}

/**
 * Các shippingStatus hàm ý kho ĐÃ bị trừ (trong luồng Shopee sync).
 * Dùng để suy ra có cần hoàn kho khi đơn bị hủy, hoặc trừ bù khi đơn từ
 * UNPAID chuyển sang trạng thái phải trừ.
 */
const DEDUCTED_SHIPPING = new Set(['CREATED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'RETURNED']);

/**
 * Kéo đơn Shopee về, trừ kho, lưu đơn nội bộ.
 * - Lấy TẤT CẢ trạng thái (UNPAID → CANCELLED), mapping vào vòng đời ERP.
 * - Đơn đã có trong DB: cập nhật trạng thái (không tạo trùng), xử lý chuyển
 *   đổi kho (trừ bù khi từ UNPAID sang, hoàn kho khi bị hủy sau khi đã trừ).
 * - SKU không khớp ISBN/code → cách ly cả đơn, không trừ kho, không crash.
 * - Idempotent theo `shopee-+order_sn`.
 * - CẤM đi qua OrderService.confirmOrder (bẫy paymentProof).
 */
export async function pullShopeeOrders(
  cfg: ShopeeSyncConfig,
  timeFrom: number,
  timeTo: number,
  timeRangeField: 'create_time' | 'update_time' = 'update_time'
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
  const editionOf = await buildComponentResolver();

  let cursor = '';
  for (;;) {
    const page = await shopeeGet(cfg, '/api/v2/order/get_order_list', {
      time_range_field: timeRangeField,
      time_from: String(timeFrom),
      time_to: String(timeTo),
      page_size: '100',
      cursor,
      // BẮT BUỘC: không xin tường minh thì Shopee không trả order_status
      // trong danh sách (chỉ có order_sn).
      response_optional_fields: 'order_status',
    });
    const list: Array<{ order_sn: string; order_status: string }> = page.order_list ?? [];
    if (list.length > 0) {
      await ingestShopeeOrderSns(eff, list.map((o) => o.order_sn), editionOf, result);
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
  editionOf?: (sku: string) => Array<{ editionId: string; qty: number }> | null,
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
  const resolve = editionOf ?? (await buildComponentResolver());
  for (let i = 0; i < orderSns.length; i += 50) {
    const batch = orderSns.slice(i, i + 50);
    const detail = await shopeeGet(cfg, '/api/v2/order/get_order_detail', {
      order_sn_list: batch.join(','),
      // Khi có response_optional_fields, Shopee CHỈ trả các trường được xin
      // (+ khóa chính) - phải liệt kê đủ những trường ingest tiêu thụ, thiếu
      // item_list là đơn vào cách ly "không có dòng hàng".
      response_optional_fields:
        'order_status,item_list,payment_method,recipient_address,shipping_carrier,total_amount,actual_shipping_fee',
    });
    const details: ShopeeOrderDetail[] = detail.order_list ?? [];
    for (const d of details) {
      await ingestOne(eff, resolve, d, out);
    }
  }
  return out;
}

/**
 * Resolver SKU → thành phần ERP. Ưu tiên mapping combo tay (shopee_sku_components),
 * fallback về khớp ISBN/code đơn lẻ. Trả về mảng (combo = nhiều dòng).
 */
async function buildComponentResolver(): Promise<
  (sku: string) => Array<{ editionId: string; qty: number }> | null
> {
  const comboRows = await withDbRetry(async () => db.select().from(shopeeSkuComponents));
  const comboBySku = new Map<string, Array<{ editionId: string; qty: number }>>();
  for (const r of comboRows) {
    const list = comboBySku.get(r.shopeeSku) || [];
    list.push({ editionId: r.editionId, qty: r.quantity });
    comboBySku.set(r.shopeeSku, list);
  }
  const catalog = await withDbRetry(async () =>
    db.select({ id: editions.id, isbn: editions.isbn, code: editions.code }).from(editions)
  );
  return (sku: string) => {
    const combo = comboBySku.get(sku);
    if (combo && combo.length > 0) return combo;
    // ISBN không UNIQUE (tái bản trùng ISBN): lấy id nhỏ nhất, ổn định.
    const hit = catalog
      .filter((e) => e.isbn === sku || e.code === sku)
      .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
    return hit ? [{ editionId: hit.id, qty: 1 }] : null;
  };
}

async function buildCatalogResolver(): Promise<(sku: string) => string | null> {
  const resolve = await buildComponentResolver();
  return (sku: string) => {
    const comps = resolve(sku);
    return comps && comps.length === 1 && comps[0].qty === 1 ? comps[0].editionId : null;
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

/**
 * Cập nhật trạng thái đơn Shopee đã có trong DB theo Shopee.
 * Xử lý chuyển đổi kho:
 * - UNPAID (chưa trừ) → trạng thái phải trừ: trừ bù DISPATCH_SALE.
 * - Đã trừ (CREATED/PICKED_UP/...) → CANCELLED: hoàn kho RETURN_INBOUND.
 * - Còn lại: chỉ cập nhật trạng thái, không động kho.
 */
async function updateExistingStatus(
  cfg: ShopeeSyncConfig,
  existing: { id: string; status: string; shippingStatus: string },
  shopeeStatus: string,
  result: PullResult
): Promise<void> {
  const mapped = mapShopeeStatus(shopeeStatus);
  const statusChanged =
    existing.status !== mapped.orderStatus || existing.shippingStatus !== mapped.shippingStatus;
  if (!statusChanged) {
    result.skipped += 1;
    return;
  }
  const wasDeducted = DEDUCTED_SHIPPING.has(existing.shippingStatus);
  await withDbRetry(async () =>
    db.transaction(async (tx) => {
      await tx
        .update(orders)
        .set({ status: mapped.orderStatus, shippingStatus: mapped.shippingStatus })
        .where(eq(orders.id, existing.id));
      const items = (
        await tx
          .select({ editionId: orderItems.editionId, quantity: orderItems.quantity })
          .from(orderItems)
          .where(eq(orderItems.orderId, existing.id))
      ).filter((r) => !!r.editionId) as Array<{ editionId: string; quantity: number }>;
      // Đơn bị hủy sau khi đã trừ kho → hoàn kho.
      if (mapped.orderStatus === 'CANCELLED' && wasDeducted && items.length > 0) {
        await InventoryService.recordMovementsBatch(
          items.map((r) => ({ editionId: r.editionId, quantityDelta: r.quantity })),
          {
            warehouseId: cfg.warehouseId,
            eventType: 'RETURN_INBOUND',
            documentRef: `SHOPEE_CANCEL_${existing.id}`,
            note: 'Hoàn kho do đơn Shopee bị hủy',
            actorId: 'system-shopee-sync',
            correlationId: existing.id,
            idempotencyPrefix: `idem-shopee-cancel-${existing.id}`,
          },
          tx as any
        );
      }
      // Đơn từ chưa trừ (UNPAID) sang phải trừ → trừ bù.
      if (!wasDeducted && mapped.deductInventory && items.length > 0) {
        await InventoryService.recordMovementsBatch(
          items.map((r) => ({ editionId: r.editionId, quantityDelta: -r.quantity })),
          {
            warehouseId: cfg.warehouseId,
            eventType: 'DISPATCH_SALE',
            documentRef: `SHOPEE_LATE_${existing.id}`,
            note: 'Trừ bù kho: đơn Shopee từ UNPAID sang đã thanh toán',
            actorId: 'system-shopee-sync',
            correlationId: existing.id,
            idempotencyPrefix: `idem-shopee-late-${existing.id}`,
          },
          tx as any
        );
      }
    })
  );
  result.pulled += 1;
}

async function ingestOne(
  cfg: ShopeeSyncConfig,
  resolve: (sku: string) => Array<{ editionId: string; qty: number }> | null,
  d: ShopeeOrderDetail,
  result: PullResult
): Promise<void> {
  const idemKey = `shopee-${d.order_sn}`;
  const dup = await withDbRetry(async () =>
    db.select().from(orders).where(eq(orders.idempotencyKey, idemKey)).limit(1)
  );
  // Đơn đã có: cập nhật trạng thái theo Shopee (không tạo trùng).
  if (dup.length > 0) {
    await updateExistingStatus(cfg, dup[0] as any, d.order_status, result);
    return;
  }

  const mapped = mapShopeeStatus(d.order_status);

  const items = d.item_list ?? [];
  const resolved: Array<{
    editionId: string;
    qty: number;
    original: number;
    discounted: number;
  }> = [];
  for (const it of items) {
    const sku = it.model_sku || it.item_sku || '';
    const components = resolve(sku);
    if (!components || components.length === 0) {
      result.quarantined.push(await quarantine(d.order_sn, sku, 'SKU không khớp ISBN/code'));
      return; // Cách ly CẢ đơn - không trừ nửa vời.
    }
    // Combo: tách thành nhiều dòng, giá chia đều theo tổng số lượng thành phần.
    const totalCompQty = components.reduce((s, c) => s + c.qty, 0) || 1;
    for (const comp of components) {
      resolved.push({
        editionId: comp.editionId,
        qty: it.model_quantity_purchased * comp.qty,
        original: it.model_original_price / totalCompQty,
        discounted: it.model_discounted_price / totalCompQty,
      });
    }
  }
  if (resolved.length === 0) {
    result.quarantined.push(await quarantine(d.order_sn, '', 'Đơn không có dòng hàng'));
    return;
  }

  // Shopee trả nhãn đầy đủ "Cash on Delivery" chứ KHÔNG phải mã "COD"
  // (kiểm chứng sandbox 2026-10-20) - khớp cứng "COD" là bỏ lọt mọi đơn
  // thu hộ ngoài đời, ghi nhầm thành chuyển khoản.
  const pmNorm = (d.payment_method || '').trim().toUpperCase();
  const isCod = pmNorm === 'COD' || pmNorm.includes('CASH ON DELIVERY');
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
        status: mapped.orderStatus,
        shippingStatus: mapped.shippingStatus,
        carrier,
        codAmount: isCod ? finalAmount : 0,
        codStatus: isCod ? 'PENDING' : 'NONE',
        cashierId: 'system-shopee-sync',
        idempotencyKey: idemKey,
        note: `Đơn Shopee #${d.order_sn} (${d.order_status}) - ${addr?.full_address || ''} - ${addr?.phone || ''}`,
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
      // Chỉ trừ kho với đơn "thật" (đã thanh toán/đang giao). UNPAID/CANCELLED
      // không trừ - tránh âm kho oan.
      if (mapped.deductInventory) {
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
      }
    })
  );
  result.pulled += 1;
}
