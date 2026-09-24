import { NextResponse } from 'next/server';
import {
  getSessionFromRequest,
  isLeaseEnforcedRole,
  renewCashierLease,
  CASHIER_LEASE_TTL_MS,
} from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/heartbeat — gia hạn lease cashier (client gọi mỗi 5 phút).
 * Cookie-only, không nhận actor/session từ client. Chỉ UPDATE row còn sống
 * khớp staff+session (không UPSERT hồi sinh). Role không bị lease: noop.
 */
export async function POST(req: Request) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json(
        { success: false, code: 'AUTH_REQUIRED', error: 'Phiên hết hiệu lực.' },
        { status: 401 }
      );
    }
    if (!isLeaseEnforcedRole(session.role)) {
      return NextResponse.json({ success: true, data: { noop: true } });
    }
    if (!session.sessionId) {
      return NextResponse.json(
        { success: false, code: 'AUTH_REQUIRED', error: 'Phiên cũ, vui lòng đăng nhập lại.' },
        { status: 401 }
      );
    }
    const now = Date.now();
    const renewed = await renewCashierLease({
      staffId: session.actorId,
      sessionId: session.sessionId,
      nowMs: now,
    });
    if (!renewed) {
      return NextResponse.json(
        { success: false, code: 'AUTH_REQUIRED', error: 'Phiên đã hết hiệu lực hoặc đang mở ở thiết bị khác.' },
        { status: 401 }
      );
    }
    return NextResponse.json({
      success: true,
      data: {
        leaseExpiresAt: new Date(now + CASHIER_LEASE_TTL_MS).toISOString(),
        serverTime: new Date(now).toISOString(),
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
