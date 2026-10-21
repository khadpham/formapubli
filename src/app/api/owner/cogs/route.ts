import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { getWorkCostBreakdown, getUnitCost } from '@/services/cogs.service';

export const dynamic = 'force-dynamic';

/** GET ?work_id= - chi tiết cấu thành giá vốn 1 đầu sách. Chỉ ROLE_OWNER. */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER'] as UserRole[]);
    const workId = `${new URL(req.url).searchParams.get('work_id') || ''}`.trim();
    if (!workId) {
      return NextResponse.json({ success: false, error: 'Thiếu work_id.' }, { status: 400 });
    }
    const breakdown = await getWorkCostBreakdown(workId);
    if (!breakdown.work) {
      return NextResponse.json({ success: false, error: 'Không tìm thấy đầu sách.' }, { status: 404 });
    }
    const { unitCost, receivedQty } = await getUnitCost(workId);
    return NextResponse.json({ success: true, data: { ...breakdown, receivedQty, unitCost } });
  } catch (e) {
    return handleApiError(e);
  }
}
