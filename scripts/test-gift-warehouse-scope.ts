/**
 * scripts/test-gift-warehouse-scope.ts — QUÀ ĐÚNG KHO MỚI ĐƯỢC TẶNG.
 *
 * Chiến dịch gắn kho A thì đơn ở kho B KHÔNG được nhận quà (dòng quà bị hạ
 * về giá thường), đơn ở kho A vẫn nhận. Chặn rò rỉ khuyến mại giữa các hội chợ.
 *
 * Tự dựng dữ liệu riêng (pr-sc-...) và tự dọn sạch.
 */
import { createClient } from '@libsql/client';
import { OrderService } from '../src/services/order.service';
import { assertIsolatedTestDb } from './test-guard';

const DB = process.env.DATABASE_URL || 'file:formapubli_test.db';
const WA = 'wh-au-co';
const WB = 'wh-quynh-mai';
const BOOK_ID = 'pr-sc-book';
const GIFT_ID = 'pr-sc-gift';
const CAMP_ID = 'km-scope';
const RULE_ID = 'kt-scope';
const MANAGER: any = { staffId: 'staff-la', role: 'ROLE_MANAGER', fullName: 'Lan Anh' };

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
async function q1(sql: string, args: any[] = []) {
  const r = await db.execute({ sql, args });
  return r.rows[0] as any;
}

async function cleanup(orderIds: string[]) {
  for (const id of orderIds) {
    const o: any = await q1(`SELECT order_code c FROM orders WHERE id = ?`, [id]);
    if (o?.c) await q(`DELETE FROM inventory_ledger WHERE document_ref = ?`, [o.c]);
    await q(`DELETE FROM order_items WHERE order_id = ?`, [id]);
    await q(`DELETE FROM orders WHERE id = ?`, [id]);
  }
  await q(`DELETE FROM promotion_gifts WHERE id = ?`, [RULE_ID]);
  await q(`DELETE FROM promotions WHERE id = ?`, [CAMP_ID]);
  await q(`DELETE FROM stock_balances WHERE product_id IN (?,?)`, [BOOK_ID, GIFT_ID]);
  await q(`DELETE FROM editions WHERE id = ?`, [BOOK_ID]);
  await q(`DELETE FROM products WHERE id IN (?,?)`, [BOOK_ID, GIFT_ID]);
  await q(`DELETE FROM works WHERE id = ?`, ['w-sc-book']);
}

async function makeOrder(warehouseId: string, tag: string) {
  return OrderService.createOrder({
    warehouseId,
    channel: 'RETAIL_OFFICE',
    paymentMethod: 'CASH',
    items: [
      { editionId: BOOK_ID, quantity: 1 },
      { editionId: GIFT_ID, quantity: 1, unitDiscountRate: 1, isGiftLine: true },
    ],
    note: `SC-NOTE-${tag}`,
    idempotencyKey: `idem-sc-${tag}-${Date.now()}`,
    actorContext: MANAGER,
  });
}

async function main() {
  assertIsolatedTestDb(DB);
  console.log('=== TEST: quà đúng kho mới được tặng ===\n');
  db = createClient({ url: DB });
  await cleanup([]);

  console.log('--- 1. Dựng sách + quà + tồn 2 kho ---');
  await db.execute({ sql: `INSERT INTO works (id,code,title,author) VALUES (?,?,?,?)`, args: ['w-sc-book', 'W-SC', 'Sách scope', 'TG'] });
  await db.execute({ sql: `INSERT INTO products (id,name,product_kind,selling_price) VALUES (?,?,'BOOK',?)`, args: [BOOK_ID, 'Sách scope', 200000] });
  await db.execute({ sql: `INSERT INTO editions (id,work_id,code,isbn,isbn_last4,cover_price) VALUES (?,?,?,?,?,?)`, args: [BOOK_ID, 'w-sc-book', 'SC-BOOK', '9780000000333', '3', 200000] });
  await db.execute({ sql: `INSERT INTO products (id,code,name,product_kind,selling_price,is_gift_item) VALUES (?,?,?,'GOODS',?,1)`, args: [GIFT_ID, 'SP-SCTEST', 'Quà scope', 10000] });
  for (const wh of [WA, WB]) {
    await db.execute({ sql: `INSERT INTO stock_balances (id,edition_id,product_id,warehouse_id,condition,physical_quantity) VALUES (?,?,?,?,'NEW',20)`, args: [`sb-sc-b-${wh}`, BOOK_ID, BOOK_ID, wh] });
    await db.execute({ sql: `INSERT INTO stock_balances (id,edition_id,product_id,warehouse_id,condition,physical_quantity) VALUES (?,?,?,?,'NEW',20)`, args: [`sb-sc-g-${wh}`, null, GIFT_ID, wh] });
  }
  // Chiến dịch mốc 0 gắn KHO A.
  await db.execute({ sql: `INSERT INTO promotions (id,name,is_active,warehouse_id) VALUES (?,?,1,?)`, args: [CAMP_ID, 'KM scope', WA] });
  await db.execute({ sql: `INSERT INTO promotion_gifts (id,promotion_id,min_subtotal,product_id,gift_quantity) VALUES (?,?,0,?,1)`, args: [RULE_ID, CAMP_ID, GIFT_ID] });
  ok('dựng xong', true);

  console.log('\n--- 2. Đơn ở kho A (đúng kho) ⇒ quà 0đ ---');
  const orderA: any = await makeOrder(WA, 'A');
  const lineA = await q1(`SELECT is_gift_line g, total_amount t FROM order_items WHERE order_id = ? AND product_id = ?`, [orderA.orderId, GIFT_ID]);
  ok('kho A: quà 0đ', Number(lineA?.g) === 1 && Number(lineA?.t) === 0, JSON.stringify(lineA));

  console.log('\n--- 3. Đơn ở kho B (sai kho) ⇒ quà bị hạ, trả đủ tiền ---');
  const orderB: any = await makeOrder(WB, 'B');
  const lineB = await q1(`SELECT is_gift_line g, total_amount t FROM order_items WHERE order_id = ? AND product_id = ?`, [orderB.orderId, GIFT_ID]);
  ok('kho B: quà bị hạ về giá thường', Number(lineB?.g) === 0 && Number(lineB?.t) === 10000, JSON.stringify(lineB));

  await cleanup([orderA.orderId, orderB.orderId]);
  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) process.exit(1);
  console.log('✅ QUÀ ĐÚNG KHO.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
