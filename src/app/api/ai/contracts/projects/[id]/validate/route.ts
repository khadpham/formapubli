import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { db, contractMilestones } from '@/db';
import { eq } from 'drizzle-orm';
import { PublishingRules, STAGE_ORDER, type StageDates } from '@/services/publishing-rules.service';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[];

/** POST /api/ai/contracts/projects/[id]/validate - chạy rule engine R1-R5
 * trên timeline 5 giai đoạn của dự án (F5). Không lưu gì, chỉ trả vi phạm. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSessionRole(req, ROLES);
    const { id } = await params;
    const projectId = decodeURIComponent(id || '').trim();
    const milestones = await db.select().from(contractMilestones)
      .where(eq(contractMilestones.projectId, projectId));

    const stages: StageDates[] = STAGE_ORDER.map((stage) => {
      const m = milestones.find((x) => x.neededCategory === stage);
      return {
        stage,
        contractDate: m?.contractDate || null,
        acceptanceDate: m?.acceptanceDate || null,
        plannedEnd: m?.dueDate || null,
      };
    });

    const violations = PublishingRules.validate(stages);
    return NextResponse.json({
      success: true,
      data: {
        violations,
        hasBlocking: PublishingRules.hasBlockingViolations(violations),
      },
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}
