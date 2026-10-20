import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { skipSpxSettlement } from '@/services/spx-reconciliation.service';

export const dynamic = 'force-dynamic';

/** POST /api/finance/spx-settlements/[id]/skip - Bo qua dong SPX, ve chua xu ly. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
    const { id } = await params;
    const data = await skipSpxSettlement(id);
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return handleApiError(e);
  }
}
