/**
 * ?unclosed=1 chỉ được bắt chốt ngày CÓ PHÁT SINH.
 *
 * Trước đây listUnclosed liệt kê mọi (kho x ngày) trong cửa sổ 30 ngày, nên:
 *  · kho tạo ngày 20 vẫn bị bắt chốt cho ngày 19 (kho chưa tồn tại)
 *  · ngày không ai bán gì vẫn phải "chốt" — báo cáo xanh giả rồi lại đỏ
 * Trên prod 30 ngày x 5 kho = 150 cặp, chỉ 2 cặp thật sự thiếu.
 *
 * Suite này gọi thẳng route handler (DB riêng) để khoá hành vi.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_unclosed.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

const vnDay = (back: number) =>
  new Date(Date.now() + 7 * 3600_000 - back * 86400_000).toISOString().slice(0, 10);

let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; assert.ok(cond, msg); };

async function run() {
  console.log('--- TEST: UNCLOSED CHI TINH NGAY CO PHAT SINH ---');
  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  process.env.CRON_SECRET = 'test-secret-unclosed';
  assertIsolatedTestDb('test-unclosed-activity');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const raw = createClient({ url: process.env.DATABASE_URL! });
  const { GET } = await import('../src/app/api/cron/auto-close/route');

  const d2 = vnDay(2);
  const d3 = vnDay(3);
  const d5 = vnDay(5);

  // KHO_A: tồn tại từ lâu, CÓ đơn ở ngày d2 nhưng KHÔNG có ở d3/d5.
  // KHO_B: tồn tại từ lâu, không có đơn nào.
  // KHO_C: tạo ở d3 ⇒ các ngày trước d3 không thể có phát sinh.
  await raw.execute({
    sql: `INSERT INTO warehouses (id,code,name,warehouse_type,is_active,is_sellable_on_pos,created_at)
          VALUES ('wh-a','KHO_A','Kho A','PHYSICAL_MAIN',1,1,?)`,
    args: [`${vnDay(60)} 00:00:00`],
  });
  await raw.execute({
    sql: `INSERT INTO warehouses (id,code,name,warehouse_type,is_active,is_sellable_on_pos,created_at)
          VALUES ('wh-b','KHO_B','Kho B','PHYSICAL_MAIN',1,1,?)`,
    args: [`${vnDay(60)} 00:00:00`],
  });
  await raw.execute({
    sql: `INSERT INTO warehouses (id,code,name,warehouse_type,is_active,is_sellable_on_pos,created_at)
          VALUES ('wh-c','KHO_C','Kho C','FAIR_EVENT',1,1,?)`,
    args: [`${d3} 00:00:00`],
  });
  await raw.execute({
    sql: `INSERT INTO works (id,code,title,author) VALUES ('wk-u','WK-U','Tac pham thu nghiem','Tac gia')`,
    args: [],
  });
  await raw.execute({
    sql: `INSERT INTO editions (id,code,work_id,title,isbn,isbn_last4,cover_price)
          VALUES ('ed-u','ED-U','wk-u','Ban thu nghiem','9780000000009','0009',100000)`,
    args: [],
  });
  // 1 đơn COMPLETED ở KHO_A ngày d2.
  await raw.execute({
    sql: `INSERT INTO orders (id,order_code,idempotency_key,warehouse_id,cashier_id,status,payment_method,subtotal,final_amount,created_at)
          VALUES ('o-u1','ORD-U1','k-u1','wh-a','C-U','COMPLETED','CASH',100000,100000,?)`,
    args: [`${d2} 10:00:00`],
  });

  // KHO_D sinh ra ở d3 NHƯNG có một đơn rác đặt nhầm vào d2 (dữ liệu bẩn).
  // Ngày sinh kho phải thắng: đơn sai ngày không được biến thành "ngày phải
  // chốt" cho một kho chưa tồn tại.
  await raw.execute({
    sql: `INSERT INTO warehouses (id,code,name,warehouse_type,is_active,is_sellable_on_pos,created_at)
          VALUES ('wh-d','KHO_D','Kho D','PHYSICAL_MAIN',1,1,?)`,
    args: [`${d2} 00:00:00`],
  });
  await raw.execute({
    sql: `INSERT INTO orders (id,order_code,idempotency_key,warehouse_id,cashier_id,status,payment_method,subtotal,final_amount,created_at)
          VALUES ('o-u2','ORD-U2','k-u2','wh-d','C-U','COMPLETED','CASH',100000,100000,?)`,
    args: [`${d3} 11:00:00`],
  });

  const res = await GET(new Request('http://localhost/api/cron/auto-close?unclosed=1&days=10', {
    headers: { Authorization: 'Bearer test-secret-unclosed' },
  }) as any);
  const body: any = await res.json();
  const list: { warehouse: string; date: string }[] = body?.data?.unclosed || [];
  const has = (wh: string, day: string) => list.some((x) => x.warehouse === wh && x.date === day);

  console.log(`   ${list.length} cap biet thieu chot`);
  list.forEach((x) => console.log(`     ${x.warehouse}  ${x.date}`));
  console.log(`   bo qua khong phat sinh: ${body?.data?.skippedNoActivity}`);

  ok(res.status === 200, `phai 200, thuc te ${res.status}`);
  ok(Array.isArray(list), 'phai tra ve danh sach unclosed');
  ok(body?.data?.warehouses === 4, 'phai dem duoc 4 kho');
  ok(typeof body?.data?.skippedNoActivity === 'number', 'phai bao cao so cap bi bo qua');

  console.log('\n[P1] Ngay CO don => phai bat chot');
  ok(has('KHO_A', d2), `KHO_A ngay ${d2} co don, phai bat chot`);

  console.log('\n[P2] Ngay KHONG co phat sinh => KHONG bat chot');
  ok(!has('KHO_A', d3), `KHO_A ngay ${d3} khong co gi, KHONG bat chot`);
  ok(!has('KHO_A', d5), `KHO_A ngay ${d5} khong co gi, KHONG bat chot`);
  ok(!has('KHO_B', d2), `KHO_B khong ban duoc ngay nao, KHONG bat chot`);
  ok(!has('KHO_B', d3), `KHO_B khong ban duoc ngay nao, KHONG bat chot`);

  console.log('\n[P3] Kho CHUA TON TAI vao ngay do => KHONG bat chot');
  // KHO_C sinh ở d3, không đơn nào ⇒ không ngày nào có phát sinh ⇒ không bắt.
  ok(!has('KHO_C', d3), `KHO_C tao ngay ${d3}, khong co phat sinh gi cao cao`);
  ok(!has('KHO_C', d2), `KHO_C tao ngay ${d3}, ngay ${d2} cung khong co gi`);
  // KHO_D sinh ở d2 nhưng có đơn rác ở d3 (trước khi kho tồn tại).
  ok(
    !has('KHO_D', d3),
    `KHO_D sinh ${d2} ⇒ ngay ${d3} khong bat chot du co don rac`
  );
  ok(
    list.filter((x) => x.warehouse === 'KHO_D').length === 0,
    'KHO_D khong co phat sinh hop le o bat ky ngay nao'
  );

  console.log('\n[P4] Da chot roi thi khong hoi lai (idempotent)');
  await raw.execute({ sql: `INSERT INTO idempotency_keys (key, scope) VALUES (?, ?)`, args: [`day-close:wh-a:${d2}`, 'day-close'] });
  const res2: any = await GET(new Request('http://localhost/api/cron/auto-close?unclosed=1&days=10', {
    headers: { Authorization: 'Bearer test-secret-unclosed' },
  }) as any);
  const list2 = (await res2.json())?.data?.unclosed || [];
  ok(!list2.some((x: any) => x.warehouse === 'KHO_A' && x.date === d2), 'KHO_A ngay da chot roi thi khong con trong danh sach');

  console.log('\n[P5] Fail-closed: sai secret van 401');
  const res3 = await GET(new Request('http://localhost/api/cron/auto-close?unclosed=1', {
    headers: { Authorization: 'Bearer sai-secret' },
  }) as any);
  ok(res3.status === 401, `sai secret phai 401, thuc te ${res3.status}`);

  const real = await createClient({ url: 'file:formapubli.db' });
  const n = (await real.execute({ sql: `SELECT COUNT(*) n FROM warehouses WHERE id IN ('wh-a','wh-b','wh-c')`, args: [] })).rows[0].n;
  ok(Number(n) === 0, 'DB that khong bi dinh du lieu thu');

  console.log(`\n=== UNCLOSED ACTIVITY: ${checks} assertions PASS ===`);
}

run()
  .then(() => process.exit(0))
  .catch((e) => { console.error('\n❌ THẤT BẠI:', e.message); process.exit(1); });
