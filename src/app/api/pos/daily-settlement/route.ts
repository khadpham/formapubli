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
    // B1 (bug #3): báo cáo tổng ngày chỉ OWNER/MANAGER. Cashier xem ca của
    // mình qua /api/cashbox (server ép actor); warehouse/tax 403 ở endpoint
    // POS này. Ẩn nút UI thôi là không đủ — chặn ở server.
    const session = await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
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

    // `date` đi thẳng vào `LIKE '${date}%'` bên trong service. Hai rủi ro:
    //  · không kiểm ngày có thật ⇒ 2026-02-30 trả 200 với số liệu rỗng
    //  · `_` và `%` là ký tự đại diện của LIKE ⇒ người gọi tự dựng được mẫu
    //    khớp lung tung. Chặn ngay tại cửa, không đợi tới service.
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { success: false, code: 'BAD_DATE', error: `Ngày "${date}" không hợp lệ. Cần dạng YYYY-MM-DD.` },
        { status: 400 }
      );
    }
    if (date) {
      const d = new Date(`${date}T00:00:00Z`);
      // Date.parse cuộn 30/2 thành 2/3 (ISO chỉ ràng buộc ngày 01-31) nên phải so
      // ngược chuỗi thay vì chỉ kiểm NaN.
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) {
        return NextResponse.json(
          { success: false, code: 'BAD_DATE', error: `Ngày "${date}" không tồn tại.` },
          { status: 400 }
        );
      }
    }

    // Chế độ kỳ: ?start=YYYY-MM-DD&end=YYYY-MM-DD (gom ở server, 1 request) hoặc
    // ?campaign=1 (suy kỳ chiến dịch từ đơn đầu→cuối). Không có cả hai ⇒ rơi
    // về báo cáo ngày cũ bên dưới, giữ nguyên shape.
    // PHÂN QUYỀN (mở 06/10 theo yêu cầu chủ: Kỳ = Chủ + Quản lý. Thu ngân/Kho/Thuế
    // ẩn hẳn nút Kỳ ở UI, server chặn nốt ở đây).
    const start = searchParams.get('start') || undefined;
    const end = searchParams.get('end') || undefined;
    const campaign = searchParams.get('campaign') === '1';
    if (start || end || campaign) {
      await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
      // Cảnh báo ca quá giờ cho cả chế độ kỳ (modal đọc data.openShiftAlerts).
      const rangeAlerts =
        searchParams.get('includeOpenShiftCheck') !== '0'
          ? await CashboxService.getStaleOpenShiftCheck({ warehouseId })
          : null;
      const withAlerts = (rangeData: any) =>
        rangeAlerts ? { ...rangeData, openShiftAlerts: rangeAlerts } : rangeData;
      if (!start || !end) {
        if (!campaign) {
          return NextResponse.json(
            { success: false, code: 'BAD_RANGE', error: 'Báo cáo kỳ cần cả ngày bắt đầu và ngày kết thúc (YYYY-MM-DD).' },
            { status: 400 }
          );
        }
        const inferred = await DailySettlementService.inferCampaignRange(warehouseId);
        if (!inferred) {
          return NextResponse.json({ success: true, mode: 'range', empty: true as const, warehouseId });
        }
        // Chiến dịch dài hơn trần kỳ: không ném lỗi cụt (người dùng hết đường),
        // trả kỳ suy ra + cờ để UI mời xem 90 ngày gần nhất.
        const spanDays =
          Math.round(
            (Date.parse(`${inferred.endDate}T00:00:00Z`) - Date.parse(`${inferred.startDate}T00:00:00Z`)) / 86_400_000
          ) + 1;
        if (spanDays > DailySettlementService.RANGE_MAX_DAYS) {
          return NextResponse.json({
            success: true,
            mode: 'range',
            tooLong: true as const,
            warehouseId,
            startDate: inferred.startDate,
            endDate: inferred.endDate,
            spanDays,
          });
        }
        const rangeData = await DailySettlementService.getSettlementRange({
          warehouseId,
          startDate: inferred.startDate,
          endDate: inferred.endDate,
        });
        return NextResponse.json({ success: true, mode: 'range' as const, data: withAlerts(rangeData) });
      }
      const rangeData = await DailySettlementService.getSettlementRange({
        warehouseId,
        startDate: start,
        endDate: end,
      });
      return NextResponse.json({ success: true, mode: 'range' as const, data: withAlerts(rangeData) });
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
