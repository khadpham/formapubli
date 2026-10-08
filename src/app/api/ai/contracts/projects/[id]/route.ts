import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { AppError } from '@/services/app-error';
import { db, contractProjects, contractMilestones } from '@/db';
import { eq, asc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[];

/** GET /api/ai/contracts/projects/[id] — chi tiết dự án + milestones. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireSessionRole(_req, ROLES);
    const [project] = await db.select().from(contractProjects).where(eq(contractProjects.id, params.id)).limit(1);
    if (!project) throw AppError.invalid('Không tìm thấy dự án.');
    const milestones = await db.select().from(contractMilestones)
      .where(eq(contractMilestones.projectId, params.id))
      .orderBy(asc(contractMilestones.dueDate));
    return NextResponse.json({ success: true, data: { ...project, milestones } });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/** PATCH /api/ai/contracts/projects/[id] — sửa dự án. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireSessionRole(req, ROLES);
    const body = await req.json().catch(() => ({}));
    const patch: Record<string, any> = {};
    if (body.name !== undefined) patch.name = `${body.name}`.trim().slice(0, 200);
    if (body.description !== undefined) patch.description = `${body.description}`.trim().slice(0, 2000) || null;
    if (body.status !== undefined) {
      if (!['ACTIVE', 'DONE', 'DRAFT'].includes(body.status)) throw AppError.invalid('Trạng thái không hợp lệ.');
      patch.status = body.status;
    }
    if (!Object.keys(patch).length) throw AppError.invalid('Không có gì để sửa.');
    await db.update(contractProjects).set(patch).where(eq(contractProjects.id, params.id));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/** DELETE /api/ai/contracts/projects/[id] — xóa dự án (milestones theo, HĐ đã ký giữ nguyên). */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireSessionRole(req, ROLES);
    await db.delete(contractProjects).where(eq(contractProjects.id, params.id));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleApiError(error);
  }
}
