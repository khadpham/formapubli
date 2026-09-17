import { NextRequest, NextResponse } from 'next/server';
import { RmaService } from '@/services/rma.service';
import { recordAuditLog } from '@/lib/rbac-guard';
import { requireSessionRole } from '@/lib/auth-session';

import { handleApiError } from '@/lib/api-response';

// P2-06 — Hardened RMA: ép hàng lỗi vào QUARANTINE/DEFECTIVE (không rửa thành NEW),
// gate vai trò, validate lý do/hành động/số nguyên.
const QUARANTINE_ONLY = ['QUARANTINE', 'DEFECTIVE'];
const VALID_REASONS = ['PRINT_DEFECT', 'BINDING_DEFECT', 'TRANSIT_DAMAGE', 'CUSTOMER_RETURN', 'WATER_DAMAGE', 'OTHER'];
const VALID_ACTIONS = ['HOLD_IN_QUARANTINE', 'RETURN_TO_SUPPLIER', 'WRITE_OFF_SCRAP', 'REPAIRED_RESTOCK'];

export async function GET(request: NextRequest) {
  try {
    await requireSessionRole(request, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_WAREHOUSE']);
    const { searchParams } = new URL(request.url);
    const warehouseId = searchParams.get('warehouseId') || undefined;
    const status = searchParams.get('status') || undefined;
    const editionId = searchParams.get('editionId') || undefined;

    const tickets = await RmaService.listTickets({
      warehouseId,
      status,
      editionId,
    });

    return NextResponse.json({ success: true, data: tickets });
  } catch (error: any) {
    return handleApiError(error);
  }
}


export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.action === 'resolve') {
      const session = await requireSessionRole(request, ['ROLE_OWNER', 'ROLE_MANAGER']);
      const userRole = session.role;
      const actorHeader = request.headers.get('x-formapubli-actor') || body.actorId || session.actorId;
      body.actorId = session.actorId;

      const { ticketId, resolutionAction, actorId, notes } = body;
      if (!ticketId || !resolutionAction) {
        return NextResponse.json(
          { error: 'Thiếu ticketId hoặc resolutionAction' },
          { status: 400 }
        );
      }
      if (!VALID_ACTIONS.includes(resolutionAction)) {
        return NextResponse.json({ error: `resolutionAction chỉ nhận: ${VALID_ACTIONS.join(' | ')}.` }, { status: 400 });
      }

      const updated = await RmaService.resolveTicket({
        ticketId,
        action: resolutionAction,
        actorId: actorHeader,
        notes,
      });
      recordAuditLog({
        action: 'ADJUST_STOCK', actorRole: userRole, actorId: actorHeader,
        resource: '/api/rma', details: `Xử lý RMA ${ticketId}: ${resolutionAction}.`,
      });

      return NextResponse.json({ success: true, data: updated });
    }

    // Mặc định là tạo ticket mới — OWNER, MANAGER, WAREHOUSE
    const session = await requireSessionRole(request, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_WAREHOUSE']);
    const userRole = session.role;
    const actorHeader = request.headers.get('x-formapubli-actor') || body.inspectedBy || session.actorId;
    body.inspectedBy = body.inspectedBy || session.actorId;
    const {
      warehouseId,
      editionId,
      quantity,
      defectReason,
      orderId,
      sourceCondition,
      targetCondition,
      inspectedBy,
      notes,
    } = body;

    if (!warehouseId || !editionId || quantity === undefined || quantity === null || !defectReason) {
      return NextResponse.json(
        { error: 'Thiếu trường bắt buộc: warehouseId, editionId, quantity, defectReason' },
        { status: 400 }
      );
    }
    const qty = typeof quantity === 'number' ? quantity : Number(`${quantity}`.trim());
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
      return NextResponse.json({ error: 'quantity phải là số nguyên > 0.' }, { status: 400 });
    }
    if (!VALID_REASONS.includes(defectReason)) {
      return NextResponse.json({ error: `defectReason chỉ nhận: ${VALID_REASONS.join(' | ')}.` }, { status: 400 });
    }
    const safeSource = sourceCondition || 'NEW';
    if (safeSource !== 'NEW' && safeSource !== 'NONE') {
      return NextResponse.json({ error: 'sourceCondition chỉ nhận: NEW | NONE.' }, { status: 400 });
    }
    // P2-06: ép cách ly — mọi hàng lỗi vào QUARANTINE/DEFECTIVE, không có đường về NEW
    const safeTarget = targetCondition && QUARANTINE_ONLY.includes(targetCondition) ? targetCondition : 'QUARANTINE';

    const ticket = await RmaService.createTicket({
      warehouseId,
      editionId,
      quantity: qty,
      defectReason,
      orderId,
      sourceCondition: safeSource as 'NEW' | 'NONE',
      targetCondition: safeTarget as 'QUARANTINE' | 'DEFECTIVE',
      inspectedBy: actorHeader,
      notes,
    });
    recordAuditLog({
      action: 'ADJUST_STOCK', actorRole: userRole, actorId: actorHeader,
      resource: '/api/rma', details: `Lập RMA ${ticket.id}: ${qty} cuốn ${editionId} (${defectReason}) → ${safeTarget}.`,
    });

    return NextResponse.json({ success: true, data: ticket });
  } catch (error: any) {
    return handleApiError(error);
  }
}

