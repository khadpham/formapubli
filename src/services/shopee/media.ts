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
 * Trích URL ảnh trực tiếp từ trang xem của ibb.co / freeimage.host.
 * Link trong spreadsheet thường là dạng trang (trả về HTML),
 * cần bóc URL i.ibb.co/... mới tải được file ảnh.
 * Ưu tiên thẻ og:image, fallback lấy URL xuất hiện nhiều nhất.
 */
async function resolveIbbDirectUrl(pageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(pageUrl, { redirect: 'follow' });
    const html = await res.text();
    const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (og?.[1] && og[1].includes('i.ibb.co/')) return og[1];
    const matches = [...html.matchAll(/https:\/\/i\.ibb\.co\/[^"'\s<>]+/g)].map((m) => m[0]);
    if (matches.length === 0) return null;
    // URL xuất hiện nhiều nhất thường là ảnh chính.
    const freq = new Map<string, number>();
    for (const u of matches) freq.set(u, (freq.get(u) || 0) + 1);
    return [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
  } catch {
    return null;
  }
}

/**
 * Tải ảnh từ URL về Buffer.
 * Xử lý redirect (ví dụ ibb.co trỏ sang ảnh thật).
 * Tự bóc trang ibb.co / freeimage.host thành link ảnh trực tiếp.
 */
export async function downloadImage(url: string): Promise<Buffer> {
  let directUrl = url;
  if (/https?:\/\/(www\.)?(ibb\.co|freeimage\.host)\//i.test(url) && !url.includes('i.ibb.co/')) {
    const resolved = await resolveIbbDirectUrl(url);
    if (!resolved) {
      throw new Error(`Không bóc được ảnh trực tiếp từ link: ${url}`);
    }
    directUrl = resolved;
  }
  const res = await fetch(directUrl, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Tải ảnh thất bại: ${res.status} - ${directUrl}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) {
    throw new Error(`URL không phải ảnh trực tiếp (${contentType}): ${directUrl}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
