/**
 * scripts/test-settlement-goods-display.ts — BÁO CÁO CHỐT NGÀY HIỆN ĐÚNG HÀNG HÓA.
 *
 * Lỗi thật trên production (ảnh chụp 02/10 tối): 4 dòng SP-001..004 hiện `[]`
 * và "Giá bìa: 0 đ" trong tab Kiểm Kê Đóng Thùng — vì báo cáo đối soát tồn chỉ
 * đọc `editions` (hàng hóa không có dòng editions nên mã/giá NULL).
 *
 * Luật khoá:
 *  1. Dòng hàng hóa hiện đúng mã SP-, đúng tên, đúng giá bán (không 0đ).
 *  2. `soldToday` của hàng hóa đếm đúng (khóa theo product_id, không gom nhầm
 *     mọi món vào một dòng NULL).
 *  3. Dòng sách không đổi: mã/tên/giá vẫn từ `editions`.
 *  4. `topSellers` cũng hiện đúng mã/tên hàng hóa.
 *
 * Tự dựng dữ liệu riêng (wh-settle-goods, ed/sg-...) và tự dọn sạch.
 */
import assert from 'node:assert';
import { createClient } from '@libsql/client';
import { OrderService, businessDateOf } from '../src/services/order.service';
import { DailySettlementService } from '../src/services/daily-settlement.service';
import { assertIsolatedTestDb } from './test-guard';

const DB = process.env.DATABASE_URL || 'file:formapubli_test.db';
const WH = 'wh-settle-goods';
const BOOK_ID = 'ed-sg-book';
const GIFT_ID = 'pr-sg-goods';
const WORK_ID = 'w-sg-book';
const MANAGER: any = { staffId: 'staff-la', role: 'ROLE_MANAGER', fullName: 'Lan Anh' };

const BOOK_PRICE = 100000;
const GOODS_PRICE = 15000;

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

async function cleanup(orderCodes: string[]) {
  for (const c of orderCodes) {
    const ords: any[] = await q(`SELECT id FROM orders WHERE order_code = ?`, [c]);
    for (const o of ords) {
      await q(`DELETE FROM order_items WHERE order_id = ?`, [o.id]);
      await q(`DELETE FROM inventory_ledger WHERE document_ref = ?`, [c]);
    }
    await q(`DELETE FROM orders WHERE order_code = ?`, [c]);
  }
  await q(`DELETE FROM stock_balances WHERE warehouse_id = ?`, [WH]);
  await q(`DELETE FROM editions WHERE id = ?`, [BOOK_ID]);
  await q(`DELETE FROM products WHERE id IN (?,?)`, [BOOK_ID, GIFT_ID]);
  await q(`DELETE FROM works WHERE id = ?`, [WORK_ID]);
  await q(`DELETE FROM warehouses WHERE id = ?`, [WH]);
}

async function main() {
  assertIsolatedTestDb(DB);
  console.log('=== TEST: báo cáo chốt ngày hiện đúng hàng hóa ===\n');
  db = createClient({ url: DB });
  await cleanup([]);

  console.log('--- 1. Dựng kho + sách + hàng hóa + tồn ---');
  await db.execute({ sql: `INSERT INTO warehouses (id,code,name,warehouse_type,is_sellable_on_pos,is_active) VALUES (?,?,'Kho settlement goods','FAIR_EVENT',1,1)`, args: [WH, 'KHO_SG'] });
  await db.execute({ sql: `INSERT INTO works (id,code,title,author) VALUES (?,?,?,?)`, args: [WORK_ID, 'W-SG', 'Sách SG', 'TG'] });
  await db.execute({ sql: `INSERT INTO products (id,name,product_kind,selling_price) VALUES (?,?,'BOOK',?)`, args: [BOOK_ID, 'Sách SG', BOOK_PRICE] });
  await db.execute({ sql: `INSERT INTO editions (id,work_id,code,isbn,isbn_last4,cover_price) VALUES (?,?,?,?,?,?)`, args: [BOOK_ID, WORK_ID, 'SG-BOOK', '9780000000222', '2', BOOK_PRICE] });
  await db.execute({ sql: `INSERT INTO products (id,code,name,product_kind,selling_price) VALUES (?,?,?,'GOODS',?)`, args: [GIFT_ID, 'SP-SGTEST', 'Hàng SG', GOODS_PRICE] });
  await db.execute({ sql: `INSERT INTO stock_balances (id,edition_id,product_id,warehouse_id,condition,physical_quantity) VALUES (?,?,?,?,'NEW',10)`, args: [`sb-sg-b`, BOOK_ID, BOOK_ID, WH] });
  await db.execute({ sql: `INSERT INTO stock_balances (id,edition_id,product_id,warehouse_id,condition,physical_quantity) VALUES (?,?,?,?,'NEW',10)`, args: [`sb-sg-g`, null, GIFT_ID, WH] });
  ok('dựng xong', true);

  console.log('\n--- 2. Bán 2 sách + 3 hàng hóa ---');
  const order: any = await OrderService.createOrder({
    warehouseId: WH,
    channel: 'RETAIL_OFFICE',
    paymentMethod: 'CASH',
    items: [
      { editionId: BOOK_ID, quantity: 2 },
      { editionId: GIFT_ID, quantity: 3 },
    ],
    note: 'SG-NOTE',
    idempotencyKey: `idem-sg-${Date.now()}`,
    actorContext: MANAGER,
  });
  ok('tạo đơn thành công', !!order?.orderId);

  console.log('\n--- 3. Báo cáo chốt ngày ---');
  const today = businessDateOf(new Date());
  const report: any = await DailySettlementService.getDailyFairSettlement({ warehouseId: WH, date: today });
  const rows: any[] = report.inventoryReconciliation || [];
  const goodsRow = rows.find((r) => r.editionId === GIFT_ID);
  const bookRow = rows.find((r) => r.editionId === BOOK_ID);

  ok('có dòng hàng hóa (không mất, không gom NULL)', !!goodsRow, JSON.stringify(goodsRow));
  if (goodsRow) {
    ok('mã hàng hóa đúng SP-SGTEST', goodsRow.code === 'SP-SGTEST', `code=${goodsRow.code}`);
    ok('tên hàng hóa đúng', goodsRow.title === 'Hàng SG', `title=${goodsRow.title}`);
    ok('giá hàng hóa đúng 15.000 (không 0đ)', Number(goodsRow.coverPrice) === GOODS_PRICE, `price=${goodsRow.coverPrice}`);
    ok('đã bán 3', Number(goodsRow.soldToday) === 3, `sold=${goodsRow.soldToday}`);
    ok('tồn lý thuyết 7', Number(goodsRow.theoreticalStock) === 7, `stock=${goodsRow.theoreticalStock}`);
    ok('loại GOODS để UI ghi "Giá bán"', goodsRow.productKind === 'GOODS', `kind=${goodsRow.productKind}`);
  }
  ok('dòng sách vẫn từ editions', !!bookRow && bookRow.code === 'SG-BOOK' && Number(bookRow.coverPrice) === BOOK_PRICE, JSON.stringify(bookRow));

  const top: any[] = report.topSellers || [];
  const topGoods = top.find((s) => s.editionId === GIFT_ID);
  ok('top bán chạy hiện đúng mã/tên hàng hóa', !!topGoods && topGoods.code === 'SP-SGTEST' && Number(topGoods.soldCopies) === 3, JSON.stringify(topGoods));

  await cleanup([order.orderCode]);
  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) process.exit(1);
  console.log('✅ BÁO CÁO HIỆN ĐÚNG HÀNG HÓA.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
