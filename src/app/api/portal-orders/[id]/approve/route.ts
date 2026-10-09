import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { db, orders, orderItems } from '@/db';
import { eq, and } from 'drizzle-orm';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { OrderService } from '@/services/order.service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/portal-orders/[id]/approve — Duyệt đơn portal (trừ kho).
 *
 * Thủ kho bấm "Duyệt đơn" sau khi đã soạn đủ hàng. Hệ thống trừ kho thực tế
 * (chuyển ATP giữ chỗ thành xuất kho), đơn vẫn ở PENDING_CONFIRMATION để tiếp
 * tục luồng giao hàng (CREATED → IN_TRANSIT → DELIVERED).
 *
 * Quyền: ROLE_WAREHOUSE, ROLE_MANAGER, ROLE_OWNER
 *
 * Idempotent: nếu đã duyệt (đã có bút toán xuất) thì trả về thành công luôn.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
    ] as UserRole[]);
    const { id } = await params;

    // Kiểm tra đơn tồn tại, là đơn ONLINE đang PENDING
    const order = (
      await db.select().from(orders).where(eq(orders.id, id)).limit(1)
    )[0];
    if (!order) {
      return NextResponse.json({ success: false, error: 'Không tìm thấy đơn.' }, { status: 404 });
    }
    if (order.channel !== 'ONLINE') {
      return NextResponse.json(
        { success: false, error: 'Chỉ duyệt được đơn online.' },
        { status: 400 }
      );
    }
    if (order.status !== 'PENDING_CONFIRMATION') {
      return NextResponse.json(
        { success: false, error: `Đơn đang ở trạng thái ${order.status}, không thể duyệt.` },
        { status: 400 }
      );
    }

    // Gọi OrderService để trừ kho (dùng logic duyệt chuẩn, idempotent)
    // confirmOrder sẽ trừ kho và giữ đơn ở trạng thái phù hợp cho luồng portal
    const result = await OrderService.approvePortalOrder(
      id,
      session.role,
      session.staffId || session.userId
    );

    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    return handleApiError(e);
  }
}
