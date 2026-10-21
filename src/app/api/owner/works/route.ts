import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { db } from '@/db';
import { works } from '@/db/schema';

export const dynamic = 'force-dynamic';

/** GET - danh sách đầu sách cho bộ lọc P&L. Chỉ ROLE_OWNER. */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER'] as UserRole[]);
    const rows = await db.select({ id: works.id, code: works.code, title: works.title }).from(works);
    return NextResponse.json({ success: true, data: rows });
  } catch (e) {
    return handleApiError(e);
  }
}
