import { NextRequest, NextResponse } from 'next/server';
import { db, campaignReports } from '@/db';
import { eq, desc } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';

export const dynamic = 'force-dynamic';

/**
 * GET /api/campaigns/[id]/report
 * Báo cáo kỳ mới nhất của chiến dịch (tự sinh khi chiến dịch kết thúc).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);
    const { id } = await params;
    const rows = await db
      .select()
      .from(campaignReports)
      .where(eq(campaignReports.campaignId, id))
      .orderBy(desc(campaignReports.createdAt))
      .limit(1);
    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'Chiến dịch chưa có báo cáo kỳ.' }, { status: 404 });
    }
    const r: any = rows[0];
    return NextResponse.json({
      ok: true,
      data: {
        ...r,
        leftoverItems: JSON.parse(r.leftoverItems || '[]'),
        soldItems: JSON.parse(r.soldItems || '[]'),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}
