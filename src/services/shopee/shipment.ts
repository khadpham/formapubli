import { eq } from 'drizzle-orm';
import { db, orders } from '@/db';
import { AppError } from '../app-error';
import type { UserRole } from '@/lib/roles';
import type { ShopeeSyncConfig } from './order-sync';
import { generateShopeeSign } from './sign';
import { TursoTokenStorage } from './token-store';
import { refreshShopeeTokenOnce } from './auth';

/** Role được bấm giao hàng Shopee: thủ kho + cấp trên. Thu ngân/kế toán: cấm. */
const SHIP_ROLES: UserRole[] = ['ROLE_WAREHOUSE', 'ROLE_MANAGER', 'ROLE_OWNER', 'ROLE_SHOPEE_OPS'];

async function signedGet(cfg: ShopeeSyncConfig, apiPath: string, query: Record<string, string>) {
  const fetchFn = cfg.fetchFn ?? globalThis.fetch;
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
  const res = await fetchFn(`${cfg.baseUrl}${apiPath}?${qs.toString()}`, { method: 'GET' });
  const data = (await res.json()) as any;
  if (data?.error) throw new Error(`Shopee API lỗi: ${data.error} - ${data.message || ''}`);
  return data.response;
}

async function signedPost(cfg: ShopeeSyncConfig, apiPath: string, body: Record<string, unknown>) {
  const fetchFn = cfg.fetchFn ?? globalThis.fetch;
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
    partner_id: String(cfg.partnerId),
    timestamp: String(timestamp),
    access_token: token.access_token,
    shop_id: String(cfg.shopId),
    sign,
  });
  const res = await fetchFn(`${cfg.baseUrl}${apiPath}?${qs.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // Vận đơn trả binary PDF - nhận diện bằng content-type thật.
  const contentType = res.headers?.get?.('content-type') || '';
  if (contentType.includes('pdf') || contentType.includes('octet-stream')) {
    return Buffer.from(await (res as any).arrayBuffer());
  }
  const data = (await res.json()) as any;
  if (data?.error) throw new Error(`Shopee API lỗi: ${data.error} - ${data.message || ''}`);
  return data.response;
}

export interface ShippingParameter {
  mode: 'pickup' | 'dropoff';
  addressId: number | null;
  pickupTimeId: string | null;
}

/**
 * Lấy cách thức gửi của đơn (shipper tới lấy hay tự mang ra bưu cục).
 * Shape response theo SDK GetShippingParameterResponseData.
 */
export async function getShippingParameter(
  cfg: ShopeeSyncConfig,
  orderSn: string
): Promise<ShippingParameter> {
  const r = await signedGet(cfg, '/api/v2/logistics/get_shipping_parameter', { order_sn: orderSn });
  const pickupList = r?.pickup?.address_list ?? [];
  if (pickupList.length > 0) {
    const slot = pickupList[0].time_slot_list?.[0];
    return {
      mode: 'pickup',
      addressId: pickupList[0].address_id ?? null,
      pickupTimeId: slot?.pickup_time_id ?? null,
    };
  }
  return { mode: 'dropoff', addressId: null, pickupTimeId: null };
}

export interface ShippedOrder {
  orderSn: string;
  trackingCode: string;
  carrier: string;
  /** true = đã xếp lịch giao nhưng Shopee chưa cấp mã vận đơn. */
  trackingPending?: boolean;
}

/**
 * Xác nhận giao hàng: CREATED → PICKED_UP + lưu tracking.
 * - Sai role → FORBIDDEN. Đơn không ở CREATED → STATE_CONFLICT.
 * - Carrier lấy từ đơn đã kéo về (khách chọn), KHÔNG đoán từ tham số ship.
 */
export async function shipShopeeOrder(
  cfg: ShopeeSyncConfig,
  orderSn: string,
  actorRole: UserRole,
  actorId: string
): Promise<ShippedOrder> {
  if (!SHIP_ROLES.includes(actorRole)) {
    throw AppError.forbidden('Chỉ thủ kho và cấp trên được bấm giao đơn Shopee.');
  }
  if (!actorId) throw AppError.forbidden('Thiếu định danh người giao hàng.');
  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.idempotencyKey, `shopee-${orderSn}`))
    .limit(1);
  if (rows.length === 0) throw AppError.invalid(`Không tìm thấy đơn Shopee #${orderSn}.`);
  const ord = rows[0];
  if (ord.shippingStatus !== 'CREATED') {
    throw AppError.conflict(`Đơn #${orderSn} đang ở trạng thái ${ord.shippingStatus}, không giao lại.`);
  }
  const carrier = (ord.carrier || 'SPX').toUpperCase();
  const param = await getShippingParameter(cfg, orderSn);
  // ship_order có thể đã thành công ở một lần bấm trước dở dang (gói đã xếp
  // lịch/lấy đi): Shopee trả lỗi khác nhau theo trạng thái ("already
  // shipped", "not eligible for rescheduling"...). Không đuổi theo câu chữ:
  // giữ lỗi lại, cứ đi lấy mã vận đơn - có mã = đã xếp lịch thật; không có
  // mã mới ném lại lỗi gốc.
  let shipError: unknown = null;
  try {
    await signedPost(cfg, '/api/v2/logistics/ship_order', {
      order_sn: orderSn,
      pickup:
        param.mode === 'pickup'
          ? { address_id: param.addressId, pickup_time_id: param.pickupTimeId }
          : undefined,
    });
  } catch (err) {
    shipError = err;
  }
  // Mã vận đơn có thể sinh TRỄ (sandbox: sau khi lấy hàng; thật: vài giây).
  // Thử lại ngắn vài nhịp; vẫn rỗng thì ghi nhận "chờ mã" thay vì lỗi hệ
  // thống - webhook tracking (code 2) hoặc lần đồng bộ sau sẽ bổ sung.
  let trackingCode = '';
  for (let attempt = 0; attempt < 3 && !trackingCode; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 3000));
    const track = await signedGet(cfg, '/api/v2/logistics/get_tracking_number', {
      order_sn: orderSn,
    });
    trackingCode = String(track?.tracking_number || '');
  }
  if (!trackingCode && shipError) throw shipError;
  await db
    .update(orders)
    .set({ shippingStatus: 'PICKED_UP', trackingCode: trackingCode || null, carrier })
    .where(eq(orders.id, ord.id));
  return { orderSn, trackingCode, carrier, trackingPending: !trackingCode };
}

/**
 * Tải vận đơn A6 (PDF) của đơn. Trả Buffer để route in/trả file.
 */
export async function getAwbPdf(cfg: ShopeeSyncConfig, orderSn: string): Promise<Buffer> {
  await signedPost(cfg, '/api/v2/logistics/create_shipping_document', {
    order_list: [{ order_sn: orderSn }],
    shipping_document_type: 'NORMAL_AIR_WAYBILL',
  });
  const pdf = await signedPost(cfg, '/api/v2/logistics/download_shipping_document', {
    order_list: [{ order_sn: orderSn }],
    shipping_document_type: 'NORMAL_AIR_WAYBILL',
  });
  if (!Buffer.isBuffer(pdf) || pdf.byteLength === 0) {
    throw new Error('Tải vận đơn thất bại.');
  }
  return pdf;
}
