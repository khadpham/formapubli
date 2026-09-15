import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, SESSION_COOKIE_NAME } from '@/lib/auth-session';
import { db, staffAccounts } from '@/db';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json(
        { success: false, code: 'AUTH_REQUIRED', error: 'Chưa đăng nhập hoặc phiên làm việc đã hết hạn.' },
        { status: 401 }
      );
    }

    // Kiểm tra tài khoản trong CSDL xem có bị vô hiệu hóa giữa chừng không
    try {
      const rows = await db.select().from(staffAccounts).where(eq(staffAccounts.staffId, session.actorId)).limit(1);
      if (rows.length > 0 && !rows[0].isActive) {
        const res = NextResponse.json(
          { success: false, code: 'FORBIDDEN', error: 'Tài khoản nhân viên này đã bị vô hiệu hóa.' },
          { status: 403 }
        );
        res.cookies.delete(SESSION_COOKIE_NAME);
        return res;
      }
    } catch {
      // Bỏ qua lỗi DB nếu chạy trong môi trường test không có bảng
    }

    return NextResponse.json({
      success: true,
      data: {
        staffId: session.actorId,
        actorId: session.actorId,
        role: session.role,
        fullName: session.fullName,
        sessionId: session.sessionId,
        expiresAt: session.expiresAt,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, code: 'INTERNAL_ERROR', error: err.message || 'Lỗi kiểm tra phiên làm việc.' },
      { status: 500 }
    );
  }
}
