import { NextRequest, NextResponse } from 'next/server';
import { db, staffAccounts, activeSessions } from '@/db';
import { eq, asc } from 'drizzle-orm';
import {
  requireSessionRole,
  hashStaffPasscodeV2,
} from '@/lib/auth-session';
import { AppError } from '@/services/app-error';
import { UserRole } from '@/lib/roles';
import { recordAuditLog } from '@/lib/rbac-guard';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

const PRIVILEGED_ROLES: UserRole[] = ['ROLE_OWNER', 'ROLE_MANAGER'];
const VALID_ROLES: UserRole[] = ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER', 'ROLE_WAREHOUSE', 'ROLE_TAX'];

function validateStaffId(raw: unknown): string {
  const v = `${raw || ''}`.trim();
  if (!/^[A-Za-z0-9_-]{3,24}$/.test(v)) {
    throw AppError.invalid('Mã nhân viên 3-24 ký tự, chỉ chữ/số/gạch ngang/gạch dưới.');
  }
  return v;
}

function validatePasscodeForRole(role: UserRole, raw: unknown): string {
  const v = `${raw || ''}`;
  // Chính sách quầy siêu tốc (theo lệnh chủ dự án): mọi role PIN từ 4 ký tự.
  // Lưu ý an ninh: PIN ngắn + SHA-256 nhanh → phải đổi PIN ngay nếu lộ DB;
  // chống đoán mò online vẫn do rate-limit 5 sai/15 phút đảm nhiệm.
  void role;
  if (!v || v.trim().length < 4 || v.length > 64) {
    throw AppError.invalid('Passcode 4-64 ký tự.');
  }
  return v;
}

// GET /api/staff — OWNER/MANAGER xem toàn bộ tài khoản (không bao giờ trả hash/salt).
// S-01: kèm lease summary (sessionId/version/startedAt/leaseExpiresAt/device)
// để UI force-release có expected fields. Chỉ manager/owner đúng scope thấy.
export async function GET(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);
    const rows = await db
      .select({
        staffId: staffAccounts.staffId,
        fullName: staffAccounts.fullName,
        role: staffAccounts.role,
        isActive: staffAccounts.isActive,
        createdAt: staffAccounts.createdAt,
        sessionVersion: staffAccounts.sessionVersion,
      })
      .from(staffAccounts)
      .orderBy(asc(staffAccounts.staffId))
      .limit(200);
    const leases = await db.select().from(activeSessions);
    const leaseMap = new Map(leases.map((l: any) => [l.staffId, l]));
    const data = rows.map((r: any) => {
      const l: any = leaseMap.get(r.staffId);
      return {
        ...r,
        lease: l
          ? {
              sessionId: l.sessionId,
              startedAt: l.startedAt,
              leaseExpiresAt: l.leaseExpiresAt,
              deviceLabel: l.deviceLabel,
            }
          : null,
      };
    });
    return NextResponse.json({ success: true, data, actorId: session.actorId });
  } catch (error: any) {
    return handleApiError(error);
  }
}

// POST /api/staff — tạo tài khoản. MANAGER chỉ được tạo CASHIER/WAREHOUSE/TAX.
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);
    const body = await req.json();
    const staffId = validateStaffId(body.staffId);
    const fullName = `${body.fullName || ''}`.trim().slice(0, 80);
    const role = body.role as UserRole;
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', error: 'Vai trò không hợp lệ.' },
        { status: 400 }
      );
    }
    if (!fullName) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', error: 'Bắt buộc nhập tên nhân viên.' },
        { status: 400 }
      );
    }
    // Chống leo thang: MANAGER không được tạo tài khoản đặc quyền.
    if (session.role === 'ROLE_MANAGER' && PRIVILEGED_ROLES.includes(role)) {
      return NextResponse.json(
        { success: false, code: 'FORBIDDEN', error: 'MANAGER chỉ được tạo Thu ngân/Thủ kho/Kế toán thuế.' },
        { status: 403 }
      );
    }
    const passcode = validatePasscodeForRole(role, body.passcode);

    const existed = await db
      .select({ staffId: staffAccounts.staffId })
      .from(staffAccounts)
      .where(eq(staffAccounts.staffId, staffId))
      .limit(1);
    if (existed.length > 0) {
      return NextResponse.json(
        { success: false, code: 'STATE_CONFLICT', error: `Mã ${staffId} đã tồn tại.` },
        { status: 409 }
      );
    }

    const salt = crypto.randomUUID();
    await db.insert(staffAccounts).values({
      staffId,
      fullName,
      role,
      passcodeHash: await hashStaffPasscodeV2(passcode, salt),
      salt,
      isActive: true,
    });

    await recordAuditLog({
      action: 'STAFF_CREATED' as any,
      actorRole: session.role,
      actorId: session.actorId,
      resource: '/api/staff',
      details: `Tạo tài khoản ${staffId} (${fullName}, ${role}).`,
    });

    return NextResponse.json({ success: true, data: { staffId, fullName, role, isActive: true } });
  } catch (error: any) {
    return handleApiError(error);
  }
}
