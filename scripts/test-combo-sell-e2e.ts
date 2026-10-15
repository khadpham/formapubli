/**
 * scripts/test-combo-sell-e2e.ts - BAN THAT 1 combo (COMBO = dong products binh thuong).
 *
 * Khoa loi:
 * 1. createOrder voi dong combo (productId combo) tao duoc don COMPLETED.
 * 2. Tien don = so bo x gia combo (khong phai gia component).
 * 3. stock_balances giam DUNG component: A -2, B -4 (ban 2 bo, B x2/bo).
 * 4. inventory_ledger co DISPATCH_SALE cho A (-2) va B (-4), documentRef = ma don.
 * 5. KHONG co but toan nao cho chinh combo (combo khong co ton rieng).
 * 6. Ban vuot ton component phai bi chan (loi ATP), don KHONG tao, ton KHONG doi.
 *
 * Chay: DATABASE_URL=file:formapubli_test.db npx tsx scripts/test-combo-sell-e2e.ts
 */
import { createClient } from '@libsql/client';
import fs from 'node:fs';
import { OrderService } from '../src/services/order.service';
import { assertIsolatedTestDb } from './test-guard';

const DB = process.env.DATABASE_URL || 'file:formapubli_test.db';
const WH = 'wh-au-co';
const COMBO_ID = 'cb-e2e-combo-01';
const BOOK_A = 'ed-e2e-cb-a';
const BOOK_B = 'ed-e2e-cb-b';
const COMBO_PRICE = 150000;

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, extra = '') {
  if (cond) {
    pass++;
    console.log(`  PASS: ${label}`);
  } else {
    fail++;
    console.log(`  FAIL: ${label}${extra ? ` - ${extra}` : ''}`);
  }
}

let db: any;
async function q(sql: string, args: any[] = []) {
  return (await db.execute({ sql, args })).rows as any[];
}
async function bal(productId: string): Promise<number> {
  const rows = await q(
    `SELECT physical_quantity AS c FROM stock_balances WHERE product_id = ? AND warehouse_id = ? AND condition = 'NEW'`,
    [productId, WH]
  );
  return rows.length > 0 ? Number(rows[0].c) : 0;
}

async function main() {
  assertIsolatedTestDb(DB);
  console.log('=== TEST: BAN COMBO END-TO-END QUA OrderService.createOrder ===\n');
  db = createClient({ url: DB });
  const MANAGER: any = { staffId: 'staff-la', role: 'ROLE_MANAGER', fullName: 'Lan Anh' };

  const mig = fs.readFileSync('src/db/migrations/0064_combo_components.sql', 'utf8');
  for (const stmt of mig.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) {
    try {
      await db.execute(stmt);
    } catch (e: any) {
      if (!String(e?.message || e).includes('already exists')) throw e;
    }
  }
  await q('INSERT OR IGNORE INTO products (id, code, name, product_kind, selling_price) VALUES (?, ?, ?, ?, ?)', [
    COMBO_ID,
    'COMBO-E2E-01',
    'Combo E2E 01',
    'BOOK',
    COMBO_PRICE,
  ]);
  await q('INSERT OR IGNORE INTO products (id, name, product_kind, selling_price) VALUES (?, ?, ?, ?)', [
    BOOK_A,
    'Sach E2E A',
    'BOOK',
    50000,
  ]);
  await q('INSERT OR IGNORE INTO products (id, name, product_kind, selling_price) VALUES (?, ?, ?, ?)', [
    BOOK_B,
    'Sach E2E B',
    'BOOK',
    60000,
  ]);
  // Sach that luon co dong works + editions (products.id === editions.id).
  await q("INSERT OR IGNORE INTO works (id, code, title, author) VALUES ('w-e2e-cb', 'W-E2E-CB', 'Tac pham E2E', 'Tac gia E2E')");
  for (const [bid, code] of [
    [BOOK_A, 'E2E-CB-A'],
    [BOOK_B, 'E2E-CB-B'],
  ] as Array<[string, string]>) {
    await q('INSERT OR IGNORE INTO editions (id, code, work_id, isbn, isbn_last4, cover_price) VALUES (?, ?, ?, ?, ?, ?)', [
      bid,
      code,
      'w-e2e-cb',
      '9780000000000',
      '0000',
      50000,
    ]);
  }
  await q('INSERT OR IGNORE INTO combo_components (id, combo_product_id, component_product_id, quantity) VALUES (?, ?, ?, ?)', [
    'cc-e2e-1',
    COMBO_ID,
    BOOK_A,
    1,
  ]);
  await q('INSERT OR IGNORE INTO combo_components (id, combo_product_id, component_product_id, quantity) VALUES (?, ?, ?, ?)', [
    'cc-e2e-2',
    COMBO_ID,
    BOOK_B,
    2,
  ]);
  await q(
    `INSERT OR REPLACE INTO stock_balances (id, product_id, warehouse_id, condition, physical_quantity)
     VALUES ('sb-e2e-cb-a', ?, ?, 'NEW', 6)`,
    [BOOK_A, WH]
  );
  await q(
    `INSERT OR REPLACE INTO stock_balances (id, product_id, warehouse_id, condition, physical_quantity)
     VALUES ('sb-e2e-cb-b', ?, ?, 'NEW', 6)`,
    [BOOK_B, WH]
  );

  // --- 1+2. Ban 2 bo ---
  let order: any = null;
  let sellError = '';
  try {
    order = await OrderService.createOrder({
      warehouseId: WH,
      channel: 'RETAIL_OFFICE',
      paymentMethod: 'CASH',
      items: [{ editionId: COMBO_ID, quantity: 2 }],
      idempotencyKey: `idem-e2e-combo-${Date.now()}`,
      actorContext: MANAGER,
    });
    ok('createOrder combo tra ve don', !!order?.orderId, `orderId=${order?.orderId}`);
  } catch (e: any) {
    sellError = `${e?.message || e}`;
    ok('createOrder combo KHONG nem loi', false, sellError);
  }
  if (!order) {
    console.log(`\nKHONG BAN DUOC combo - loi day du: ${sellError}`);
    process.exit(1);
  }
  const ordRow = (await q('SELECT status, final_amount AS fa, order_code AS code FROM orders WHERE id = ?', [order.orderId]))[0];
  ok('don COMPLETED', ordRow?.status === 'COMPLETED', `status=${ordRow?.status}`);
  ok('tien don = 2 x 150000', Number(ordRow?.fa) === 2 * COMBO_PRICE, `fa=${ordRow?.fa}`);

  // --- 3. Ton component giam dung ---
  ok('A 6-2=4', (await bal(BOOK_A)) === 4, `A=${await bal(BOOK_A)}`);
  ok('B 6-4=2', (await bal(BOOK_B)) === 2, `B=${await bal(BOOK_B)}`);

  // --- 4+5. But toan ---
  const ledgers = await q(
    `SELECT product_id AS p, quantity_delta AS d FROM inventory_ledger WHERE document_ref = ?`,
    [ordRow.code]
  );
  ok(
    'ledger co A -2 va B -4',
    ledgers.some((r: any) => r.p === BOOK_A && Number(r.d) === -2) &&
      ledgers.some((r: any) => r.p === BOOK_B && Number(r.d) === -4),
    JSON.stringify(ledgers)
  );
  ok('KHONG co but toan cho chinh combo', !ledgers.some((r: any) => r.p === COMBO_ID));

  // --- 6. Ban vuot ton ---
  const beforeA = await bal(BOOK_A);
  let overError = '';
  try {
    await OrderService.createOrder({
      warehouseId: WH,
      channel: 'RETAIL_OFFICE',
      paymentMethod: 'CASH',
      items: [{ editionId: COMBO_ID, quantity: 10 }],
      idempotencyKey: `idem-e2e-combo-over-${Date.now()}`,
      actorContext: MANAGER,
    });
  } catch (e: any) {
    overError = `${e?.message || e}`;
  }
  ok('ban vuot ton bi chan (loi ATP)', /ATP|HẾT HÀNG|KHÔNG ĐỦ TỒN/i.test(overError), overError.slice(0, 100));
  ok('ton khong doi sau don loi', (await bal(BOOK_A)) === beforeA);

  // --- Don sach thuong trong cung DB van ban duoc (khong hong gi) ---
  console.log(`\nCombo e2e: ${pass} xanh, ${fail} do.`);
  const codes = [ordRow.code];
  await q(`DELETE FROM inventory_ledger WHERE document_ref IN ('${codes.join("','")}')`);
  await q(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE order_code IN ('${codes.join("','")}'))`);
  await q(`DELETE FROM orders WHERE order_code IN ('${codes.join("','")}')`);
  await q('DELETE FROM combo_components WHERE combo_product_id = ?', [COMBO_ID]);
  await q("DELETE FROM stock_balances WHERE id IN ('sb-e2e-cb-a', 'sb-e2e-cb-b')");
  await q('DELETE FROM editions WHERE id IN (?, ?)', [BOOK_A, BOOK_B]);
  await q("DELETE FROM works WHERE id = 'w-e2e-cb'");
  await q('DELETE FROM products WHERE id IN (?, ?, ?)', [COMBO_ID, BOOK_A, BOOK_B]);
  db.close();
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
