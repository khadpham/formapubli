import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { AppError } from '@/services/app-error';
import { db, contractMilestones, contractProjects } from '@/db';
import { eq } from 'drizzle-orm';
import { generateUUIDv7 } from '@/lib/uuidv7';
import { CONTRACT_CATEGORIES } from '@/services/ai/contract-ai.service';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[];

/** POST /api/ai/contracts/milestones - thêm cột mốc. */
export async function POST(req: NextRequest) {
  try {
    await requireSessionRole(req, ROLES);
    const body = await req.json().catch(() => ({}));
    const projectId = `${body.projectId || ''}`.trim();
    const title = `${body.title || ''}`.trim();
    const dueDate = `${body.dueDate || ''}`.trim();
    const neededCategory = `${body.neededCategory || ''}`.trim();
    if (!projectId) throw AppError.invalid('Thiếu dự án.');
    if (!title) throw AppError.invalid('Thiếu tên cột mốc.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw AppError.invalid('Hạn phải dạng YYYY-MM-DD.');
    if (!CONTRACT_CATEGORIES.includes(neededCategory as never)) throw AppError.invalid('Loại hợp đồng không hợp lệ.');
    const [project] = await db.select().from(contractProjects).where(eq(contractProjects.id, projectId)).limit(1);
    if (!project) throw AppError.invalid('Không tìm thấy dự án.');
    if (project.startDate && dueDate < project.startDate) throw AppError.invalid('Hạn cột mốc trước ngày bắt đầu dự án.');
    const [row] = await db.insert(contractMilestones).values({
      id: `cms-${generateUUIDv7()}`,
      projectId,
      title: title.slice(0, 200),
      dueDate,
      neededCategory,
      status: 'PENDING',
    }).returning();
    return NextResponse.json({ success: true, data: row }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/** PATCH /api/ai/contracts/milestones - link hợp đồng đã ký / đổi trạng thái. */
export async function PATCH(req: NextRequest) {
  try {
    await requireSessionRole(req, ROLES);
    const body = await req.json().catch(() => ({}));
    const id = `${body.id || ''}`.trim();
    if (!id) throw AppError.invalid('Thiếu id cột mốc.');
    const patch: Record<string, any> = {};
    if (body.contractId !== undefined) {
      patch.contractId = `${body.contractId}`.trim() || null;
      patch.status = patch.contractId ? 'DONE' : 'PENDING';
    }
    if (body.status !== undefined) {
      if (!['PENDING', 'DONE'].includes(body.status)) throw AppError.invalid('Trạng thái không hợp lệ.');
      patch.status = body.status;
    }
    if (!Object.keys(patch).length) throw AppError.invalid('Không có gì để sửa.');
    await db.update(contractMilestones).set(patch).where(eq(contractMilestones.id, id));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleApiError(error);
  }
}
