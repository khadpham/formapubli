import { db, shopeeSettings, shopeeShopTokens, orders } from '@/db';
import { eq, desc } from 'drizzle-orm';
import { AppError } from '../app-error';
import type { UserRole } from '@/lib/roles';

export interface ShopeeShopConfig {
  /** Kho xuất hàng Shopee. Rỗng = chưa cấu hình, luồng sync từ chối chạy. */
  warehouseId: string;
  /** COD đang bật? Mặc định tắt. */
  codEnabled: boolean;
}

const DEFAULTS: ShopeeShopConfig = { warehouseId: '', codEnabled: false };

/** Đọc cấu hình runtime (DB thắng env, env thắng mặc định). */
export async function getShopeeConfig(): Promise<ShopeeShopConfig> {
  const rows = await db.select().from(shopeeSettings);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const envWh = `${process.env.SHOPEE_WAREHOUSE_ID || ''}`.trim();
  const envCod = `${process.env.SHOPEE_COD_ENABLED || ''}`.trim() === '1';
  return {
    warehouseId: map.get('warehouse_id') ?? (envWh || DEFAULTS.warehouseId),
    codEnabled: map.has('cod_enabled')
      ? map.get('cod_enabled') === '1'
      : envCod || DEFAULTS.codEnabled,
  };
}

/**
 * Lấy shop_id hiệu lực: ENV SHOPEE_SHOP_ID thắng; khi env trống thì đọc
 * shop_id mới nhất từ shopee_shop_tokens (sau ủy quyền lần đầu env chưa kịp
 * điền mà token đã nằm trong DB). Trả kèm nguồn để UI/API cho người vận hành
 * biết shop_id lấy từ đâu. KHÔNG tự ghi env.
 */
export async function resolveShopeeShopId(): Promise<{
  shopId: number;
  source: 'env' | 'db' | null;
}> {
  const envId = Number(process.env.SHOPEE_SHOP_ID || '0') || 0;
  if (envId) return { shopId: envId, source: 'env' };
  const rows = await db
    .select({ shopId: shopeeShopTokens.shopId })
    .from(shopeeShopTokens)
    .orderBy(desc(shopeeShopTokens.updatedAt))
    .limit(1);
  if (rows.length > 0 && rows[0].shopId) return { shopId: rows[0].shopId, source: 'db' };
  return { shopId: 0, source: null };
}

/**
 * Ghi cấu hình - CHỈ chủ. Kho phải tồn tại (check ở route gọi, tránh import
 * vòng với warehouse.service).
 */
export async function setShopeeConfig(
  patch: Partial<ShopeeShopConfig>,
  actorRole: UserRole
): Promise<ShopeeShopConfig> {
  if (actorRole !== 'ROLE_OWNER') {
    throw AppError.forbidden('Chỉ chủ mới được đổi cấu hình Shopee.');
  }
  const entries: Array<[string, string]> = [];
  if (patch.warehouseId !== undefined) entries.push(['warehouse_id', patch.warehouseId]);
  if (patch.codEnabled !== undefined) entries.push(['cod_enabled', patch.codEnabled ? '1' : '0']);
  for (const [key, value] of entries) {
    await db
      .insert(shopeeSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: shopeeSettings.key, set: { value } });
  }
  return getShopeeConfig();
}

/**
 * Kho đội Shopee được thấy (nhiều kho, quản lý trở lên cấp).
 * Mặc định = [kho xuất] khi chưa cấu hình.
 * Đọc DB mỗi lần gọi - quản lý đổi có hiệu lực ngay, không restart.
 */
export async function getShopeeOpsWarehouses(): Promise<string[]> {
  const rows = await db.select().from(shopeeSettings);
  const raw = rows.find((r) => r.key === 'ops_warehouse_ids')?.value || '';
  try {
    const list: unknown = JSON.parse(raw || '[]');
    if (Array.isArray(list) && list.length > 0) return list.map(String);
  } catch {
    /* JSON hỏng → rơi xuống mặc định */
  }
  const cfg = await getShopeeConfig();
  // ponytail: phạm vi đội Shopee dùng chung 1 danh sách; muốn cấp theo từng
  // người thì nâng key thành map staffId->ids (cột staff_accounts.
  // allowed_warehouse_ids sẵn cho POS là đường nâng cấp).
  return cfg.warehouseId ? [cfg.warehouseId] : [];
}

/** Ghi phạm vi kho - CHỈ chủ/quản lý. */
export async function setShopeeOpsWarehouses(
  ids: string[],
  actorRole: UserRole
): Promise<string[]> {
  if (actorRole !== 'ROLE_OWNER' && actorRole !== 'ROLE_MANAGER') {
    throw AppError.forbidden('Chỉ chủ/quản lý được cấp kho cho nhân viên Shopee.');
  }
  const clean = Array.from(new Set(ids.map((s) => `${s}`.trim()).filter(Boolean)));
  const value = JSON.stringify(clean);
  await db
    .insert(shopeeSettings)
    .values({ key: 'ops_warehouse_ids', value })
    .onConflictDoUpdate({ target: shopeeSettings.key, set: { value } });
  return getShopeeOpsWarehouses();
}

/**
 * Đơn có nằm trong phạm vi của role không. Chủ/quản lý/kho chung: luôn đúng;
 * nhân viên Shopee: kho của đơn phải thuộc danh sách được cấp.
 */
export async function isShopeeOrderInScope(orderSn: string, actorRole: UserRole): Promise<boolean> {
  if (actorRole !== 'ROLE_SHOPEE_OPS') return true;
  const found = await db
    .select({ warehouseId: orders.warehouseId })
    .from(orders)
    .where(eq(orders.idempotencyKey, `shopee-${orderSn}`))
    .limit(1);
  if (found.length === 0) return false;
  return (await getShopeeOpsWarehouses()).includes(found[0].warehouseId);
}


