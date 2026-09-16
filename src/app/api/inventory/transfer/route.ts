import { NextRequest, NextResponse } from 'next/server';
import { InventoryService } from '@/services/inventory.service';
import { extractUserRole, recordAuditLog } from '@/lib/rbac-guard';
import { resolveRequestIdentity } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';

export async function POST(req: NextRequest) {
  try {
    // CP3-B1 Invariant: Direct internal transfer is strictly restricted to ROLE_OWNER and ROLE_MANAGER
    const ALLOWED_TRANSFER_ROLES: UserRole[] = ['ROLE_OWNER', 'ROLE_MANAGER'];
    const identity = await resolveRequestIdentity(req, ALLOWED_TRANSFER_ROLES, {
      role: extractUserRole(req),
      actorId: req.headers.get('x-formapubli-actor') || 'Thủ kho formapubli',
    });
    const userRole = identity.role as UserRole;
    const actorHeader = identity.actorId;
    const actorContext = identity.actorContext;

    if (userRole !== 'ROLE_OWNER' && userRole !== 'ROLE_MANAGER') {
      return NextResponse.json(
        { success: false, code: 'FORBIDDEN', error: 'Chuyển kho trực tiếp chỉ dành cho Quản lý hoặc Chủ cửa hàng.' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { editionId, fromWarehouseId, toWarehouseId, quantity, documentRef, note } = body;
    const idempotencyKey = req.headers.get('idempotency-key') || req.headers.get('x-idempotency-key') || body.idempotencyKey;

    if (!editionId || !fromWarehouseId || !toWarehouseId || quantity === undefined || quantity === null || !documentRef) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', error: 'Thiếu thông tin bắt buộc (editionId, fromWarehouseId, toWarehouseId, quantity, documentRef)' },
        { status: 400 }
      );
    }
    if (!idempotencyKey || !`${idempotencyKey}`.trim()) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', error: 'Bắt buộc cung cấp idempotencyKey cho thao tác chuyển kho trực tiếp.' },
        { status: 400 }
      );
    }
    const qty = typeof quantity === 'number' ? quantity : Number(`${quantity}`.trim());
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
      return NextResponse.json({ success: false, code: 'INVALID_INPUT', error: 'quantity phải là số nguyên > 0.' }, { status: 400 });
    }

    const result = await InventoryService.transfer({
      editionId,
      fromWarehouseId,
      toWarehouseId,
      quantity: qty,
      documentRef,
      note,
      actorId: actorHeader,
      actorContext,
      idempotencyKey: `${idempotencyKey}`.trim(),
    });

    if (!(result as any).isDuplicate) {
      recordAuditLog({
        action: 'TRANSFER_DISPATCH', actorRole: userRole, actorId: actorHeader,
        resource: '/api/inventory/transfer', details: `Chuyển ${qty} cuốn ${editionId}: ${fromWarehouseId} → ${toWarehouseId} (${documentRef}).`,
      });
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    return handleApiError(error);
  }
}

