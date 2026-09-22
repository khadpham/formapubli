import { NextRequest, NextResponse } from 'next/server';
import { InventoryService } from '@/services/inventory.service';
import { recordAuditLog } from '@/lib/rbac-guard';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';

/**
 * V4.1 S1.3 — Chốt chuyển kho hàng loạt: server cấp số PCK trong cùng tx,
 * TOCTOU stale ném 409 TRANSFER_TOCTOU_ATP_STALE kèm staleItems để UI re-cap.
 * Client KHÔNG được tự đặt documentRef (xem V4.1 mục 8-Q1; draft offline chỉ là UUID local).
 */
export async function POST(req: NextRequest) {
  try {
    const ALLOWED_TRANSFER_ROLES: UserRole[] = ['ROLE_OWNER', 'ROLE_MANAGER'];
    const session = await requireSessionRole(req, ALLOWED_TRANSFER_ROLES);
    const userRole = session.role as UserRole;
    const actorContext = {
      staffId: session.actorId,
      role: session.role,
      fullName: session.fullName,
      sessionId: session.sessionId,
    };

    const body = await req.json();
    const { fromWarehouseId, toWarehouseId, items, note } = body ?? {};
    const idempotencyKey = req.headers.get('idempotency-key') || req.headers.get('x-idempotency-key') || body?.idempotencyKey;

    if (!idempotencyKey || !`${idempotencyKey}`.trim()) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', error: 'Bắt buộc cung cấp Idempotency-Key cho thao tác chuyển kho hàng loạt.' },
        { status: 400 }
      );
    }

    const result = await InventoryService.transferBatch({
      fromWarehouseId,
      toWarehouseId,
      items,
      note,
      actorContext,
      idempotencyKey: `${idempotencyKey}`.trim(),
    });

    if (!(result as any).isDuplicate) {
      await recordAuditLog({
        action: 'TRANSFER_DISPATCH', actorRole: userRole, actorId: session.actorId,
        resource: '/api/inventory/transfer-batch',
        details: `Chuyển hàng loạt ${(result as any).lines.length} dòng ${fromWarehouseId} → ${toWarehouseId} (${(result as any).pckCode}).`,
      });
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    return handleApiError(error);
  }
}
