import { NextRequest, NextResponse } from 'next/server';
import { InventoryService } from '@/services/inventory.service';
import { extractUserRole, recordAuditLog } from '@/lib/rbac-guard';
import { resolveRequestIdentity } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';

// P2-01/02/03 — Hardened: route bút toán kho trực tiếp.
// - Chặn TAX/CASHIER khai báo tường minh (header vắng mặt = luồng UI nội bộ, mặc định OWNER).
// - Allowlist event + nhất quán dấu + số nguyên + khóa chống lặp BẮT BUỘC.
const ALLOWED_EVENTS = ['RECEIPT', 'ADJUSTMENT', 'DISPATCH_SALE'];
const ALLOWED_CONDITIONS = ['NEW', 'MINOR_DAMAGE', 'DEFECTIVE', 'QUARANTINE'];

export async function POST(req: NextRequest) {
  try {
    const ALLOWED_MOVEMENT_ROLES: UserRole[] = ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_WAREHOUSE'];
    const identity = await resolveRequestIdentity(req, ALLOWED_MOVEMENT_ROLES, {
      role: extractUserRole(req),
      actorId: req.headers.get('x-formapubli-actor') || 'Thủ kho formapubli',
    });
    const userRole = identity.role as UserRole;
    const actorHeader = identity.actorId;
    const actorContext = identity.actorContext;

    if (userRole === 'ROLE_TAX' || userRole === 'ROLE_CASHIER') {
      return NextResponse.json(
        { success: false, code: 'FORBIDDEN', error: 'Bút toán kho trực tiếp chỉ dành cho Thủ kho/Quản lý.' },
        { status: 403 }
      );
    }
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

    recordAuditLog({
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

