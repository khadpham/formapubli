/**
 * Reserve-code + portal order_code xuyen suot (Viec 1 brief doi soat).
 *
 * - POST /api/orders/reserve-code tra ma ORD duy nhat, chua tao don.
 * - POST /api/portal-orders nhan order_code giu nguyen ma (khong tu sinh).
 * - Thieu order_code (don cu) thi tu sinh nhu hien tai.
 * - order_code sai dinh dang thi 400.
 * - Gui lai cung madon thi idempotent (tra don cu).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_reservecode.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* chua co = tao moi */ }
}

let checks = 0;
const ok = (c: boolean, m: string) => { checks++; assert.ok(c, m); };

const fakeReq = (body: any, key: string) =>
  ({
    headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? `Bearer ${key}` : null) },
    json: async () => body,
  }) as any;

async function run() {
  console.log('--- TEST: RESERVE-CODE + ORDER_CODE XUYEN SUOT ---');
  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  process.env.PORTAL_API_KEY = 'test-reserve-key';
  assertIsolatedTestDb('test-reserve-code');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const raw = createClient({ url: process.env.DATABASE_URL! });
  const { isPosOrderCode } = await import('../src/services/order-code');
  const { POST: reservePOST } = await import('../src/app/api/orders/reserve-code/route');
  const { POST: portalPOST } = await import('../src/app/api/portal-orders/route');

  await raw.execute(`INSERT INTO works (id, code, title, author) VALUES ('w-t1', 'TEST-001', 'Sach test', 'Tac gia')`);
  await raw.execute(`INSERT INTO products (id, name, product_kind, selling_price) VALUES ('ed-h82', 'Nu cong tuoc', 'BOOK', 100000)`);
  await raw.execute(`INSERT INTO editions (id, code, work_id, isbn, isbn_last4, cover_price) VALUES ('ed-h82', 'H82', 'w-t1', '9780000000001', '0001', 100000)`);
  await raw.execute(`INSERT INTO warehouses (id, code, name, warehouse_type, is_sellable_on_pos) VALUES ('wh-t1', 'KHO_TEST', 'Kho test', 'PHYSICAL_MAIN', 1)`);
  await raw.execute(`INSERT INTO portal_settings (key, value) VALUES ('PORTAL_WAREHOUSE_ID', 'wh-t1')`);
  await raw.execute(`INSERT INTO stock_balances (id, edition_id, product_id, warehouse_id, physical_quantity) VALUES ('sb-t1', 'ed-h82', 'ed-h82', 'wh-t1', 100)`);

  // 1. Reserve 2 ma: duy nhat, dung dinh dang 13 ky tu.
  const r1 = await reservePOST(fakeReq({}, 'test-reserve-key'));
  const j1 = await r1.json();
  ok(j1.success && isPosOrderCode(j1.data?.orderCode), `reserve 1 tra ma ORD hop le (thuc te ${j1.data?.orderCode})`);
  const r2 = await reservePOST(fakeReq({}, 'test-reserve-key'));
  const j2 = await r2.json();
  ok(j2.success && j2.data.orderCode !== j1.data.orderCode, 'reserve 2 lan khong trung ma');
  // Chua tao don nao.
  const cnt = await raw.execute(`SELECT COUNT(*) n FROM orders`);
  ok(Number((cnt.rows[0] as any).n) === 0, 'reserve khong tao don (chi dot bo dem)');

  // 2. Sai key thi 401.
  const r401 = await reservePOST(fakeReq({}, 'sai-key'));
  ok(r401.status === 401, 'reserve sai key tra 401');

  const base = {
    email: 'khach@test.vn', name: 'Khach Test', phone: '0900000001', address: 'Dia chi',
    items: [{ portalProductId: 'nu-cong-tuoc-de-langeais', qty: 1 }],
    paymentMethod: 'COD', shippingFee: 0, hasGift: false,
  };

  // 3. Gui kem order_code da reserve: don giu nguyen ma.
  const p1 = await portalPOST(fakeReq({ ...base, madon: 'DH-TEST-001', order_code: j1.data.orderCode }, 'test-reserve-key'));
  const q1 = await p1.json();
  ok(q1.success && q1.data.orderCode === j1.data.orderCode, `don giu ma reserve ${j1.data.orderCode} (thuc te ${q1.data?.orderCode})`);

  // 4. Khong gui order_code (don cu): tu sinh ma moi, khac 2 ma reserve.
  const p2 = await portalPOST(fakeReq({ ...base, madon: 'DH-TEST-002', email: 'khach2@test.vn' }, 'test-reserve-key'));
  const q2 = await p2.json();
  ok(q2.success && isPosOrderCode(q2.data.orderCode), 'don cu tu sinh ma ORD');
  ok(q2.data.orderCode !== j1.data.orderCode && q2.data.orderCode !== j2.data.orderCode, 'ma tu sinh khong dung do reserve');

  // 5. Ma sai dinh dang thi 400, khong tao don.
  const p3 = await portalPOST(fakeReq({ ...base, madon: 'DH-TEST-003', email: 'khach3@test.vn', order_code: 'SAI-MA' }, 'test-reserve-key'));
  ok(p3.status === 400, 'order_code sai dinh dang tra 400');

  // 6. Gui lai cung madon + CUNG ma: idempotent, tra don cu.
  const p4 = await portalPOST(fakeReq({ ...base, madon: 'DH-TEST-001', order_code: j1.data.orderCode }, 'test-reserve-key'));
  const q4 = await p4.json();
  ok(q4.success && q4.data.orderCode === j1.data.orderCode, 'retry cung madon + cung ma tra don cu');

  // 7. Cung madon nhung ma KHAC: xung dot 409 (bao ve khach khoi nhan nham ma
  // khac voi ma tren QR). Portal phai retry bang dung ma da hien cho khach.
  const p5 = await portalPOST(fakeReq({ ...base, madon: 'DH-TEST-001', order_code: j2.data.orderCode }, 'test-reserve-key'));
  ok(p5.status === 409, `cung madon khac ma tra 409 (thuc te ${p5.status})`);

  // 7. portal_ref van luu de tra cuu don cu.
  const ref = await raw.execute({ sql: `SELECT portal_ref FROM orders WHERE order_code = ?`, args: [j1.data.orderCode] });
  ok((ref.rows[0] as any)?.portal_ref === 'DH-TEST-001', 'portal_ref van luu song song');

  console.log(`Test Reserve-Code: PASS (${checks} kiem tra)`);
}

run().catch((e) => { console.error('FAIL:', e?.message || e); process.exit(1); });
