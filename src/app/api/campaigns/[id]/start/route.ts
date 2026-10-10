import { NextRequest, NextResponse } from 'next/server';
import { CampaignService } from '@/services/campaign.service';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { recordAuditLog } from '@/lib/rbac-guard';
import { UserRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

const PRIVILEGED: UserRole[] = ['ROLE_OWNER', 'ROLE_MANAGER'];

/**
 * POST /api/campaigns/[id]/start - Bắt đầu (DRAFT → ACTIVE, sinh kho FAIR_EVENT).
 * Quyền: Owner, Manager.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionRole(req, PRIVILEGED);
    const { id } = await params;
    const result = await CampaignService.start({
      campaignId: decodeURIComponent(id || '').trim(),
      actor: {
        staffId: session.actorId,
        role: session.role,
        fullName: session.fullName,
        sessionId: session.sessionId,
      },
    });
    await recordAuditLog({
      action: 'CAMPAIGN_STARTED' as any,
      actorRole: session.role,
      actorId: session.actorId,
      resource: '/api/campaigns',
      details: `Bắt đầu chiến dịch ${result.campaignId} (kho ${result.warehouseId}).`,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    return handleApiError(e);
  }
}
