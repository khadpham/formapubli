import { NextRequest, NextResponse } from 'next/server';
import { ReturnService } from '@/services/return.service';
import { recordAuditLog } from '@/lib/rbac-guard';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { isValidManagerPin } from '@/lib/manager-pin';
import { UserRole } from '@/lib/roles';

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
    const ALLOWED_VIEW_ROLES: UserRole[] = ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER', 'ROLE_WAREHOUSE'];
    // P1b: Default-Deny — bắt buộc session cookie hợp lệ.
    const session = await requireSessionRole(req, ALLOWED_VIEW_ROLES);
    const userRole = session.role;
    const actorHeader = session.actorId;

    if (userRole === 'ROLE_WAREHOUSE') {
      return NextResponse.json({ success: true, returns: [], message: 'Thủ kho không có quyền xem phiếu hoàn tiền.' });
    }
    const list = await ReturnService.list({
      orderId: searchParams.get('orderId') || undefined,
      status: searchParams.get('status') || undefined,
    });
    const scoped = userRole === 'ROLE_CASHIER' ? list.filter((r) => r.createdBy === actorHeader) : list;
    return NextResponse.json({ success: true, role: userRole, returns: scoped });
  } catch (error: any) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;
    const needPriv = action !== 'REQUEST';
    // CP3-R1 (mục 6): REQUEST chỉ OWNER/MANAGER/CASHIER — TAX và WAREHOUSE bị chặn.
    const allowedRoles: UserRole[] = needPriv
      ? ['ROLE_OWNER', 'ROLE_MANAGER']
      : ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER'];

    // P1b: Default-Deny — danh tính lấy từ session (giữ nguyên CP3-R1:
    // body.createdBy không bao giờ được dùng làm identity).
    const session = await requireSessionRole(req, allowedRoles);
    const userRole = session.role;
    const actorHeader = session.actorId;
    const actorContext = {
      staffId: session.actorId,
      role: session.role,
      fullName: session.fullName,
      sessionId: session.sessionId,
    };


    if (userRole === 'ROLE_TAX' || userRole === 'ROLE_WAREHOUSE') {
      return NextResponse.json({ success: false, error: 'Vai trò này không được thao tác phiếu đổi/trả.' }, { status: 403 });
    }

    // CP3-R1: số lượng không cắt thập phân — "1.5" tới service nguyên vẹn để bị chặn.
    const toQty = (v: unknown): number => {
      if (typeof v === 'number') return v;
      if (typeof v === 'string' && v.trim() !== '') return Number(v.trim());
      return 0;
    };

    if (action === 'REQUEST') {
      // Cashier quá hạn window: bắt buộc PIN quản lý (pattern hard-cap discount)
      const providedPin = `${body.managerPin ?? ''}`;
      const bypassWindow = isPrivileged(userRole) || (providedPin !== '' && (await isValidManagerPin(providedPin)));
      if (!isPrivileged(userRole) && body.expectWindowOverride && !bypassWindow) {
        await recordAuditLog({
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
        actorContext,
        idempotencyKey: body.idempotencyKey,
        note: body.note,
        bypassWindow,
        items: Array.isArray(body.items) ? body.items.map((it: any) => ({
          orderItemId: it.orderItemId,
          editionId: it.editionId,
          quantity: toQty(it.quantity ?? 0),
          unitRefund: undefined, // CP3-R1: server snapshot giá, không tin client.
        })) : [],
      });
      if (!result.isDuplicate) {
        await recordAuditLog({
          action: 'RETURN_REQUESTED', actorRole: userRole, actorId: actorHeader,
          resource: '/api/returns', details: `Lập phiếu ${result.returnCode} cho đơn ${body.orderId}.`,
        });
      }
      return NextResponse.json({ success: true, data: result });
    }

    if (action === 'APPROVE') {
      if (!isPrivileged(userRole)) {
        return NextResponse.json({ success: false, code: 'FORBIDDEN', error: 'Chỉ Manager/Owner được duyệt phiếu.' }, { status: 403 });
      }
      const result = await ReturnService.approve(body.returnId, userRole, actorHeader, actorContext, body.idempotencyKey);
      await recordAuditLog({
        action: 'RETURN_APPROVED', actorRole: userRole, actorId: actorHeader,
        resource: '/api/returns', details: `Duyệt phiếu ${body.returnId}.`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    if (action === 'COMPLETE') {
      if (!isPrivileged(userRole)) {
        return NextResponse.json({ success: false, code: 'FORBIDDEN', error: 'Chỉ Manager/Owner được hoàn tất phiếu.' }, { status: 403 });
      }
      const result = await ReturnService.complete(
        body.returnId,
        userRole,
        Array.isArray(body.exchangeItems) ? body.exchangeItems.map((it: any) => ({
          editionId: it.editionId, quantity: toQty(it.quantity ?? 0),
        })) : undefined,
        actorContext,
        body.idempotencyKey,
      );
      await recordAuditLog({
        action: 'RETURN_COMPLETED', actorRole: userRole, actorId: actorHeader,
        resource: '/api/returns', details: `Hoàn tất phiếu ${body.returnId} (hoàn kho RETURN_INBOUND).`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    if (action === 'REJECT') {
      if (!isPrivileged(userRole)) {
        return NextResponse.json({ success: false, code: 'FORBIDDEN', error: 'Chỉ Manager/Owner được từ chối phiếu.' }, { status: 403 });
      }
      const result = await ReturnService.reject(body.returnId, userRole, body.rejectNote, actorContext, body.idempotencyKey);
      await recordAuditLog({
        action: 'RETURN_REJECTED', actorRole: userRole, actorId: actorHeader,
        resource: '/api/returns', details: `Từ chối phiếu ${body.returnId}.`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    if (action === 'VOID') {
      if (!isPrivileged(userRole)) {
        return NextResponse.json({ success: false, code: 'FORBIDDEN', error: 'Chỉ Manager/Owner được hủy phiếu.' }, { status: 403 });
      }
      const result = await ReturnService.voidReturn(
        body.returnId,
        userRole,
        body.voidReason,
        actorContext,
        body.idempotencyKey,
      );
      await recordAuditLog({
        action: 'RETURN_VOIDED', actorRole: userRole, actorId: actorHeader,
        resource: '/api/returns', details: `Hủy phiếu ${body.returnId} (lý do: ${body.voidReason}).`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    return NextResponse.json(
      { success: false, code: 'INVALID_INPUT', error: 'action không hợp lệ (REQUEST | APPROVE | COMPLETE | REJECT | VOID).' },
      { status: 400 }
    );
  } catch (error: any) {
    return handleApiError(error);
  }
}

