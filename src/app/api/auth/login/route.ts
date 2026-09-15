import { NextRequest, NextResponse } from 'next/server';
import {
  signSession,
  verifyRolePasscode,
  checkRateLimit,
  recordFailedAttempt,
  resetRateLimit,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from '@/lib/auth-session';
import { UserRole } from '@/lib/roles';
import { recordAuditLog } from '@/lib/rbac-guard';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
    const body = await req.json();
    const { role, actorId, passcode } = body;

    if (!role || !actorId || !passcode) {
      return NextResponse.json(
        { success: false, error: 'Bắt buộc nhập đủ: Vai trò, Mã/Tên nhân viên (actorId) và Passcode.' },
        { status: 400 }
      );
    }

    const cleanActor = `${actorId}`.trim();
    const rateLimitKey = `${ip}:${cleanActor}`;

    // Chặn role lạ ngay từ cổng (kẻo ký session cho role không tồn tại)
    const VALID_ROLES = ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER', 'ROLE_WAREHOUSE', 'ROLE_TAX'];
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ success: false, error: 'Vai trò không hợp lệ.' }, { status: 400 });
    }

    // 1. Kiểm tra Rate Limiting (chống brute-force: 5 lần sai -> khóa 15 phút)
    const limitCheck = checkRateLimit(rateLimitKey);
    if (!limitCheck.allowed) {
      recordAuditLog({
        action: 'LOGIN_FAILED' as any,
        actorRole: role,
        actorId: cleanActor,
        resource: '/api/auth/login',
        details: `CẢNH BÁO BRUTE-FORCE: Bị khóa đăng nhập trong ${limitCheck.waitMinutes} phút do sai liên tiếp.`,
        ipAddress: ip,
      });

      return NextResponse.json(
        {
          success: false,
          error: `Tài khoản tạm thời bị khóa do nhập sai quá 5 lần. Vui lòng thử lại sau ${limitCheck.waitMinutes} phút.`,
          locked: true,
        },
        { status: 429 }
      );
    }

    // 2. Xác thực Passcode vai trò
    const isValid = verifyRolePasscode(role as UserRole, passcode);
    if (!isValid) {
      const attemptRes = recordFailedAttempt(rateLimitKey);

      recordAuditLog({
        action: (attemptRes.locked ? 'BRUTE_FORCE_DETECTED' : 'LOGIN_FAILED') as any,
        actorRole: role,
        actorId: cleanActor,
        resource: '/api/auth/login',
        details: attemptRes.locked
          ? `KHÓA 15 phút sau 5 lần sai liên tiếp (brute-force).`
          : `Đăng nhập thất bại (sai passcode). Còn lại ${attemptRes.remainingAttempts} lần thử.`,
        ipAddress: ip,
      });

      return NextResponse.json(
        {
          success: false,
          error: attemptRes.locked
            ? 'Nhập sai 5 lần! Hệ thống đã khóa phiên đăng nhập 15 phút để bảo vệ.'
            : `Mã Passcode không chính xác. Còn lại ${attemptRes.remainingAttempts} lần thử.`,
          remainingAttempts: attemptRes.remainingAttempts,
          locked: attemptRes.locked,
        },
        { status: 401 }
      );
    }

    // 3. Đăng nhập thành công -> Reset rate limit & Sinh Signed Session Cookie
    resetRateLimit(rateLimitKey);

    const now = Date.now();
    const expiresAt = now + SESSION_MAX_AGE_SECONDS * 1000;

    const token = await signSession({
      role: role as UserRole,
      actorId: cleanActor,
      issuedAt: now,
      expiresAt,
    });

    recordAuditLog({
      action: 'LOGIN_SUCCESS' as any,
      actorRole: role,
      actorId: cleanActor,
      resource: '/api/auth/login',
      details: `Đăng nhập thành công ca làm việc (vai trò: ${role}). Session cấp phát 12h.`,
      ipAddress: ip,
    });

    // 4. Trả về response có gắn Set-Cookie (HttpOnly, SameSite=Lax, Max-Age=12h)
    const res = NextResponse.json({
      success: true,
      data: {
        role,
        actorId: cleanActor,
        expiresAt,
      },
    });

    res.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return res;
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Lỗi xử lý đăng nhập' },
      { status: 500 }
    );
  }
}
