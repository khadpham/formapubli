import { NextRequest, NextResponse } from 'next/server';
import { CampaignService } from '@/services/campaign.service';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { recordAuditLog } from '@/lib/rbac-guard';
import { UserRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

const PRIVILEGED: UserRole[] = ['ROLE_OWNER', 'ROLE_MANAGER'];

/**
 * POST /api/campaigns/[id]/end - Kết thúc (ACTIVE → ENDED): chuyển tồn thừa
 * đã duyệt về kho nguồn, ngưng kho (tự gỡ nhân sự), lưu trữ.
 * Body: { items: [{ editionId, quantity }] } - rỗng được (tồn 0).
 * Quyền: Owner, Manager.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionRole(req, PRIVILEGED);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const result = await CampaignService.end({
      campaignId: decodeURIComponent(id || '').trim(),
      items: Array.isArray(body.items) ? body.items : [],
      actor: {
        staffId: session.actorId,
        role: session.role,
        fullName: session.fullName,
        sessionId: session.sessionId,
      },
    });
    await recordAuditLog({
      action: 'CAMPAIGN_ENDED' as any,
      actorRole: session.role,
      actorId: session.actorId,
      resource: '/api/campaigns',
      details: `Kết thúc chiến dịch ${result.campaignId}.`,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    return handleApiError(e);
  }
}
