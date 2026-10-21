import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { syncContractCosts } from '@/services/cogs.service';

export const dynamic = 'force-dynamic';

/** POST - đồng bộ chi phí từ hợp đồng vào work_costs. Chỉ ROLE_OWNER. */
export async function POST(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER'] as UserRole[]);
    const data = await syncContractCosts();
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return handleApiError(e);
  }
}
