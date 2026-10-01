/**
 * scripts/test-gift-shortfall.ts — B3: QUÀ HẾT TỒN KHÔNG CHẶN ĐƠN.
 *
 * Trước đây: quà trong bậc đạt được nhưng hết tồn ⇒ cả đơn chết ATP. Giờ:
 *  1. Đơn vẫn tạo (201/COMPLETED), dòng quà mang cờ `is_gift_shortfall = 1`.
 *  2. `stock_balances` của quà KHÔNG bị trừ (và không bị tạo dòng mới âm).
 *  3. `inventory_ledger` VẪN ghi nhận bút toán DISPATCH_SALE (hàng đã ra).
 *  4. Quà CÒN tồn: đường cũ — trừ `stock_balances`, `is_gift_shortfall = 0`.
 *
 * Dữ liệu dựng bằng sản phẩm/kho GIẢ riêng (pr-gift-short, ed-short-book) và
 * tự dọn sạch; đọc giá từ DB như mọi test khác, không hard-code tiền.
 */
import assert from 'node:assert';
import { createClient } from '@libsql/client';
import { OrderService } from '../src/services/order.service';
import { assertIsolatedTestDb } from './test-guard';

const DB = process.env.DATABASE_URL || 'file:formapubli_test.db';
const WH = 'wh-au-co';
const BOOK_ID = 'ed-short-book';
const GIFT_ID = 'pr-gift-short';
const WORK_ID = 'w-short-book';
const CAMP_ID = 'km-gift-shortfall';
const RULE_ID = 'kt-gift-shortfall';

let BOOK_PRICE = 0;
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
async function q1(sql: string, args: any[] = []) {
  const r = await db.execute({ sql, args });
  return r.rows[0] as any;
}
async function q(sql: string, args: any[] = []) {
  const r = await db.execute({ sql, args });
  return r.rows as any[];
}

async function main() {
  assertIsolatedTestDb(DB);
  console.log('=== TEST: B3 — quà hết tồn vẫn bán được, ghi sổ nhưng không trừ bảng cân đối ===\n');
  db = createClient({ url: DB });

  console.log('--- 1. Dựng sách + quà HẾT TỒN + chiến dịch ---');
  await db.execute({ sql: `INSERT OR IGNORE INTO works (id,code,title,author) VALUES (?,?,?,?)`, args: [WORK_ID, 'W-SHORT', 'Sách shortfall', 'Tác giả'] });
  await db.execute({ sql: `INSERT OR IGNORE INTO products (id, name, product_kind, selling_price) VALUES (?,?,'BOOK',?)`, args: [BOOK_ID, 'Sách shortfall', 100000] });
  await db.execute({ sql: `INSERT OR IGNORE INTO editions (id,work_id,code,isbn,isbn_last4,cover_price) VALUES (?,?,?,?,?,?)`, args: [BOOK_ID, WORK_ID, 'SHORT-BOOK', '9780000000999', '9', 100000] });
  await db.execute({ sql: `INSERT OR IGNORE INTO products (id, name, product_kind, selling_price, is_gift_item) VALUES (?,?,'GOODS',?,1)`, args: [GIFT_ID, 'Quà hết tồn', 5000] });
  // Chỉ nạp tồn cho SÁCH, KHÔNG có dòng stock_balances cho quà ⇒ quà hết tồn.
  await db.execute({ sql: `INSERT OR REPLACE INTO stock_balances (id,edition_id,product_id,warehouse_id,condition,physical_quantity) VALUES (?,?,?,?,'NEW',20)`, args: [`sb-short-book`, BOOK_ID, BOOK_ID, WH] });

  const priceRow = await q1(`SELECT selling_price AS p FROM products WHERE id = ?`, [BOOK_ID]);
  BOOK_PRICE = Number(priceRow?.p ?? 0);
  assert(BOOK_PRICE > 0, 'Giá sách phải > 0');

  await db.execute({ sql: `INSERT OR REPLACE INTO promotions (id,name,is_active) VALUES (?,?,1)`, args: [CAMP_ID, 'KM shortfall'] });
  await db.execute({ sql: `INSERT OR REPLACE INTO promotion_gifts (id,promotion_id,min_subtotal,product_id,gift_quantity) VALUES (?,?,?,?,1)`, args: [RULE_ID, CAMP_ID, BOOK_PRICE, GIFT_ID] });
  ok('dựng dữ liệu xong', true);

  console.log('\n--- 2. createOrder khi quà hết tồn ---');
  const MANAGER: any = { staffId: 'staff-la', role: 'ROLE_MANAGER', fullName: 'Lan Anh' };
  let order: any = null;
  let err = '';
  try {
    order = await OrderService.createOrder({
      warehouseId: WH,
      channel: 'RETAIL_OFFICE',
      paymentMethod: 'CASH',
      items: [
        { editionId: BOOK_ID, quantity: 1 },
        { editionId: GIFT_ID, quantity: 1, unitDiscountRate: 1, isGiftLine: true },
      ],
      idempotencyKey: `idem-gift-shortfall-${Date.now()}`,
      actorContext: MANAGER,
    });
  } catch (e: any) {
    err = `${e?.message || e}`;
  }
  ok('createOrder không ném lỗi', !!order?.orderId, err);
  if (!order) process.exit(1);

  const giftLine = await q1(
    `SELECT is_gift_shortfall AS s, is_gift_line AS g, unit_discount_rate AS r FROM order_items WHERE order_id = ? AND product_id = ?`,
    [order.orderId, GIFT_ID]
  );
  ok('dòng quà có is_gift_shortfall = 1', Number(giftLine?.s) === 1, `s=${giftLine?.s}`);
  ok('dòng quà giữ is_gift_line = 1, rate = 1', Number(giftLine?.g) === 1 && Number(giftLine?.r) === 1);

  const stockRow = await q1(`SELECT physical_quantity AS q FROM stock_balances WHERE product_id = ? AND warehouse_id = ?`, [GIFT_ID, WH]);
  ok('stock_balances của quà KHÔNG bị trừ', stockRow === undefined, JSON.stringify(stockRow));

  const ledgerRow = await q1(
    `SELECT event_type AS t, quantity_delta AS d, note AS n FROM inventory_ledger WHERE product_id = ? AND document_ref = ?`,
    [GIFT_ID, order.orderCode]
  );
  ok('ledger CÓ bút toán DISPATCH_SALE cho quà', !!ledgerRow && ledgerRow.t === 'DISPATCH_SALE' && Number(ledgerRow.d) === -1, JSON.stringify(ledgerRow));

  // Sách VẪN trừ bình thường.
  const bookStock = await q1(`SELECT physical_quantity AS q FROM stock_balances WHERE product_id = ? AND warehouse_id = ?`, [BOOK_ID, WH]);
  ok('sách vẫn trừ stock_balances (20 → 19)', Number(bookStock?.q) === 19, `q=${bookStock?.q}`);

  // --- Dọn dẹp ---
  await q(`DELETE FROM inventory_ledger WHERE document_ref = ?`, [order.orderCode]);
  await q(`DELETE FROM order_items WHERE order_id = ?`, [order.orderId]);
  await q(`DELETE FROM orders WHERE id = ?`, [order.orderId]);
  await q(`DELETE FROM promotion_gifts WHERE id = ?`, [RULE_ID]);
  await q(`DELETE FROM promotions WHERE id = ?`, [CAMP_ID]);
  await q(`DELETE FROM stock_balances WHERE product_id = ?`, [BOOK_ID]);
  await q(`DELETE FROM editions WHERE id = ?`, [BOOK_ID]);
  await q(`DELETE FROM products WHERE id IN (?,?)`, [BOOK_ID, GIFT_ID]);
  await q(`DELETE FROM works WHERE id = ?`, [WORK_ID]);

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) process.exit(1);
  console.log('✅ B3 ĐÚNG: quà hết tồn không chặn đơn, ghi sổ, không trừ bảng cân đối.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
