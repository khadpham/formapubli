import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { DiscountApprovalService } from '@/services/discount-approval.service';
import { AppError } from '@/services/app-error';

export const dynamic = 'force-dynamic';

/**
 * GET /api/pos/discount-approvals/[id]
 * - Thu ngân kiểm tra trạng thái yêu cầu duyệt theo ID (polling).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_CASHIER',
    ] as UserRole[]);

    const data = await DiscountApprovalService.getRequest(params.id);
    if (session.role === 'ROLE_CASHIER' && data.cashierId !== session.actorId) {
      return NextResponse.json({ success: false, code: 'FORBIDDEN', error: 'Không được xem yêu cầu của thu ngân khác.' }, { status: 403 });
    }
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/**
 * POST /api/pos/discount-approvals/[id]
 * - Quản lý phê duyệt (APPROVE), từ chối (REJECT) hoặc thu ngân hủy yêu cầu của mình (CANCEL).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_CASHIER',
    ] as UserRole[]);

    const body = await req.json();
    const { action, method, shortCode, qrToken, emergencyCode, rejectedReason } = body;

    // Thu ngân chỉ được phép gửi mã cấp phép (OTP) hoặc mã khẩn cấp từ Quản lý
    if (session.role === 'ROLE_CASHIER' && action === 'APPROVE') {
      throw AppError.forbidden('Chỉ Quản lý hoặc Chủ quầy mới có quyền phê duyệt chiết khấu.');
    }
    if (session.role === 'ROLE_CASHIER' && action !== 'CANCEL') {
      throw AppError.forbidden('Thu ngân chỉ có thể hủy yêu cầu duyệt của mình.');
    }

    const actorContext = {
      staffId: session.actorId,
      role: session.role,
      fullName: session.fullName,
    };

    if (action === 'CANCEL') {
      const data = await DiscountApprovalService.cancelRequest({
        requestId: params.id,
        actorContext: {
          staffId: session.actorId,
          role: session.role,
          fullName: session.fullName,
        },
      });
      return NextResponse.json({ success: true, data });
    }

    if (action === 'APPROVE') {
      const data = await DiscountApprovalService.approveRequest({
        requestId: params.id,
        method: method || 'ONE_TOUCH',
        shortCode,
        qrToken,
        emergencyCode,
        actorContext,
      });
      return NextResponse.json({ success: true, data });
    }

    if (action === 'REJECT') {
      const data = await DiscountApprovalService.rejectRequest({
        requestId: params.id,
        rejectedReason: rejectedReason || 'Quản lý từ chối chiết khấu',
        actorContext,
      });
      return NextResponse.json({ success: true, data });
    }

    throw AppError.invalid(`Hành động '${action}' không được hỗ trợ (chỉ APPROVE, REJECT hoặc CANCEL)`);
  } catch (error: any) {
    return handleApiError(error);
  }
}
