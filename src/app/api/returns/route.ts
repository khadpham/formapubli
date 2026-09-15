import { NextRequest, NextResponse } from 'next/server';
import { ReturnService } from '@/services/return.service';
import { extractUserRole, recordAuditLog } from '@/lib/rbac-guard';
import { isValidManagerPin } from '@/lib/manager-pin';

export const dynamic = 'force-dynamic';

/**
 * BV-06 — Contract API Phiếu Đổi/Trả sách.
 *
 * POST /api/returns { action, ... }:
 * - REQUEST: { orderId, returnType, reason, targetWarehouseId, inventoryDisposition,
 *              items: [{editionId, quantity, unitRefund?}], refundAmount?, cashboxSessionId?,
 *              note?, idempotencyKey?, managerPin? (khi quá hạn đổi/trả) }
 * - APPROVE: { returnId }
 * - COMPLETE: { returnId, exchangeItems?: [{editionId, quantity}] }
 * - REJECT: { returnId, rejectNote? }
 * - VOID: { returnId, voidReason! }
 * GET /api/returns?orderId=&status= — tra cứu phiếu.
 *
 * Phân quyền: ROLE_TAX không được mutate. APPROVE/COMPLETE/REJECT/VOID chỉ
 * ROLE_OWNER/ROLE_MANAGER. Cashier quá hạn window bắt buộc managerPin.
 */

function isPrivileged(role: string) {
  return role === 'ROLE_OWNER' || role === 'ROLE_MANAGER';
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userRole = extractUserRole(req);
    if (userRole === 'ROLE_WAREHOUSE') {
      return NextResponse.json({ success: true, returns: [], message: 'Thủ kho không có quyền xem phiếu hoàn tiền.' });
    }
    const actorHeader = req.headers.get('x-formapubli-actor') || userRole;
    const list = await ReturnService.list({
      orderId: searchParams.get('orderId') || undefined,
      status: searchParams.get('status') || undefined,
    });
    const scoped = userRole === 'ROLE_CASHIER' ? list.filter((r) => r.createdBy === actorHeader) : list;
    return NextResponse.json({ success: true, role: userRole, returns: scoped });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Lỗi truy vấn phiếu trả' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;
    const userRole = extractUserRole(req);
    const actorHeader = req.headers.get('x-formapubli-actor') || body.createdBy || userRole;

    if (userRole === 'ROLE_TAX') {
      return NextResponse.json({ success: false, error: 'Kế toán thuế không được thao tác phiếu đổi/trả.' }, { status: 403 });
    }

    if (action === 'REQUEST') {
      // Cashier quá hạn window: bắt buộc PIN quản lý (pattern hard-cap discount)
      const providedPin = `${body.managerPin ?? ''}`;
      const bypassWindow = isPrivileged(userRole) || (providedPin !== '' && isValidManagerPin(providedPin));
      if (!isPrivileged(userRole) && body.expectWindowOverride && !bypassWindow) {
        recordAuditLog({
          action: 'RETURN_REQUESTED', actorRole: userRole, actorId: actorHeader,
          resource: '/api/returns', details: `Từ chối phiếu quá hạn không PIN (đơn ${body.orderId}).`,
        });
        return NextResponse.json({ success: false, error: 'Phiếu quá hạn đổi/trả. Yêu cầu mã PIN Quản lý!' }, { status: 403 });
      }
      const result = await ReturnService.createRequest({
        id: body.id,
        returnCode: body.returnCode,
        orderId: body.orderId,
        returnType: body.returnType,
        reason: body.reason,
        targetWarehouseId: body.targetWarehouseId,
        inventoryDisposition: body.inventoryDisposition,
        refundAmount: body.refundAmount !== undefined ? parseFloat(body.refundAmount) : 0,
        cashboxSessionId: body.cashboxSessionId,
        createdBy: actorHeader,
        actorRole: userRole,
        idempotencyKey: body.idempotencyKey,
        note: body.note,
        bypassWindow,
        items: Array.isArray(body.items) ? body.items.map((it: any) => ({
          editionId: it.editionId,
          quantity: parseInt(it.quantity ?? 0, 10),
          unitRefund: it.unitRefund !== undefined ? parseFloat(it.unitRefund) : 0,
        })) : [],
      });
      if (!result.isDuplicate) {
        recordAuditLog({
          action: 'RETURN_REQUESTED', actorRole: userRole, actorId: actorHeader,
          resource: '/api/returns', details: `Lập phiếu ${result.returnCode} cho đơn ${body.orderId}.`,
        });
      }
      return NextResponse.json({ success: true, data: result });
    }

    if (action === 'APPROVE') {
      if (!isPrivileged(userRole)) {
        return NextResponse.json({ success: false, error: 'Chỉ Manager/Owner được duyệt phiếu.' }, { status: 403 });
      }
      const result = await ReturnService.approve(body.returnId, userRole, actorHeader);
      recordAuditLog({
        action: 'RETURN_APPROVED', actorRole: userRole, actorId: actorHeader,
        resource: '/api/returns', details: `Duyệt phiếu ${body.returnId}.`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    if (action === 'COMPLETE') {
      if (!isPrivileged(userRole)) {
        return NextResponse.json({ success: false, error: 'Chỉ Manager/Owner được hoàn tất phiếu.' }, { status: 403 });
      }
      const result = await ReturnService.complete(
        body.returnId,
        userRole,
        Array.isArray(body.exchangeItems) ? body.exchangeItems.map((it: any) => ({
          editionId: it.editionId, quantity: parseInt(it.quantity ?? 0, 10),
        })) : undefined,
      );
      recordAuditLog({
        action: 'RETURN_COMPLETED', actorRole: userRole, actorId: actorHeader,
        resource: '/api/returns', details: `Hoàn tất phiếu ${body.returnId} (hoàn kho RETURN_INBOUND).`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    if (action === 'REJECT') {
      if (!isPrivileged(userRole)) {
        return NextResponse.json({ success: false, error: 'Chỉ Manager/Owner được từ chối phiếu.' }, { status: 403 });
      }
      const result = await ReturnService.reject(body.returnId, userRole, body.rejectNote);
      recordAuditLog({
        action: 'RETURN_REJECTED', actorRole: userRole, actorId: actorHeader,
        resource: '/api/returns', details: `Từ chối phiếu ${body.returnId}.`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    if (action === 'VOID') {
      if (!isPrivileged(userRole)) {
        return NextResponse.json({ success: false, error: 'Chỉ Manager/Owner được hủy phiếu.' }, { status: 403 });
      }
      const result = await ReturnService.voidReturn(body.returnId, userRole, body.voidReason);
      recordAuditLog({
        action: 'RETURN_VOIDED', actorRole: userRole, actorId: actorHeader,
        resource: '/api/returns', details: `Hủy phiếu ${body.returnId} (lý do: ${body.voidReason}).`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    return NextResponse.json(
      { success: false, error: 'action không hợp lệ (REQUEST | APPROVE | COMPLETE | REJECT | VOID).' },
      { status: 400 }
    );
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Lỗi xử lý phiếu đổi/trả' }, { status: 400 });
  }
}
