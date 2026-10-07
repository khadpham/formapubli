import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole, assertAssignedWarehouse, assertReadWarehouse } from '@/lib/auth-session';
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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
      'ROLE_TAX',
      'ROLE_CASHIER',
    ] as UserRole[]);

    const routeParams = await params;
    const data = await DeliveryOrderService.getDeliveryOrder(routeParams.id);
    // Ràng buộc kho khi ĐỌC: thủ kho gán kho A không xem chi tiết phiếu kho B
    // (trước đây chỉ luồng list lọc, chi tiết theo id thì lọt).
    assertReadWarehouse(session, data as any);
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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
    ] as UserRole[]);

    const routeParams = await params;
    const body = await req.json();
    const { action, idempotencyKey, reason } = body;

    const actorContext = {
      staffId: session.actorId,
      role: session.role,
      fullName: session.fullName,
    };

    // Ràng buộc kho khi GHI: chỉ xuất/hủy được phiếu thuộc kho mình phụ trách.
    // Luồng list POST đã kiểm (`assertAssignedWarehouse`); route động này trước
    // đây bỏ sót nên thủ kho kho A xuất/hủy được phiếu DRAFT của kho B nếu biết id.
    const existing = await DeliveryOrderService.getDeliveryOrder(routeParams.id);
    assertAssignedWarehouse(session, existing.fromWarehouseId);

    if (action === 'DISPATCH') {
      const data = await DeliveryOrderService.dispatchAndLock({
        deliveryOrderId: routeParams.id,
        idempotencyKey,
        actorContext,
      });
      return NextResponse.json({ success: true, data });
    }

    if (action === 'REVERSE') {
      const data = await DeliveryOrderService.reverse({
        deliveryOrderId: routeParams.id,
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
