import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { db, portalProducts } from '@/db';
import { eq, and, or, like, desc, asc, sql } from 'drizzle-orm';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

const ADMIN_ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[];

/**
 * GET /api/portal-products/admin - Danh sach TAT CA san pham portal (ke ca an).
 * Query: q (ten/tac gia/ISBN), type (SINGLE/COMBO/GIFT), visible (1/0), sort, page, limit.
 * Quyen: Owner, Manager.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ADMIN_ROLES);
    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q')?.trim() || '';
    const type = searchParams.get('type')?.trim() || '';
    const visible = searchParams.get('visible')?.trim() || '';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const offset = (page - 1) * limit;

    const conditions = [];
    if (q) {
      conditions.push(
        or(
          like(portalProducts.name, `%${q}%`),
          like(portalProducts.author, `%${q}%`),
          like(portalProducts.isbn, `%${q}%`),
        )!,
      );
    }
    if (type) conditions.push(eq(portalProducts.productType, type));
    if (visible === '1') conditions.push(eq(portalProducts.isVisible, true));
    if (visible === '0') conditions.push(eq(portalProducts.isVisible, false));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await db
      .select()
      .from(portalProducts)
      .where(where)
      .orderBy(asc(portalProducts.sortOrder), desc(portalProducts.updatedAt))
      .limit(limit)
      .offset(offset);
    const totalRow = await db
      .select({ n: sql<number>`count(*)` })
      .from(portalProducts)
      .where(where);
    return NextResponse.json({
      success: true,
      data: rows,
      pagination: { page, limit, total: totalRow[0]?.n ?? 0 },
    });
  } catch (e) {
    return handleApiError(e);
  }
}

const EDITABLE_FIELDS = [
  'name', 'author', 'translator', 'description', 'coverPrice', 'salePrice',
  'category', 'isbn', 'sku', 'coverImage', 'isVisible', 'isFeatured', 'sortOrder',
] as const;

/**
 * PATCH /api/portal-products/admin - Cap nhat 1 san pham portal.
 * Body: { id, ...fields } - chi nhan cac field trong EDITABLE_FIELDS.
 * Quyen: Owner, Manager.
 */
export async function PATCH(req: NextRequest) {
  try {
    await requireSessionRole(req, ADMIN_ROLES);
    const body = await req.json().catch(() => ({}));
    const id = String(body.id || '').trim();
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Thieu id san pham.' },
        { status: 400 },
      );
    }
    const patch: Record<string, unknown> = {};
    for (const f of EDITABLE_FIELDS) {
      if (body[f] !== undefined) patch[f] = body[f];
    }
    if (typeof patch.name === 'string' && !patch.name.trim()) {
      return NextResponse.json(
        { success: false, error: 'Ten san pham khong duoc rong.' },
        { status: 400 },
      );
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { success: false, error: 'Khong co gi de cap nhat.' },
        { status: 400 },
      );
    }
    // Chuan hoa so
    if (patch.coverPrice !== undefined) patch.coverPrice = Number(patch.coverPrice) || 0;
    if (patch.salePrice !== undefined && patch.salePrice !== null && patch.salePrice !== '') {
      patch.salePrice = Number(patch.salePrice) || 0;
    }
    if (patch.sortOrder !== undefined) patch.sortOrder = Number(patch.sortOrder) || 0;
    patch.updatedAt = new Date().toISOString();

    await db.update(portalProducts).set(patch).where(eq(portalProducts.id, id));
    const updated = (
      await db.select().from(portalProducts).where(eq(portalProducts.id, id)).limit(1)
    )[0];
    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return handleApiError(e);
  }
}
