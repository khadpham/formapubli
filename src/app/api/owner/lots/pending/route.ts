import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { listPendingCostLots } from '@/services/owner-finance.service';

export const dynamic = 'force-dynamic';

/** GET /api/owner/lots/pending — các lô chờ nhập giá vốn (chỉ chủ). */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER'] as UserRole[]);
    const data = await listPendingCostLots(session.role);
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}
