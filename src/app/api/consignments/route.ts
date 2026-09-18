import { NextRequest, NextResponse } from 'next/server';
import { ConsignmentService } from '@/services/consignment.service';
import { extractUserRole, enforceFiscalScope, recordAuditLog } from '@/lib/rbac-guard';
import { requireSessionRole, resolveRequestIdentity, resolveActorId, AuthError } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * CP3-B1.2 (mục 5): chuyển đổi số lượng KHÔNG cắt phần thập phân.
 * "1.5" phải tới service nguyên vẹn để bị từ chối (không parseInt).
 */
function toQty(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v.trim());
  return 0;
}

// GET /api/consignments?id=CS-... — chi tiết kỳ (kèm lines)
// GET /api/consignments?partnerId=...&status=DRAFT — danh sách kỳ
// GET /api/consignments?partnerStock=<partnerId> — tồn hiện tại tại quầy
export async function GET(req: NextRequest) {
  try {
    const session = await requireSessionRole(
      req,
      ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER', 'ROLE_TAX']
    );
    const userRole = session.role;
    const actorHeader = session.actorId;

    const { searchParams } = new URL(req.url);

    const id = searchParams.get('id');
    if (id) {
      const stmt = await ConsignmentService.getStatement(id);
      if (userRole === 'ROLE_TAX' && stmt.fiscalScope !== 'OFFICIAL_TAX') {
        return NextResponse.json(
          { success: false, error: 'Kỳ đối soát nội bộ, kế toán thuế không được xem.' },
          { status: 403 }
        );
      }
      return NextResponse.json({ success: true, data: stmt });
    }

    const partnerStock = searchParams.get('partnerStock');
    if (partnerStock) {
      const stock = await ConsignmentService.getPartnerStock(partnerStock);
      return NextResponse.json({ success: true, data: stock });
    }

    const partnerId = searchParams.get('partnerId') || undefined;
    const requestedScope = searchParams.get('fiscalScope') || 'ALL';
    const safeScope = enforceFiscalScope(userRole as any, requestedScope);
    const status = searchParams.get('status') || undefined;
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 50;

    const list = await ConsignmentService.listStatements(partnerId, status, limit);
    // Kế toán thuế chỉ thấy kỳ OFFICIAL_TAX.
    const filtered =
      userRole === 'ROLE_TAX' ? list.filter((s) => s.fiscalScope === 'OFFICIAL_TAX') : list;

    if (safeScope !== 'OFFICIAL_TAX') {
      await recordAuditLog({
        action: 'VIEW_FISCAL_MANAGEMENT',
        actorRole: userRole,
        actorId: actorHeader,
        resource: '/api/consignments',
        details: `Truy vấn sổ ký gửi (phạm vi ${safeScope}).`,
      });
    }
    return NextResponse.json({ success: true, data: filtered });
  } catch (error: any) {
    return handleApiError(error);
  }
}

// POST /api/consignments { action: send | confirm-receipt | create-statement |
//   record-sale | record-return | confirm, ... }
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(
      req,
      ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER']
    );
    const userRole = session.role;
    const actorHeader = session.actorId;
    const actorContext = {
      staffId: session.actorId,
      role: session.role,
      fullName: session.fullName,
      sessionId: session.sessionId,
    };

    const body = await req.json();
    const { action } = body;
    const bodyKey = body.idempotencyKey;
    const cleanBodyKey = typeof bodyKey === 'string' ? bodyKey.trim() : '';

    if (action === 'send') {
      const { partnerId, fromWarehouseId, vehicleInfo, notes, items } = body;
      if (!partnerId || !fromWarehouseId || !items || !Array.isArray(items) || items.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Thiếu đối tác, kho gửi hoặc danh sách hàng (items).' },
          { status: 400 }
        );
      }
      if (!cleanBodyKey) {
        return NextResponse.json(
          { success: false, code: 'INVALID_INPUT', error: 'Bắt buộc cung cấp idempotencyKey cho thao tác gửi ký gửi.' },
          { status: 400 }
        );
      }
      const result = await ConsignmentService.sendToConsignment({
        partnerId,
        fromWarehouseId,
        actorContext,
        idempotencyKey: cleanBodyKey,
        vehicleInfo,
        notes,
        items: items.map((it: any) => ({
          editionId: it.editionId,
          quantity: toQty(it.quantity ?? 0),
          notes: it.notes,
        })),
      });
      await recordAuditLog({
        action: 'TRANSFER_DISPATCH',
        actorRole: userRole,
        actorId: actorHeader,
        resource: '/api/consignments',
        details: `Gửi ký gửi ${result.shipmentId} tới ${partnerId} (${result.totalQuantity} cuốn).`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    if (action === 'confirm-receipt') {
      const { shipmentId } = body;
      if (!shipmentId) {
        return NextResponse.json({ success: false, error: 'Thiếu mã phiếu (shipmentId).' }, { status: 400 });
      }
      if (!cleanBodyKey) {
        return NextResponse.json(
          { success: false, code: 'INVALID_INPUT', error: 'Bắt buộc cung cấp idempotencyKey cho thao tác xác nhận nhận ký gửi.' },
          { status: 400 }
        );
      }
      const result = await ConsignmentService.confirmConsignmentReceipt({
        shipmentId,
        actorContext,
        idempotencyKey: cleanBodyKey,
      });
      await recordAuditLog({
        action: 'TRANSFER_RECEIVE',
        actorRole: userRole,
        actorId: actorHeader,
        resource: '/api/consignments',
        details: `Đại lý nhận hàng ký gửi phiếu ${shipmentId} (${result.status}).`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    if (action === 'create-statement') {
      const { partnerId, periodStart, periodEnd, discountOverride, fiscalScope, createdBy, notes } = body;
      if (!partnerId || !periodStart || !periodEnd) {
        return NextResponse.json(
          { success: false, error: 'Thiếu đối tác hoặc kỳ đối soát (periodStart/periodEnd).' },
          { status: 400 }
        );
      }
      if (fiscalScope === 'OFFICIAL_TAX' && userRole !== 'ROLE_OWNER' && userRole !== 'ROLE_MANAGER') {
        return NextResponse.json(
          { success: false, error: 'Chỉ Quản lý/Chủ được mở kỳ đối soát sổ thuế.' },
          { status: 403 }
        );
      }
      const result = await ConsignmentService.createStatement({
        partnerId,
        periodStart,
        periodEnd,
        discountOverride:
          discountOverride !== undefined && discountOverride !== null
            ? parseFloat(discountOverride)
            : undefined,
        fiscalScope: fiscalScope || 'INTERNAL_MANAGEMENT',
        // Chống mạo danh: strict ép người mở kỳ = session (bỏ createdBy client).
        createdBy: resolveActorId(session, createdBy),
        notes,
      });
      const effCreatedBy = resolveActorId(session, createdBy);
      await recordAuditLog({
        action: 'CONSIGNMENT_STATEMENT',
        actorRole: userRole,
        actorId: effCreatedBy,
        resource: '/api/consignments',
        details: `Mở kỳ đối soát ${result.statementId} cho ${partnerId} (${periodStart} -> ${periodEnd}).`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    if (action === 'record-sale') {
      const { statementId, editionId, quantity, actorId } = body;
      if (!statementId || !editionId || !quantity) {
        return NextResponse.json(
          { success: false, error: 'Thiếu kỳ đối soát, ấn bản hoặc số lượng bán.' },
          { status: 400 }
        );
      }
      const result = await ConsignmentService.recordSale({
        statementId,
        editionId,
        quantity: toQty(quantity),
        // Chống mạo danh: strict ép session (bỏ actorId client).
        actorId: resolveActorId(session, actorId),
      });
      const effSaleActor = resolveActorId(session, actorId);
      await recordAuditLog({
        action: 'CONSIGNMENT_SALE',
        actorRole: userRole,
        actorId: effSaleActor,
        resource: '/api/consignments',
        details: `Đại lý báo bán ${quantity} cuốn ${editionId} (kỳ ${statementId}).`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    if (action === 'record-return') {
      const { statementId, toWarehouseId, editionId, newQty, damagedQty, actorId, notes } = body;
      if (!statementId || !toWarehouseId || !editionId) {
        return NextResponse.json(
          { success: false, error: 'Thiếu kỳ đối soát, kho nhận hoặc ấn bản thu hồi.' },
          { status: 400 }
        );
      }
      const result = await ConsignmentService.recordReturn({
        statementId,
        toWarehouseId,
        editionId,
        newQty: toQty(newQty ?? 0),
        damagedQty: toQty(damagedQty ?? 0),
        // Chống mạo danh: strict ép session (bỏ actorId client).
        actorId: resolveActorId(session, actorId),
        notes,
      });
      const effReturnActor = resolveActorId(session, actorId);
      await recordAuditLog({
        action: 'CONSIGNMENT_RETURN',
        actorRole: userRole,
        actorId: effReturnActor,
        resource: '/api/consignments',
        details: `Thu hồi ${editionId} từ quầy về ${toWarehouseId} (kỳ ${statementId}).`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    if (action === 'confirm') {
      const { statementId, actorId } = body;
      if (!statementId) {
        return NextResponse.json({ success: false, error: 'Thiếu kỳ đối soát (statementId).' }, { status: 400 });
      }
      // Chống mạo danh: strict ép người chốt = session (bỏ actorId client).
      const effConfirmActor = resolveActorId(session, actorId);
      const result = await ConsignmentService.confirm(statementId, effConfirmActor);
      await recordAuditLog({
        action: 'CONSIGNMENT_STATEMENT',
        actorRole: userRole,
        actorId: effConfirmActor,
        resource: '/api/consignments',
        details: `Chốt kỳ đối soát ${statementId}: AR ${result.totalReceivable.toLocaleString('vi-VN')} đ.`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    return NextResponse.json(
      { success: false, error: `Hành động không hợp lệ: ${action}.` },
      { status: 400 }
    );
  } catch (error: any) {
    return handleApiError(error);
  }
}

