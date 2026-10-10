import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { LoanService } from '@/services/loan.service';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER'] as UserRole[];

/** POST /api/owner/loans/[id]/payments - ghi nhận trả nợ (chỉ chủ). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const data = await LoanService.recordPayment({
      loanId: decodeURIComponent(id || '').trim(),
      amount: body.amount,
      principalAmount: body.principalAmount,
      interestAmount: body.interestAmount,
      paidAt: body.paidAt,
      note: body.note,
      actorRole: session.role,
      actorId: session.actorId,
    });
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error);
  }
}
