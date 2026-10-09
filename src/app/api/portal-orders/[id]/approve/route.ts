import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { db, orders, orderItems, inventoryLedger } from '@/db';
import { eq, and } from 'drizzle-orm';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { InventoryService } from '@/services/inventory.service';
import { withDbRetry } from '@/lib/db-retry';
import { AppError } from '@/services/app-error';

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
 * Idempotent: nếu đã duyệt (đã có bút toán DISPATCH_SALE) thì trả về thành công luôn.
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
    if (!actorId) {
      return NextResponse.json(
        { success: false, error: 'Thiếu định danh người duyệt.' },
        { status: 403 }
      );
    }

    const result = await withDbRetry(async () => {
      return await db.transaction(async (tx) => {
        // 1. Kiểm tra đơn
        const ord = (await tx.select().from(orders).where(eq(orders.id, id)).limit(1))[0];
        if (!ord) throw AppError.notFound('Không tìm thấy đơn.');
        if (ord.channel !== 'ONLINE') throw AppError.invalid('Chỉ duyệt được đơn online.');
        if (ord.status !== 'PENDING_CONFIRMATION') {
          throw AppError.conflict(`Đơn đang ở trạng thái ${ord.status}, không thể duyệt.`);
        }

        // 2. Idempotent: đã có bút toán xuất chưa
        const existing = await tx
          .select({ id: inventoryLedger.id })
          .from(inventoryLedger)
          .where(
            and(
              eq(inventoryLedger.correlationId, id),
              eq(inventoryLedger.eventType, 'DISPATCH_SALE')
            )
          )
          .limit(1);
        if (existing.length > 0) {
          return { orderId: id, orderCode: ord.orderCode, alreadyApproved: true };
        }

        // 3. Lấy items + trừ kho
        const lines = await tx.select().from(orderItems).where(eq(orderItems.orderId, id));
        if (!lines.length) throw AppError.invalid('Đơn không có dòng hàng nào.');

        await InventoryService.recordMovementsBatch(
          lines.map((ln: any) => ({
            productId: ln.productId,
            editionId: ln.productId,
            isBook: !String(ln.productId).startsWith('pr-'),
            quantityDelta: -ln.quantity,
            condition: 'NEW' as const,
          })),
          {
            warehouseId: ord.warehouseId,
            eventType: 'DISPATCH_SALE',
            documentRef: ord.orderCode,
            note: `Duyệt đơn portal ${ord.orderCode} (trừ kho, chờ giao hàng)`,
            actorId,
            correlationId: id,
            idempotencyPrefix: `idem-approve-portal-${id}`,
          },
          tx
        );

        // 4. Đơn COD: set số tiền phải thu
        if (ord.paymentMethod === 'COD') {
          await tx
            .update(orders)
            .set({
              codAmount: (ord as any).finalAmount || 0,
              codStatus: 'PENDING',
            })
            .where(eq(orders.id, id));
        }

        return { orderId: id, orderCode: ord.orderCode, alreadyApproved: false };
      });
    });

    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    return handleApiError(e);
  }
}
