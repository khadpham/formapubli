import { NextRequest, NextResponse } from 'next/server';
import { AnalyticsService } from '@/services/analytics.service';
import { extractUserRole } from '@/lib/rbac-guard';

export const dynamic = 'force-dynamic';

/**
 * Bước 5 — OLAP read-only (0 migration).
 * GET /api/analytics?view=channels|trending|consignment|cashflow
 *   &startDate=&endDate=&top=20&warehouseId=
 * TAX 403 (dùng /api/orders?fiscalScope=OFFICIAL_TAX cho số VAT).
 */
export async function GET(req: NextRequest) {
  try {
    const userRole = extractUserRole(req);
    if (userRole === 'ROLE_TAX') {
      return NextResponse.json({ success: false, error: 'Báo cáo quản trị nội bộ, kế toán thuế dùng Sổ Thuế.' }, { status: 403 });
    }
    const { searchParams } = new URL(req.url);
    const view = searchParams.get('view') || 'channels';
    const range = {
      startDate: searchParams.get('startDate') || undefined,
      endDate: searchParams.get('endDate') || undefined,
    };
    if (view === 'channels') {
      return NextResponse.json({ success: true, data: await AnalyticsService.byChannel(range) });
    }
    if (view === 'trending') {
      const top = Math.min(100, Math.max(1, parseInt(searchParams.get('top') || '20', 10) || 20));
      return NextResponse.json({ success: true, data: await AnalyticsService.trending(top) });
    }
    if (view === 'consignment') {
      return NextResponse.json({ success: true, data: await AnalyticsService.consignment(range) });
    }
    if (view === 'cashflow') {
      return NextResponse.json({ success: true, data: await AnalyticsService.cashflow(range) });
    }
    return NextResponse.json(
      { success: false, error: 'view không hợp lệ (channels | trending | consignment | cashflow).' },
      { status: 400 }
    );
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Lỗi phân tích' }, { status: 500 });
  }
}
