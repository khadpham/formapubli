import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { db, orders } from '@/db';
import { eq } from 'drizzle-orm';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/portal-orders/[id]/shipping - Cập nhật trạng thái giao hàng.
 *
 * Body: { shippingStatus: 'CREATED'|'PICKED_UP'|'IN_TRANSIT'|'DELIVERED', trackingCode?: string }
 *
 * Quyền: ROLE_WAREHOUSE, ROLE_MANAGER, ROLE_OWNER
 *
 * Luồng:
 * - CREATED: đã đóng gói
 * - IN_TRANSIT: đã gửi (kèm trackingCode)
 * - DELIVERED: đã giao (chờ nhận tiền COD)
 */
const VALID_STATUSES = ['CREATED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'RETURNED', 'FAILED'];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
    ] as UserRole[]);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const { shippingStatus, trackingCode } = body;

    if (!VALID_STATUSES.includes(shippingStatus)) {
      return NextResponse.json(
        { success: false, error: 'shippingStatus không hợp lệ.' },
        { status: 400 },
      );
    }

    const updated = await db
      .update(orders)
      .set({
        shippingStatus,
        trackingCode: trackingCode || undefined,
        codStatus: shippingStatus === 'IN_TRANSIT' ? 'PENDING' : undefined,
      })
      .where(eq(orders.id, id))
      .returning({ id: orders.id, shippingStatus: orders.shippingStatus });

    if (!updated.length) {
      return NextResponse.json({ success: false, error: 'Không tìm thấy đơn.' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: updated[0] });
  } catch (e) {
    return handleApiError(e);
  }
}
