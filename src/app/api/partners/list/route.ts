import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { db, partners } from '@/db';
import { asc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/** GET /api/partners/list — id/code/name/type cho ô chọn đối tác (composer HĐ). */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
    const rows = await db.select({
      id: partners.id,
      code: partners.code,
      name: partners.name,
      type: partners.type,
    }).from(partners).orderBy(asc(partners.name));
    return NextResponse.json({ success: true, data: rows });
  } catch (error: any) {
    return handleApiError(error);
  }
}
