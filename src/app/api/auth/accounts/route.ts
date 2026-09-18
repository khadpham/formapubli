import { NextRequest, NextResponse } from 'next/server';
import { db, staffAccounts } from '@/db';
import { eq, asc } from 'drizzle-orm';
import { checkWindowRateLimit, extractClientIp } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

// GET /api/auth/accounts — danh sách tài khoản đang hoạt động cho màn hình
// đăng nhập chạm-chọn. Công khai trước auth (login screen cần), nhưng CHỈ trả
// field an toàn: staffId, fullName, role. Tuyệt đối không trả passcodeHash/salt.
export async function GET(req: NextRequest) {
  try {
    const ip = extractClientIp(req);
    const rl = checkWindowRateLimit(`acctlist:${ip}`, 60, 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, code: 'RATE_LIMITED', error: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' },
        { status: 429 }
      );
    }

    const rows = await db
      .select({
        staffId: staffAccounts.staffId,
        fullName: staffAccounts.fullName,
        role: staffAccounts.role,
      })
      .from(staffAccounts)
      .where(eq(staffAccounts.isActive, true))
      .orderBy(asc(staffAccounts.staffId))
      .limit(100);

    return NextResponse.json({ success: true, data: rows });
  } catch (error: any) {
    return handleApiError(error);
  }
}
