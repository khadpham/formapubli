import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { promotions, promotionGifts, products } from '@/db/schema';
import { eq, and, or, isNull, lte, gte, asc } from 'drizzle-orm';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

function checkAuth(req: NextRequest) {
  const apiKey = process.env.PORTAL_API_KEY;
  if (!apiKey) return false;
  return req.headers.get('authorization') === `Bearer ${apiKey}`;
}

/**
 * GET /api/portal/promotions/active - Danh sach khuyen mai dang chay.
 * Dung bang promotions + promotion_gifts co san cua ERP.
 */
export async function GET(req: NextRequest) {
  try {
    if (!checkAuth(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date().toISOString();

    const activePromos = await db
      .select({
        id: promotions.id,
        name: promotions.name,
      })
      .from(promotions)
      .where(and(
        eq(promotions.isActive, true),
        or(isNull(promotions.startsAt), lte(promotions.startsAt, now))!,
        or(isNull(promotions.endsAt), gte(promotions.endsAt, now))!
      ));

    const result = await Promise.all(
      activePromos.map(async (promo) => {
        const gifts = await db
          .select({
            minSubtotal: promotionGifts.minSubtotal,
            giftQuantity: promotionGifts.giftQuantity,
            giftProductId: promotionGifts.productId,
            giftName: products.name,
          })
          .from(promotionGifts)
          .innerJoin(products, eq(promotionGifts.productId, products.id))
          .where(eq(promotionGifts.promotionId, promo.id))
          .orderBy(asc(promotionGifts.minSubtotal));

        return {
          id: promo.id,
          name: promo.name,
          type: 'GIFT_THRESHOLD',
          tiers: gifts.map((g) => ({
            threshold: g.minSubtotal,
            giftName: g.giftName,
            giftQuantity: g.giftQuantity,
          })),
        };
      })
    );

    // Chi tra khuyen mai co it nhat 1 moc qua
    const withTiers = result.filter((r) => r.tiers.length > 0);

    return NextResponse.json({ promotions: withTiers });
  } catch (e) {
    console.error(`[portal/promotions] 500 ${(e as Error)?.message || e}`);
    return handleApiError(e);
  }
}
