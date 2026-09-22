import { NextRequest, NextResponse } from 'next/server';
import { WarehouseService } from '@/services/warehouse.service';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

/**
 * V4.1 S2.1 — Danh sách kho POS được phép chọn (active + is_sellable_on_pos).
 * POS nạp 1 lần khi mở quầy thay vì hardcode 3 kho trong component.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_CASHIER',
      'ROLE_WAREHOUSE',
    ] as UserRole[]);
    const list = await WarehouseService.listSellable();
    return NextResponse.json({
      success: true,
      data: list.map((w) => ({ id: w.id, code: w.code, name: w.name, warehouseType: w.warehouseType })),
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}
