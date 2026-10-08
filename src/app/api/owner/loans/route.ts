import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { LoanService } from '@/services/loan.service';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER'] as UserRole[];

/** GET /api/owner/loans — tổng quan nợ vay (chỉ chủ). */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const data = await LoanService.overview(session.role);
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/** POST /api/owner/loans — ghi nhận khoản vay mới (chỉ chủ). */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const body = await req.json().catch(() => ({}));
    const data = await LoanService.create({
      lender: body.lender,
      principal: body.principal,
      interestRate: body.interestRate,
      borrowedAt: body.borrowedAt,
      dueAt: body.dueAt,
      note: body.note,
      actorRole: session.role,
      actorId: session.actorId,
    });
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error);
  }
}
