import { NextRequest, NextResponse } from 'next/server';
import { AnalyticsService, type AnalyticsScope } from '@/services/analytics.service';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * Bước 5 — OLAP read-only (0 migration).
 * GET /api/analytics?view=channels|trending|consignment|cashflow|top-editions|stock-summary
 *   &startDate=&endDate=
 *
 * Tham số RIÊNG theo từng view (không phải view nào cũng nhận hết):
 *   channels, cashflow : startDate, endDate, warehouseId, fiscalScope(OFFICIAL_TAX|INTERNAL_MANAGEMENT)
 *   top-editions       : startDate, endDate, top, warehouseId, excludeGifts=0 (mặc định ĐÃ loại dòng quà tặng; truyền excludeGifts=0 để GIỮ lại dòng quà)
 *   stock-summary      : warehouseId
 *   consignment        : startDate, endDate  (kho ký gửi suy ra từ mẫu id wh-consign-*, không nhận warehouseId/fiscalScope)
 *   trending           : top               (tuần hiện tại, không nhận startDate/endDate/warehouseId/fiscalScope)
 * P2-13 / P1b: Chỉ OWNER/MANAGER (Default-Deny fail-closed, bắt buộc session cookie hợp lệ).
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);
    const { searchParams } = new URL(req.url);
    const view = searchParams.get('view') || 'channels';
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    // Ngay khong hop le → 400 thay vi tra rong lang le.
    for (const d of [startDate, endDate]) {
      if (d !== undefined && Number.isNaN(Date.parse(d))) {
        return NextResponse.json(
          { success: false, error: `Tham số ngày không hợp lệ: ${d}` },
          { status: 400 }
        );
      }
    }
    const range = { startDate, endDate };
    // Filter phạm vi của tab Doanh Số: kho + sổ kế toán. `fiscalScope` sai giá trị
    // → 400 (không cho lọc im lặng theo sổ nào đó), còn thiếu thì không lọc sổ.
    const warehouseId = searchParams.get('warehouseId') || undefined;
    const fiscalScope = searchParams.get('fiscalScope') || undefined;
    if (fiscalScope !== undefined && fiscalScope !== 'OFFICIAL_TAX' && fiscalScope !== 'INTERNAL_MANAGEMENT') {
      return NextResponse.json(
        { success: false, error: `Tham số fiscalScope không hợp lệ: ${fiscalScope} (chỉ OFFICIAL_TAX | INTERNAL_MANAGEMENT).` },
        { status: 400 }
      );
    }
    // Narrow kiểu: sau khối if ở trên, fiscalScope chỉ còn 2 giá trị hợp lệ.
    const scope: AnalyticsScope = { warehouseId, fiscalScope };
    if (view === 'channels') {
      return NextResponse.json({ success: true, data: await AnalyticsService.byChannel(range, scope) });
    }
    if (view === 'trending') {
      const top = Math.min(100, Math.max(1, parseInt(searchParams.get('top') || '20', 10) || 20));
      return NextResponse.json({ success: true, data: await AnalyticsService.trending(top) });
    }
    if (view === 'consignment') {
      return NextResponse.json({ success: true, data: await AnalyticsService.consignment(range) });
    }
    if (view === 'cashflow') {
      return NextResponse.json({ success: true, data: await AnalyticsService.cashflow(range, scope) });
    }
    if (view === 'top-editions') {
      const top = Math.min(100, Math.max(1, parseInt(searchParams.get('top') || '20', 10) || 20));
      // Mặc định luôn loại bỏ quà tặng kèm (excludeGifts = true), trừ khi truyền thẳng '0'.
      const excludeGifts = searchParams.get('excludeGifts') !== '0';
      return NextResponse.json({ success: true, data: await AnalyticsService.topEditions(range, top, warehouseId, excludeGifts) });
    }
    if (view === 'stock-summary') {
      return NextResponse.json({ success: true, data: await AnalyticsService.stockSummary(warehouseId) });
    }
    return NextResponse.json(
      {
        success: false,
        error:
          'view không hợp lệ (channels | trending | consignment | cashflow | top-editions | stock-summary). ' +
          'channels/cashflow nhận startDate, endDate, warehouseId, fiscalScope (OFFICIAL_TAX | INTERNAL_MANAGEMENT). ' +
          'top-editions nhận startDate, endDate, top, warehouseId; mặc định đã loại dòng quà tặng, truyền excludeGifts=0 để giữ lại. ' +
          'stock-summary nhận warehouseId; consignment nhận startDate, endDate; trending nhận top.',
      },
      { status: 400 }
    );
  } catch (error: any) {
    return handleApiError(error);
  }
}

