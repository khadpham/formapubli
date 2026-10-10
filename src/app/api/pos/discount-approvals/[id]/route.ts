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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_CASHIER',
    ] as UserRole[]);

    const routeParams = await params;
    const data = await DiscountApprovalService.getRequest(routeParams.id);
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
 * - Quản lý phê duyệt (APPROVE), từ chối (REJECT) hoặc thu ngân hủy yêu cầu của mình (CANCEL).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_CASHIER',
    ] as UserRole[]);

    const routeParams = await params;
    const body = await req.json();
    const { action, method, shortCode, qrToken, rejectedReason } = body;

    // Thu ngân KHÔNG được duyệt: mọi phương thức duyệt (1-chạm, mã 4 số, QR)
    // đều quyết định của Quản lý - service chặn ở approveRequest/rejectRequest
    // và từ chối tự duyệt đơn của chính mình. Route chỉ cho phép CANCEL đơn của
    // chính thu ngân; KHÔNG mở cửa sổ "mã khẩn cấp/OTP" vì không có bảng mã nào
    // tồn tại và service vẫn chặn - cửa sổ đó chỉ là lời hứa không có thật.
    if (session.role === 'ROLE_CASHIER' && action !== 'CANCEL') {
      throw AppError.forbidden('Thu ngân chỉ có thể hủy yêu cầu duyệt chiết khấu của chính mình.');
    }

    const actorContext = {
      staffId: session.actorId,
      role: session.role,
      fullName: session.fullName,
    };

    if (action === 'CANCEL') {
      const data = await DiscountApprovalService.cancelRequest({
        requestId: routeParams.id,
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
        requestId: routeParams.id,
        method: method || 'ONE_TOUCH',
        shortCode,
        qrToken,
        actorContext,
      });
      return NextResponse.json({ success: true, data });
    }

    if (action === 'REJECT') {
      const data = await DiscountApprovalService.rejectRequest({
        requestId: routeParams.id,
        rejectedReason: rejectedReason || 'Quản lý từ chối chiết khấu',
        actorContext,
      });
      return NextResponse.json({ success: true, data });
    }

    // A1-F: cashier hủy yêu cầu của mình (hoặc manager/owner hủy hộ) trước
    // khi sửa giỏ - server chuyển SUPERSEDED có điều kiện, UI mới bỏ khóa.
    // (nhánh CANCEL đã được xử lý ở trên, trước khi mở khóa APPROVE)
    throw AppError.invalid(`Hành động '${action}' không được hỗ trợ (chỉ APPROVE, REJECT hoặc CANCEL)`);
  } catch (error: any) {
    return handleApiError(error);
  }
}
