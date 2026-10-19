import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole, resolveActorId } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { AppError } from '@/services/app-error';
import { db, contractMilestones, contractProjects } from '@/db';
import { eq } from 'drizzle-orm';
import { generateUUIDv7 } from '@/lib/uuidv7';
import { CONTRACT_CATEGORIES } from '@/services/ai/contract-ai.service';
import { PublishingRules, STAGE_ORDER, type StageDates } from '@/services/publishing-rules.service';
import { recordAuditLog } from '@/lib/rbac-guard';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Dựng timeline 5 giai đoạn từ milestones để chạy rule engine (F5). */
function buildStages(milestones: any[], overrideId?: string, overridePatch?: Record<string, any>): StageDates[] {
  return STAGE_ORDER.map((stage) => {
    let m = milestones.find((x) => x.neededCategory === stage);
    if (m && overrideId && m.id === overrideId && overridePatch) {
      m = { ...m, ...overridePatch };
    }
    return {
      stage,
      contractDate: m?.contractDate || null,
      acceptanceDate: m?.acceptanceDate || null,
      plannedEnd: m?.dueDate || null,
    };
  });
}

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
    const validCats = [...CONTRACT_CATEGORIES, ...STAGE_ORDER];
    if (!validCats.includes(neededCategory as never)) throw AppError.invalid('Loại hợp đồng không hợp lệ.');
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

/** PATCH /api/ai/contracts/milestones - link hợp đồng / đổi trạng thái / cập nhật ngày.
 * F5: khi đổi ngày ký hoặc ngày nghiệm thu, chạy rule engine R1-R5 trên timeline
 * của dự án. Vi phạm BLOCK thì chặn lưu, trừ khi manager xác nhận vượt (có lý do,
 * ghi audit log). R4 chỉ cảnh báo. */
export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ROLES);
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
    if (body.contractDate !== undefined) {
      const v = `${body.contractDate || ''}`.trim();
      if (v && !DATE_RE.test(v)) throw AppError.invalid('Ngày ký phải dạng YYYY-MM-DD.');
      patch.contractDate = v || null;
    }
    if (body.acceptanceDate !== undefined) {
      const v = `${body.acceptanceDate || ''}`.trim();
      if (v && !DATE_RE.test(v)) throw AppError.invalid('Ngày nghiệm thu phải dạng YYYY-MM-DD.');
      patch.acceptanceDate = v || null;
    }
    if (!Object.keys(patch).length) throw AppError.invalid('Không có gì để sửa.');

    // F5: kiểm tra R1-R5 khi ngày thay đổi.
    let warnings: any[] = [];
    const dateChanged = patch.contractDate !== undefined || patch.acceptanceDate !== undefined;
    if (dateChanged) {
      const [ms] = await db.select().from(contractMilestones).where(eq(contractMilestones.id, id)).limit(1);
      if (!ms) throw AppError.invalid('Không tìm thấy cột mốc.');
      const all = await db.select().from(contractMilestones).where(eq(contractMilestones.projectId, ms.projectId));
      const stages = buildStages(all, id, patch);
      const violations = PublishingRules.validate(stages);
      const blocking = violations.filter((v) => v.severity === 'BLOCK');
      warnings = violations.filter((v) => v.severity === 'WARN');
      if (blocking.length > 0) {
        if (body.override !== true) {
          throw AppError.conflict(
            `Vi phạm quy tắc timeline: ${blocking.map((v) => `[${v.rule}] ${v.message}`).join(' ')}`
          );
        }
        const reason = `${body.overrideReason || ''}`.trim();
        if (!reason) throw AppError.invalid('Vượt quy tắc cần ghi rõ lý do.');
        await recordAuditLog({
          action: 'CONTRACT_TIMELINE_OVERRIDE' as any, actorRole: session.role, actorId: resolveActorId(session, undefined),
          resource: '/api/ai/contracts/milestones',
          details: `Vượt ${blocking.map((v) => v.rule).join(',')} tại "${ms.title}": ${reason}.`,
        });
      }
    }

    await db.update(contractMilestones).set(patch).where(eq(contractMilestones.id, id));
    return NextResponse.json({ success: true, data: { warnings } });
  } catch (error: any) {
    return handleApiError(error);
  }
}
