import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { OrderService } from '@/services/order.service';

export const dynamic = 'force-dynamic';

const ALLOWED_VOID_ROLES: UserRole[] = ['ROLE_OWNER', 'ROLE_MANAGER'];

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionRole(req, ALLOWED_VOID_ROLES);
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Thiếu mã đơn.' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';

    if (!reason || reason.length < 5) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', error: 'Lý do hủy đơn bắt buộc (ít nhất 5 ký tự).' },
        { status: 400 }
      );
    }

    if (reason.length > 500) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', error: 'Lý do hủy đơn không được vượt quá 500 ký tự.' },
        { status: 400 }
      );
    }

    const force = Boolean(body?.force);

    const result = await OrderService.voidCompletedOrder({
      orderId: id,
      actorRole: session.role,
      actorId: session.actorId,
      reason,
      forceCloseBypass: force,
    });

    return NextResponse.json({
      success: true,
      message: 'Đã hủy đơn và hoàn trả tồn kho thành công.',
      data: result,
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}
