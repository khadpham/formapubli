import { NextRequest, NextResponse } from 'next/server';
import {
  signSession,
  verifyRolePasscode,
  verifyStaffPasscode,
  hashStaffPasscodeV2,
  checkDualRateLimit,
  recordDualFailedAttempt,
  resetDualRateLimit,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  isAuthStrict,
  extractClientIp,
} from '@/lib/auth-session';
import {
  checkDbDualLimit,
  recordDbDualFail,
  resetDbDualLimit,
} from '@/lib/login-attempts-db';
import { UserRole } from '@/lib/roles';
import { recordAuditLog } from '@/lib/rbac-guard';
import { db, staffAccounts } from '@/db';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const ip = extractClientIp(req);
    const body = await req.json();
    const staffIdInput = `${body.staffId || body.actorId || ''}`.trim();
    const passcode = `${body.passcode || ''}`.trim();
    const roleInput = body.role as UserRole | undefined;

    if (!staffIdInput || !passcode) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', error: 'Bắt buộc nhập Mã nhân viên (staffId) và Passcode.' },
        { status: 400 }
      );
    }

    // 0. Ranh giới tin cậy proxy (#6): production bắt buộc khai báo TRUST_PROXY
    // (cloudflare | direct) — nếu không mọi client đổ về 127.0.0.1, khóa 1
    // người là khóa cả quầy + audit ghi sai IP. Fail-closed ngay khi boot logic.
    const trustProxy = `${process.env.TRUST_PROXY || ''}`.trim().toLowerCase();
    if (process.env.NODE_ENV === 'production' && trustProxy !== 'cloudflare' && trustProxy !== 'direct') {
      console.error('[auth/login] REFUSED: production thiếu TRUST_PROXY=cloudflare|direct.');
      return NextResponse.json(
        { success: false, code: 'INTERNAL_ERROR', error: 'Cấu hình máy chủ chưa hoàn tất (proxy).' },
        { status: 500 }
      );
    }
    if (isAuthStrict() && !trustProxy) {
      console.warn('[auth/login] AUTH_STRICT nhưng thiếu TRUST_PROXY — rate-limit IP gộp chung, audit IP có thể sai.');
    }

    // 1. Kiểm tra Rate Limiting đa tầng (IP: 10 lần, Account: 5 lần -> khóa 15 phút)
    // Tầng in-memory (nhanh, theo instance) + tầng DB bền vững (sống qua
    // restart/đa instance) — chặn nếu MỘT trong hai từ chối.
    const limitCheck = checkDualRateLimit(ip, staffIdInput);
    if (!limitCheck.allowed) {
      await recordAuditLog({
        action: 'LOGIN_FAILED' as any,
        actorRole: roleInput || 'UNKNOWN',
        actorId: staffIdInput,
        resource: '/api/auth/login',
        details: `CẢNH BÁO BRUTE-FORCE: Bị khóa đăng nhập (${limitCheck.reason}) trong ${limitCheck.waitMinutes} phút.`,
        ipAddress: ip,
      });

      return NextResponse.json(
        {
          success: false,
          code: 'RATE_LIMITED',
          error: limitCheck.reason === 'IP_LOCKED'
            ? `Địa chỉ IP tạm thời bị khóa trong ${limitCheck.waitMinutes} phút do quá nhiều lần thử thất bại.`
            : `Tài khoản ${staffIdInput} tạm thời bị khóa trong ${limitCheck.waitMinutes} phút do nhập sai quá 5 lần.`,
          locked: true,
          waitMinutes: limitCheck.waitMinutes,
        },
        { status: 429 }
      );
    }

    // 1b. Tầng DB bền vững (#5): sống qua restart isolate/đa instance.
    const dbCheck = await checkDbDualLimit(ip, staffIdInput);
    if (!dbCheck.allowed) {
      await recordAuditLog({
        action: 'LOGIN_FAILED' as any,
        actorRole: roleInput || 'UNKNOWN',
        actorId: staffIdInput,
        resource: '/api/auth/login',
        details: `CẢNH BÁO BRUTE-FORCE (khóa DB bền vững, ${dbCheck.reason}) trong ${dbCheck.waitMinutes} phút.`,
        ipAddress: ip,
      });

      return NextResponse.json(
        {
          success: false,
          code: 'RATE_LIMITED',
          error: `Tài khoản hoặc IP tạm thời bị khóa trong ${dbCheck.waitMinutes} phút do nhập sai quá số lần cho phép.`,
          locked: true,
          waitMinutes: dbCheck.waitMinutes,
        },
        { status: 429 }
      );
    }

    let role: UserRole;
    let actorId: string;
    let fullName: string | undefined;

    // 2. Tra cứu tài khoản nhân viên trong bảng staff_accounts (Single Source of Truth)
    let staffRow: typeof staffAccounts.$inferSelect | undefined;
    try {
      const rows = await db.select().from(staffAccounts).where(eq(staffAccounts.staffId, staffIdInput)).limit(1);
      if (rows.length > 0) {
        staffRow = rows[0];
      }
    } catch (dbErr) {
      console.error('[auth/login] Lỗi truy vấn bảng staff_accounts:', dbErr);
    }

    if (staffRow) {
      // 2.1. Kiểm tra tài khoản có đang hoạt động không
      if (!staffRow.isActive) {
        recordDualFailedAttempt(ip, staffIdInput);
        await recordDbDualFail(ip, staffIdInput);
        await recordAuditLog({
          action: 'LOGIN_FAILED' as any,
          actorRole: staffRow.role,
          actorId: staffRow.staffId,
          resource: '/api/auth/login',
          details: 'Đăng nhập bị từ chối: Tài khoản nhân viên đã bị vô hiệu hóa (isActive = false).',
          ipAddress: ip,
        });

        return NextResponse.json(
          { success: false, code: 'FORBIDDEN', error: 'Tài khoản nhân viên này đã bị vô hiệu hóa.' },
          { status: 403 }
        );
      }

      // 2.2. Kiểm tra Passcode: chịu cả hash legacy (SHA-256 1 vòng) và V2
      // (PBKDF2). Khớp legacy → tự nâng lên V2 ngay (migrate mềm, không làm
      // gián đoạn ca làm việc; nâng cấp thất bại cũng không chặn đăng nhập).
      const { match: isMatch, needsUpgrade } = await verifyStaffPasscode(
        passcode,
        staffRow.salt,
        staffRow.passcodeHash
      );
      if (needsUpgrade) {
        try {
          await db
            .update(staffAccounts)
            .set({ passcodeHash: await hashStaffPasscodeV2(passcode, staffRow.salt) })
            .where(eq(staffAccounts.staffId, staffRow.staffId));
        } catch {
          // Best-effort: login vẫn tiếp tục.
        }
      }

      if (!isMatch) {
        const attemptRes = recordDualFailedAttempt(ip, staffIdInput);
        const dbRes = await recordDbDualFail(ip, staffIdInput);
        const isLocked = attemptRes.staffLocked || attemptRes.ipLocked || dbRes.staffLocked || dbRes.ipLocked;
        await recordAuditLog({
          action: (isLocked ? 'BRUTE_FORCE_DETECTED' : 'LOGIN_FAILED') as any,
          actorRole: staffRow.role,
          actorId: staffRow.staffId,
          resource: '/api/auth/login',
          details: isLocked
            ? 'KHÓA 15 phút sau nhiều lần sai liên tiếp (brute-force).'
            : `Sai passcode. Còn lại ${attemptRes.remainingStaffAttempts} lần thử.`,
          ipAddress: ip,
        });

        if (isLocked) {
          return NextResponse.json(
            {
              success: false,
              code: 'RATE_LIMITED',
              error: 'Nhập sai 5 lần! Hệ thống đã khóa tài khoản 15 phút để bảo vệ.',
              remainingAttempts: 0,
              locked: true,
              waitMinutes: 15,
            },
            { status: 429 }
          );
        }

        return NextResponse.json(
          {
            success: false,
            code: 'AUTH_REQUIRED',
            error: `Mã Passcode không chính xác. Còn lại ${attemptRes.remainingStaffAttempts} lần thử.`,
            remainingAttempts: attemptRes.remainingStaffAttempts,
            locked: false,
          },
          { status: 401 }
        );
      }

      // Khóa danh tính chuẩn hóa từ CSDL
      role = staffRow.role as UserRole;
      actorId = staffRow.staffId;
      fullName = staffRow.fullName;
    } else {
      // Trong chế độ strict: Fail-closed! Không cho phép fallback role passcode khi tài khoản không tồn tại trong staff_accounts
      if (isAuthStrict()) {
        const attemptRes = recordDualFailedAttempt(ip, staffIdInput);
        const dbRes = await recordDbDualFail(ip, staffIdInput);
        const isLocked = attemptRes.staffLocked || attemptRes.ipLocked || dbRes.staffLocked || dbRes.ipLocked;
        await recordAuditLog({
          action: (isLocked ? 'BRUTE_FORCE_DETECTED' : 'LOGIN_FAILED') as any,
          actorRole: roleInput || 'UNKNOWN',
          actorId: staffIdInput,
          resource: '/api/auth/login',
          details: isLocked
            ? 'KHÓA 15 phút sau nhiều lần sai liên tiếp (brute-force).'
            : `Đăng nhập thất bại: Tài khoản không tồn tại trong CSDL nhân viên (Strict Mode).`,
          ipAddress: ip,
        });

        if (isLocked) {
          return NextResponse.json(
            {
              success: false,
              code: 'RATE_LIMITED',
              error: 'Nhập sai quá số lần cho phép! Hệ thống đã khóa phiên đăng nhập 15 phút.',
              remainingAttempts: 0,
              locked: true,
              waitMinutes: 15,
            },
            { status: 429 }
          );
        }

        return NextResponse.json(
          {
            success: false,
            code: 'AUTH_REQUIRED',
            error: 'Mã nhân viên hoặc Passcode không chính xác.',
            remainingAttempts: attemptRes.remainingStaffAttempts,
            locked: false,
          },
          { status: 401 }
        );
      }

      // Fallback khi đăng nhập bằng role-level passcode trong test/dev non-strict
      const VALID_ROLES: UserRole[] = ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER', 'ROLE_WAREHOUSE', 'ROLE_TAX'];
      if (roleInput && VALID_ROLES.includes(roleInput) && verifyRolePasscode(roleInput, passcode)) {
        role = roleInput;
        actorId = staffIdInput || roleInput;
        fullName = staffIdInput || roleInput;
      } else {
        const attemptRes = recordDualFailedAttempt(ip, staffIdInput);
        const dbRes = await recordDbDualFail(ip, staffIdInput);
        const isLocked = attemptRes.staffLocked || attemptRes.ipLocked || dbRes.staffLocked || dbRes.ipLocked;
        await recordAuditLog({
          action: (isLocked ? 'BRUTE_FORCE_DETECTED' : 'LOGIN_FAILED') as any,
          actorRole: roleInput || 'UNKNOWN',
          actorId: staffIdInput,
          resource: '/api/auth/login',
          details: isLocked
            ? 'KHÓA 15 phút sau nhiều lần sai liên tiếp (brute-force).'
            : `Đăng nhập thất bại: Tài khoản không tồn tại hoặc sai mật khẩu.`,
          ipAddress: ip,
        });

        if (isLocked) {
          return NextResponse.json(
            {
              success: false,
              code: 'RATE_LIMITED',
              error: 'Nhập sai quá số lần cho phép! Hệ thống đã khóa phiên đăng nhập 15 phút.',
              remainingAttempts: 0,
              locked: true,
              waitMinutes: 15,
            },
            { status: 429 }
          );
        }

        return NextResponse.json(
          {
            success: false,
            code: 'AUTH_REQUIRED',
            error: 'Mã nhân viên hoặc Passcode không chính xác.',
            remainingAttempts: attemptRes.remainingStaffAttempts,
            locked: false,
          },
          { status: 401 }
        );
      }
    }

    // 3. Đăng nhập thành công -> Reset rate limit & Sinh Signed Session Cookie
    resetDualRateLimit(ip, staffIdInput);
    await resetDbDualLimit(ip, staffIdInput);

    const now = Date.now();
    const expiresAt = now + SESSION_MAX_AGE_SECONDS * 1000;
    const sessionId = `sess-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const token = await signSession({
      role,
      actorId,
      fullName,
      sessionId,
      issuedAt: now,
      expiresAt,
    });

    await recordAuditLog({
      action: 'LOGIN_SUCCESS' as any,
      actorRole: role,
      actorId,
      resource: '/api/auth/login',
      details: `Đăng nhập thành công ca làm việc (${actorId} - ${role} - ${fullName || ''}). Session cấp phát 12h.`,
      ipAddress: ip,
    });

    // 4. Trả về response có gắn Set-Cookie (HttpOnly, SameSite=Lax, Max-Age=12h)
    const res = NextResponse.json({
      success: true,
      data: {
        staffId: actorId,
        actorId,
        role,
        fullName,
        sessionId,
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
    // Production: không rò chi tiết lỗi đăng nhập (DB down, secret...) ra client.
    const safe = process.env.NODE_ENV === 'production' ? 'Lỗi hệ thống, vui lòng thử lại.' : err.message || 'Lỗi xử lý đăng nhập';
    if (process.env.NODE_ENV === 'production') console.error('[auth/login] INTERNAL_ERROR:', err?.stack || err);
    return NextResponse.json(
      { success: false, code: 'INTERNAL_ERROR', error: safe },
      { status: 500 }
    );
  }
}

