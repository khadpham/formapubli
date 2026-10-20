import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { confirmMatch } from '@/services/bank-reconciliation.service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/finance/bank-statements/[id]/confirm - Ke toan xac nhan dong review.
 * Body { orderId? }: co orderId thi gan tay ve don do, khong thi chap nhan
 * goi y AUTO hien co.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const data = await confirmMatch(id, `${body.orderId || ''}`.trim() || null, session.actorId);
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return handleApiError(e);
  }
}
