import { NextRequest, NextResponse } from 'next/server';
import { WarehouseService } from '@/services/warehouse.service';
import type { BankAccountRow } from '@/services/warehouse.service';
import { requireSessionRole } from '@/lib/auth-session';
import { recordAuditLog } from '@/lib/rbac-guard';
import { handleApiError } from '@/lib/api-response';
import { AppError } from '@/services/app-error';
import { UserRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

/**
 * V4.1 S2.1 — Danh sách kho POS được phép chọn (active + is_sellable_on_pos)
 * hoặc toàn bộ kho nếu có param all=true (chỉ dành cho quản lý/thủ kho).
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_CASHIER',
      'ROLE_WAREHOUSE',
    ] as UserRole[]);

    const { searchParams } = new URL(req.url);
    const getAll = searchParams.get('all') === 'true';

    const list =
      getAll &&
      (session.role === 'ROLE_OWNER' ||
        session.role === 'ROLE_MANAGER' ||
        session.role === 'ROLE_WAREHOUSE')
        ? await WarehouseService.listAll()
        : await WarehouseService.listSellable();

    return NextResponse.json({
      success: true,
      data: list.map((w) => ({
        id: w.id,
        code: w.code,
        name: w.name,
        address: w.address,
        warehouseType: w.warehouseType,
        isSellableOnPos: w.isSellableOnPos,
        isActive: w.isActive,
        defaultBankAccountId: (w as any).defaultBankAccountId || null,
      })),
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/**
 * Tạo kho mới (Gian hàng hội chợ hoặc Kho vật lý).
 * CHỈ dành riêng cho ROLE_OWNER hoặc ROLE_MANAGER.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
    const body = await req.json();

    if (body.defaultBankAccountId) {
      const accounts = await WarehouseService.listBankAccounts();
      if (!accounts.some((b: BankAccountRow) => b.id === body.defaultBankAccountId)) {
        throw AppError.invalid('Tài khoản nhận tiền không tồn tại hoặc đã ngưng.');
      }
    }

    const created = await WarehouseService.createWarehouse({
      code: body.code,
      name: body.name,
      address: body.address,
      warehouseType: body.warehouseType,
      isSellableOnPos: body.isSellableOnPos,
    });

    const out = created as typeof created & { defaultBankAccountId: string | null };
    if (body.defaultBankAccountId) {
      await WarehouseService.setDefaultBankAccount(created.id, body.defaultBankAccountId);
      out.defaultBankAccountId = body.defaultBankAccountId;
    } else {
      out.defaultBankAccountId = null;
    }

    // Nhật ký hoạt động: ai mở kho lúc nào, loại kho gì (xem ở /api/activity-log).
    await recordAuditLog({
      action: 'WAREHOUSE_CREATED' as any,
      actorRole: session.role,
      actorId: session.actorId,
      resource: '/api/warehouses',
      details: `Mở kho [${created.code}] ${created.name} (${created.warehouseType}).`,
    });

    return NextResponse.json(
      {
        success: true,
        data: out,
        message: `Đã mở kho/gian hàng [${created.code}] ${created.name} thành công.`,
      },
      { status: 201 }
    );
  } catch (error: any) {
    return handleApiError(error);
  }
}
