import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { db, contractMilestones, contractProjects } from '@/db';
import { eq, and, isNull, lt, gte, lte, asc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[];

function vnToday(): string {
  // YYYY-MM-DD theo giờ Việt Nam
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function vnDatePlus(days: number): string {
  return new Date(Date.now() + 7 * 3600 * 1000 + days * 86400 * 1000).toISOString().slice(0, 10);
}

/** GET /api/ai/contracts/suggest — cột mốc quá hạn + sắp tới hạn (14 ngày) chưa có HĐ. */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ROLES);
    const today = vnToday();
    const soon = vnDatePlus(14);
    const base = and(
      eq(contractMilestones.status, 'PENDING'),
      isNull(contractMilestones.contractId),
    );
    const overdue = await db.select({
      id: contractMilestones.id,
      title: contractMilestones.title,
      dueDate: contractMilestones.dueDate,
      neededCategory: contractMilestones.neededCategory,
      projectId: contractMilestones.projectId,
      projectName: contractProjects.name,
    }).from(contractMilestones)
      .innerJoin(contractProjects, eq(contractMilestones.projectId, contractProjects.id))
      .where(and(base, lt(contractMilestones.dueDate, today)))
      .orderBy(asc(contractMilestones.dueDate));
    const upcoming = await db.select({
      id: contractMilestones.id,
      title: contractMilestones.title,
      dueDate: contractMilestones.dueDate,
      neededCategory: contractMilestones.neededCategory,
      projectId: contractMilestones.projectId,
      projectName: contractProjects.name,
    }).from(contractMilestones)
      .innerJoin(contractProjects, eq(contractMilestones.projectId, contractProjects.id))
      .where(and(base, gte(contractMilestones.dueDate, today), lte(contractMilestones.dueDate, soon)))
      .orderBy(asc(contractMilestones.dueDate));
    return NextResponse.json({ success: true, data: { overdue, upcoming } });
  } catch (error: any) {
    return handleApiError(error);
  }
}
