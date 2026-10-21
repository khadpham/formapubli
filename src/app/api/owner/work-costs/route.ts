import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { addManualCost } from '@/services/cogs.service';

export const dynamic = 'force-dynamic';

/** POST - thêm chi phí thủ công (tiền in ấn). Chỉ ROLE_OWNER. */
export async function POST(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER'] as UserRole[]);
    const body = await req.json();
    const { id } = await addManualCost({
      workId: `${body.workId || ''}`.trim(),
      costType: 'PRINTING',
      amount: Number(body.amount),
      costDate: `${body.costDate || ''}`.trim(),
      notes: `${body.notes || ''}`.trim() || undefined,
    });
    return NextResponse.json({ success: true, data: { id } });
  } catch (e) {
    return handleApiError(e);
  }
}
