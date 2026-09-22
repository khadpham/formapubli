import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { DeliveryOrderService } from '@/services/delivery-order.service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/delivery-orders
 * - Lấy danh sách phiếu xuất kho theo các bộ lọc.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
      'ROLE_TAX',
    ] as UserRole[]);

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || undefined;
    const fromWarehouseId = searchParams.get('fromWarehouseId') || undefined;
    const partnerId = searchParams.get('partnerId') || undefined;

    const data = await DeliveryOrderService.listDeliveryOrders({
      status,
      fromWarehouseId,
      partnerId,
    });

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/**
 * POST /api/delivery-orders
 * - Lập phiếu xuất bán sỉ đại lý mới (DRAFT).
 * - Nếu kèm cờ autoDispatch = true và idempotencyKey: thực hiện xuất và khóa sổ ngay lập tức.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
    ] as UserRole[]);

    const body = await req.json();
    const {
      partnerId,
      fromWarehouseId,
      discountRate,
      fiscalScope,
      note,
      items,
      autoDispatch,
      idempotencyKey,
    } = body;

    const actorContext = {
      staffId: session.actorId,
      role: session.role,
      fullName: session.fullName,
    };

    const draft = await DeliveryOrderService.createDraft({
      partnerId,
      fromWarehouseId,
      discountRate,
      fiscalScope,
      note,
      items,
      actorContext,
    });

    if (autoDispatch && idempotencyKey) {
      const dispatched = await DeliveryOrderService.dispatchAndLock({
        deliveryOrderId: draft.id,
        idempotencyKey,
        actorContext,
      });
      return NextResponse.json({ success: true, data: dispatched });
    }

    return NextResponse.json({ success: true, data: draft });
  } catch (error: any) {
    return handleApiError(error);
  }
}
