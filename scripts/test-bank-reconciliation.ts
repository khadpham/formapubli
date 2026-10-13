/**
 * Doi soat sao ke ngan hang (Viec 2 brief doi soat).
 *
 * - Parse xlsx MB theo ten header, chiu duoc doi so thu tu cot.
 * - Ma don tim bang regex ORD day du (gi ca hau to base36).
 * - Ma + tien khop -> HIGH + don RECEIVED. Ma khop tien lech -> MEDIUM.
 * - Ma khong thay don / khop SDT -> LOW review. Tien ra -> chua xu ly.
 * - Import lap (trung but_toan) thi bo qua, khong tao trung.
 * - confirmMatch/skipStatement doi trang thai dung.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_bankrecon.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* chua co = tao moi */ }
}

let checks = 0;
const ok = (c: boolean, m: string) => { checks++; assert.ok(c, m); };

const CODE1 = 'ORD2610130001';
const CODE2 = 'ORD2610130002';

async function run() {
  console.log('--- TEST: DOI SOAT SAO KE NGAN HANG ---');
  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-bank-reconciliation');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const raw = createClient({ url: process.env.DATABASE_URL! });
  const svc = await import('../src/services/bank-reconciliation.service');
  const XLSX = await import('xlsx');

  await raw.execute(`INSERT INTO warehouses (id, code, name, warehouse_type) VALUES ('wh-b1', 'KHO_B1', 'Kho B1', 'PHYSICAL_MAIN')`);
  await raw.execute(`INSERT INTO customers (id, code, full_name, email, phone, segment, channel) VALUES ('cu-b1', 'CUST-B1', 'Khach B1', 'b1@test.vn', '0901111222', 'RETAIL', 'DIRECT')`);
  await raw.execute(`INSERT INTO orders (id, order_code, warehouse_id, channel, customer_id, subtotal, final_amount, payment_method, status, idempotency_key) VALUES ('o-b1', '${CODE1}', 'wh-b1', 'ONLINE', 'cu-b1', 500000, 500000, 'BANK_TRANSFER', 'PENDING_CONFIRMATION', 'idem-b1')`);
  await raw.execute(`INSERT INTO orders (id, order_code, warehouse_id, channel, subtotal, final_amount, payment_method, status, idempotency_key) VALUES ('o-b2', '${CODE2}', 'wh-b1', 'ONLINE', 300000, 300000, 'BANK_TRANSFER', 'PENDING_CONFIRMATION', 'idem-b2')`);
  await raw.execute(`INSERT INTO customers (id, code, full_name, email, phone, segment, channel) VALUES ('cu-b3', 'CUST-B3', 'Khach B3', 'b3@test.vn', '0903333444', 'RETAIL', 'DIRECT')`);
  await raw.execute(`INSERT INTO orders (id, order_code, warehouse_id, channel, customer_id, subtotal, final_amount, payment_method, status, idempotency_key) VALUES ('o-b3', 'ORD2610130003', 'wh-b1', 'ONLINE', 'cu-b3', 150000, 150000, 'BANK_TRANSFER', 'PENDING_CONFIRMATION', 'idem-b3')`);

  // Regex phai an ca hau to base36 (chu cai), khong cat nhu ORD\d+.
  ok(svc.extractOrderCode(`MBVCB.15601306902.096033.${CODE1}`) === CODE1, 'regex lay du ma ORD ke ca hau to chu');
  ok(svc.extractOrderCode('ORD261011000M CK tien sach') === 'ORD261011000M', 'regex giu hau to M');
  ok(svc.extractOrderCode('khong co ma') === null, 'khong ma tra null');

  // Dung file xlsx that: doi thu tu cot so voi brief (don vi truoc noi dung) de
  // bat loi parse cung cot.
  const sheet = XLSX.utils.aoa_to_sheet([
    ['STT', 'BUT TOAN', 'NGAY GIAO DICH', 'DON VI', 'NOI DUNG', 'PHAT SINH CO', 'PHAT SINH NO', 'SO DU'],
    [1, 'BT-A1', '12/10/2026', 'NGUYEN VAN A', `MBVCB.15601306902.096033.${CODE1}`, 500000, '', 1000000],
    [2, 'BT-A2', '12/10/2026', 'TRAN THI B', `CK ${CODE2} tien sach`, 250000, '', 750000],
    [3, 'BT-A3', '12/10/2026', 'LE VAN C', 'CK ORD2610130099 tien coc', 100000, '', 650000],
    [4, 'BT-A4', '12/10/2026', 'CONG TY DIEN', 'Thanh toan tien dien', '', 200000, 450000],
    [5, 'BT-A5', '12/10/2026', 'KHACH LE', 'CK tien sach 0903333444', 150000, '', 600000],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Thông tin giao dịch');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const rows = svc.parseMbStatement(buf);
  ok(rows.length === 5, `parse du 5 dong (thuc te ${rows.length})`);
  ok(rows[0].butToan === 'BT-A1' && rows[0].ngayGiaoDich === '2026-10-12', 'map cot theo ten header, doi thu tu van dung');
  ok(rows[0].phatSinhCo === 500000 && rows[3].phatSinhNo === 200000, 'tien vao/ra dung');

  const res = await svc.importStatements(rows, 'staff-test');
  ok(res.imported === 5 && res.skipped === 0, `import 5 dong (thuc te ${res.imported})`);
  ok(res.high === 1 && res.medium === 1 && res.low === 2 && res.unprocessed === 1, `HIGH=1 MEDIUM=1 LOW=2 UNPROCESSED=1 (thuc te ${res.high}/${res.medium}/${res.low}/${res.unprocessed})`);

  const st1 = (await raw.execute({ sql: `SELECT cod_status FROM orders WHERE id = 'o-b1'`, args: [] })).rows[0] as any;
  ok(st1.cod_status === 'RECEIVED', 'don HIGH duoc danh dau RECEIVED');
  const st2 = (await raw.execute({ sql: `SELECT cod_status FROM orders WHERE id = 'o-b2'`, args: [] })).rows[0] as any;
  ok(st2.cod_status === 'NONE', 'don MEDIUM giu nguyen cho review');

  // Import lap: trung but_toan thi bo qua het.
  const res2 = await svc.importStatements(rows, 'staff-test');
  ok(res2.imported === 0 && res2.skipped === 5, 'import lap bo qua, khong tao trung');

  // Confirm dong MEDIUM -> MANUAL/HIGH + don RECEIVED.
  const med = (await raw.execute(`SELECT s.id FROM bank_statements s JOIN bank_statement_matches m ON m.statement_id = s.id WHERE m.confidence = 'MEDIUM'`)).rows[0] as any;
  const cf = await svc.confirmMatch(med.id, null, 'staff-test');
  ok(cf.orderCode === CODE2, 'confirm giu don goi y');
  const mrow = (await raw.execute({ sql: `SELECT match_type, confidence, matched_by FROM bank_statement_matches WHERE statement_id = ?`, args: [med.id] })).rows[0] as any;
  ok(mrow.match_type === 'MANUAL' && mrow.confidence === 'HIGH' && mrow.matched_by === 'staff-test', 'confirm chuyen MANUAL/HIGH + nguoi xac nhan');

  // Skip dong LOW -> ve chua xu ly.
  const low = (await raw.execute(`SELECT s.id FROM bank_statements s JOIN bank_statement_matches m ON m.statement_id = s.id WHERE m.confidence = 'LOW' LIMIT 1`)).rows[0] as any;
  await svc.skipStatement(low.id);
  const gone = (await raw.execute({ sql: `SELECT COUNT(*) n FROM bank_statement_matches WHERE statement_id = ?`, args: [low.id] })).rows[0] as any;
  ok(Number(gone.n) === 0, 'skip xoa match, dong ve chua xu ly');

  console.log(`Test Bank Reconciliation: PASS (${checks} kiem tra)`);
}

run().catch((e) => { console.error('FAIL:', e?.message || e); process.exit(1); });
