import { NextRequest, NextResponse } from 'next/server';
import { InventoryService } from '@/services/inventory.service';
import { recordAuditLog } from '@/lib/rbac-guard';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';

// P2-01/02/03 / P1b — Hardened: route bút toán kho trực tiếp (Default-Deny).
// - Chỉ OWNER, MANAGER, WAREHOUSE có session cookie hợp lệ.
// - Allowlist event + nhất quán dấu + số nguyên + khóa chống lặp BẮT BUỘC.
const ALLOWED_EVENTS = ['RECEIPT', 'ADJUSTMENT', 'DISPATCH_SALE'];
const ALLOWED_CONDITIONS = ['NEW', 'MINOR_DAMAGE', 'DEFECTIVE', 'QUARANTINE'];

export async function POST(req: NextRequest) {
  try {
    const ALLOWED_MOVEMENT_ROLES: UserRole[] = ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_WAREHOUSE'];
    const session = await requireSessionRole(req, ALLOWED_MOVEMENT_ROLES);
    const userRole = session.role as UserRole;
    const actorHeader = session.actorId;
    const actorContext = {
      staffId: session.actorId,
      role: session.role,
      fullName: session.fullName,
      sessionId: session.sessionId,
    };
    const body = await req.json();
    const { editionId, warehouseId, eventType, quantityDelta, documentRef, note, condition, idempotencyKey } = body;


    if (!editionId || !warehouseId || !eventType || quantityDelta === undefined || quantityDelta === null || !documentRef) {
      return NextResponse.json(
        { error: 'Thiếu thông tin bắt buộc (editionId, warehouseId, eventType, quantityDelta, documentRef)' },
        { status: 400 }
      );
    }
    if (!ALLOWED_EVENTS.includes(eventType)) {
      return NextResponse.json(
        { error: `eventType chỉ nhận: ${ALLOWED_EVENTS.join(' | ')} (luồng bán/trả/combo phải đi service riêng).` },
        { status: 400 }
      );
    }
    const delta = typeof quantityDelta === 'number' ? quantityDelta : Number(`${quantityDelta}`.trim());
    if (!Number.isFinite(delta) || !Number.isInteger(delta) || delta === 0) {
      return NextResponse.json(
        { error: 'quantityDelta phải là số nguyên khác 0 (không nhận chuỗi lẻ, NaN).' },
        { status: 400 }
      );
    }
    if (eventType === 'RECEIPT' && delta < 0) {
      return NextResponse.json({ error: 'RECEIPT bắt buộc dương (xuất kho dùng DISPATCH_SALE/ADJUSTMENT).' }, { status: 400 });
    }
    if (eventType === 'DISPATCH_SALE' && delta > 0) {
      return NextResponse.json({ error: 'DISPATCH_SALE bắt buộc âm.' }, { status: 400 });
    }
    const safeCondition = condition || 'NEW';
    if (!ALLOWED_CONDITIONS.includes(safeCondition)) {
      return NextResponse.json({ error: `condition chỉ nhận: ${ALLOWED_CONDITIONS.join(' | ')}.` }, { status: 400 });
    }
    if (!idempotencyKey || !`${idempotencyKey}`.trim()) {
      return NextResponse.json(
        { error: 'Thiếu idempotencyKey — client phải sinh key mỗi lần bấm để chống double-click ghi trùng kho.' },
        { status: 400 }
      );
    }

    const result = await InventoryService.recordMovement({
      editionId,
      warehouseId,
      eventType,
      quantityDelta: delta,
      condition: safeCondition,
      documentRef,
      note,
      actorId: actorHeader,
      actorContext,
      idempotencyKey: `${idempotencyKey}`.trim(),
    });

    await recordAuditLog({
      action: 'ADJUST_STOCK',
      actorRole: userRole,
      actorId: actorHeader,
      resource: '/api/inventory/movement',
      details: `Bút toán ${eventType} ${delta} cuốn ${editionId} tại ${warehouseId} (${documentRef}).`,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    const msg = error.message || 'Lỗi xử lý bút toán kho';
    if (/UNIQUE|duplicate|idempotency/i.test(msg)) {
      return NextResponse.json({ success: false, code: 'IDEMPOTENCY_CONFLICT', error: msg }, { status: 409 });
    }
    return handleApiError(error);
  }
}

