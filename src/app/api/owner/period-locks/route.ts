import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { PeriodLockService } from '@/services/period-lock.service';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER'] as UserRole[];

/** GET /api/owner/period-locks?month=YYYY-MM - trạng thái khóa sổ (chỉ chủ). */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const { searchParams } = new URL(req.url);
    const month = `${searchParams.get('month') || ''}`.trim();
    const info = month ? await PeriodLockService.getInfo(month) : null;
    return NextResponse.json({ success: true, data: { month, locked: !!info, info } });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/**
 * POST /api/owner/period-locks - { month, action: 'lock' | 'unlock', note? }.
 * Chỉ chủ.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const body = await req.json().catch(() => ({}));
    const month = `${body.month || ''}`.trim();
    const action = `${body.action || ''}`.trim();
    const data =
      action === 'unlock'
        ? await PeriodLockService.unlock(month, session.role, session.actorId)
        : await PeriodLockService.lock(month, session.role, session.actorId, body.note);
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}
