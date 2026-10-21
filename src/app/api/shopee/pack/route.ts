import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { db, orders } from '@/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/shopee/pack { orderSn } - xác nhận đã đóng gói (bước 1/4, nội bộ).
 * Idempotent: đã đóng gói rồi thì trả về mốc cũ.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
      'ROLE_SHOPEE_OPS',
    ] as UserRole[]);
    const body = (await req.json().catch(() => ({}))) as { orderSn?: string };
    const orderSn = String(body.orderSn || '').trim();
    if (!orderSn) {
      return NextResponse.json({ success: false, error: 'Thiếu mã đơn.' }, { status: 400 });
    }
    const rows = await db
      .select()
      .from(orders)
      .where(eq(orders.idempotencyKey, `shopee-${orderSn}`))
      .limit(1);
    const ord: any = rows[0];
    if (!ord || ord.channel !== 'SHOPEE') {
      return NextResponse.json({ success: false, error: 'Không tìm thấy đơn Shopee.' }, { status: 404 });
    }
    if (ord.packedAt) {
      return NextResponse.json({ success: true, data: { alreadyPacked: true, packedAt: ord.packedAt } });
    }
    const now = new Date().toISOString();
    await db.update(orders).set({ packedAt: now, packedBy: session.actorId }).where(eq(orders.id, ord.id));
    return NextResponse.json({ success: true, data: { packedAt: now } });
  } catch (error) {
    return handleApiError(error);
  }
}
