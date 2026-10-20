import { AppError } from '../app-error';
import { generateShopeeSign } from './sign';
import { TursoTokenStorage, type ShopeeAccessToken } from './token-store';

export interface ShopeeApiConfig {
  shopId: number;
  partnerId: number;
  partnerKey: string;
  baseUrl: string;
  fetchFn?: typeof fetch;
}

interface ShopeeTokenResponse {
  error?: string;
  message?: string;
  /** Endpoint auth tra token NGAY TAI GOC JSON (khong long trong response) - da verify that 2026-10-20. */
  access_token?: string;
  refresh_token?: string;
  expire_in?: number;
  shop_id?: number;
  response?: {
    access_token: string;
    refresh_token: string;
    expire_in: number;
    shop_id?: number;
  };
}

function tokenPayload(
  data: ShopeeTokenResponse
): NonNullable<ShopeeTokenResponse['response']> | undefined {
  // Tra loi token o goc JSON neu co, nguoc lai dung long trong response.
  if (data.access_token && data.refresh_token && data.expire_in) {
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expire_in: data.expire_in,
      shop_id: data.shop_id,
    };
  }
  return data.response;
}

function toToken(
  shopId: number,
  r: NonNullable<ShopeeTokenResponse['response']>
): ShopeeAccessToken {
  return {
    access_token: r.access_token,
    refresh_token: r.refresh_token,
    expired_at: Date.now() + r.expire_in * 1000,
    shop_id: r.shop_id ?? shopId,
  };
}

async function postShopee(
  cfg: ShopeeApiConfig,
  apiPath: string,
  body: Record<string, unknown>,
  withShopToken: boolean
): Promise<ShopeeTokenResponse> {
  const fetchFn = cfg.fetchFn ?? globalThis.fetch;
  const stored = withShopToken
    ? await new TursoTokenStorage(cfg.shopId).get()
    : null;
  const { timestamp, sign } = generateShopeeSign({
    partnerId: cfg.partnerId,
    partnerKey: cfg.partnerKey,
    apiPath,
    accessToken: withShopToken ? stored?.access_token : undefined,
    shopId: withShopToken ? cfg.shopId : undefined,
  });
  const url =
    `${cfg.baseUrl}${apiPath}` +
    `?partner_id=${cfg.partnerId}&timestamp=${timestamp}&sign=${sign}` +
    (withShopToken ? `&shop_id=${cfg.shopId}` : '');
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, partner_id: cfg.partnerId, shop_id: cfg.shopId }),
  });
  return (await res.json()) as ShopeeTokenResponse;
}

/**
 * Đổi `code` ủy quyền lấy cặp token đầu tiên và lưu DB.
 * Gọi 1 lần duy nhất khi Anh bấm ủy quyền trên console Shopee.
 */
export async function exchangeCodeForToken(
  cfg: ShopeeApiConfig & { code: string }
): Promise<ShopeeAccessToken> {
  const data = await postShopee(cfg, '/api/v2/auth/token/get', { code: cfg.code }, false);
  const payload = tokenPayload(data);
  if (!payload?.access_token || data.error) {
    throw new AppError(
      'SHOPEE_AUTH_EXPIRED',
      'Đổi mã ủy quyền Shopee thất bại - Anh bấm ủy quyền lại.',
      { error: data.error, message: data.message }
    );
  }
  const token = toToken(cfg.shopId, payload);
  await new TursoTokenStorage(cfg.shopId).store(token);
  return token;
}

/**
 * Gia hạn token - ĐÚNG 1 lần, không vòng lặp.
 * Shopee xoay refresh_token mỗi lần: bắt buộc lưu cả cặp mới.
 * Thất bại ném SHOPEE_AUTH_EXPIRED để tab Chủ báo Anh ủy quyền lại.
 */
export async function refreshShopeeTokenOnce(
  cfg: ShopeeApiConfig
): Promise<ShopeeAccessToken> {
  const stored = await new TursoTokenStorage(cfg.shopId).get();
  if (!stored?.refresh_token) {
    throw new AppError(
      'SHOPEE_AUTH_EXPIRED',
      'Gian hàng Shopee chưa ủy quyền - Anh bấm ủy quyền trước.'
    );
  }
  const data = await postShopee(
    cfg,
    '/api/v2/auth/access_token/get',
    { refresh_token: stored.refresh_token },
    false
  );
  const refreshPayload = tokenPayload(data);
  if (!refreshPayload?.access_token || data.error) {
    throw new AppError('SHOPEE_AUTH_EXPIRED', 'Token Shopee hết hạn - Anh bấm ủy quyền lại.', {
      error: data.error,
      message: data.message,
    });
  }
  const token = toToken(cfg.shopId, refreshPayload);
  await new TursoTokenStorage(cfg.shopId).store(token);
  return token;
}
