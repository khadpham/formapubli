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
    await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_CASHIER',
    ] as UserRole[]);

    const data = await DiscountApprovalService.getRequest(params.id);
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

    // Thu ngân chỉ được phép gửi mã cấp phép (OTP) hoặc mã khẩn cấp từ Quản lý
    if (session.role === 'ROLE_CASHIER') {
      if (action !== 'APPROVE' || (method !== 'SHORTCODE_BOUND' && method !== 'OFFLINE_EMERGENCY')) {
        throw AppError.forbidden(
          'Thu ngân chỉ có thể mở khóa khi nhập đúng mã cấp phép (OTP 4 số) hoặc mã khẩn cấp từ Quản lý.'
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

    throw AppError.invalid(`Hành động '${action}' không được hỗ trợ (chỉ APPROVE hoặc REJECT)`);
  } catch (error: any) {
    return handleApiError(error);
  }
}
