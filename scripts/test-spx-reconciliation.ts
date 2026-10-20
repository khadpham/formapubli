/**
 * Doi soat SPX (Viec 3 brief doi soat).
 *
 * - Parse xlsx bao cao SPX theo ten header.
 * - Match ma_van_don voi orders.tracking_code.
 * - COD khop + phi on + khong dieu chinh -> CLEAN + don RECEIVED.
 * - COD lech / phi bat thuong / co dieu chinh -> REVIEW.
 * - Van don khong thay don -> UNPROCESSED. Import lap bo qua.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_spxrecon.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* chua co = tao moi */ }
}

let checks = 0;
const ok = (c: boolean, m: string) => { checks++; assert.ok(c, m); };

async function run() {
  console.log('--- TEST: DOI SOAT SPX ---');
  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-spx-reconciliation');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const raw = createClient({ url: process.env.DATABASE_URL! });
  const svc = await import('../src/services/spx-reconciliation.service');
  const XLSX = await import('xlsx');

  await raw.execute(`INSERT INTO warehouses (id, code, name, warehouse_type) VALUES ('wh-s1', 'KHO_S1', 'Kho S1', 'PHYSICAL_MAIN')`);
  const mkOrder = (id: string, code: string, track: string, cod: number, fee: number) =>
    raw.execute(`INSERT INTO orders (id, order_code, warehouse_id, channel, subtotal, final_amount, payment_method, cod_amount, shipping_fee, tracking_code, status, idempotency_key) VALUES ('${id}', '${code}', 'wh-s1', 'ONLINE', ${cod}, ${cod}, 'COD', ${cod}, ${fee}, '${track}', 'PENDING_CONFIRMATION', 'idem-${id}')`);
  await mkOrder('o-s1', 'ORD2610130011', 'SPX111', 200000, 30000);
  await mkOrder('o-s2', 'ORD2610130012', 'SPX222', 200000, 30000);
  await mkOrder('o-s3', 'ORD2610130013', 'SPX333', 200000, 30000);

  const sheet = XLSX.utils.aoa_to_sheet([
    ['Mã vận đơn', 'Trạng thái vận đơn', 'Tiền thu hộ (VND)', 'Tổng phí phải trả (VND)', 'Phí giao hàng', 'Phí bảo hiểm', 'Số tiền điều chỉnh (VND)', 'Lý do điều chỉnh', 'Tổng tiền vào Số dư'],
    ['SPX111', 'Đã giao', 200000, 30000, 28000, 2000, 0, '', 170000],
    ['SPX222', 'Đã giao', 180000, 30000, 28000, 2000, 0, '', 150000],
    ['SPX333', 'Đã giao', 200000, 60000, 58000, 2000, 5000, 'Phí vùng xa', 145000],
    ['SPX999', 'Đã giao', 100000, 20000, 20000, 0, 0, '', 80000],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Report');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const rows = svc.parseSpxReport(buf);
  ok(rows.length === 4, `parse du 4 van don (thuc te ${rows.length})`);
  ok(rows[0].maVanDon === 'SPX111' && rows[0].tienThuHo === 200000, 'map cot theo ten header');

  const res = await svc.importSpxSettlements(rows, 'staff-test');
  ok(res.imported === 4 && res.skipped === 0, 'import 4 dong');
  ok(res.clean === 1 && res.needReview === 2 && res.unmatched === 1, `CLEAN=1 REVIEW=2 UNMATCHED=1 (thuc te ${res.clean}/${res.needReview}/${res.unmatched})`);

  const s1 = (await raw.execute(`SELECT cod_status FROM orders WHERE id = 'o-s1'`)).rows[0] as any;
  ok(s1.cod_status === 'RECEIVED', 'don CLEAN danh dau RECEIVED');
  const s2 = (await raw.execute(`SELECT cod_status FROM orders WHERE id = 'o-s2'`)).rows[0] as any;
  ok(s2.cod_status === 'NONE', 'don COD lech giu nguyen cho review');

  const res2 = await svc.importSpxSettlements(rows, 'staff-test');
  ok(res2.imported === 0 && res2.skipped === 4, 'import lap bo qua');

  const rev = (await raw.execute(`SELECT s.id FROM spx_settlements s JOIN spx_settlement_matches m ON m.settlement_id = s.id WHERE s.ma_van_don = 'SPX222'`)).rows[0] as any;
  await svc.confirmSpxMatch(rev.id, 'staff-test');
  const mrow = (await raw.execute({ sql: `SELECT match_type, matched_by FROM spx_settlement_matches WHERE settlement_id = ?`, args: [rev.id] })).rows[0] as any;
  ok(mrow.match_type === 'MANUAL' && mrow.matched_by === 'staff-test', 'confirm chuyen MANUAL + nguoi duyet');

  const un = (await raw.execute(`SELECT id FROM spx_settlements WHERE ma_van_don = 'SPX999'`)).rows[0] as any;
  await svc.skipSpxSettlement(un.id);
  const gone = (await raw.execute({ sql: `SELECT COUNT(*) n FROM spx_settlement_matches WHERE settlement_id = ?`, args: [un.id] })).rows[0] as any;
  ok(Number(gone.n) === 0, 'skip ve chua xu ly');

  console.log(`Test SPX Reconciliation: PASS (${checks} kiem tra)`);
}

run().catch((e) => { console.error('FAIL:', e?.message || e); process.exit(1); });
