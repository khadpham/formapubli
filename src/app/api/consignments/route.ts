import { NextRequest, NextResponse } from 'next/server';
import { ConsignmentService } from '@/services/consignment.service';
import { extractUserRole, enforceFiscalScope, recordAuditLog } from '@/lib/rbac-guard';
import { resolveRequestIdentity, AuthError } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

// GET /api/consignments?id=CS-... — chi tiết kỳ (kèm lines)
// GET /api/consignments?partnerId=...&status=DRAFT — danh sách kỳ
// GET /api/consignments?partnerStock=<partnerId> — tồn hiện tại tại quầy
export async function GET(req: NextRequest) {
  try {
    const identity = await resolveRequestIdentity(
      req,
      ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER', 'ROLE_TAX'],
      { role: extractUserRole(req), actorId: 'consignments-reader' }
    );
    const userRole = identity.role;
    const actorHeader = identity.actorId;

    if (userRole === 'ROLE_WAREHOUSE') {
      throw new AuthError(403, 'Thủ kho không có quyền truy cập sổ ký gửi & công nợ.');
    }

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
    const safeScope = enforceFiscalScope(userRole, requestedScope);
    const status = searchParams.get('status') || undefined;
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 50;

    const list = await ConsignmentService.listStatements(partnerId, status, limit);
    // Kế toán thuế chỉ thấy kỳ OFFICIAL_TAX.
    const filtered =
      userRole === 'ROLE_TAX' ? list.filter((s) => s.fiscalScope === 'OFFICIAL_TAX') : list;

    if (safeScope !== 'OFFICIAL_TAX') {
      recordAuditLog({
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
    const identity = await resolveRequestIdentity(
      req,
      ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER'],
      { role: extractUserRole(req), actorId: req.headers.get('x-formapubli-actor') || extractUserRole(req) }
    );
    const userRole = identity.role;
    const actorHeader = identity.actorId;

    if (userRole === 'ROLE_TAX' || userRole === 'ROLE_WAREHOUSE') {
      throw new AuthError(403, 'Vai trò này không được thao tác sổ ký gửi.');
    }

    const body = await req.json();
    const { action } = body;

    if (action === 'send') {
      const { partnerId, fromWarehouseId, dispatcherId, vehicleInfo, notes, items } = body;
      if (!partnerId || !fromWarehouseId || !items || !Array.isArray(items) || items.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Thiếu đối tác, kho gửi hoặc danh sách hàng (items).' },
          { status: 400 }
        );
      }
      const result = await ConsignmentService.sendToConsignment({
        partnerId,
        fromWarehouseId,
        dispatcherId: dispatcherId || actorHeader,
        vehicleInfo,
        notes,
        items: items.map((it: any) => ({
          editionId: it.editionId,
          quantity: parseInt(it.quantity ?? 0, 10),
          notes: it.notes,
        })),
      });
      recordAuditLog({
        action: 'TRANSFER_DISPATCH',
        actorRole: userRole,
        actorId: dispatcherId || actorHeader,
        resource: '/api/consignments',
        details: `Gửi ký gửi ${result.shipmentId} tới ${partnerId} (${result.totalQuantity} cuốn).`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    if (action === 'confirm-receipt') {
      const { shipmentId, receiverId } = body;
      if (!shipmentId) {
        return NextResponse.json({ success: false, error: 'Thiếu mã phiếu (shipmentId).' }, { status: 400 });
      }
      const result = await ConsignmentService.confirmConsignmentReceipt(
        shipmentId,
        receiverId || actorHeader
      );
      recordAuditLog({
        action: 'TRANSFER_RECEIVE',
        actorRole: userRole,
        actorId: receiverId || actorHeader,
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
        createdBy: createdBy || actorHeader,
        notes,
      });
      recordAuditLog({
        action: 'CONSIGNMENT_STATEMENT',
        actorRole: userRole,
        actorId: createdBy || actorHeader,
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
        quantity: parseInt(quantity, 10),
        actorId: actorId || actorHeader,
      });
      recordAuditLog({
        action: 'CONSIGNMENT_SALE',
        actorRole: userRole,
        actorId: actorId || actorHeader,
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
        newQty: parseInt(newQty ?? 0, 10),
        damagedQty: parseInt(damagedQty ?? 0, 10),
        actorId: actorId || actorHeader,
        notes,
      });
      recordAuditLog({
        action: 'CONSIGNMENT_RETURN',
        actorRole: userRole,
        actorId: actorId || actorHeader,
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
      const result = await ConsignmentService.confirm(statementId, actorId || actorHeader);
      recordAuditLog({
        action: 'CONSIGNMENT_STATEMENT',
        actorRole: userRole,
        actorId: actorId || actorHeader,
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

