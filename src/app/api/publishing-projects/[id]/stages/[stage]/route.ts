import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { PublishingService } from '@/services/publishing.service';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[];

/**
 * PATCH /api/publishing-projects/[id]/stages/[stage]
 * Cập nhật giai đoạn, tự động kiểm tra rule engine.
 * Body: { contractDate, acceptanceDate, plannedStart, plannedEnd, contractAmount, assigneeName, force }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stage: string }> }
) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const { id, stage } = await params;
    const body = await req.json().catch(() => ({}));
    const result = await PublishingService.updateStage(id, stage, {
      contractDate: body.contractDate,
      acceptanceDate: body.acceptanceDate,
      plannedStart: body.plannedStart,
      plannedEnd: body.plannedEnd,
      contractAmount: body.contractAmount ? Number(body.contractAmount) : undefined,
      assigneeName: body.assigneeName,
      contractId: body.contractId,
      acceptanceDocId: body.acceptanceDocId,
    }, {
      force: body.force === true,
      actorRole: (session as any).role,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    return handleApiError(error);
  }
}
