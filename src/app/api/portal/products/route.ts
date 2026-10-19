import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { portalProducts, portalComboItems, portalReviews } from '@/db/schema';
import { eq, and, or, like, desc, asc, sql, count } from 'drizzle-orm';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

function checkAuth(req: NextRequest) {
  const apiKey = process.env.PORTAL_API_KEY;
  if (!apiKey) return false;
  return req.headers.get('authorization') === `Bearer ${apiKey}`;
}

/**
 * GET /api/portal/products - Danh sach san pham cho portal.
 * Query: q, category, sort, page, limit, featured
 */
export async function GET(req: NextRequest) {
  try {
    if (!checkAuth(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q')?.trim() || '';
    const category = searchParams.get('category')?.trim() || '';
    const sort = searchParams.get('sort') || 'custom';
    const featured = searchParams.get('featured') === 'true';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const offset = (page - 1) * limit;

    const conditions = [eq(portalProducts.isVisible, true)];
    if (q) {
      conditions.push(
        or(
          like(portalProducts.name, `%${q}%`),
          like(portalProducts.author, `%${q}%`)
        )!
      );
    }
    if (category) {
      conditions.push(eq(portalProducts.category, category));
    }
    if (featured) {
      conditions.push(eq(portalProducts.isFeatured, true));
    }
    // Khong hien qua tang de ban le
    conditions.push(or(
      eq(portalProducts.productType, 'SINGLE'),
      eq(portalProducts.productType, 'COMBO')
    )!);

    const where = and(...conditions);

    let orderBy;
    switch (sort) {
      case 'newest':
        orderBy = desc(portalProducts.createdAt);
        break;
      case 'price_asc':
        orderBy = asc(portalProducts.coverPrice);
        break;
      case 'price_desc':
        orderBy = desc(portalProducts.coverPrice);
        break;
      case 'custom':
      default:
        orderBy = asc(portalProducts.sortOrder);
        break;
    }

    const [items, totalResult] = await Promise.all([
      db.select({
        id: portalProducts.id,
        slug: portalProducts.slug,
        name: portalProducts.name,
        author: portalProducts.author,
        translator: portalProducts.translator,
        coverPrice: portalProducts.coverPrice,
        salePrice: portalProducts.salePrice,
        productType: portalProducts.productType,
        category: portalProducts.category,
        coverImage: portalProducts.coverImage,
        isFeatured: portalProducts.isFeatured,
        description: portalProducts.description,
      })
        .from(portalProducts)
        .where(where)
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(portalProducts).where(where),
    ]);

    const total = totalResult[0]?.total || 0;

    // Lay so sao trung binh cho tung san pham
    const products = await Promise.all(
      items.map(async (p) => {
        const ratingResult = await db
          .select({
            avg: sql<number>`AVG(${portalReviews.rating})`,
            cnt: count(),
          })
          .from(portalReviews)
          .where(and(
            eq(portalReviews.productId, p.id),
            eq(portalReviews.status, 'APPROVED')
          ));
        const avgRating = ratingResult[0]?.avg || 0;
        const reviewCount = ratingResult[0]?.cnt || 0;

        // TODO: kiem tra ton kho tu inventory_ledger (tam tra ve true)
        const inStock = true;

        return {
          ...p,
          hasPromotion: p.salePrice != null && p.salePrice < p.coverPrice,
          inStock,
          avgRating: Math.round(avgRating * 10) / 10,
          reviewCount,
        };
      })
    );

    return NextResponse.json({
      products,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (e) {
    console.error(`[portal/products] 500 ${(e as Error)?.message || e}`);
    return handleApiError(e);
  }
}
