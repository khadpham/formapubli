import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { AppError } from '@/services/app-error';
import { db, contractProjects, contractMilestones } from '@/db';
import { eq, desc, count, and } from 'drizzle-orm';
import { generateUUIDv7 } from '@/lib/uuidv7';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[];

/** GET /api/ai/contracts/projects - danh sách dự án + đếm milestones. */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ROLES);
    const projects = await db.select().from(contractProjects).orderBy(desc(contractProjects.createdAt));
    const withCounts = await Promise.all(projects.map(async (p) => {
      const [c] = await db.select({ n: count() }).from(contractMilestones).where(eq(contractMilestones.projectId, p.id));
      const [d] = await db.select({ n: count() }).from(contractMilestones)
        .where(and(eq(contractMilestones.projectId, p.id), eq(contractMilestones.status, 'DONE')));
      return { ...p, milestoneCount: c?.n ?? 0, doneCount: d?.n ?? 0 };
    }));
    return NextResponse.json({ success: true, data: withCounts });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/** POST /api/ai/contracts/projects - tạo dự án/sự kiện. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const body = await req.json().catch(() => ({}));
    const name = `${body.name || ''}`.trim();
    if (!name) throw AppError.invalid('Thiếu tên dự án/sự kiện.');
    const startDate = `${body.startDate || ''}`.trim() || null;
    const endDate = `${body.endDate || ''}`.trim() || null;
    if (startDate && endDate && endDate < startDate) throw AppError.invalid('Ngày kết thúc không được trước ngày bắt đầu.');
    const [row] = await db.insert(contractProjects).values({
      id: `cprj-${generateUUIDv7()}`,
      name: name.slice(0, 200),
      description: `${body.description || ''}`.trim().slice(0, 2000) || null,
      startDate,
      endDate,
      status: 'ACTIVE',
      createdBy: session.actorId,
    }).returning();
    return NextResponse.json({ success: true, data: row }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error);
  }
}
