import { eq, and, or, like, desc, sql } from 'drizzle-orm';
import { db } from '@/db';
import { products, editions } from '@/db/schema';
import { AppError } from './app-error';

/**
 * Sản phẩm (migration 0031/0032).
 *
 * TẦNG GỐC chung cho sách và hàng hóa. Sách đã có sẵn ở `works`/`editions` và
 * được mirror sang `products` với `id` TRÙNG `editions.id` — nên phần lớn mã ở
 * đây lo phần HÀNG HÓA: tạo, sửa, tìm, quét mã vạch.
 *
 * `code` CHỈ dành cho hàng hóa (`SP-0001`). Sách giữ mã ở `editions.code` —
 * copy sang `products` sẽ tạo hai nguồn sự thật cho cùng một SKU, và
 * `migrate-book-skus.ts` đã từng đổi `editions.code` (H01 → HH001).
 * Vì vậy mỗi khi so trùng mã hàng hóa, ta kiểm tra CẢ `editions.code`.
 */

export const GOODS_CODE_PREFIX = 'SP-';

export type ProductKind = 'BOOK' | 'GOODS';

export interface CreateProductInput {
  code?: string | null;
  name: string;
  kind?: ProductKind;
  sellingPrice: number;
  costPrice?: number | null;
  barcode?: string | null;
  description?: string | null;
  isGiftItem?: boolean;
}

export interface UpdateProductInput {
  name?: string;
  sellingPrice?: number;
  costPrice?: number | null;
  barcode?: string | null;
  description?: string | null;
  isGiftItem?: boolean;
  isActive?: boolean;
}

/** EAN-13: 13 chữ số. Mã vạch sách (ISBN-13) cũng là EAN-13 nên không loại trừ. */
function normalizeBarcode(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).replace(/[\s-]/g, '');
  if (!s) return null;
  if (!/^\d{13}$/.test(s)) {
    throw AppError.invalid('Mã vạch phải đúng 13 chữ số (EAN-13).');
  }
  return s;
}

/** Mã hàng hóa phải có tiền tố SP- để không trùng dãi mã sách (H01, HH042…). */
function normalizeCode(raw: string | null | undefined, required: boolean): string | null {
  if (raw == null || String(raw).trim() === '') {
    if (required) throw AppError.invalid('Thiếu mã sản phẩm.');
    return null;
  }
  const s = String(raw).trim().toUpperCase();
  if (!s.startsWith(GOODS_CODE_PREFIX)) {
    throw AppError.invalid(
      `Mã hàng hóa phải bắt đầu bằng "${GOODS_CODE_PREFIX}" để không trùng mã sách.`
    );
  }
  if (!/^SP-[A-Z0-9-]{1,20}$/.test(s)) {
    throw AppError.invalid('Mã sản phẩm chỉ gồm chữ in hoa, số và dấu gạch ngang.');
  }
  return s;
}

/**
 * Chặn trùng mã ở TẦNG ỨNG DỤNG, không đợi UNIQUE constraint.
 * UNIQUE chỉ bắt được trùng trong `products`, còn mã sách nằm ở `editions` —
 * một hàng hóa tên `H01` sẽ đâm thẳng vào dãi mã sách mà UNIQUE không thấy.
 */
async function assertCodeFree(code: string, excludeId?: string) {
  const [inGoods, inBooks] = await Promise.all([
    db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.code, code))
      .limit(1),
    db
      .select({ id: editions.id })
      .from(editions)
      .where(eq(editions.code, code))
      .limit(1),
  ]);
  const clash = inGoods[0] || inBooks[0];
  if (clash && clash.id !== excludeId) {
    const where = inBooks[0] ? 'mã sách' : 'mã hàng hóa';
    throw AppError.conflict(`Mã "${code}" đã có ở ${where}.`);
  }
}

async function assertBarcodeFree(barcode: string | null, excludeId?: string) {
  if (!barcode) return;
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.barcode, barcode))
    .limit(1);
  if (rows[0] && rows[0].id !== excludeId) {
    throw AppError.conflict(`Mã vạch ${barcode} đã gán cho sản phẩm khác.`);
  }
}

function assertPrice(value: number, label: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw AppError.invalid(`${label} không hợp lệ.`);
  }
  // Giá tiền Việt Nam không có phần thập phân; làm tròn để tránh lệch 0.5đ do
  // Math.round ở pricing.ts rồi lệch so với giá hiện trên hóa đơn.
  return Math.round(n);
}

export const ProductService = {
  async create(input: CreateProductInput) {
    const name = String(input.name || '').trim();
    if (!name) throw AppError.invalid('Thiếu tên sản phẩm.');

    const code = normalizeCode(input.code, true);
    const barcode = normalizeBarcode(input.barcode);
    // `await` là BẮT BUỘC ở cả hai. Thiếu `await` ở `assertCodeFree` khiến lời
    // gọi chạy nền, lỗi bay vào hư không, và UNIQUE của DB phải đỡ thay — người
    // dùng nhận thông báo kỹ thuật. `test-products.ts` khoá đúng điểm này.
    await assertCodeFree(code!);
    await assertBarcodeFree(barcode);

    const row = {
      // Hàng hóa dùng `pr-` để không chạm namespace `ed-` của sách.
      id: `pr-${crypto.randomUUID()}`,
      code,
      name,
      productKind: input.kind === 'BOOK' ? 'BOOK' : 'GOODS',
      sellingPrice: assertPrice(input.sellingPrice, 'Giá bán'),
      costPrice: input.costPrice == null ? null : assertPrice(input.costPrice, 'Giá vốn'),
      barcode,
      description: input.description ? String(input.description).trim() : null,
      isGiftItem: input.isGiftItem ?? false,
      isActive: true,
    };
    await db.insert(products).values(row);
    return row;
  },

  async update(id: string, input: UpdateProductInput) {
    const existing = await db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);
    if (!existing[0]) throw AppError.invalid('Không tìm thấy sản phẩm.');

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = String(input.name).trim();
      if (!name) throw AppError.invalid('Tên sản phẩm không được để trống.');
      patch.name = name;
    }
    if (input.sellingPrice !== undefined) {
      patch.sellingPrice = assertPrice(input.sellingPrice, 'Giá bán');
    }
    if (input.costPrice !== undefined) {
      patch.costPrice =
        input.costPrice === null ? null : assertPrice(input.costPrice, 'Giá vốn');
    }
    if (input.barcode !== undefined) {
      const barcode = normalizeBarcode(input.barcode);
      await assertBarcodeFree(barcode, id);
      patch.barcode = barcode;
    }
    if (input.description !== undefined) {
      patch.description = input.description ? String(input.description).trim() : null;
    }
    if (input.isGiftItem !== undefined) patch.isGiftItem = input.isGiftItem;
    if (input.isActive !== undefined) patch.isActive = input.isActive;

    if (Object.keys(patch).length === 0) return existing[0];
    await db.update(products).set(patch).where(eq(products.id, id));
    const after = await db.select().from(products).where(eq(products.id, id)).limit(1);
    return after[0];
  },

  /** Danh sách hàng hóa (kind = GOODS). Sách xem ở màn hình ấn bản như cũ. */
  async listGoods(opts: { search?: string; includeInactive?: boolean; limit?: number } = {}) {
    const conds = [eq(products.productKind, 'GOODS')];
    if (!opts.includeInactive) conds.push(eq(products.isActive, true));
    if (opts.search?.trim()) {
      const q = `%${opts.search.trim()}%`;
      conds.push(or(like(products.name, q), like(products.code, q), like(products.barcode, q))!);
    }
    return db
      .select()
      .from(products)
      .where(and(...conds))
      .orderBy(desc(products.createdAt))
      .limit(Math.min(500, Math.max(1, opts.limit ?? 200)));
  },

  /**
   * Tra theo mã vạch. POS quét EAN-13 — sách khớp qua `editions.isbn`/`code`,
   * hàng hóa qua `products.barcode`. Hai bên có thể trùng EAN (bút/túi bán kèm
   * sách) nên hàm này KHÔNG tự quyết, caller phải xử lý khi ra >1 kết quả.
   */
  async findByBarcode(barcode: string) {
    const code = String(barcode || '').replace(/[\s-]/g, '');
    if (!/^\d{13}$/.test(code)) return [];
    return db
      .select()
      .from(products)
      .where(and(eq(products.barcode, code), eq(products.isActive, true)))
      .limit(5);
  },

  async countGoods() {
    const r = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(products)
      .where(eq(products.productKind, 'GOODS'));
    return Number(r[0]?.n || 0);
  },
};