import { NextRequest, NextResponse } from 'next/server';
import { or, like } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { db, editions } from '@/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/editions/search?q=...&limit=10 - tìm sách theo tên/mã/ISBN.
 * Dùng cho dialog đối chiếu SKU Shopee.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
      'ROLE_SHOPEE_OPS',
    ] as UserRole[]);
    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q')?.trim() || '';
    const limit = Math.min(Number(searchParams.get('limit') || '10') || 10, 20);
    if (q.length < 2) return NextResponse.json({ success: true, data: [] });
    const pattern = `%${q}%`;
    const rows = await db
      .select({ id: editions.id, code: editions.code, title: editions.title })
      .from(editions)
      .where(
        or(
          like(editions.title, pattern),
          like(editions.code, pattern),
          like(editions.isbn, pattern)
        )
      )
      .limit(limit);
    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    return handleApiError(error);
  }
}
