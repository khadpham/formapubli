import { NextRequest, NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { db, shopeePayouts } from '@/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/owner/shopee-payouts
 * Danh sách đối soát payout theo kỳ. CHỈ ROLE_OWNER.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER'] as UserRole[]);
    const rows = await db
      .select()
      .from(shopeePayouts)
      .orderBy(desc(shopeePayouts.period))
      .limit(24);
    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    return handleApiError(error);
  }
}
