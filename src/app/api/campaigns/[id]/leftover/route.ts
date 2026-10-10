import { NextRequest, NextResponse } from 'next/server';
import { CampaignService } from '@/services/campaign.service';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

const PRIVILEGED: UserRole[] = ['ROLE_OWNER', 'ROLE_MANAGER'];

/**
 * GET /api/campaigns/[id]/leftover - Xem trước tồn thừa tại kho chiến dịch
 * để quản lý duyệt trước khi Kết thúc.
 * Quyền: Owner, Manager.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSessionRole(req, PRIVILEGED);
    const { id } = await params;
    const data = await CampaignService.getLeftover({ campaignId: decodeURIComponent(id || '').trim() });
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return handleApiError(e);
  }
}
