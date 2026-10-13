import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { confirmSpxMatch } from '@/services/spx-reconciliation.service';

export const dynamic = 'force-dynamic';

/** POST /api/finance/spx-settlements/[id]/confirm - Duyet dong SPX sau khi xem ly do lech. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
    const { id } = await params;
    const data = await confirmSpxMatch(id, session.actorId);
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return handleApiError(e);
  }
}
