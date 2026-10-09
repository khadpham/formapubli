import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { TursoTokenStorage } from '@/services/shopee/token-store';
import { getShopeeConfig } from '@/services/shopee/shop-config';

export const dynamic = 'force-dynamic';

/**
 * GET /api/shopee/status — trạng thái kết nối cho UI.
 * Không trả secret. Cờ UI nằm ở server (SHOPEE_UI_ENABLED) — bật/tắt không
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
    const shopId = Number(process.env.SHOPEE_SHOP_ID || '0') || 0;
    const stored = shopId ? await new TursoTokenStorage(shopId).get() : null;
    const cfg = await getShopeeConfig();
    return NextResponse.json({
      success: true,
      data: {
        uiEnabled: `${process.env.SHOPEE_UI_ENABLED || ''}`.trim() === '1',
        connected: !!stored?.access_token,
        shopId: stored?.shop_id ?? null,
        warehouseId: cfg.warehouseId || null,
        codEnabled: cfg.codEnabled,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
