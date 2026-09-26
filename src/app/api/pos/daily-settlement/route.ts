import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { DailySettlementService } from '@/services/daily-settlement.service';
import { CashboxService } from '@/services/order.service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/pos/daily-settlement
 * - Báo cáo tổng hợp chốt ngày hội chợ & đối soát kiểm kê ca/ngày (Sprint 4).
 * - Thêm `openShiftAlerts`: các ca két còn mở quá giờ chốt ngày (chỉ đọc).
 *   Đây là phần ĐỂ UI NHẮC, không tự sửa: mỗi phần tử nêu rõ cần làm gì và ai làm.
 * - Parameters:
 *   - warehouseId: ID kho hội chợ hoặc kho bán lẻ (bắt buộc).
 *   - date: Ngày chốt YYYY-MM-DD (mặc định hôm nay).
 *   - sessionId: ID phiên két tiền ca làm việc (tùy chọn).
 *   - includeOpenShiftCheck: '0' để bỏ qua phần cảnh báo ca quá giờ.
 *
 * POST /api/pos/daily-settlement — CHỐT NGÀY (quản lý/owner), đúng 1 lần/ngày/kho.
 *   Body: { warehouseId, date?, notes?, autoCloseOpenShifts? }
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, [
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

    if (searchParams.get('includeOpenShiftCheck') !== '0') {
      const check = await CashboxService.getStaleOpenShiftCheck({
        warehouseId,
        cashierId: session.role === 'ROLE_CASHIER' ? session.actorId : undefined,
      });
      return NextResponse.json({
        success: true,
        data: { ...data, openShiftAlerts: check },
      });
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);

    const body = await req.json().catch(() => ({}));
    if (!body?.warehouseId) {
      return NextResponse.json(
        { success: false, error: 'Thiếu tham số warehouseId' },
        { status: 400 }
      );
    }

    const record = await DailySettlementService.closeDay({
      warehouseId: body.warehouseId,
      date: body.date || undefined,
      notes: typeof body.notes === 'string' ? body.notes : undefined,
      autoCloseOpenShifts: body.autoCloseOpenShifts === true,
      actorRole: session.role,
      actorId: session.actorId,
    });

    return NextResponse.json({ success: true, data: record });
  } catch (error: any) {
    return handleApiError(error);
  }
}
