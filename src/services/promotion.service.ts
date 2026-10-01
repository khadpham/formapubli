import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { promotions, promotionGifts, products } from '@/db/schema';
import { AppError } from './app-error';

/**
 * Chương trình khuyến mại (migration 0031).
 *
 * Mô hình BẬC THANG — các dòng `promotion_gifts` CÙNG `min_subtotal` là cùng
 * một bậc. Engine (`src/lib/promotion-engine.ts`) là nguồn sự thật tính quà;
 * service này chỉ lo CRUD cấu hình, KHÔNG tính quà.
 */

export interface PromotionGiftInput {
  minSubtotal: number;
  productId: string;
  giftQuantity: number;
}

export interface CreatePromotionInput {
  name: string;
  isActive?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  gifts: PromotionGiftInput[];
}

export interface UpdatePromotionInput {
  name?: string;
  isActive?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  gifts?: PromotionGiftInput[];
}

function assertGift(g: PromotionGiftInput) {
  if (!Number.isFinite(g.minSubtotal) || g.minSubtotal <= 0) {
    throw AppError.invalid('Mốc tiền phải lớn hơn 0.');
  }
  if (!Number.isInteger(g.giftQuantity) || g.giftQuantity <= 0) {
    throw AppError.invalid('Số lượng quà phải là số nguyên dương.');
  }
  if (!g.productId || typeof g.productId !== 'string') {
    throw AppError.invalid('Thiếu sản phẩm quà.');
  }
}

async function assertProductsExist(gifts: PromotionGiftInput[]) {
  for (const g of gifts) {
    const rows = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, g.productId))
      .limit(1);
    if (!rows.length) throw AppError.invalid(`Sản phẩm quà không tồn tại: ${g.productId}`);
  }
}

export const PromotionService = {
  async list() {
    const campaigns = await db.select().from(promotions);
    const gifts = campaigns.length ? await db.select().from(promotionGifts) : [];
    return campaigns.map((c) => ({
      ...c,
      gifts: gifts
        .filter((g) => g.promotionId === c.id)
        .map((g) => ({
          id: g.id,
          minSubtotal: g.minSubtotal,
          productId: g.productId,
          giftQuantity: g.giftQuantity,
        })),
    }));
  },

  async create(input: CreatePromotionInput) {
    const name = String(input.name ?? '').trim();
    if (!name) throw AppError.invalid('Cần tên chương trình.');
    const gifts = input.gifts ?? [];
    if (!gifts.length) throw AppError.invalid('Cần ít nhất một dòng quà.');
    gifts.forEach(assertGift);
    await assertProductsExist(gifts);

    const id = `promo-${crypto.randomUUID()}`;
    await db.insert(promotions).values({
      id,
      name,
      isActive: input.isActive !== false,
      startsAt: input.startsAt || null,
      endsAt: input.endsAt || null,
    });
    for (const g of gifts) {
      await db.insert(promotionGifts).values({
        id: `pg-${crypto.randomUUID()}`,
        promotionId: id,
        minSubtotal: g.minSubtotal,
        productId: g.productId,
        giftQuantity: g.giftQuantity,
      });
    }
    return { id, name };
  },

  async update(id: string, input: UpdatePromotionInput) {
    const rows = await db.select().from(promotions).where(eq(promotions.id, id)).limit(1);
    if (!rows.length) throw AppError.invalid('Không tìm thấy chương trình.');
    if (input.name !== undefined) {
      const name = String(input.name).trim();
      if (!name) throw AppError.invalid('Cần tên chương trình.');
      await db.update(promotions).set({ name }).where(eq(promotions.id, id));
    }
    if (input.isActive !== undefined) {
      await db.update(promotions).set({ isActive: input.isActive }).where(eq(promotions.id, id));
    }
    if (input.startsAt !== undefined) {
      await db.update(promotions).set({ startsAt: input.startsAt || null }).where(eq(promotions.id, id));
    }
    if (input.endsAt !== undefined) {
      await db.update(promotions).set({ endsAt: input.endsAt || null }).where(eq(promotions.id, id));
    }
    if (input.gifts !== undefined) {
      if (!input.gifts.length) throw AppError.invalid('Cần ít nhất một dòng quà.');
      input.gifts.forEach(assertGift);
      await assertProductsExist(input.gifts);
      await db.delete(promotionGifts).where(eq(promotionGifts.promotionId, id));
      for (const g of input.gifts) {
        await db.insert(promotionGifts).values({
          id: `pg-${crypto.randomUUID()}`,
          promotionId: id,
          minSubtotal: g.minSubtotal,
          productId: g.productId,
          giftQuantity: g.giftQuantity,
        });
      }
    }
    return { id };
  },
};
