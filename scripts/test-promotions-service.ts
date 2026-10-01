/**
 * scripts/test-promotions-service.ts — CRUD cấu hình khuyến mại.
 *
 * Khoá lại các luật:
 *  1. Tạo chương trình + dòng quà thành công, list trả đúng cấu trúc.
 *  2. Mốc ≤ 0, số lượng không nguyên ⇒ bị chặn (không ghi DB).
 *  3. Sản phẩm quà không tồn tại ⇒ bị chặn.
 *  4. Update gifts THAY THẾ toàn bộ dòng cũ (không trộn).
 *  5. Tắt chương trình (isActive=false) làm quà biến mất khỏi tính quà
 *     (engine nhận campaign đã tắt ⇒ không tặng).
 *
 * Tự dựng dữ liệu: 1 sản phẩm quà tạm (pr-test-promo-ui), tự xoá sau khi chạy.
 */
import assert from 'node:assert';
import { createClient } from '@libsql/client';
import { PromotionService } from '../src/services/promotion.service';
import { computeGifts } from '../src/lib/promotion-engine';
import { assertIsolatedTestDb } from './test-guard';

const DB = process.env.DATABASE_URL || 'file:formapubli_test.db';
const PRODUCT_ID = 'pr-test-promo-ui';
const CAMP_ID_PATTERN = 'promo-test-ui-';

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ FAIL: ${label}${extra ? ` — ${extra}` : ''}`);
  }
}

let db: any;
async function q(sql: string, args: any[] = []) {
  const r = await db.execute({ sql, args });
  return r.rows as any[];
}

async function main() {
  assertIsolatedTestDb(DB);
  console.log('=== TEST: PromotionService CRUD ===\n');
  db = createClient({ url: DB });

  // Dọn dữ liệu cũ nếu có (từ lần chạy trước bị chết giữa chừng).
  await q(`DELETE FROM promotion_gifts WHERE promotion_id LIKE ?`, [`${CAMP_ID_PATTERN}%`]);
  await q(`DELETE FROM promotions WHERE id LIKE ?`, [`${CAMP_ID_PATTERN}%`]);
  await q(`DELETE FROM products WHERE id = ?`, [PRODUCT_ID]);

  // Dựng 1 sản phẩm quà tạm.
  await q(
    `INSERT INTO products (id, name, product_kind, selling_price, is_gift_item, is_active, code)
     VALUES (?, ?, 'GOODS', 10000, 1, 1, 'SP-TESTPROMOUI')`,
    [PRODUCT_ID, 'Quà test UI']
  );

  // 1. Tạo thành công.
  const created = await PromotionService.create({
    name: `${CAMP_ID_PATTERN}mốc 500k`,
    gifts: [{ minSubtotal: 500000, productId: PRODUCT_ID, giftQuantity: 1 }],
  });
  ok('Tạo chương trình thành công', typeof created.id === 'string' && created.id.startsWith('promo-'));

  let all = await PromotionService.list();
  let mine = all.find((c: any) => c.id === created.id);
  ok('list trả đúng 1 dòng quà, mốc 500.000', !!mine && mine.gifts.length === 1 && mine.gifts[0].minSubtotal === 500000);

  // 2. Mốc âm bị chặn; mốc 0 ("đơn bất kỳ") hợp lệ.
  let blocked = false;
  try {
    await PromotionService.create({ name: 'x', gifts: [{ minSubtotal: -1, productId: PRODUCT_ID, giftQuantity: 1 }] });
  } catch {
    blocked = true;
  }
  ok('Mốc âm bị chặn', blocked);

  const zeroCamp = await PromotionService.create({
    name: `${CAMP_ID_PATTERN}moc 0`,
    gifts: [{ minSubtotal: 0, productId: PRODUCT_ID, giftQuantity: 1 }],
  });
  ok('Mốc 0 ("đơn bất kỳ") được chấp nhận', typeof zeroCamp.id === 'string');
  const zeroGifts = computeGifts({
    eligibleBase: 50000,
    campaigns: (await PromotionService.list())
      .filter((c: any) => c.id === zeroCamp.id)
      .map((c: any) => ({ id: c.id, name: c.name, isActive: c.isActive, gifts: c.gifts })),
  });
  ok('Mốc 0 từ DB: đơn 50k được tặng', zeroGifts.length === 1 && zeroGifts[0].productId === PRODUCT_ID);
  await q(`DELETE FROM promotion_gifts WHERE promotion_id = ?`, [zeroCamp.id]);
  await q(`DELETE FROM promotions WHERE id = ?`, [zeroCamp.id]);

  blocked = false;
  try {
    await PromotionService.create({ name: 'x', gifts: [{ minSubtotal: 500000, productId: PRODUCT_ID, giftQuantity: 1.5 }] });
  } catch {
    blocked = true;
  }
  ok('Số lượng 1.5 bị chặn', blocked);

  blocked = false;
  try {
    await PromotionService.create({ name: 'x', gifts: [{ minSubtotal: 500000, productId: 'khong-ton-tai', giftQuantity: 1 }] });
  } catch {
    blocked = true;
  }
  ok('Sản phẩm không tồn tại bị chặn', blocked);

  // 3. Update gifts thay thế toàn bộ.
  await PromotionService.update(created.id, {
    gifts: [
      { minSubtotal: 800000, productId: PRODUCT_ID, giftQuantity: 2 },
      { minSubtotal: 1200000, productId: PRODUCT_ID, giftQuantity: 3 },
    ],
  });
  all = await PromotionService.list();
  mine = all.find((c: any) => c.id === created.id);
  ok('Update thay thế: 2 dòng mới, không còn dòng cũ', !!mine && mine.gifts.length === 2 && !mine.gifts.some((g: any) => g.minSubtotal === 500000));

  // 4. Engine không tặng khi đã tắt.
  await PromotionService.update(created.id, { isActive: false });
  const gifts = computeGifts({
    eligibleBase: 2000000,
    campaigns: (await PromotionService.list())
      .filter((c: any) => c.id === created.id)
      .map((c: any) => ({ id: c.id, name: c.name, isActive: c.isActive, gifts: c.gifts })),
  });
  ok('Tắt chương trình ⇒ engine không tặng gì', gifts.length === 0);

  // Dọn dẹp.
  await q(`DELETE FROM promotion_gifts WHERE promotion_id = ?`, [created.id]);
  await q(`DELETE FROM promotions WHERE id = ?`, [created.id]);
  await q(`DELETE FROM products WHERE id = ?`, [PRODUCT_ID]);

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) process.exit(1);
  console.log('✅ PromotionService ĐÚNG.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
