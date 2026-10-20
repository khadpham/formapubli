import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { products, stockBalances } from '@/db/schema';
import { and, eq, inArray, like, or } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * GET /api/combos/books?search=...&warehouseId=... - tim sach lam component combo.
 * Chi tra products BOOK (hang hoa va combo khong lam component duoc).
 * Co warehouseId: kem ton tung sach trong kho (de picker hien ton, preview min).
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_WAREHOUSE']);
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search')?.trim() || '';
    const warehouseId = searchParams.get('warehouseId')?.trim() || '';
    const conds = [eq(products.productKind, 'BOOK')];
    if (search) {
      conds.push(or(like(products.name, `%${search}%`), like(products.code, `%${search}%`))!);
    }
    const rows = await db
      .select({ id: products.id, code: products.code, name: products.name, sellingPrice: products.sellingPrice })
      .from(products)
      .where(and(...conds))
      .limit(50);
    if (!warehouseId) return NextResponse.json({ books: rows });
    const balRows = await db
      .select({ productId: stockBalances.productId, qty: stockBalances.physicalQuantity })
      .from(stockBalances)
      .where(
        and(
          inArray(
            stockBalances.productId,
            rows.map((r) => r.id)
          ),
          eq(stockBalances.warehouseId, warehouseId),
          eq(stockBalances.condition, 'NEW')
        )
      );
    const balMap = new Map(balRows.map((b) => [b.productId, Number(b.qty || 0)]));
    return NextResponse.json({
      books: rows.map((r) => ({ ...r, stock: balMap.get(r.id) ?? 0 })),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
