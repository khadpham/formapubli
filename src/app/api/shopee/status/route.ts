import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { TursoTokenStorage } from '@/services/shopee/token-store';
import { getShopeeConfig, resolveShopeeShopId } from '@/services/shopee/shop-config';

export const dynamic = 'force-dynamic';

/**
 * GET /api/shopee/status - trạng thái kết nối cho UI.
 * Không trả secret. Cờ UI nằm ở server (SHOPEE_UI_ENABLED) - bật/tắt không
 * cần deploy lại, không sửa code.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
      'ROLE_SHOPEE_OPS',
    ] as UserRole[]);
    const { shopId, source: shopIdSource } = await resolveShopeeShopId();
    const stored = shopId ? await new TursoTokenStorage(shopId).get() : null;
    // Token hết hạn (cùng đệm 5 phút như logic refresh) thì báo chưa kết nối
    // kèm lý do rõ - lần gọi API đầu sẽ tự refresh, nhưng UI không được nói dối.
    const tokenExpired = !!stored?.access_token && stored.expired_at <= Date.now() + 5 * 60 * 1000;
    const cfg = await getShopeeConfig();
    return NextResponse.json({
      success: true,
      data: {
        uiEnabled: `${process.env.SHOPEE_UI_ENABLED || ''}`.trim() === '1',
        connected: !!stored?.access_token && !tokenExpired,
        tokenExpired,
        tokenHint: tokenExpired ? 'Token Shopee hết hạn - cần ủy quyền lại gian hàng.' : null,
        shopId: stored?.shop_id ?? (shopId || null),
        // 'env' | 'db' | null - cho người vận hành biết shop_id lấy từ đâu
        // để điền env sau lần ủy quyền đầu.
        shopIdSource,
        warehouseId: cfg.warehouseId || null,
        codEnabled: cfg.codEnabled,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
