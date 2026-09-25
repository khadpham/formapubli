import { NextRequest, NextResponse } from 'next/server';
import { db, auditLogs } from '@/db';
import { desc, eq, and } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

/**
 * Nhật ký hoạt động — LỊCH SỬ BỀN VỮNG của mọi thao tác đã xảy ra.
 * Quản lý/Owner xem toàn bộ; nhân viên chỉ xem việc của chính mình.
 * Dùng để đối soát sau này ("ai làm gì, lúc nào"), không mất khi đóng app.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, [
      'ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER', 'ROLE_WAREHOUSE', 'ROLE_TAX',
    ] as UserRole[]);
    const isManager = session.role === 'ROLE_OWNER' || session.role === 'ROLE_MANAGER';
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get('limit') || 60) || 60, 200);

    const rows = await db
      .select()
      .from(auditLogs)
      .where(isManager ? undefined : eq(auditLogs.actorId, session.actorId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);

    return NextResponse.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        action: r.action,
        actorId: r.actorId,
        actorRole: r.actorRole,
        resource: r.resource,
        details: r.details,
        at: r.createdAt,
      })),
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}
