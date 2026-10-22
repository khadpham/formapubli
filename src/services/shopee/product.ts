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
  /** Kênh vận chuyển Shopee (logistic_id). Bắt buộc theo API v2. */
  logisticId?: number;
  /**
   * Attributes bắt buộc của category (mặc định cho sách Adult's Books 301543:
   * Language=Vietnamese, Import/Local=Local). Ghi đè khi cần.
   */
  attributes?: Array<{ attributeId: number; valueId: number }>;
}

/** Attributes mặc định cho sách tiếng Việt xuất bản nội địa (category 301543). */
export const DEFAULT_BOOK_ATTRIBUTES = [
  { attributeId: 200673, valueId: 105471 }, // Language = Vietnamese
  { attributeId: 200676, valueId: 103518 }, // Import/Local = Local
];

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
 * Lấy danh sách kênh vận chuyển của shop.
 * @returns logistic_id của kênh đang bật đầu tiên (để dùng cho add_item).
 */
export async function getShopeeLogisticChannelId(cfg: ShopeeSyncConfig): Promise<number> {
  const res = await shopeeGet(cfg, '/api/v2/logistics/get_channel_list', {});
  const list = (res?.logistics_channel_list || []) as Array<{
    logistics_channel_id: number;
    enabled: boolean;
  }>;
  const enabled = list.find((c) => c.enabled);
  if (!enabled) {
    throw new Error('Shop chưa bật kênh vận chuyển nào trên Shopee.');
  }
  return enabled.logistics_channel_id;
}

export interface ShopeeAttributeValue {
  value_id: number;
  original_value_name: string;
  value_unit?: string;
}

export interface ShopeeAttribute {
  attribute_id: number;
  original_attribute_name: string;
  is_mandatory: boolean;
  input_type: string;
  attribute_value_list?: ShopeeAttributeValue[];
}

/**
 * Lấy cây attributes của 1 category (để biết field bắt buộc khi tạo sản phẩm).
 */
export async function getShopeeAttributes(
  cfg: ShopeeSyncConfig,
  categoryId: number
): Promise<ShopeeAttribute[]> {
  const res = await shopeeGet(cfg, '/api/v2/product/get_attribute_tree', {
    category_id_list: String(categoryId),
    language: 'en',
  });
  // Response thật: { list: [{ category_id, attribute_tree: [{attribute_id, mandatory, name, attribute_value_list: [{value_id, name}]}] }] }
  const cats = (res?.list || []) as Array<{ attribute_tree?: any[] }>;
  const tree = cats[0]?.attribute_tree || [];
  return tree.map((a: any) => ({
    attribute_id: a.attribute_id,
    original_attribute_name: a.name,
    is_mandatory: !!a.mandatory,
    input_type: '',
    attribute_value_list: (a.attribute_value_list || []).map((v: any) => ({
      value_id: v.value_id,
      original_value_name: v.name,
    })),
  })) as ShopeeAttribute[];
}

/**
 * Tạo sản phẩm mới trên Shopee.
 * Cấu trúc theo SDK @congminh1254/shopee-sdk (đã kiểm chứng trên sandbox):
 * - seller_stock là field TOP-LEVEL (không phải stock_info_v2)
 * - logistic_info là BẮT BUỘC
 * @returns item_id của sản phẩm vừa tạo.
 */
export async function addShopeeItem(
  cfg: ShopeeSyncConfig,
  params: AddItemParams
): Promise<number> {
  const logisticId = params.logisticId ?? (await getShopeeLogisticChannelId(cfg));
  const body: Record<string, unknown> = {
    category_id: params.categoryId,
    item_name: params.name,
    description: params.description,
    item_sku: params.itemSku,
    original_price: params.price,
    image: { image_id_list: params.imageIdList },
    weight: params.weight,
    // Tồn kho: field top-level, location_id không bắt buộc
    seller_stock: [{ stock: params.stock }],
    // Kênh vận chuyển: bắt buộc
    logistic_info: [{ logistic_id: logisticId, enabled: true, is_free: false }],
    pre_order: { is_pre_order: false },
    condition: 'NEW',
    brand: { brand_id: 0, original_brand_name: 'NoBrand' },
    // Attributes bắt buộc của category (VD: Language, Import/Local với sách)
    attribute_list: (params.attributes ?? DEFAULT_BOOK_ATTRIBUTES).map((a) => ({
      attribute_id: a.attributeId,
      attribute_value_list: [{ value_id: a.valueId }],
    })),
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
