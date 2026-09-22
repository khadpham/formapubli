import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { DeliveryOrderService } from '@/services/delivery-order.service';
import { AppError } from '@/services/app-error';

export const dynamic = 'force-dynamic';

/**
 * GET /api/delivery-orders/[id]
 * - Lấy chi tiết phiếu xuất kho (sử dụng ID hoặc mã PXK-YYYY-XXXX).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
      'ROLE_TAX',
      'ROLE_CASHIER',
    ] as UserRole[]);

    const data = await DeliveryOrderService.getDeliveryOrder(params.id);
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/**
 * POST /api/delivery-orders/[id]
 * - Thực hiện hành động:
 *   - action: 'DISPATCH': Ký duyệt và khóa sổ phiếu xuất kho.
 *   - action: 'REVERSE': Đảo bút toán hủy phiếu đã xuất.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
    ] as UserRole[]);

    const body = await req.json();
    const { action, idempotencyKey, reason } = body;

    const actorContext = {
      staffId: session.actorId,
      role: session.role,
      fullName: session.fullName,
    };

    if (action === 'DISPATCH') {
      const data = await DeliveryOrderService.dispatchAndLock({
        deliveryOrderId: params.id,
        idempotencyKey,
        actorContext,
      });
      return NextResponse.json({ success: true, data });
    }

    if (action === 'REVERSE') {
      const data = await DeliveryOrderService.reverse({
        deliveryOrderId: params.id,
        reason: reason || 'Yêu cầu hủy từ người dùng',
        idempotencyKey,
        actorContext,
      });
      return NextResponse.json({ success: true, data });
    }

    throw AppError.invalid(`Hành động '${action}' không được hỗ trợ (chỉ DISPATCH hoặc REVERSE)`);
  } catch (error: any) {
    return handleApiError(error);
  }
}
