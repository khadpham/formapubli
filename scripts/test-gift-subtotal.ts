/**
 * scripts/test-gift-subtotal.ts — DÒNG QUÀ KHÔNG ĐƯỢC LÀM NHIỄM TIỀN ĐƠN.
 *
 * Bối cảnh: khuyến mại "quà tặng khi đơn đạt mốc tiền". Dòng quà là dòng
 * `order_items` có `is_gift_line = 1`, `unit_discount_rate = 1` ⇒ bán 0đ.
 *
 * Trước khi sửa, `OrderService.createOrder` cộng `priced.subtotal` của MỌI dòng
 * vào `calculatedSubtotal`, nên đơn 1 sách 500.000 + 1 quà giá bìa 300.000 ra:
 *   subtotal = 800.000, discountAmount = 300.000, finalAmount = 500.000
 * ⇒ `daily-settlement.service.ts:101-102` đọc đúng 2 cột này nên báo cáo cuối
 * ngày bịa ra 300.000đ "chiết khấu" dù khách không được giảm 1đ nào.
 *
 * Luật khoá ở đây:
 *  1. `subtotal` = giá bìa sách (tiền khách trả TRƯỚC chiết khấu, không gồm giá bìa quà)
 *  2. `discountAmount` = 0
 *  3. `finalAmount` = giá bìa sách
 *  4. Dòng quà vẫn nằm trong đơn, `is_gift_line = 1`, giá bán 0đ, thành tiền 0đ
 *  5. Dòng sách KHÔNG bị gắn cờ quà (is_gift_line = 0) — không miễn trần rò rỉ
 *
 * Cố ý KHÔNG assert tồn kho của món quà: phần B3=(b*) (quà hết tồn vẫn bán được
 * nhưng không ghi stock_balances) chưa làm, và nó nằm ngoài phạm vi 2 lỗi này.
 *
 * ⚠️ SERVER KHÔNG TIN CỜ `isGiftLine` TỪ CLIENT (`order.service.ts:616`): dòng
 * quà chỉ được bán 0đ khi nó nằm trong `promotions` + `promotion_gifts` đang bật
 * VÀ đơn đủ mốc tiền. Bản test cũ chỉ gửi cờ lên ⇒ dòng quà bị HẠ về dòng
 * thường, `subtotal` = 500.000 + 300.000 = 800.000, test đỏ 8 luật mà server
 * chạy ĐÚNG. Nay test tự dựng chiến dịch thật trước khi tạo đơn.
 *
 * ⚠️ KHÔNG hard-code giá. Mọi kỳ vọng về tiền đọc từ `products.selling_price`
 * trong DB, nên đổi giá danh mục sau này test không đỏ giả. Số tiền trong phần
 * mô tả lịch sử ở trên chỉ là ví dụ của lỗi đã gặp, không phải kỳ vọng.
 *
 * ⚠️ Dọn dẹp sau khi chạy: bản test cũ để lại `ed-gift-book` + `w-gift-book`
 * trong `editions`/`works` ⇒ `scripts/test-master-audit.ts` đỏ "Có đúng 89/88
 * ấn bản sách". Test này tự xoá mọi dòng nó tạo.
 */
import assert from 'node:assert';
import { createClient } from '@libsql/client';
import { OrderService } from '../src/services/order.service';
import { assertIsolatedTestDb } from './test-guard';

const DB = process.env.DATABASE_URL || 'file:formapubli_test.db';
const WH = 'wh-au-co';
const BOOK_ID = 'ed-gift-book';
const GIFT_ID = 'pr-gift-1';
const WORK_ID = 'w-gift-book';
const CAMP_ID = 'km-gift-subtotal';
const RULE_ID = 'kt-gift-subtotal';

/** Đọc từ DB sau khi chuẩn bị — KHÔNG hard-code. */
let BOOK_PRICE = 0;
let GIFT_PRICE = 0;

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
  console.log('=== TEST: DÒNG QUÀ KHÔNG NHIỄM subtotal / discountAmount ===\n');

  db = createClient({ url: DB });

  // --- Chuẩn bị: 1 sách + 1 món quà, cả hai đều có tồn -------------------
  //
  // Giá nhập lúc CHUẨN BỊ chỉ là giá trị khởi tạo; mọi kỳ vọng bên dưới đọc
  // lại từ DB. `INSERT OR IGNORE` nghĩa là lần chạy thứ 2 giữ giá của lần
  // chạy trước — đọc từ DB là cách duy nhất đúng khi đó.
  console.log('--- 1. Chuẩn bị sách + món quà, cả hai đều có tồn ---');
  const SEED_BOOK_PRICE = 500_000;
  const SEED_GIFT_PRICE = 300_000;
  await db.execute({ sql: `INSERT OR IGNORE INTO works (id,code,title,author) VALUES (?,?,?,?)`, args: [WORK_ID, 'W-GIFT', 'Sách mốc tiền', 'Tác giả'] });
  // `products` là tầng gốc (0032): sách có id TRÙNG `editions.id` + mirror products.
  await db.execute({
    sql: `INSERT OR IGNORE INTO products (id, name, product_kind, selling_price)
          VALUES (?, ?, 'BOOK', ?)`,
    args: [BOOK_ID, 'Sách mốc tiền', SEED_BOOK_PRICE],
  });
  await db.execute({
    sql: `INSERT OR IGNORE INTO editions (id,work_id,code,isbn,isbn_last4,cover_price)
          VALUES (?,?,?,?,?,?)`,
    args: [BOOK_ID, WORK_ID, 'GIFT-BOOK', '9780000000123', '3', SEED_BOOK_PRICE],
  });
  // Hàng hóa: chỉ có dòng `products`, KHÔNG có dòng `editions`.
  await db.execute({
    sql: `INSERT OR IGNORE INTO products (id, name, product_kind, selling_price, is_gift_item)
          VALUES (?, ?, 'GOODS', ?, 1)`,
    args: [GIFT_ID, 'Quà tặng mốc tiền', SEED_GIFT_PRICE],
  });
  // Sách: `edition_id` trỏ ấn bản. Hàng hóa: `edition_id = NULL` vì cột này vẫn còn
  // FK `editions(id)` (nullable ≠ bỏ FK) — xem migration 0032.
  for (const [id, editionId, qty] of [
    [BOOK_ID, BOOK_ID, 20],
    [GIFT_ID, null, 20],
  ] as Array<[string, string | null, number]>) {
    await db.execute({
      sql: `INSERT OR REPLACE INTO stock_balances (id,edition_id,product_id,warehouse_id,condition,physical_quantity)
            VALUES (?,?,?,?,'NEW',?)`,
      args: [`sb-gift-${id}`, editionId, id, WH, qty],
    });
  }

  // ⚠️ KHÔNG hard-code giá. `order.service.ts` định giá bằng
  // `products.selling_price`, nên đó mới là con số kỳ vọng.
  const priceRows = await q(
    `SELECT id, selling_price AS p FROM products WHERE id IN (?, ?)`,
    [BOOK_ID, GIFT_ID]
  );
  BOOK_PRICE = Number(priceRows.find((r) => r.id === BOOK_ID)?.p ?? 0);
  GIFT_PRICE = Number(priceRows.find((r) => r.id === GIFT_ID)?.p ?? 0);
  assert(BOOK_PRICE > 0 && GIFT_PRICE > 0, `Giá trong DB phải > 0 (sách=${BOOK_PRICE}, quà=${GIFT_PRICE}).`);
  const editionPrice = Number((await q1(`SELECT cover_price AS p FROM editions WHERE id = ?`, [BOOK_ID]))?.p ?? 0);
  assert(
    editionPrice === BOOK_PRICE,
    `editions.cover_price (${editionPrice}) phải khớp products.selling_price (${BOOK_PRICE}).`
  );

  // --- 1b. Chiến dịch khuyến mại THẬT --------------------------------------
  // `order.service.ts:552-596` chỉ cho bán 0đ khi dòng quà nằm trong bậc mà
  // `eligibleBase` (= tổng giá gốc dòng KHÔNG phải quà) đạt tới. Không có
  // `promotion_gifts` thì mọi dòng quà bị hạ về dòng thường ⇒ test đỏ vì
  // THIẾU DỮ LIỆU, không phải vì lỗi tiền.
  console.log('--- 1b. Dựng chiến dịch tặng quà (mốc = giá sách trong DB) ---');
  await db.execute({
    sql: `INSERT OR REPLACE INTO promotions (id, name, is_active) VALUES (?, ?, 1)`,
    args: [CAMP_ID, 'KM tặng quà — test subtotal'],
  });
  await db.execute({
    sql: `INSERT OR REPLACE INTO promotion_gifts (id, promotion_id, min_subtotal, product_id, gift_quantity)
          VALUES (?, ?, ?, ?, 1)`,
    args: [RULE_ID, CAMP_ID, BOOK_PRICE, GIFT_ID],
  });
  console.log(`    mốc tiền = ${BOOK_PRICE}đ (= giá 1 cuốn sách đọc từ DB); quà trị ${GIFT_PRICE}đ`);
  ok('chuẩn bị xong sách + món quà + chiến dịch', true);

  // --- 2. Tạo đơn: 1 sách + 1 dòng quà (bán 0đ) -----------------------------
  console.log('\n--- 2. createOrder với 1 sách + 1 dòng quà (isGiftLine) ---');
  const MANAGER: any = { staffId: 'staff-la', role: 'ROLE_MANAGER', fullName: 'Lan Anh' };
  let order: any = null;
  let err = '';
  try {
    order = await OrderService.createOrder({
      warehouseId: WH,
      channel: 'RETAIL_OFFICE',
      paymentMethod: 'CASH',
      // Đơn khuyến mại: KHÔNG có chiết khấu cấp đơn (discountRate = 0) — đúng
      // trường hợp thật, chỉ có dòng quà đi kèm.
      items: [
        { editionId: BOOK_ID, quantity: 1 },
        { editionId: GIFT_ID, quantity: 1, unitDiscountRate: 1, isGiftLine: true },
      ],
      idempotencyKey: `idem-gift-subtotal-${Date.now()}`,
      actorContext: MANAGER,
    });
  } catch (e: any) {
    err = `${e?.message || e}`;
  }
  ok('createOrder không ném lỗi', !!order?.orderId, err);
  if (!order) {
    console.log(`\n⛔ Không tạo được đơn ⇒ các luật tiền sau vô nghĩa. Lỗi: ${err}`);
    process.exit(1);
  }

  // --- 3. Tiền đơn: quà KHÔNG được cộng vào subtotal, cũng không sinh chiết khấu
  console.log('\n--- 3. Tiền đơn ---');
  ok(`subtotal = ${BOOK_PRICE} (KHÔNG cộng giá bìa quà)`, order.subtotal === BOOK_PRICE, `subtotal=${order.subtotal}`);
  ok('discountAmount = 0', order.discountAmount === 0, `discountAmount=${order.discountAmount}`);
  ok(`finalAmount = ${BOOK_PRICE}`, order.finalAmount === BOOK_PRICE, `finalAmount=${order.finalAmount}`);

  const row = await q1(
    'SELECT subtotal, discount_amount AS da, final_amount AS fa, status FROM orders WHERE id = ?',
    [order.orderId]
  );
  ok('đơn tồn tại trong DB', !!row);
  ok('đơn COMPLETED', row?.status === 'COMPLETED', `status=${row?.status}`);
  ok(`DB orders.subtotal = ${BOOK_PRICE}`, Number(row?.subtotal) === BOOK_PRICE, `subtotal=${row?.subtotal}`);
  ok('DB orders.discount_amount = 0', Number(row?.da) === 0, `discountAmount=${row?.da}`);
  ok(`DB orders.final_amount = ${BOOK_PRICE}`, Number(row?.fa) === BOOK_PRICE, `finalAmount=${row?.fa}`);

  // --- 4. Dòng quà vẫn nằm trong đơn, đúng cờ, giá bán 0đ -------------------
  console.log('\n--- 4. order_items: dòng quà gắn cờ và bán 0đ ---');
  const items = await q(
    `SELECT product_id AS pid, quantity AS qty, unit_cover_price AS cp,
            unit_discount_rate AS dr, unit_selling_price AS sp,
            total_amount AS ta, is_gift_line AS gl
       FROM order_items WHERE order_id = ?`,
    [order.orderId]
  );
  ok('đơn có đúng 2 dòng', items.length === 2, `thực tế=${items.length}`);
  const giftLine = items.find((i) => i.pid === GIFT_ID);
  const bookLine = items.find((i) => i.pid === BOOK_ID);
  ok('có dòng món quà', !!giftLine);
  ok('dòng quà có is_gift_line = 1', Number(giftLine?.gl) === 1, `is_gift_line=${giftLine?.gl}`);
  ok(`dòng quà giữ giá bìa ${GIFT_PRICE} (đọc từ DB)`, Number(giftLine?.cp) === GIFT_PRICE, `unit_cover_price=${giftLine?.cp}`);
  ok('dòng quà có unit_discount_rate = 1', Number(giftLine?.dr) === 1, `unit_discount_rate=${giftLine?.dr}`);
  ok('dòng quà bán giá 0đ', Number(giftLine?.sp) === 0, `unit_selling_price=${giftLine?.sp}`);
  ok('dòng quà có thành tiền 0đ', Number(giftLine?.ta) === 0, `total_amount=${giftLine?.ta}`);
  ok('dòng sách KHÔNG bị gắn cờ quà', Number(bookLine?.gl) === 0, `is_gift_line=${bookLine?.gl}`);

  // --- 5. Dọn dẹp: KHÔNG để lại dữ liệu làm đỏ test khác -----------------
  // Bản test cũ để lại `ed-gift-book` + `w-gift-book` ⇒ `test-master-audit.ts`
  // đỏ "Có đúng 89/88 ấn bản sách". Xoá theo thứ tự FK: con trước cha.
  console.log('\n--- 5. Dọn dẹp dữ liệu test ---');
  const ids = [BOOK_ID, GIFT_ID];
  const idList = ids.map(() => '?').join(',');
  async function del(label: string, sql: string, args: any[] = []) {
    try {
      await db.execute({ sql, args });
    } catch (e: any) {
      throw new Error(`dọn dẹp thất bại ở "${label}": ${e?.message || e}`);
    }
  }
  // Xoá theo ID THẬT của đơn vừa tạo — `inventory_ledger` không có
  // `order_id`, nên phải xoá theo `edition_id`/`product_id` thay vì theo đơn.
  await del('order_items của đơn', `DELETE FROM order_items WHERE order_id = ?`, [order.orderId]);
  await del('orders', `DELETE FROM orders WHERE id = ?`, [order.orderId]);
  // ⚠️ `idList` xuất hiện HAI lần trong các câu dưới ⇒ phải truyền args
  // HAI lần. Thiếu ⇒ SQLite bind NULL, mệnh đề `IN (NULL, …)` không khớp dòng
  // nào ⇒ `del` "thành công" mà không xoá gì. Đã dính đúng lỗi này một lần.
  await del('inventory_ledger theo id', `DELETE FROM inventory_ledger WHERE edition_id IN (${idList}) OR product_id IN (${idList})`, [...ids, ...ids]);
  await del('order_items theo id', `DELETE FROM order_items WHERE edition_id IN (${idList}) OR product_id IN (${idList})`, [...ids, ...ids]);
  await del('promotion_gifts', `DELETE FROM promotion_gifts WHERE promotion_id = ? OR product_id IN (${idList})`, [CAMP_ID, ...ids]);
  await del('promotions', `DELETE FROM promotions WHERE id = ?`, [CAMP_ID]);
  await del('stock_balances', `DELETE FROM stock_balances WHERE edition_id IN (${idList}) OR product_id IN (${idList})`, [...ids, ...ids]);
  await del('editions', `DELETE FROM editions WHERE id IN (${idList})`, ids);
  await del('works', `DELETE FROM works WHERE id = ?`, [WORK_ID]);
  await del('products', `DELETE FROM products WHERE id IN (${idList})`, ids);
  const left = await q(
    `SELECT (SELECT COUNT(*) FROM editions WHERE id IN (${idList})) +
            (SELECT COUNT(*) FROM products WHERE id IN (${idList})) +
            (SELECT COUNT(*) FROM works WHERE id = ?) +
            (SELECT COUNT(*) FROM promotions WHERE id = ?) AS n`,
    [...ids, WORK_ID, CAMP_ID]
  );
  ok('không còn dòng nào sót lại', Number(left[0]?.n) === 0, `còn=${left[0]?.n}`);
  const stock = await q(`SELECT physical_quantity AS q FROM stock_balances WHERE warehouse_id = ? AND condition = 'NEW' AND product_id IN (${idList})`, [WH, ...ids]);
  ok('không còn tồn kho của sản phẩm test', stock.length === 0, `còn ${stock.length} dòng tồn`);

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error('\n❌ test-gift-subtotal thất bại');
    process.exit(1);
  }
  console.log('\n✅ DÒNG QUÀ KHÔNG CỘNG VÀO TIỀN ĐƠN.');
  process.exit(0);
}

main().catch((e) => {
  console.error('\n❌', e?.message || e);
  process.exit(1);
});