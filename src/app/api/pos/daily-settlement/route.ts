import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { DailySettlementService } from '@/services/daily-settlement.service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/pos/daily-settlement
 * - Báo cáo tổng hợp chốt ngày hội chợ & đối soát kiểm kê ca/ngày (Sprint 4).
 * - Parameters:
 *   - warehouseId: ID kho hội chợ hoặc kho bán lẻ (bắt buộc).
 *   - date: Ngày chốt YYYY-MM-DD (mặc định hôm nay).
 *   - sessionId: ID phiên két tiền ca làm việc (tùy chọn).
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_CASHIER',
      'ROLE_WAREHOUSE',
      'ROLE_TAX',
    ] as UserRole[]);

    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get('warehouseId');
    const date = searchParams.get('date') || undefined;
    const sessionId = searchParams.get('sessionId') || undefined;

    if (!warehouseId) {
      return NextResponse.json(
        { success: false, error: 'Thiếu tham số warehouseId' },
        { status: 400 }
      );
    }

    const data = await DailySettlementService.getDailyFairSettlement({
      warehouseId,
      date,
      sessionId,
    });

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}
