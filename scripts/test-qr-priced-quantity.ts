/**
 * scripts/test-qr-priced-quantity.ts — {SL} TRÊN QR PHẢI TRỪ QUÀ KHUYẾN MẠI.
 *
 * Lỗi thật 02/10/2026: mua 1 quyển + tặng 1 quà ⇒ nội dung chuyển khoản ghi
 * "2cuon". Nguyên nhân: `createOrder` trả `totalQuantity` = tổng MỌI dòng
 * (gồm quà), POS lấy nó làm `orderQuantity` cho {SL}.
 *
 * Luật khoá ở đây:
 *  1. Đơn 1 sách + 1 quà ⇒ `totalQuantity` = 2 (giữ nguyên ngữ nghĩa cũ),
 *     `pricedQuantity` = 1 (số MUA, vào {SL}).
 *  2. Đơn không quà ⇒ `pricedQuantity` = `totalQuantity`.
 *  3. Dòng quà giả (không trong chiến dịch) bị hạ về thường ⇒ vẫn tính vào
 *     `pricedQuantity` (server tự xác minh cờ, không tin client).
 *
 * Tự dựng + tự dọn dữ liệu của mình (tiền tố qr-pq-), không đụng seed chung.
 */
import assert from 'node:assert';
import { createClient } from '@libsql/client';
import { OrderService } from '../src/services/order.service';
import { assertIsolatedTestDb } from './test-guard';

const DB = process.env.DATABASE_URL || 'file:formapubli_test.db';
const WH = 'wh-au-co';
const BOOK_ID = 'ed-qr-pq-book';
const GIFT_ID = 'pr-qr-pq-gift';
const WORK_ID = 'w-qr-pq-book';
const CAMP_ID = 'km-qr-pq';
const RULE_ID = 'kt-qr-pq';

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
async function main() {
  assertIsolatedTestDb(DB);
  console.log('=== TEST: pricedQuantity trừ quà khuyến mại ===\n');
  db = createClient({ url: DB });
  const ex = (sql: string, args: any[] = []) => db.execute({ sql, args });

  await ex(`INSERT OR IGNORE INTO works (id,code,title,author) VALUES (?,?,?,?)`, [WORK_ID, 'W-QR-PQ', 'Sách QR', 'TG']);
  await ex(`INSERT OR IGNORE INTO products (id, name, product_kind, selling_price) VALUES (?, ?, 'BOOK', ?)`, [
    BOOK_ID,
    'Sách QR',
    100000,
  ]);
  await ex(`INSERT OR IGNORE INTO editions (id,work_id,code,isbn,isbn_last4,cover_price) VALUES (?,?,?,?,?,?)`, [
    BOOK_ID,
    WORK_ID,
    'QR-PQ-BOOK',
    '9780000000999',
    '9',
    100000,
  ]);
  await ex(`INSERT OR IGNORE INTO products (id, name, product_kind, selling_price, is_gift_item) VALUES (?, ?, 'GOODS', ?, 1)`, [
    GIFT_ID,
    'Quà QR',
    50000,
  ]);
  for (const [id, editionId] of [
    [BOOK_ID, BOOK_ID],
    [GIFT_ID, null],
  ] as Array<[string, string | null]>) {
    await ex(
      `INSERT OR REPLACE INTO stock_balances (id,edition_id,product_id,warehouse_id,condition,physical_quantity) VALUES (?,?,?,?,'NEW',20)`,
      [`sb-qr-pq-${id}`, editionId, id, WH]
    );
  }
  await ex(`INSERT OR REPLACE INTO promotions (id, name, is_active) VALUES (?, ?, 1)`, [CAMP_ID, 'KM QR test']);
  await ex(
    `INSERT OR REPLACE INTO promotion_gifts (id, promotion_id, min_subtotal, product_id, gift_quantity) VALUES (?, ?, ?, ?, 1)`,
    [RULE_ID, CAMP_ID, 100000, GIFT_ID]
  );

  const MANAGER: any = { staffId: 'staff-la', role: 'ROLE_MANAGER', fullName: 'Lan Anh' };

  // 1. Đơn 1 sách + 1 quà thật
  const o1: any = await OrderService.createOrder({
    warehouseId: WH,
    channel: 'RETAIL_OFFICE',
    paymentMethod: 'CASH',
    items: [
      { editionId: BOOK_ID, quantity: 1 },
      { editionId: GIFT_ID, quantity: 1, unitDiscountRate: 1, isGiftLine: true },
    ],
    idempotencyKey: `idem-qr-pq-1-${Date.now()}`,
    actorContext: MANAGER,
  });
  ok('totalQuantity = 2 (gồm quà, giữ nguyên)', o1.totalQuantity === 2, `totalQuantity=${o1.totalQuantity}`);
  ok('pricedQuantity = 1 (trừ quà, vào {SL})', (o1 as any).pricedQuantity === 1, `pricedQuantity=${(o1 as any).pricedQuantity}`);

  // 2. Đơn không quà
  const o2: any = await OrderService.createOrder({
    warehouseId: WH,
    channel: 'RETAIL_OFFICE',
    paymentMethod: 'CASH',
    items: [{ editionId: BOOK_ID, quantity: 3 }],
    idempotencyKey: `idem-qr-pq-2-${Date.now()}`,
    actorContext: MANAGER,
  });
  ok('đơn không quà: pricedQuantity = totalQuantity = 3', o2.totalQuantity === 3 && (o2 as any).pricedQuantity === 3, `t=${o2.totalQuantity} p=${(o2 as any).pricedQuantity}`);

  // 3. Quà giả (không trong chiến dịch) ⇒ hạ về dòng thường ⇒ vẫn tính
  const o3: any = await OrderService.createOrder({
    warehouseId: WH,
    channel: 'RETAIL_OFFICE',
    paymentMethod: 'CASH',
    items: [
      { editionId: BOOK_ID, quantity: 1 },
      { editionId: BOOK_ID, quantity: 1, unitDiscountRate: 1, isGiftLine: true },
    ],
    idempotencyKey: `idem-qr-pq-3-${Date.now()}`,
    actorContext: MANAGER,
  });
  ok('quà giả bị hạ về thường: pricedQuantity = 2', (o3 as any).pricedQuantity === 2, `pricedQuantity=${(o3 as any).pricedQuantity}`);

  // --- Dọn: xoá mọi dòng mình tạo (giữ seed chung nguyên vẹn) ---
  for (const o of [o1, o2, o3]) {
    await ex(`DELETE FROM order_items WHERE order_id = ?`, [o.orderId]);
    await ex(`DELETE FROM inventory_ledger WHERE correlation_id = ?`, [o.orderId]);
    await ex(`DELETE FROM orders WHERE id = ?`, [o.orderId]);
    await ex(`DELETE FROM audit_logs WHERE details LIKE ?`, [`%${o.orderCode}%`]);
  }
  await ex(`DELETE FROM promotion_gifts WHERE id = ?`, [RULE_ID]);
  await ex(`DELETE FROM promotions WHERE id = ?`, [CAMP_ID]);
  await ex(`DELETE FROM stock_balances WHERE id LIKE 'sb-qr-pq-%'`);
  await ex(`DELETE FROM editions WHERE id = ?`, [BOOK_ID]);
  await ex(`DELETE FROM products WHERE id IN (?, ?)`, [BOOK_ID, GIFT_ID]);
  await ex(`DELETE FROM works WHERE id = ?`, [WORK_ID]);

  console.log(`\n${pass} pass / ${fail} fail`);
  assert(fail === 0, `${fail} luật đỏ`);
  process.exit(fail === 0 ? 0 : 1);
}
main().then(
  () => {},
  (e) => {
    console.error('TEST CRASH:', e?.message || e);
    process.exit(1);
  }
);
