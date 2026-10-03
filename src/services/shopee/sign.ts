import crypto from 'node:crypto';

export interface ShopeeSignParams {
  partnerId: number;
  partnerKey: string;
  apiPath: string;
  /** Unix timestamp (giây). Mặc định = giờ hiện tại. Test ghim số cố định. */
  timestamp?: number;
  accessToken?: string;
  shopId?: number;
}

/**
 * Chữ ký HMAC-SHA256 cho Shopee API v2.
 * API công khai: base = partnerId + apiPath + timestamp.
 * API nghiệp vụ: base += accessToken + shopId.
 */
export function generateShopeeSign(params: ShopeeSignParams): {
  timestamp: number;
  sign: string;
} {
  const timestamp =
    params.timestamp ?? Math.floor(Date.now() / 1000);
  let baseString = `${params.partnerId}${params.apiPath}${timestamp}`;
  if (params.accessToken && params.shopId) {
    baseString += `${params.accessToken}${params.shopId}`;
  }
  const sign = crypto
    .createHmac('sha256', params.partnerKey)
    .update(baseString)
    .digest('hex');
  return { timestamp, sign };
}
