import { NextRequest, NextResponse } from 'next/server';
import { db, staffAccounts, activeSessions } from '@/db';
import { eq } from 'drizzle-orm';
import {
  requireSessionRole,
  forceReleaseCashierLease,
  isLeaseEnforcedRole,
} from '@/lib/auth-session';
import { UserRole } from '@/lib/roles';
import { AppError } from '@/services/app-error';
import { recordAuditLog } from '@/lib/rbac-guard';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

const PRIVILEGED_ROLES: UserRole[] = ['ROLE_OWNER', 'ROLE_MANAGER'];

/**
 * POST /api/staff/[staffId]/release-session — force-release lease cashier
 * (S-01). Chỉ OWNER/MANAGER, target phải là role bị lease (cashier).
 * Body: { reason, expectedSessionId?, expectedSessionVersion? }.
 * - Row/version khớp (hoặc không gửi expected) → release + bump version.
 * - Không còn lease nhưng version đã đổi / đã có phiên mới → 409 (refresh,
 *   không tăng version lần nữa, không hủy phiên mới). Retry an toàn.
 */
export async function POST(req: NextRequest, { params }: { params: { staffId: string } }) {
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
    if (session.role === 'ROLE_MANAGER' && PRIVILEGED_ROLES.includes(target.role as UserRole)) {
      return NextResponse.json(
        { success: false, code: 'FORBIDDEN', error: 'MANAGER không được can thiệp tài khoản OWNER/MANAGER.' },
        { status: 403 }
      );
    }
    if (!isLeaseEnforcedRole(target.role)) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', error: 'Tài khoản này không thuộc diện giới hạn một phiên.' },
        { status: 400 }
      );
    }
    if (target.staffId === session.actorId) {
      return NextResponse.json(
        { success: false, code: 'FORBIDDEN', error: 'Không tự giải phóng phiên của chính mình (dùng Đăng xuất).' },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const reason = `${body.reason || ''}`.trim().slice(0, 200);
    if (!reason) throw AppError.invalid('Bắt buộc ghi lý do giải phóng phiên.');
    const expectedSessionId =
      body.expectedSessionId !== undefined ? `${body.expectedSessionId || ''}` : undefined;
    const expectedVersion =
      body.expectedSessionVersion !== undefined && body.expectedSessionVersion !== null
        ? Number(body.expectedSessionVersion)
        : undefined;

    const leaseRows = await db
      .select()
      .from(activeSessions)
      .where(eq(activeSessions.staffId, targetId))
      .limit(1);
    const lease = leaseRows[0];
    // Không còn lease: version đã đổi (ai đó release trước) hoặc đã có kiểm
    // soát khác → 409 để UI refresh, không bump version lần nữa.
    if (!lease) {
      if (expectedVersion !== undefined && Number(target.sessionVersion) !== expectedVersion) {
        return NextResponse.json(
          { success: false, code: 'STATE_CONFLICT', error: 'Trạng thái đã thay đổi, vui lòng tải lại.' },
          { status: 409 }
        );
      }
      return NextResponse.json({ success: true, data: { released: false, sessionVersion: target.sessionVersion } });
    }
    // Đã có phiên mới khác expected → không hủy phiên mới.
    if (expectedSessionId !== undefined && `${lease.sessionId}` !== expectedSessionId) {
      return NextResponse.json(
        { success: false, code: 'STATE_CONFLICT', error: 'Đã có phiên mới hơn, vui lòng tải lại.' },
        { status: 409 }
      );
    }
    if (expectedVersion !== undefined && Number(target.sessionVersion) !== expectedVersion) {
      return NextResponse.json(
        { success: false, code: 'STATE_CONFLICT', error: 'Trạng thái đã thay đổi, vui lòng tải lại.' },
        { status: 409 }
      );
    }

    const result = await forceReleaseCashierLease(targetId);
    await recordAuditLog({
      action: 'LOGOUT' as any,
      actorRole: session.role,
      actorId: session.actorId,
      resource: `/api/staff/${targetId}/release-session`,
      details: `Force-release phiên ${targetId} (lý do: ${reason}).`,
      ipAddress: 'local',
    });
    return NextResponse.json({ success: true, data: result });
  } catch (err: any) {
    return handleApiError(err);
  }
}
