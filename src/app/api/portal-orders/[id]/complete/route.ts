import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { db, orders, auditLogs } from '@/db';
import { eq, and, sql } from 'drizzle-orm';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { withDbRetry } from '@/lib/db-retry';
import { AppError } from '@/services/app-error';

export const dynamic = 'force-dynamic';

/**
 * POST /api/portal-orders/[id]/complete - Hoàn tất đơn portal (ghi doanh thu).
 *
 * Chuyển đơn PENDING_CONFIRMATION + shippingStatus=DELIVERED → COMPLETED.
 * Doanh thu được ghi nhận qua trạng thái COMPLETED (getSalesSummary lọc theo
 * status này). KHÔNG tạo bút toán kho mới - bước approve đã trừ kho thật
 * (DISPATCH_SALE) rồi.
 *
 * Với đơn COD: đánh dấu codStatus=RECEIVED (đã thu tiền khi giao hàng).
 *
 * Quyền: ROLE_OWNER, ROLE_MANAGER, ROLE_WAREHOUSE (người giao xác nhận đã thu tiền)
 *
 * Idempotent: đơn đã COMPLETED thì trả về thành công luôn.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
    ] as UserRole[]);
    const { id } = await params;
    const actorId = session.actorId;
    const actorRole = session.role as string;

    const result = await withDbRetry(async () => {
      return await db.transaction(async (tx) => {
        const ord = (await tx.select().from(orders).where(eq(orders.id, id)).limit(1))[0];
        if (!ord) throw AppError.notFound('Không tìm thấy đơn.');
        if (ord.channel !== 'ONLINE') throw AppError.invalid('Chỉ hoàn tất được đơn online.');
        if (ord.status === 'COMPLETED') {
          return { orderId: id, orderCode: ord.orderCode, alreadyCompleted: true };
        }
        if (ord.status !== 'PENDING_CONFIRMATION') {
          throw AppError.conflict(`Đơn đang ở trạng thái ${ord.status}, không thể hoàn tất.`);
        }
        if (ord.shippingStatus !== 'DELIVERED') {
          throw AppError.conflict(
            'Chỉ hoàn tất được đơn đã giao hàng (DELIVERED). Cập nhật trạng thái giao hàng trước.'
          );
        }

        const updateRes: any = await tx.run(sql`
          UPDATE orders
          SET status = 'COMPLETED',
              cod_status = CASE WHEN payment_method = 'COD' THEN 'RECEIVED' ELSE cod_status END
          WHERE id = ${id} AND status = 'PENDING_CONFIRMATION'
        `);
        if (updateRes.rowsAffected !== 1) {
          throw AppError.conflict(
            'Trạng thái đơn đã đổi trong lúc đang hoàn tất. Tải lại trang và kiểm tra lại.'
          );
        }

        await tx
          .insert(auditLogs)
          .values({
            id: `aud-order-complete-${id}`,
            action: 'ORDER_COMPLETED',
            actorRole,
            actorId: actorId || `unattributed:${actorRole}`,
            resource: '/api/portal-orders',
            details: `Hoàn tất đơn portal ${ord.orderCode} (doanh thu ${ord.paymentMethod})`,
          })
          .onConflictDoNothing({ target: auditLogs.id });

        return { orderId: id, orderCode: ord.orderCode, alreadyCompleted: false };
      });
    });

    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    return handleApiError(e);
  }
}
