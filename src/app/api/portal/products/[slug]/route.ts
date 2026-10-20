import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { portalProducts, portalProductImages, portalComboItems, portalReviews } from '@/db/schema';
import { eq, and, count, sql } from 'drizzle-orm';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

function checkAuth(req: NextRequest) {
  const apiKey = process.env.PORTAL_API_KEY;
  if (!apiKey) return false;
  return req.headers.get('authorization') === `Bearer ${apiKey}`;
}

/**
 * GET /api/portal/products/[slug] - Chi tiet mot san pham.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    if (!checkAuth(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { slug } = await params;
    const rows = await db
      .select()
      .from(portalProducts)
      .where(eq(portalProducts.slug, slug))
      .limit(1);

    const product = rows[0];
    if (!product || !product.isVisible) {
      return NextResponse.json(
        { error: 'Không tìm thấy sản phẩm.' },
        { status: 404 }
      );
    }

    // Anh phu
    const images = await db
      .select({ imageUrl: portalProductImages.imageUrl })
      .from(portalProductImages)
      .where(eq(portalProductImages.productId, product.id))
      .orderBy(portalProductImages.sortOrder);

    const imageUrls = [
      ...(product.coverImage ? [product.coverImage] : []),
      ...images.map((i) => i.imageUrl).filter((u) => u !== product.coverImage),
    ];

    // Neu la combo, lay danh sach sach trong combo
    let comboItems: Array<{ productId: string; productName: string; quantity: number }> = [];
    if (product.productType === 'COMBO') {
      const comboRows = await db
        .select({
          productId: portalComboItems.itemProductId,
          productName: portalProducts.name,
          quantity: portalComboItems.quantity,
        })
        .from(portalComboItems)
        .innerJoin(portalProducts, eq(portalComboItems.itemProductId, portalProducts.id))
        .where(eq(portalComboItems.comboProductId, product.id));
      comboItems = comboRows;
    }

    // Danh gia trung binh
    const ratingResult = await db
      .select({
        avg: sql<number>`AVG(${portalReviews.rating})`,
        cnt: count(),
      })
      .from(portalReviews)
      .where(and(
        eq(portalReviews.productId, product.id),
        eq(portalReviews.status, 'APPROVED')
      ));
    const avgRating = ratingResult[0]?.avg || 0;
    const reviewCount = ratingResult[0]?.cnt || 0;

    // TODO: kiem tra ton kho tu inventory_ledger
    const inStock = true;

    let details = null;
    try {
      details = product.detailsJson ? JSON.parse(product.detailsJson) : null;
    } catch {
      details = null;
    }

    return NextResponse.json({
      id: product.id,
      slug: product.slug,
      name: product.name,
      author: product.author,
      translator: product.translator,
      description: product.description,
      coverPrice: product.coverPrice,
      salePrice: product.salePrice,
      hasPromotion: product.salePrice != null && product.salePrice < product.coverPrice,
      productType: product.productType,
      category: product.category,
      isbn: product.isbn,
      images: imageUrls,
      inStock,
      comboItems: product.productType === 'COMBO' ? comboItems : undefined,
      details,
      avgRating: Math.round(avgRating * 10) / 10,
      reviewCount,
    });
  } catch (e) {
    console.error(`[portal/products/slug] 500 ${(e as Error)?.message || e}`);
    return handleApiError(e);
  }
}
