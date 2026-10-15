/**
 * scripts/test-combo-service.ts - ton combo = min(ton thanh phan / yeu cau).
 *
 * Khoa loi:
 * 1. expandComboNeeds: dong combo x2 voi 2 thanh phan -> 2 dong component (qty x2),
 *    dong thuong giu nguyen, ma la khong no.
 * 2. getComboStocks: min logic (A ton 5/yeu cau 2 = 2, B ton 3/yeu cau 1 = 3 -> combo = 2).
 * 3. isCombo: true voi combo co thanh phan, false voi ma la/sach le.
 * 4. Combo khong co thanh phan -> stock 0.
 *
 * Tu dung du lieu: combo + sach fixture (prefix cb-test-/ed-test-), tu xoa sau khi chay.
 * Chay: DATABASE_URL=file:formapubli_test.db npx tsx scripts/test-combo-service.ts
 * (hoac qua scripts/run-isolated.ts).
 */
import fs from 'node:fs';
import assert from 'node:assert';
import { createClient } from '@libsql/client';
import { assertIsolatedTestDb } from './test-guard';
import {
  expandComboNeeds,
  getComboStock,
  getComboStocks,
  isCombo,
} from '../src/services/combo.service';

assertIsolatedTestDb('test-combo-service');

const DB = process.env.DATABASE_URL || 'file:formapubli_test.db';
const db = createClient({ url: DB });

const COMBO_ID = 'cb-test-combo-01';
const BOOK_A = 'ed-test-book-a';
const BOOK_B = 'ed-test-book-b';
const PLAIN_ID = 'ed-test-plain';

let pass = 0;
function ok(label: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  PASS: ${label}`);
  } else {
    console.log(`  FAIL: ${label}`);
    process.exitCode = 1;
  }
}

async function setup() {
  const mig = fs.readFileSync('src/db/migrations/0064_combo_components.sql', 'utf8');
  for (const stmt of mig.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) {
    try {
      await db.execute(stmt);
    } catch (e: any) {
      if (!String(e?.message || e).includes('already exists')) throw e;
    }
  }
  await db.execute({
    sql: 'INSERT OR IGNORE INTO products (id, code, name, product_kind, selling_price) VALUES (?, ?, ?, ?, ?)',
    args: [COMBO_ID, 'COMBO-TEST-01', 'Combo Test 01', 'BOOK', 100000],
  });
  await db.execute({
    sql: 'INSERT OR IGNORE INTO products (id, name, product_kind, selling_price) VALUES (?, ?, ?, ?)',
    args: [BOOK_A, 'Sach Test A', 'BOOK', 50000],
  });
  await db.execute({
    sql: 'INSERT OR IGNORE INTO products (id, name, product_kind, selling_price) VALUES (?, ?, ?, ?)',
    args: [BOOK_B, 'Sach Test B', 'BOOK', 60000],
  });
  await db.execute({
    sql: 'INSERT OR IGNORE INTO products (id, name, product_kind, selling_price) VALUES (?, ?, ?, ?)',
    args: [PLAIN_ID, 'Sach Le Test', 'BOOK', 40000],
  });
  await db.execute({
    sql: 'INSERT OR IGNORE INTO combo_components (id, combo_product_id, component_product_id, quantity) VALUES (?, ?, ?, ?)',
    args: ['cc-test-1', COMBO_ID, BOOK_A, 2],
  });
  await db.execute({
    sql: 'INSERT OR IGNORE INTO combo_components (id, combo_product_id, component_product_id, quantity) VALUES (?, ?, ?, ?)',
    args: ['cc-test-2', COMBO_ID, BOOK_B, 1],
  });
  const wh = await db.execute('SELECT id FROM warehouses LIMIT 1');
  const warehouseId = (wh.rows[0] as any).id as string;
  await db.execute({
    sql: `INSERT OR REPLACE INTO stock_balances (id, product_id, warehouse_id, condition, physical_quantity)
          VALUES (?, ?, ?, 'NEW', ?)`,
    args: ['sb-test-a', BOOK_A, warehouseId, 5],
  });
  await db.execute({
    sql: `INSERT OR REPLACE INTO stock_balances (id, product_id, warehouse_id, condition, physical_quantity)
          VALUES (?, ?, ?, 'NEW', ?)`,
    args: ['sb-test-b', BOOK_B, warehouseId, 3],
  });
  return warehouseId;
}

async function cleanup() {
  await db.execute({ sql: 'DELETE FROM combo_components WHERE combo_product_id = ?', args: [COMBO_ID] });
  await db.execute({ sql: "DELETE FROM stock_balances WHERE id IN ('sb-test-a', 'sb-test-b')", args: [] });
  await db.execute({
    sql: 'DELETE FROM products WHERE id IN (?, ?, ?, ?)',
    args: [COMBO_ID, BOOK_A, BOOK_B, PLAIN_ID],
  });
  db.close();
}

async function main() {
  const warehouseId = await setup();
  try {
    // 1. expand
    const expanded = await expandComboNeeds([
      { productId: COMBO_ID, quantity: 2 },
      { productId: PLAIN_ID, quantity: 1 },
      { productId: 'no-such-id', quantity: 1 },
    ]);
    ok(
      'expand combo x2 thanh 2 dong component (4, 2)',
      expanded.some((e) => e.productId === BOOK_A && e.quantity === 4 && e.fromComboId === COMBO_ID) &&
        expanded.some((e) => e.productId === BOOK_B && e.quantity === 2 && e.fromComboId === COMBO_ID)
    );
    ok(
      'dong thuong + ma la giu nguyen',
      expanded.some((e) => e.productId === PLAIN_ID && e.quantity === 1 && e.fromComboId === null) &&
        expanded.some((e) => e.productId === 'no-such-id' && e.quantity === 1)
    );

    // 2. min logic: A 5/2=2, B 3/1=3 -> combo 2
    const stocks = await getComboStocks([COMBO_ID], warehouseId);
    const s = stocks.get(COMBO_ID);
    ok('combo stock = min (2)', s?.stock === 2);
    ok('components du ten + ton', (s?.components.length || 0) === 2);

    // 3. isCombo
    ok('isCombo true', await isCombo(COMBO_ID));
    ok('isCombo false sach le', !(await isCombo(PLAIN_ID)));

    // 4. combo rong
    const empty = await getComboStock(PLAIN_ID, warehouseId);
    ok('combo rong stock 0', empty.stock === 0 && empty.components.length === 0);

    console.log(`Combo service test: ${pass} xanh.`);
  } finally {
    await cleanup();
  }
  if (process.exitCode === 1) {
    console.error('Combo service test: CO DO.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
