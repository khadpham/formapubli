import { NextRequest, NextResponse } from 'next/server';
import { db, staffAccounts, activeSessions } from '@/db';
import { eq } from 'drizzle-orm';
import { requireSessionRole, hashStaffPasscodeV2 } from '@/lib/auth-session';
import { UserRole } from '@/lib/roles';
import { AppError } from '@/services/app-error';
import { recordAuditLog } from '@/lib/rbac-guard';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

const PRIVILEGED_ROLES: UserRole[] = ['ROLE_OWNER', 'ROLE_MANAGER'];
const VALID_ROLES: UserRole[] = ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER', 'ROLE_WAREHOUSE', 'ROLE_TAX'];

// PATCH /api/staff/[staffId] — sửa tên / đổi role / reset passcode / khóa-mở.
// Không xóa cứng: khóa = isActive=false (giữ audit + két ca nguyên vẹn).
// MANAGER chỉ được chạm CASHIER/WAREHOUSE/TAX, không leo thang đặc quyền.
// Không ai được tự hạ role / tự khóa chính mình (chống tự khóa quầy).
export async function PATCH(req: NextRequest, { params }: { params: { staffId: string } }) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);
    let targetId: string;
    try {
      targetId = decodeURIComponent(params.staffId || '').trim();
    } catch {
      throw AppError.invalid('Mã nhân viên không hợp lệ.');
    }
    if (!targetId) throw AppError.invalid('Thiếu mã nhân viên.');

    const rows = await db
      .select()
      .from(staffAccounts)
      .where(eq(staffAccounts.staffId, targetId))
      .limit(1);
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', error: 'Tài khoản không tồn tại.' },
        { status: 404 }
      );
    }
    const target = rows[0];
    const isSelf = target.staffId === session.actorId;

    // MANAGER không được chạm tài khoản đặc quyền (cả chiều hiện tại lẫn chiều mới).
    if (session.role === 'ROLE_MANAGER' && PRIVILEGED_ROLES.includes(target.role as UserRole)) {
      return NextResponse.json(
        { success: false, code: 'FORBIDDEN', error: 'MANAGER không được sửa tài khoản OWNER/MANAGER.' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const patch: Partial<typeof staffAccounts.$inferInsert> = {};
    const notes: string[] = [];

    if (body.fullName !== undefined) {
      const name = `${body.fullName || ''}`.trim().slice(0, 80);
      if (!name) throw AppError.invalid('Tên nhân viên không được để trống.');
      patch.fullName = name;
      notes.push(`tên→${name}`);
    }

    if (body.role !== undefined) {
      const newRole = body.role as UserRole;
      if (!VALID_ROLES.includes(newRole)) throw AppError.invalid('Vai trò không hợp lệ.');
      if (isSelf) throw AppError.invalid('Không được tự đổi vai trò của chính mình.');
      if (session.role === 'ROLE_MANAGER' && PRIVILEGED_ROLES.includes(newRole)) {
        return NextResponse.json(
          { success: false, code: 'FORBIDDEN', error: 'MANAGER không được phong cấp OWNER/MANAGER.' },
          { status: 403 }
        );
      }
      patch.role = newRole;
      notes.push(`role ${target.role}→${newRole}`);
    }

    if (body.passcode !== undefined && `${body.passcode || ''}`.trim() !== '') {
      const raw = `${body.passcode}`;
      // Chính sách quầy siêu tốc: mọi role PIN từ 4 ký tự (xem staff/route.ts).
      if (raw.trim().length < 4 || raw.length > 64) throw AppError.invalid('Passcode 4-64 ký tự.');
      const salt = crypto.randomUUID();
      patch.salt = salt;
      patch.passcodeHash = await hashStaffPasscodeV2(raw, salt);
      // M2: reset passcode = thu hồi mọi session cũ của tài khoản này.
      patch.sessionVersion = (target.sessionVersion ?? 1) + 1;
      notes.push('reset passcode');
      // S-01: xóa luôn mọi lease của staff để login mới bằng PIN mới không bị
      // chặn oan tới 10 phút bởi lease phiên cũ (version bump đã thu hồi token
      // cũ; khác logout thường chỉ xóa đúng session của mình).
      await db.delete(activeSessions).where(eq(activeSessions.staffId, targetId)).catch(() => null);
    }

    if (body.isActive !== undefined) {
      const next = body.isActive === true;
      if (isSelf && !next) throw AppError.invalid('Không được tự khóa chính mình.');
      patch.isActive = next;
      notes.push(next ? 'mở khóa' : 'khóa');
    }

    if (Object.keys(patch).length === 0) throw AppError.invalid('Không có gì để cập nhật.');

    await db.update(staffAccounts).set(patch).where(eq(staffAccounts.staffId, targetId));

    await recordAuditLog({
      action: 'STAFF_UPDATED' as any,
      actorRole: session.role,
      actorId: session.actorId,
      resource: '/api/staff',
      details: `Sửa ${targetId}: ${notes.join(', ')}.`,
    });

    return NextResponse.json({ success: true, data: { staffId: targetId, updated: notes } });
  } catch (error: any) {
    return handleApiError(error);
  }
}
