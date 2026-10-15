import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { products } from '@/db/schema';
import { and, eq, like, or } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * GET /api/combos/books?search=... - tim sach lam component combo.
 * Chi tra products BOOK (hang hoa va combo khong lam component duoc).
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_WAREHOUSE']);
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search')?.trim() || '';
    const conds = [eq(products.productKind, 'BOOK')];
    if (search) {
      conds.push(or(like(products.name, `%${search}%`), like(products.code, `%${search}%`))!);
    }
    const rows = await db
      .select({ id: products.id, code: products.code, name: products.name, sellingPrice: products.sellingPrice })
      .from(products)
      .where(and(...conds))
      .limit(50);
    return NextResponse.json({ books: rows });
  } catch (e) {
    return handleApiError(e);
  }
}
