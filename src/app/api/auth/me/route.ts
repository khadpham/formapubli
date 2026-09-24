import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, validateSessionAccount, SESSION_COOKIE_NAME } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

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

    try {
      await validateSessionAccount(session);
    } catch (err: any) {
      // Lỗi CSDL tạm thời (503) không xóa cookie — client retry, tránh văng
      // oan khi DB sụt nhất thời. Chỉ xóa cookie khi auth thật sự hết hiệu lực.
      if (err?.status === 503) return handleApiError(err);
      const res = handleApiError(err);
      res.cookies.delete(SESSION_COOKIE_NAME);
      return res;
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
    return handleApiError(err);
  }
}

