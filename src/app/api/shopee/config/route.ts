import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { getShopeeConfig, setShopeeConfig } from '@/services/shopee/shop-config';
import { WarehouseService } from '@/services/warehouse.service';

export const dynamic = 'force-dynamic';

/** GET /api/shopee/config — cấu hình hiện tại (chủ only). */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER'] as UserRole[]);
    return NextResponse.json({ success: true, data: await getShopeeConfig() });
  } catch (error) {
    return handleApiError(error);
  }
}

/** PUT /api/shopee/config { warehouseId?, codEnabled? } — chủ only. */
export async function PUT(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER'] as UserRole[]);
    const body = (await req.json().catch(() => ({}))) as {
      warehouseId?: string;
      codEnabled?: boolean;
    };
    if (body.warehouseId !== undefined) {
      const whs = await WarehouseService.listAll();
      if (!whs.some((w: any) => w.id === body.warehouseId)) {
        return NextResponse.json({ success: false, error: 'Kho không tồn tại.' }, { status: 400 });
      }
    }
    const cfg = await setShopeeConfig(
      {
        ...(body.warehouseId !== undefined ? { warehouseId: `${body.warehouseId}` } : {}),
        ...(body.codEnabled !== undefined ? { codEnabled: !!body.codEnabled } : {}),
      },
      session.role
    );
    return NextResponse.json({ success: true, data: cfg });
  } catch (error) {
    return handleApiError(error);
  }
}
