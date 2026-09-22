import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { DiscountApprovalService } from '@/services/discount-approval.service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/pos/discount-approvals?warehouseId=...&id=...
 * - Lấy danh sách yêu cầu chờ duyệt (Quản lý) hoặc tra cứu 1 yêu cầu cụ thể (Thu ngân).
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_CASHIER',
    ] as UserRole[]);

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const warehouseId = searchParams.get('warehouseId') || undefined;

    if (id) {
      const data = await DiscountApprovalService.getRequest(id);
      return NextResponse.json({ success: true, data });
    }

    const data = await DiscountApprovalService.listPending(warehouseId);
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/**
 * POST /api/pos/discount-approvals
 * - Thu ngân gửi yêu cầu duyệt chiết khấu đặc biệt cho giỏ hàng hiện tại.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_CASHIER',
    ] as UserRole[]);

    const body = await req.json();
    const { orderCode, warehouseId, items, requestedDiscountRate } = body;

    const data = await DiscountApprovalService.createRequest({
      orderCode,
      warehouseId,
      cashierId: session.actorId,
      items,
      requestedDiscountRate,
      actorContext: {
        staffId: session.actorId,
        role: session.role,
        fullName: session.fullName,
      },
    });

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}
