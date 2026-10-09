import { NextRequest, NextResponse } from 'next/server';
import { CampaignService } from '@/services/campaign.service';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { recordAuditLog } from '@/lib/rbac-guard';
import { UserRole } from '@/lib/roles';
import { db, campaigns } from '@/db';
import { desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const PRIVILEGED: UserRole[] = ['ROLE_OWNER', 'ROLE_MANAGER'];

/**
 * GET /api/campaigns — Danh sách chiến dịch (mới nhất trước).
 * Quyền: Owner, Manager.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, PRIVILEGED);
    const rows = await db.select().from(campaigns).orderBy(desc(campaigns.createdAt)).limit(100);
    return NextResponse.json({ success: true, data: rows });
  } catch (e) {
    return handleApiError(e);
  }
}

/**
 * POST /api/campaigns — Tạo chiến dịch (DRAFT).
 * Body: { name, startDate: YYYY-MM-DD, endDate: YYYY-MM-DD, sourceWarehouseId }
 * Quyền: Owner, Manager.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, PRIVILEGED);
    const body = await req.json().catch(() => ({}));
    const result = await CampaignService.create({
      name: `${body.name || ''}`,
      startDate: `${body.startDate || ''}`,
      endDate: `${body.endDate || ''}`,
      sourceWarehouseId: `${body.sourceWarehouseId || ''}`,
      actorId: session.actorId,
    });
    await recordAuditLog({
      action: 'CAMPAIGN_CREATED' as any,
      actorRole: session.role,
      actorId: session.actorId,
      resource: '/api/campaigns',
      details: `Tạo chiến dịch ${result.id} (${body.name}).`,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    return handleApiError(e);
  }
}
