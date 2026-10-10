import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { setLotCost } from '@/services/owner-finance.service';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/owner/lots/[lotId]/cost - chủ nhập/sửa giá vốn lô (chỉ chủ, có audit).
 * Body: { unitCost, force? } - force=true để ghi đè giá vốn đã có.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ lotId: string }> }) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER'] as UserRole[]);
    const { lotId } = await params;
    const body = await req.json().catch(() => ({}));
    const data = await setLotCost({
      lotId: decodeURIComponent(lotId || ''),
      unitCost: body.unitCost,
      force: body.force === true,
      actorRole: session.role,
      actorId: session.actorId,
    });
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}
