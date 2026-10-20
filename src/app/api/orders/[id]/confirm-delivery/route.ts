/**
 * POST /api/orders/[id]/confirm-delivery - Xác nhận khách đã nhận hàng (D1).
 *
 * Mốc kiểm toán cho hóa đơn đơn online: chỉ sau mốc này hóa đơn của đơn
 * mới được phát hành (đẩy MS-Invoice) hoặc gom vào hóa đơn tổng hợp.
 * Trước mắt xác nhận thủ công; khi có API vận chuyển, mốc này sẽ tự điền.
 *
 * Điều kiện theo kênh (giá trị lấy từ dữ liệu thật):
 * - SHOPEE: shipping_status phải là PICKED_UP/DELIVERED (đã giao cho SPX).
 * - ONLINE (portal): đơn phải COMPLETED (thủ kho đã bấm "Xác nhận đã giao").
 * Idempotent: xác nhận lại trả về mốc cũ, không ghi đè người/giờ đầu tiên.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { orders } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { isOnlineChannel } from '@/lib/order-channels';
import type { UserRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
      'ROLE_SHOPEE_OPS',
    ] as UserRole[]);
    const { id } = await params;

    const rows = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
    const ord: any = rows[0];
    if (!ord) {
      return NextResponse.json({ ok: false, error: 'Không tìm thấy đơn hàng' }, { status: 404 });
    }
    if (!isOnlineChannel(ord.channel)) {
      return NextResponse.json(
        { ok: false, error: 'Chỉ đơn online (portal/Shopee) mới cần xác nhận nhận hàng.' },
        { status: 400 }
      );
    }
    if (ord.deliveryConfirmedAt) {
      return NextResponse.json({
        ok: true,
        data: {
          alreadyConfirmed: true,
          deliveryConfirmedAt: ord.deliveryConfirmedAt,
          deliveryConfirmedBy: ord.deliveryConfirmedBy,
        },
      });
    }
    if (ord.channel === 'SHOPEE' && !['PICKED_UP', 'DELIVERED'].includes(ord.shippingStatus)) {
      return NextResponse.json(
        { ok: false, error: 'Đơn Shopee chưa giao cho đơn vị vận chuyển - chưa thể xác nhận khách đã nhận hàng.' },
        { status: 400 }
      );
    }
    if (ord.channel === 'ONLINE' && ord.status !== 'COMPLETED') {
      return NextResponse.json(
        { ok: false, error: 'Đơn portal chưa hoàn tất giao hàng - chưa thể xác nhận khách đã nhận hàng.' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const by = session.fullName || session.actorId;
    await db
      .update(orders)
      .set({ deliveryConfirmedAt: now, deliveryConfirmedBy: by } as any)
      .where(eq(orders.id, id));

    return NextResponse.json({
      ok: true,
      data: { alreadyConfirmed: false, deliveryConfirmedAt: now, deliveryConfirmedBy: by },
    });
  } catch (e: any) {
    return handleApiError(e);
  }
}
