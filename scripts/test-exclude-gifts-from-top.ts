/**
 * scripts/test-exclude-gifts-from-top.ts — KIỂM THỬ LOẠI BỎ QUÀ TẶNG KÈM KHỎI TOP BÁN CHẠY.
 *
 * Kiểm tra:
 * 1. Báo cáo chốt ngày (DailySettlementService):
 *    - Đơn có 1 Sách A (bán 1 cuốn), 1 Sách B (bán 2 cuốn), và 1 Bookmark (tặng kèm 5 chiếc, isGiftLine = true, giá 0đ).
 *    - `topSellers` CHỈ được chứa Sách B (2 cuốn) và Sách A (1 cuốn). Bookmark TUYỆT ĐỐI KHÔNG có trong topSellers.
 *    - `inventoryReconciliation` (đối soát tồn kho): Bookmark VẪN PHẢI ghi nhận `soldToday = 5` và trừ tồn lý thuyết đúng 5 chiếc.
 * 2. AnalyticsService.topEditions:
 *    - Mặc định Bookmark quà tặng không được có mặt trong danh sách top sách bán chạy.
 */

import assert from 'node:assert';
import { createClient } from '@libsql/client';
import { OrderService, businessDateOf } from '../src/services/order.service';
import { DailySettlementService } from '../src/services/daily-settlement.service';
import { AnalyticsService } from '../src/services/analytics.service';
import { assertIsolatedTestDb } from './test-guard';

const DB = process.env.DATABASE_URL || 'file:formapubli_test.db';
const WH = 'wh-test-gifts-top';
const BOOK_A = 'ed-test-book-a';
const BOOK_B = 'ed-test-book-b';
const BOOKMARK = 'pr-test-bookmark-gift';
const WORK_A = 'w-test-book-a';
const WORK_B = 'w-test-book-b';
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

async function cleanup(orderCodes: string[] = []) {
  for (const c of orderCodes) {
    const ords: any[] = await q(`SELECT id FROM orders WHERE order_code = ?`, [c]);
    for (const o of ords) {
      await q(`DELETE FROM order_items WHERE order_id = ?`, [o.id]);
      await q(`DELETE FROM inventory_ledger WHERE document_ref = ?`, [c]);
    }
    await q(`DELETE FROM orders WHERE order_code = ?`, [c]);
  }
  await q(`DELETE FROM stock_balances WHERE warehouse_id = ?`, [WH]);
  await q(`DELETE FROM editions WHERE id IN (?, ?)`, [BOOK_A, BOOK_B]);
  await q(`DELETE FROM products WHERE id IN (?, ?, ?)`, [BOOK_A, BOOK_B, BOOKMARK]);
  await q(`DELETE FROM works WHERE id IN (?, ?)`, [WORK_A, WORK_B]);
  await q(`DELETE FROM warehouses WHERE id = ?`, [WH]);
}

async function main() {
  assertIsolatedTestDb(DB);
  console.log('=== TEST: LOẠI BỎ QUÀ TẶNG KÈM KHỎI CÁC BẢNG TOP BÁN CHẠY ===\n');
  db = createClient({ url: DB });
  await cleanup();

  console.log('--- 1. Thiết lập kho, sách và quà tặng Bookmark ---');
  await db.execute({
    sql: `INSERT INTO warehouses (id, code, name, warehouse_type, is_sellable_on_pos, is_active)
          VALUES (?, 'KHO_TEST_GIFTS', 'Kho Test Gifts Top', 'FAIR_EVENT', 1, 1)`,
    args: [WH],
  });

  await db.execute({ sql: `INSERT INTO works (id, code, title, author) VALUES (?, 'W-TA', 'Sách A', 'Tác giả A')`, args: [WORK_A] });
  await db.execute({ sql: `INSERT INTO products (id, code, name, product_kind, selling_price) VALUES (?, 'BK-A', 'Sách A', 'BOOK', 100000)`, args: [BOOK_A] });
  await db.execute({ sql: `INSERT INTO editions (id, work_id, code, isbn, isbn_last4, cover_price) VALUES (?, ?, 'BK-A', '978000000001', '1', 100000)`, args: [BOOK_A, WORK_A] });

  await db.execute({ sql: `INSERT INTO works (id, code, title, author) VALUES (?, 'W-TB', 'Sách B', 'Tác giả B')`, args: [WORK_B] });
  await db.execute({ sql: `INSERT INTO products (id, code, name, product_kind, selling_price) VALUES (?, 'BK-B', 'Sách B', 'BOOK', 200000)`, args: [BOOK_B] });
  await db.execute({ sql: `INSERT INTO editions (id, work_id, code, isbn, isbn_last4, cover_price) VALUES (?, ?, 'BK-B', '978000000002', '2', 200000)`, args: [BOOK_B, WORK_B] });

  await db.execute({ sql: `INSERT INTO products (id, code, name, product_kind, selling_price) VALUES (?, 'SP-BM01', 'Bookmark Mùa Thu', 'GOODS', 5000)`, args: [BOOKMARK] });

  // Tồn ban đầu: 10 Sách A, 10 Sách B, 50 Bookmark
  await db.execute({ sql: `INSERT INTO stock_balances (id, edition_id, product_id, warehouse_id, condition, physical_quantity) VALUES (?, ?, ?, ?, 'NEW', 10)`, args: ['sb-ta', BOOK_A, BOOK_A, WH] });
  await db.execute({ sql: `INSERT INTO stock_balances (id, edition_id, product_id, warehouse_id, condition, physical_quantity) VALUES (?, ?, ?, ?, 'NEW', 10)`, args: ['sb-tb', BOOK_B, BOOK_B, WH] });
  await db.execute({ sql: `INSERT INTO stock_balances (id, edition_id, product_id, warehouse_id, condition, physical_quantity) VALUES (?, NULL, ?, ?, 'NEW', 50)`, args: ['sb-bm', BOOKMARK, WH] });
  ok('thiết lập dữ liệu ban đầu xong', true);

  console.log('\n--- 2. Tạo đơn hàng: Bán 1 Sách A, 2 Sách B, TẶNG KÈM 5 Bookmark (isGiftLine = true, giá 0đ) ---');
  const today = businessDateOf(new Date());
  const orderId = `ord-test-gift-${Date.now()}`;
  const orderCode = `ORD-${Date.now().toString().slice(-8)}`;

  const idempotencyKey = `idem-test-gift-${Date.now()}`;
  await db.execute({
    sql: `INSERT INTO orders (id, order_code, idempotency_key, warehouse_id, status, channel, payment_method, subtotal, discount_amount, final_amount, created_at)
          VALUES (?, ?, ?, ?, 'COMPLETED', 'FAIR_EVENT', 'CASH', 500000, 0, 500000, CURRENT_TIMESTAMP)`,
    args: [orderId, orderCode, idempotencyKey, WH],
  });

  // 1 cuốn Sách A
  await db.execute({
    sql: `INSERT INTO order_items (id, order_id, edition_id, product_id, quantity, unit_cover_price, unit_selling_price, total_amount, is_gift_line)
          VALUES (?, ?, ?, ?, 1, 100000, 100000, 100000, 0)`,
    args: [`item-1-${orderId}`, orderId, BOOK_A, BOOK_A],
  });

  // 2 cuốn Sách B
  await db.execute({
    sql: `INSERT INTO order_items (id, order_id, edition_id, product_id, quantity, unit_cover_price, unit_selling_price, total_amount, is_gift_line)
          VALUES (?, ?, ?, ?, 2, 200000, 200000, 400000, 0)`,
    args: [`item-2-${orderId}`, orderId, BOOK_B, BOOK_B],
  });

  // 5 chiếc Bookmark TẶNG KÈM (is_gift_line = 1, unit_selling_price = 0, total_amount = 0)
  await db.execute({
    sql: `INSERT INTO order_items (id, order_id, edition_id, product_id, quantity, unit_cover_price, unit_selling_price, total_amount, is_gift_line)
          VALUES (?, ?, NULL, ?, 5, 5000, 0, 0, 1)`,
    args: [`item-3-${orderId}`, orderId, BOOKMARK],
  });

  // Giả lập trừ tồn kho sau khi đơn hoàn tất
  await db.execute({ sql: `UPDATE stock_balances SET physical_quantity = physical_quantity - 1 WHERE product_id = ? AND warehouse_id = ?`, args: [BOOK_A, WH] });
  await db.execute({ sql: `UPDATE stock_balances SET physical_quantity = physical_quantity - 2 WHERE product_id = ? AND warehouse_id = ?`, args: [BOOK_B, WH] });
  await db.execute({ sql: `UPDATE stock_balances SET physical_quantity = physical_quantity - 5 WHERE product_id = ? AND warehouse_id = ?`, args: [BOOKMARK, WH] });

  ok('đơn hàng tạo thành công với 5 bookmark tặng kèm', true);

  console.log('\n--- 3. Kiểm tra Báo cáo chốt ngày (DailySettlementService) ---');
  const settlement: any = await DailySettlementService.getDailyFairSettlement({ warehouseId: WH, date: today });
  const topSellers: any[] = settlement.topSellers || [];

  console.log('  Top sellers nhận được:', topSellers.map((s) => `[${s.code}] ${s.title}: ${s.soldCopies} cuốn`));

  // Kiểm tra 1: Bookmark TUYỆT ĐỐI KHÔNG có trong topSellers
  const bookmarkInTop = topSellers.find((s) => s.code === 'SP-BM01' || s.editionId === BOOKMARK);
  ok('Bookmark quà tặng KHÔNG được nằm trong Top bán chạy', !bookmarkInTop, JSON.stringify(bookmarkInTop));

  // Kiểm tra 2: Sách B (bán 2 cuốn) phải đứng số 1
  ok('Sách B (bán 2 cuốn) phải đứng vị trí #1', topSellers[0]?.code === 'BK-B' && Number(topSellers[0]?.soldCopies) === 2);

  // Kiểm tra 3: Sách A (bán 1 cuốn) phải đứng vị trí #2
  ok('Sách A (bán 1 cuốn) phải đứng vị trí #2', topSellers[1]?.code === 'BK-A' && Number(topSellers[1]?.soldCopies) === 1);

  // Kiểm tra 4: Đối soát tồn kho (inventoryReconciliation) VẪN PHẢI TRỪ TỒN Bookmark
  const recon: any[] = settlement.inventoryReconciliation || [];
  const bookmarkRecon = recon.find((r) => r.editionId === BOOKMARK);
  ok('Bookmark vẫn có mặt trong bảng đối soát tồn kho', !!bookmarkRecon);
  if (bookmarkRecon) {
    ok('Bookmark ghi nhận đúng 5 chiếc đã xuất/tặng', Number(bookmarkRecon.soldToday) === 5);
    ok('Tồn lý thuyết Bookmark tính đúng 50 - 5 = 45 chiếc', Number(bookmarkRecon.theoreticalStock) === 45);
  }

  // Kiểm tra 5: Thống kê quà tặng đã phát (giftSummary) ghi nhận chính xác 5 Bookmark
  const giftSummary = settlement.giftSummary;
  ok('giftSummary ghi nhận đúng 5 phần quà', giftSummary?.totalGiftCopies === 5);
  ok('giftSummary danh sách chứa Bookmark', giftSummary?.items?.[0]?.code === 'SP-BM01' && giftSummary?.items?.[0]?.copies === 5);

  console.log('\n--- 4. Kiểm tra AnalyticsService.topEditions ---');
  const analyticsTop: any = await AnalyticsService.topEditions({ startDate: today, endDate: today }, 10, WH);
  const analyticsItems: any[] = analyticsTop.items || [];
  const bookmarkInAnalytics = analyticsItems.find((s) => s.code === 'SP-BM01' || s.editionId === BOOKMARK);
  ok('AnalyticsService.topEditions mặc định KHÔNG chứa Bookmark quà tặng', !bookmarkInAnalytics);

  await cleanup([orderCode]);

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error(`❌ CÓ ${fail} KIỂM THỬ THẤT BẠI!`);
    process.exit(1);
  }
  console.log('✅ TẤT CẢ KIỂM THỬ ĐÃ PASS HOÀN TOÀN.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
