import { generateShopeeSign } from './sign';
import { TursoTokenStorage } from './token-store';
import { refreshShopeeTokenOnce } from './auth';
import type { ShopeeSyncConfig } from './order-sync';

export interface ShopeeCategory {
  category_id: number;
  category_name: string;
  display_category_name?: string;
  has_children: boolean;
}

export interface AddItemParams {
  /** Tên sản phẩm (10-120 ký tự). */
  name: string;
  /** Mô tả (tối thiểu 20 ký tự). */
  description: string;
  /** Giá bán VND (số nguyên). */
  price: number;
  /** Tồn kho. */
  stock: number;
  /** SKU nội bộ. */
  itemSku: string;
  /** Danh sách image_id từ Media API. */
  imageIdList: string[];
  /** Category ID của Shopee. */
  categoryId: number;
  /** Cân nặng kg. */
  weight: number;
  /** Kích thước gói hàng cm (tùy chọn). */
  parcelLength?: number;
  parcelWidth?: number;
  parcelHeight?: number;
}

async function shopeePost(
  cfg: ShopeeSyncConfig,
  apiPath: string,
  body: Record<string, unknown>
): Promise<any> {
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
  const data = (await res.json()) as any;
  if (data?.error) {
    throw new Error(`Shopee API lỗi: ${data.error} - ${data.message || ''}`);
  }
  return data.response;
}

async function shopeeGet(
  cfg: ShopeeSyncConfig,
  apiPath: string,
  query: Record<string, string>
): Promise<any> {
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
  if (data?.error) {
    throw new Error(`Shopee API lỗi: ${data.error} - ${data.message || ''}`);
  }
  return data.response;
}

/**
 * Lấy cây danh mục Shopee.
 * @param categoryId 0 = gốc; truyền ID cha để lấy con.
 */
export async function getShopeeCategories(
  cfg: ShopeeSyncConfig,
  categoryId = 0
): Promise<ShopeeCategory[]> {
  const res = await shopeeGet(cfg, '/api/v2/product/get_category', {
    category_id: String(categoryId),
    language: 'vn',
  });
  return (res?.category_list || []) as ShopeeCategory[];
}

/**
 * Tạo sản phẩm mới trên Shopee.
 * @returns item_id của sản phẩm vừa tạo.
 */
export async function addShopeeItem(
  cfg: ShopeeSyncConfig,
  params: AddItemParams
): Promise<number> {
  // Cấu trúc tối giản cho sản phẩm không có phân loại
  const body: Record<string, unknown> = {
    category_id: params.categoryId,
    item_name: params.name,
    description: params.description,
    item_sku: params.itemSku,
    price_info: [
      {
        currency: 'VND',
        original_price: params.price,
        current_price: params.price,
      },
    ],
    image: { image_id_list: params.imageIdList },
    weight: params.weight,
    pre_order: { is_pre_order: false },
    condition: 'NEW',
    brand: { brand_id: 0, original_brand_name: 'No Brand' },
  };
  if (params.parcelLength && params.parcelWidth && params.parcelHeight) {
    body.dimension = {
      package_length: params.parcelLength,
      package_width: params.parcelWidth,
      package_height: params.parcelHeight,
    };
  }
  const res = await shopeePost(cfg, '/api/v2/product/add_item', body);
  const itemId = res?.item_id;
  if (!itemId) {
    throw new Error('Shopee không trả item_id sau khi tạo sản phẩm.');
  }
  return Number(itemId);
}
