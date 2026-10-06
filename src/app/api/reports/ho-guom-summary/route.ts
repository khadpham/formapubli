import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { DailySettlementService } from '@/services/daily-settlement.service';
import { HoGuomSummaryService } from '@/services/ho-guom-summary.service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/ho-guom-summary
 * Bảng tổng hợp cả kỳ theo đầu sách (yêu cầu chủ 06/10/2026).
 * - ?warehouseId=<id>&start=YYYY-MM-DD&end=YYYY-MM-DD
 * - ?warehouseId=<id>&campaign=1 (suy kỳ từ đơn đầu→cuối)
 * Chỉ Chủ + Quản lý. Ngữ nghĩa gom kế thừa getSettlementRange.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get('warehouseId') || '';
    if (!warehouseId) {
      return NextResponse.json(
        { success: false, code: 'BAD_RANGE', error: 'Thiếu tham số warehouseId.' },
        { status: 400 }
      );
    }
    const start = searchParams.get('start') || undefined;
    const end = searchParams.get('end') || undefined;
    const campaign = searchParams.get('campaign') === '1';
    if (!start || !end) {
      if (!campaign) {
        return NextResponse.json(
          { success: false, code: 'BAD_RANGE', error: 'Báo cáo kỳ cần cả ngày bắt đầu và ngày kết thúc (YYYY-MM-DD), hoặc ?campaign=1.' },
          { status: 400 }
        );
      }
      const inferred = await DailySettlementService.inferCampaignRange(warehouseId);
      if (!inferred) {
        return NextResponse.json({ success: true, mode: 'ho-guom-summary' as const, empty: true as const, warehouseId });
      }
      const spanDays =
        Math.round(
          (Date.parse(`${inferred.endDate}T00:00:00Z`) - Date.parse(`${inferred.startDate}T00:00:00Z`)) / 86_400_000
        ) + 1;
      if (spanDays > DailySettlementService.RANGE_MAX_DAYS) {
        return NextResponse.json({
          success: true,
          mode: 'ho-guom-summary' as const,
          tooLong: true as const,
          warehouseId,
          startDate: inferred.startDate,
          endDate: inferred.endDate,
          spanDays,
        });
      }
      const data = await HoGuomSummaryService.summary({
        warehouseId,
        startDate: inferred.startDate,
        endDate: inferred.endDate,
      });
      return NextResponse.json({ success: true, mode: 'ho-guom-summary' as const, data });
    }
    const data = await HoGuomSummaryService.summary({ warehouseId, startDate: start, endDate: end });
    return NextResponse.json({ success: true, mode: 'ho-guom-summary' as const, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}
