import { NextRequest, NextResponse } from 'next/server';
import { GiftReportService } from '@/services/gift-report.service';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * Báo cáo quà tặng.
 * GET /api/reports/gifts?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Tách 2 nhóm: quà còn tồn (trừ bảng cân đối) vs quà hết tồn (is_gift_shortfall).
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);
    const { searchParams } = new URL(req.url);
    const data = await GiftReportService.summary(
      searchParams.get('from'),
      searchParams.get('to')
    );
    return NextResponse.json({ success: true, ...data });
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
