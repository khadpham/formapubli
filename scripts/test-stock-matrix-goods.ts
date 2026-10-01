/**
 * scripts/test-stock-matrix-goods.ts — MA TRẬN KHO + SỔ CÁI HIỆN HÀNG HÓA.
 *
 * Lỗi thật 02/10: `getStockMatrix` duyệt `FROM editions` nên 4 món SP tồn 100
 * vô hình trên tab kho, `books` của POS thiếu hàng hóa ⇒ quà không resolve
 * được ⇒ không tự vào giỏ/đơn/sổ. `getLedgerHistory` INNER JOIN editions nên
 * bút toán hàng hóa mất hẳn khỏi sổ cái.
 *
 * Luật khoá:
 *  1. Matrix có dòng hàng hóa: đúng mã SP-, tên, giá bán, tồn theo kho.
 *  2. Dòng sách không đổi: mã/tên/giá từ `editions`.
 *  3. Sổ cái hiện bút toán hàng hóa với mã/tên (không mất dòng, không rỗng).
 *
 * Tự dựng dữ liệu riêng (mx-...) và tự dọn sạch.
 */
import { createClient } from '@libsql/client';
import { InventoryService } from '../src/services/inventory.service';
import { assertIsolatedTestDb } from './test-guard';

const DB = process.env.DATABASE_URL || 'file:formapubli_test.db';
const WH = 'wh-au-co';
const BOOK_ID = 'ed-mx-book';
const GOODS_ID = 'pr-mx-goods';

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

async function cleanup() {
  await q(`DELETE FROM inventory_ledger WHERE product_id IN (?,?)`, [BOOK_ID, GOODS_ID]);
  await q(`DELETE FROM stock_balances WHERE product_id IN (?,?)`, [BOOK_ID, GOODS_ID]);
  await q(`DELETE FROM editions WHERE id = ?`, [BOOK_ID]);
  await q(`DELETE FROM products WHERE id IN (?,?)`, [BOOK_ID, GOODS_ID]);
  await q(`DELETE FROM works WHERE id = ?`, ['w-mx-book']);
}

async function main() {
  assertIsolatedTestDb(DB);
  console.log('=== TEST: ma trận kho + sổ cái hiện hàng hóa ===\n');
  db = createClient({ url: DB });
  await cleanup();

  await db.execute({ sql: `INSERT INTO works (id,code,title,author) VALUES (?,?,?,?)`, args: ['w-mx-book', 'W-MX', 'Sách MX', 'TG'] });
  await db.execute({ sql: `INSERT INTO products (id,name,product_kind,selling_price) VALUES (?,?,'BOOK',?)`, args: [BOOK_ID, 'Sách MX', 100000] });
  await db.execute({ sql: `INSERT INTO editions (id,work_id,code,isbn,isbn_last4,cover_price) VALUES (?,?,?,?,?,?)`, args: [BOOK_ID, 'w-mx-book', 'MX-BOOK', '9780000000444', '4', 100000] });
  await db.execute({ sql: `INSERT INTO products (id,code,name,product_kind,selling_price) VALUES (?,?,?,'GOODS',?)`, args: [GOODS_ID, 'SP-MXTEST', 'Hàng MX', 15000] });
  await db.execute({ sql: `INSERT INTO stock_balances (id,edition_id,product_id,warehouse_id,condition,physical_quantity) VALUES (?,?,?,?,'NEW',10)`, args: ['sb-mx-b', BOOK_ID, BOOK_ID, WH] });
  await db.execute({ sql: `INSERT INTO stock_balances (id,edition_id,product_id,warehouse_id,condition,physical_quantity) VALUES (?,?,?,?,'NEW',10)`, args: ['sb-mx-g', null, GOODS_ID, WH] });
  await InventoryService.recordMovement({
    editionId: GOODS_ID, isBook: false, warehouseId: WH, eventType: 'RECEIPT',
    quantityDelta: 5, condition: 'NEW', documentRef: 'MX-DOC',
    idempotencyKey: `idem-mx-${Date.now()}`, actorId: 'system',
  });

  console.log('--- 1. Ma trận kho ---');
  const matrix: any[] = await InventoryService.getStockMatrix();
  const goods = matrix.find((r) => r.id === GOODS_ID);
  const book = matrix.find((r) => r.id === BOOK_ID);
  ok('matrix có dòng hàng hóa', !!goods, JSON.stringify(goods));
  if (goods) {
    ok('mã SP đúng', goods.code === 'SP-MXTEST', `code=${goods.code}`);
    ok('tên đúng', goods.title === 'Hàng MX', `title=${goods.title}`);
    ok('giá đúng 15.000', Number(goods.coverPrice) === 15000, `price=${goods.coverPrice}`);
    ok('tồn kho hiện đúng (10 + 5 nhập)', Number(goods.totalStock) === 15, `stock=${goods.totalStock}`);
  }
  ok('dòng sách giữ nguyên từ editions', !!book && book.code === 'MX-BOOK' && Number(book.coverPrice) === 100000, JSON.stringify({ code: book?.code, price: book?.coverPrice }));

  console.log('\n--- 2. Sổ cái ---');
  const history: any[] = await InventoryService.getLedgerHistory(200);
  const gl = history.find((h) => h.documentRef === 'MX-DOC');
  ok('sổ cái giữ bút toán hàng hóa', !!gl, 'mất dòng = INNER JOIN cũ');
  if (gl) {
    ok('mã đúng SP-MXTEST', gl.bookCode === 'SP-MXTEST', `code=${gl.bookCode}`);
    ok('tên đúng Hàng MX', gl.bookTitle === 'Hàng MX', `title=${gl.bookTitle}`);
  }

  await cleanup();
  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) process.exit(1);
  console.log('✅ MA TRẬN + SỔ CÁI HIỆN ĐÚNG HÀNG HÓA.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
