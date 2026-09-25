import { NextRequest, NextResponse } from 'next/server';
import { WarehouseService } from '@/services/warehouse.service';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { recordAuditLog } from '@/lib/rbac-guard';
import { AppError } from '@/services/app-error';
import { UserRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

const PRIVILEGED: UserRole[] = ['ROLE_OWNER', 'ROLE_MANAGER'];

/** 404 khi kho không tồn tại (không phải 400 — cùng pattern với /api/staff/[staffId]). */
async function notFoundIfMissing(id: string) {
  const wh = await WarehouseService.getWarehouse(id);
  if (!wh) {
    return NextResponse.json(
      { success: false, code: 'INVALID_INPUT', error: 'Kho không tồn tại.' },
      { status: 404 }
    );
  }
  return null;
}

/** PATCH /api/warehouses/[id] — sửa tên/địa chỉ/bán trên POS/ngưng hoạt động. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireSessionRole(req, PRIVILEGED);
    const id = decodeURIComponent(params.id || '').trim();
    if (!id) throw AppError.invalid('Thiếu mã kho.');
    const missing = await notFoundIfMissing(id);
    if (missing) return missing;

    const body = await req.json();
    const updated = await WarehouseService.updateWarehouse(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.address !== undefined ? { address: body.address } : {}),
      ...(body.isSellableOnPos !== undefined ? { isSellableOnPos: body.isSellableOnPos } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      ...(body.qrTransferTemplate !== undefined ? { qrTransferTemplate: body.qrTransferTemplate } : {}),
    });

    await recordAuditLog({
      action: 'WAREHOUSE_UPDATED' as any,
      actorRole: session.role,
      actorId: session.actorId,
      resource: '/api/warehouses',
      details: `Sửa kho ${updated.code}: ${updated.name}.`,
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
    const missing = await notFoundIfMissing(id);
    if (missing) return missing;

    const removed = await WarehouseService.deleteWarehouse(id);

    await recordAuditLog({
      action: 'WAREHOUSE_DELETED' as any,
      actorRole: session.role,
      actorId: session.actorId,
      resource: '/api/warehouses',
      details: `Xóa kho rỗng ${removed.id} (${removed.name}).`,
    });

    return NextResponse.json({ success: true, data: removed, message: `Đã xóa kho [${removed.name}].` });
  } catch (error: any) {
    return handleApiError(error);
  }
}
