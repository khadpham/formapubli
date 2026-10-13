import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { skipStatement } from '@/services/bank-reconciliation.service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/finance/bank-statements/[id]/skip - Bo qua dong review (VD: chi
 * luong, chi NCC). Dong ve CHUA_XU_LY, don lien quan khong doi trang thai.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
    const { id } = await params;
    const data = await skipStatement(id);
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return handleApiError(e);
  }
}
