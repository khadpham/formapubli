import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { promotions, promotionGifts, products, warehouses } from '@/db/schema';
import { AppError } from './app-error';

/**
 * Chương trình khuyến mại (migration 0031).
 *
 * Mô hình BẬC THANG - các dòng `promotion_gifts` CÙNG `min_subtotal` là cùng
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
  /** NULL/undefined = mọi kho; có giá trị = chỉ kho đó (0034). */
  warehouseId?: string | null;
  gifts: PromotionGiftInput[];
}

export interface UpdatePromotionInput {
  name?: string;
  isActive?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  warehouseId?: string | null;
  gifts?: PromotionGiftInput[];
}

/** Ngày kết thúc phải sau ngày bắt đầu (so tuyệt đối, chấp nhận mọi múi giờ ISO). */
function assertWindow(startsAt?: string | null, endsAt?: string | null) {
  if (!startsAt || !endsAt) return;
  const s = new Date(startsAt).getTime();
  const e = new Date(endsAt).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e)) {
    throw AppError.invalid('Ngày bắt đầu / kết thúc không đúng định dạng.');
  }
  if (e <= s) {
    throw AppError.invalid('Ngày kết thúc phải sau ngày bắt đầu.');
  }
}

async function assertWarehouse(warehouseId?: string | null) {
  if (!warehouseId) return;
  const rows = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.id, warehouseId)).limit(1);
  if (!rows.length) throw AppError.invalid('Kho áp dụng không tồn tại.');
}

function assertGift(g: PromotionGiftInput) {
  // Mốc 0 = "đơn bất kỳ cũng tặng" (vd đơn < 300k tặng Bookmark). Engine chỉ
  // kích hoạt mốc 0 khi đơn có tiền thật nên đơn quà-only 0đ không lọt.
  // Chỉ chặn số âm / không phải số.
  if (!Number.isFinite(g.minSubtotal) || g.minSubtotal < 0) {
    throw AppError.invalid('Mốc tiền không được âm.');
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
    return this.shape(campaigns);
  },

  /** Chiến dịch áp dụng cho một kho: toàn hệ thống (warehouse_id NULL) + riêng kho đó. */
  async listForWarehouse(warehouseId: string) {
    const campaigns = await db.select().from(promotions);
    return this.shape(
      campaigns.filter((c) => !c.warehouseId || c.warehouseId === warehouseId)
    );
  },

  async shape(campaigns: Array<typeof promotions.$inferSelect>) {
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
    assertWindow(input.startsAt, input.endsAt);
    await assertWarehouse(input.warehouseId);

    const id = `promo-${crypto.randomUUID()}`;
    // Bọc transaction: lỗi giữa vòng lặp không được để lại campaign THIẾU quà.
    await db.transaction(async (tx) => {
      await tx.insert(promotions).values({
        id,
        name,
        isActive: input.isActive !== false,
        startsAt: input.startsAt || null,
        endsAt: input.endsAt || null,
        warehouseId: input.warehouseId || null,
      });
      for (const g of gifts) {
        await tx.insert(promotionGifts).values({
          id: `pg-${crypto.randomUUID()}`,
          promotionId: id,
          minSubtotal: g.minSubtotal,
          productId: g.productId,
          giftQuantity: g.giftQuantity,
        });
      }
    });
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
    if (input.startsAt !== undefined || input.endsAt !== undefined) {
      const nextStart = input.startsAt !== undefined ? input.startsAt : rows[0].startsAt;
      const nextEnd = input.endsAt !== undefined ? input.endsAt : rows[0].endsAt;
      assertWindow(nextStart, nextEnd);
    }
    if (input.startsAt !== undefined) {
      await db.update(promotions).set({ startsAt: input.startsAt || null }).where(eq(promotions.id, id));
    }
    if (input.endsAt !== undefined) {
      await db.update(promotions).set({ endsAt: input.endsAt || null }).where(eq(promotions.id, id));
    }
    if (input.warehouseId !== undefined) {
      await assertWarehouse(input.warehouseId);
      await db.update(promotions).set({ warehouseId: input.warehouseId || null }).where(eq(promotions.id, id));
    }
    if (input.gifts !== undefined) {
      const nextGifts = input.gifts;
      if (!nextGifts.length) throw AppError.invalid('Cần ít nhất một dòng quà.');
      nextGifts.forEach(assertGift);
      await assertProductsExist(nextGifts);
      // Bọc transaction: xoá-rồi-chèn-lại; lỗi giữa chừng KHÔNG được để campaign
      // mất SẠCH quà (trước đây delete xong chèn lỗi là campaign rỗng).
      await db.transaction(async (tx) => {
        await tx.delete(promotionGifts).where(eq(promotionGifts.promotionId, id));
        for (const g of nextGifts) {
          await tx.insert(promotionGifts).values({
            id: `pg-${crypto.randomUUID()}`,
            promotionId: id,
            minSubtotal: g.minSubtotal,
            productId: g.productId,
            giftQuantity: g.giftQuantity,
          });
        }
      });
    }
    return { id };
  },
};
