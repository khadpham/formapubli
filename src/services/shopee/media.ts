import { generateShopeeSign } from './sign';
import { TursoTokenStorage } from './token-store';
import { refreshShopeeTokenOnce } from './auth';
import type { ShopeeSyncConfig } from './order-sync';

/**
 * Upload ảnh lên Shopee qua Media API.
 * Shopee KHÔNG chấp nhận URL ngoài - phải upload file lên server họ trước,
 * lấy image_id rồi mới dùng trong product.add_item.
 *
 * @param cfg Cấu hình Shopee (sandbox hoặc production).
 * @param imageBuffer Buffer ảnh (jpg/png).
 * @param filename Tên file gợi nhớ.
 * @returns image_id của Shopee.
 */
export async function uploadImageToShopee(
  cfg: ShopeeSyncConfig,
  imageBuffer: Buffer,
  filename: string
): Promise<string> {
  const fetchFn = cfg.fetchFn ?? globalThis.fetch;
  const store = new TursoTokenStorage(cfg.shopId);
  let token = await store.get();
  if (!token || token.expired_at <= Date.now() + 5 * 60 * 1000) {
    token = await refreshShopeeTokenOnce(cfg);
  }

  const apiPath = '/api/v2/media/upload_image';
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

  // Multipart form - Shopee yêu cầu Content-Type multipart/form-data
  const form = new FormData();
  const blob = new Blob([new Uint8Array(imageBuffer)], { type: 'image/png' });
  form.append('images', blob, filename);
  form.append('business', '1');
  form.append('scene', '1');

  const res = await fetchFn(`${cfg.baseUrl}${apiPath}?${qs.toString()}`, {
    method: 'POST',
    body: form,
  });

  const data = (await res.json()) as any;
  if (data?.error) {
    throw new Error(`Shopee upload ảnh lỗi: ${data.error} - ${data.message || ''}`);
  }

  // Response: { response: { image_list: [{ image_id, image_url }] } }
  const imageId = data?.response?.image_list?.[0]?.image_id;
  if (!imageId) {
    throw new Error('Shopee không trả image_id sau khi upload.');
  }
  return String(imageId);
}

/**
 * Tải ảnh từ URL về Buffer.
 * Xử lý redirect (ví dụ ibb.co trỏ sang ảnh thật).
 */
export async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Tải ảnh thất bại: ${res.status} - ${url}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) {
    throw new Error(`URL không phải ảnh trực tiếp (${contentType}): ${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
