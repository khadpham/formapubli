import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { updateExpense } from '@/services/expense.service';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/owner/finance/[id] - sửa chi phí (amount/category/note/entryDate/
 * staffId/recurrence). Chỉ Chủ; mỗi lần sửa ghi 1 dòng EXPENSE_UPDATED.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER'] as UserRole[]);
    const routeParams = await params;
    const body = (await req.json().catch(() => ({}))) as {
      amount?: number;
      category?: string;
      note?: string | null;
      entryDate?: string;
      staffId?: string | null;
      recurrence?: string;
    };
    const entry = await updateExpense(
      routeParams.id,
      {
        amount: body.amount !== undefined ? Number(body.amount) : undefined,
        category: body.category,
        note: body.note,
        entryDate: body.entryDate,
        staffId: body.staffId,
        recurrence: body.recurrence,
      },
      session.role,
      session.actorId
    );
    return NextResponse.json({ success: true, data: entry });
  } catch (error) {
    return handleApiError(error);
  }
}
