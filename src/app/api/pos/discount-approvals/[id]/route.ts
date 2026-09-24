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
    // A1.7: cashier chỉ xem được yêu cầu của chính mình (chống soi giỏ/
    // mức giảm của thu ngân khác qua id); manager/owner xem tất cả.
    if (session.role === 'ROLE_CASHIER' && `${data.cashierId}` !== `${session.actorId}`) {
      throw AppError.forbidden('Bạn chỉ được xem yêu cầu duyệt của chính mình.');
    }
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/**
 * POST /api/pos/discount-approvals/[id]
 * - Quản lý phê duyệt (APPROVE) hoặc từ chối (REJECT).
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

    // Thu ngân chỉ được: gửi mã cấp phép (OTP)/mã khẩn cấp, hoặc HỦY yêu cầu
    // của chính mình (A1-F: nút "Sửa giỏ và hủy phê duyệt").
    if (session.role === 'ROLE_CASHIER') {
      const isOtpFlow =
        action === 'APPROVE' && (method === 'SHORTCODE_BOUND' || method === 'OFFLINE_EMERGENCY');
      if (action !== 'CANCEL' && !isOtpFlow) {
        throw AppError.forbidden(
          'Thu ngân chỉ có thể mở khóa khi nhập đúng mã cấp phép (OTP 4 số), mã khẩn cấp, hoặc hủy yêu cầu của mình.'
        );
      }
    }

    const actorContext = {
      staffId: session.actorId,
      role: session.role === 'ROLE_CASHIER' ? 'ROLE_MANAGER' : session.role,
      fullName: session.role === 'ROLE_CASHIER' ? `Quản lý (cấp OTP cho ${session.actorId})` : session.fullName,
    };

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

    // A1-F: cashier hủy yêu cầu của mình (hoặc manager/owner hủy hộ) trước
    // khi sửa giỏ — server chuyển SUPERSEDED có điều kiện, UI mới bỏ khóa.
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

    throw AppError.invalid(`Hành động '${action}' không được hỗ trợ (chỉ APPROVE, REJECT hoặc CANCEL)`);
  } catch (error: any) {
    return handleApiError(error);
  }
}
