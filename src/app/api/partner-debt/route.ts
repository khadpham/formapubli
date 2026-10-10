import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { PartnerDebtService } from '@/services/partner-debt.service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/partner-debt?partnerId=... - tổng phải thu/đã thu/còn nợ/quá hạn
 * bán đứt (FIFO, cảnh báo). OWNER/MANAGER.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);
    const { searchParams } = new URL(req.url);
    const partnerId = (searchParams.get('partnerId') || '').trim();
    if (!partnerId) {
      return NextResponse.json({ success: false, error: 'Thiếu partnerId.' }, { status: 400 });
    }
    const data = await PartnerDebtService.summary(partnerId);
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}
