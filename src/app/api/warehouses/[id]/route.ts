import { NextRequest, NextResponse } from 'next/server';
import { WarehouseService } from '@/services/warehouse.service';
import type { WarehouseRow } from '@/services/warehouse.service';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { recordAuditLog } from '@/lib/rbac-guard';
import { AppError } from '@/services/app-error';
import { UserRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

const PRIVILEGED: UserRole[] = ['ROLE_OWNER', 'ROLE_MANAGER'];

/**
 * Nạp kho trước khi ghi. Trả về chính row để so trước/sau (ví dụ isActive),
 * hoặc response 404 nếu kho không tồn tại (không phải 400 — cùng pattern với
 * /api/staff/[staffId]).
 */
async function loadExisting(
  id: string
): Promise<{ row: WarehouseRow; res: null } | { row: null; res: NextResponse }> {
  const row = await WarehouseService.getWarehouse(id);
  if (!row) {
    return {
      row: null,
      res: NextResponse.json(
        { success: false, code: 'INVALID_INPUT', error: 'Kho không tồn tại.' },
        { status: 404 }
      ),
    };
  }
  return { row, res: null };
}

/** PATCH /api/warehouses/[id] — sửa tên/địa chỉ/bán trên POS/ngưng hoạt động. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireSessionRole(req, PRIVILEGED);
    const id = decodeURIComponent(params.id || '').trim();
    if (!id) throw AppError.invalid('Thiếu mã kho.');
    const existing = await loadExisting(id);
    if (existing.res) return existing.res;
    const before = existing.row!;

    const body = await req.json();
    const updated = await WarehouseService.updateWarehouse(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.address !== undefined ? { address: body.address } : {}),
      ...(body.isSellableOnPos !== undefined ? { isSellableOnPos: body.isSellableOnPos } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      ...(body.qrTransferTemplate !== undefined ? { qrTransferTemplate: body.qrTransferTemplate } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: Number(body.sortOrder) } : {}),
    });

    // Ngưng / mở lại là thao tác nhạy cảm: phải có vết riêng trong nhật ký hoạt
    // động, không gộp vào "Sửa kho" — ai tắt kho, ai bật lại kho.
    const toggled = updated.isActive !== before.isActive;
    await recordAuditLog({
      action: (toggled
        ? updated.isActive
          ? 'WAREHOUSE_ACTIVATED'
          : 'WAREHOUSE_DEACTIVATED'
        : 'WAREHOUSE_UPDATED') as any,
      actorRole: session.role,
      actorId: session.actorId,
      resource: '/api/warehouses',
      details: toggled
        ? `${updated.isActive ? 'Mở lại' : 'Ngưng hoạt động'} kho ${updated.code}: ${updated.name}.`
        : `Sửa kho ${updated.code}: ${updated.name}.`,
    });

    return NextResponse.json({ success: true, data: updated, message: `Đã cập nhật kho [${updated.code}].` });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/warehouses/[id] — chỉ xóa được kho RỖNG và chưa phát sinh nghiệp vụ.
 * Kho còn tồn / có đơn / có sổ kho → 409 kèm lý do, hướng dẫn dùng "Ngưng hoạt động".
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireSessionRole(req, PRIVILEGED);
    const id = decodeURIComponent(params.id || '').trim();
    if (!id) throw AppError.invalid('Thiếu mã kho.');
    const existing = await loadExisting(id);
    if (existing.res) return existing.res;

    const removed = await WarehouseService.deleteWarehouse(id);

    await recordAuditLog({
      action: 'WAREHOUSE_DELETED' as any,
      actorRole: session.role,
      actorId: session.actorId,
      resource: '/api/warehouses',
      details: `Xóa kho rỗng ${existing.row!.code}: ${removed.name} (${removed.id}).`,
    });

    return NextResponse.json({ success: true, data: removed, message: `Đã xóa kho [${removed.name}].` });
  } catch (error: any) {
    return handleApiError(error);
  }
}
