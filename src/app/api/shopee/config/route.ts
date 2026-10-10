import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { getShopeeConfig, setShopeeConfig, getShopeeOpsWarehouses, setShopeeOpsWarehouses } from '@/services/shopee/shop-config';
import { WarehouseService } from '@/services/warehouse.service';

export const dynamic = 'force-dynamic';

/** GET /api/shopee/config - cấu hình hiện tại (3 role tab Shopee). */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_SHOPEE_OPS'] as UserRole[]);
    return NextResponse.json({
      success: true,
      data: { ...(await getShopeeConfig()), opsWarehouseIds: await getShopeeOpsWarehouses() },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/** PUT /api/shopee/config { warehouseId?, codEnabled?, opsWarehouseIds? } - kho xuất + COD chỉ chủ; phạm vi kho chủ/quản lý. */
export async function PUT(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
    const body = (await req.json().catch(() => ({}))) as {
      warehouseId?: string;
      codEnabled?: boolean;
      opsWarehouseIds?: string[];
    };
    if ((body.warehouseId !== undefined || body.codEnabled !== undefined) && session.role !== 'ROLE_OWNER') {
      return NextResponse.json({ success: false, error: 'Chỉ chủ mới được đổi kho xuất/COD.' }, { status: 403 });
    }
    if (body.warehouseId !== undefined || body.opsWarehouseIds !== undefined) {
      const whs = await WarehouseService.listAll();
      const ids = [
        ...(body.warehouseId !== undefined ? [`${body.warehouseId}`] : []),
        ...(Array.isArray(body.opsWarehouseIds) ? body.opsWarehouseIds.map(String) : []),
      ].filter(Boolean);
      const unknown = ids.filter((id) => !whs.some((w: any) => w.id === id));
      if (unknown.length > 0) {
        return NextResponse.json({ success: false, error: `Kho không tồn tại: ${unknown.join(', ')}.` }, { status: 400 });
      }
    }
    if (body.warehouseId !== undefined || body.codEnabled !== undefined) {
      await setShopeeConfig(
        {
          ...(body.warehouseId !== undefined ? { warehouseId: `${body.warehouseId}` } : {}),
          ...(body.codEnabled !== undefined ? { codEnabled: !!body.codEnabled } : {}),
        },
        session.role
      );
    }
    if (body.opsWarehouseIds !== undefined) {
      await setShopeeOpsWarehouses(body.opsWarehouseIds.map(String), session.role);
    }
    return NextResponse.json({
      success: true,
      data: { ...(await getShopeeConfig()), opsWarehouseIds: await getShopeeOpsWarehouses() },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
