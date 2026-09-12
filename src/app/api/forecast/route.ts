import { NextRequest, NextResponse } from 'next/server';
import {
  ForecastService,
  DEFAULT_WINDOW_DAYS,
  LEAD_TIME_DAYS,
  BUFFER_DAYS,
  SAFETY_DAYS,
  RED_DAYS,
  YELLOW_DAYS,
  type RunoutLevel,
} from '@/services/forecast.service';
import { extractUserRole } from '@/lib/rbac-guard';

export const dynamic = 'force-dynamic';

// GET /api/forecast?windowDays=30&warehouseId=&level=RED_ALERT&limit=200
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userRole = extractUserRole(req);

    if (userRole === 'ROLE_CASHIER' || userRole === 'ROLE_TAX') {
      return NextResponse.json(
        { success: false, error: 'Vai trò này không có quyền xem dự báo tái bản.' },
        { status: 403 }
      );
    }

    const windowDays = searchParams.get('windowDays')
      ? parseInt(searchParams.get('windowDays')!, 10)
      : DEFAULT_WINDOW_DAYS;
    if (!Number.isFinite(windowDays) || windowDays <= 0) {
      return NextResponse.json(
        { success: false, error: 'windowDays phải là số ngày > 0.' },
        { status: 400 }
      );
    }

    const warehouseId = searchParams.get('warehouseId') || undefined;
    const level = (searchParams.get('level') || undefined) as RunoutLevel | undefined;
    if (level && !['RED_ALERT', 'YELLOW_WARNING', 'HEALTHY_NORMAL'].includes(level)) {
      return NextResponse.json(
        { success: false, error: 'level chỉ chấp nhận RED_ALERT, YELLOW_WARNING, HEALTHY_NORMAL.' },
        { status: 400 }
      );
    }
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 200;

    const result = await ForecastService.forecastAll(windowDays, warehouseId, level, limit);
    return NextResponse.json({
      success: true,
      data: result.items,
      summary: result.summary,
      params: {
        windowDays,
        warehouseId: warehouseId || 'ALL',
        leadTimeDays: LEAD_TIME_DAYS,
        bufferDays: BUFFER_DAYS,
        safetyDays: SAFETY_DAYS,
        redDays: RED_DAYS,
        yellowDays: YELLOW_DAYS,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Lỗi dự báo tái bản' },
      { status: 400 }
    );
  }
}
