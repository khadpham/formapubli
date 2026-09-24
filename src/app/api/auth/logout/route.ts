import { NextRequest, NextResponse } from 'next/server';
import {
  SESSION_COOKIE_NAME,
  verifySession,
  releaseCashierLease,
  isLeaseEnforcedRole,
} from '@/lib/auth-session';
import { recordAuditLog } from '@/lib/rbac-guard';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (cookie) {
      const payload = await verifySession(cookie);
      if (payload) {
        // S-01: nhả lease CÓ ĐIỀU KIỆN (staff + session) — cookie cũ không
        // xóa lease của phiên mới hơn nếu đã có máy khác chiếm.
        if (isLeaseEnforcedRole(payload.role)) {
          await releaseCashierLease(payload.actorId, payload.sessionId).catch(() => false);
        }
        await recordAuditLog({
          action: 'LOGOUT' as any,
          actorRole: payload.role,
          actorId: payload.actorId,
          resource: '/api/auth/logout',
          details: `Đăng xuất chốt ca làm việc (${payload.actorId} - ${payload.role}).`,
        });
      }
    }

    const res = NextResponse.json({ success: true, message: 'Đã đăng xuất ca làm việc.' });
    res.cookies.delete(SESSION_COOKIE_NAME);
    return res;
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Lỗi xử lý đăng xuất' },
      { status: 500 }
    );
  }
}
