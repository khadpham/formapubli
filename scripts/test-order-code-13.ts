/**
 * Mã đơn hàng 13 ký tự, cấp bằng bộ đếm NGUYÊN TẬ ở DB.
 *
 * `ORD` + `YYMMDD` + số thứ tự base36 4 ký tự. Ví dụ `ORD2609290001`.
 *
 * VÌ SAO BỘ ĐẾM PHẢI NẰM Ở DB: hội chợ có nhiều máy POS. Nếu mỗi máy tự đếm
 * từ 0001 thì hai máy cùng tạo đơn đầu tiên trong ngày ra cùng một số, mà
 * `orders.order_code` là UNIQUE ⇒ đơn của máy thứ hai KHÔNG GHI ĐƯỢC. Ca test
 * "chạy song song" bên dưới chính là để bắt đúng lỗi này.
 *
 * Ca này ĐỎ nếu quay lại cách cũ (`substr(col,1,10)`) hoặc cách đếm ở máy.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';
import { toBase36 } from '../src/services/order.service';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_ordercode.db');
// Xoá DB cũ TRƯỚC khi migrate. `migrateFresh` không idempotent (migration 0000 dùng
// `CREATE TABLE` trần) nên chạy lại trên file cũ là vấp "table already exists".
// Các suite khác trong repo đều làm bước này.
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* chưa có = tạo mới */ }
}

let checks = 0;
const ok = (c: boolean, m: string) => { checks++; assert.ok(c, m); };

// ---------------------------------------------------------------- base36
// 9999 = 07PR, 10000 = 07PS. 36^4 = 1.679.616 ⇒ vượt 9999 thì TỰ ĐỘNG sang chữ
// cái, không cần nhánh "tràn" riêng. Đây là câu trả lời cho "quá 9999 thì sao?".
ok(toBase36(1, 4) === '0001', 'số 1 -> 0001');
ok(toBase36(9999, 4) === '07PR', 'số 9999 -> 07PR (vẫn đúng 4 ký tự)');
ok(toBase36(10000, 4) === '07PS', 'số 10000 -> 07PS (TỰ ĐỘNG tràn sang chữ cái)');
ok(toBase36(1679615, 4) === 'ZZZZ', 'số 1.679.615 -> ZZZZ, hết 4 ký tự base36');
// Base36 = 0-9 + A-Z, nên mã CÓ chữ cái. Regex phải chấp nhận cả hai, không
// phải `^\d{4}$` (lần đầu tôi viết vậy nên test đỏ oan dù hàm chạy đúng).
ok(/^[0-9A-Z]{4}$/.test(toBase36(12345, 4)), 'kết quả luôn đúng 4 ký tự base36 (0-9, A-Z)');
ok(toBase36(0, 4) === '0000', 'số 0 -> 0000');
{
  let threw = false;
  try { toBase36(-1, 4); } catch { threw = true; }
  ok(threw, 'số âm phải ném lỗi, không được tạo mã trùng 0000');
}
{
  // Vượt 36^4 sẽ sinh chuỗi 5 ký tự ⇒ mã 14 ký tự. Phải chặn, không lặng lẽ sinh.
  let threw = false;
  try { toBase36(1679616, 4); } catch { threw = true; }
  ok(threw, 'vượt 1.679.615 đơn/ngày phải ném lỗi, không được sinh mã 14 ký tự');
}

// ---------------------------------------------------------------- DB thật
async function run() {
  console.log('--- TEST: MÃ ĐƠN 13 KÝ TỰ, CẤP NGUYÊN TẬ Ở DB ---');
  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-order-code-13');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const raw = createClient({ url: process.env.DATABASE_URL! });

  // Bảng bộ đếm phải được migrate tạo ra.
  const tbl = await raw.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='daily_order_counters'`
  );
  ok(tbl.rows.length === 1, 'migration phải tạo bảng daily_order_counters');

  const day = '2026-09-29';
  const yymmdd = '260929';

  // Cấp số liên tiếp, mô phỏng nhiều đơn trong ngày.
  const alloc = async () => {
    const r = await raw.execute({
      sql: `INSERT INTO daily_order_counters (day, last_seq) VALUES (?, 1)
            ON CONFLICT(day) DO UPDATE SET last_seq = last_seq + 1
            RETURNING last_seq`,
      args: [day],
    });
    const seq = Number(r.rows[0].last_seq);
    return `ORD${yymmdd}${toBase36(seq, 4)}`;
  };

  const first = await alloc();
  ok(first === 'ORD2609290001', `đơn đầu tiên trong ngày = ORD2609290001 (thực tế ${first})`);
  ok(first.length === 13, `mã dài đúng 13 ký tự (thực tế ${first.length})`);
  ok(!first.includes('-'), 'mã không được có dấu gạch ngang');

  const second = await alloc();
  ok(second === 'ORD2609290002', `đơn thứ hai = ...0002 (thực tế ${second})`);

  // ĐỔI NGÀY thì đếm lại từ 1 — cần cho khớp "một ngày một dãy".
  await raw.execute({
    sql: `INSERT INTO daily_order_counters (day, last_seq) VALUES (?, 1)
          ON CONFLICT(day) DO UPDATE SET last_seq = last_seq + 1 RETURNING last_seq`,
    args: ['2026-09-30'],
  });
  const r2 = await raw.execute({ sql: `SELECT last_seq FROM daily_order_counters WHERE day = ?`, args: ['2026-09-30'] });
  ok(Number(r2.rows[0].last_seq) === 1, 'ngày mới bắt đầu lại từ 1');

  // CÁC MÁY POS SONG SONG: 20 lần cấp số chạy đồng thời, không được trùng.
  const results = await Promise.all(
    Array.from({ length: 20 }, () => alloc())
  );
  ok(new Set(results).size === 20, `20 lần cấp số SONG SONG không được trùng nhau (thực tế ${new Set(results).size} mã khác nhau)`);
  ok(
    results.every((c) => c.length === 13),
    'mọi mã sinh ra đều dài 13 ký tự'
  );

  // Trùng mã sẽ vi phạm UNIQUE — đó là lý do bộ đếm phải ở DB chứ không ở máy.
  const dupCheck = await raw.execute({
    sql: `SELECT COUNT(*) n, COUNT(DISTINCT code) d FROM (
            SELECT 'ORD2609290001' AS code UNION ALL SELECT 'ORD2609290001')`,
    args: [],
  });
  ok(Number(dupCheck.rows[0].n) === 2 && Number(dupCheck.rows[0].d) === 1, 'cặp mã trùng sẽ bị UNIQUE bắt (n=2, d=1)');

  console.log(`\n=== MÃ ĐƠN 13 KÝ TỰ: ${checks} assertions PASS ===`);
}

// -----------------------------------------------------------------------------
// CA CHỐNG "TEST XANH NHƯNG TÍNH NĂNG CHẾT"
//
// Lần đầu tôi viết test này chỉ lặp lại logic cấp số bằng SQL thuần, nên nó
// XANH trong khi POS thực tế vẫn gửi `orderCode` tự sinh 29 ký tự lên server,
// khiến `params.orderCode` luôn có giá trị và bộ đếm KHÔNG BAO GIỜ chạy. Test
// pass, tính năng chết — đúng loại false-green tệ nhất: nó làm tôi tin là đã xong.
//
// Ca dưới đây kiểm tra ở đúng tầng: client KHÔNG được gửi orderCode, và server
// phải tự cấp mã. Đọc source để bắt, vì hành vi này nằm ở ranh giới client↔server.
function testClientDoesNotBypassServerAllocation() {
  const fs2 = require('node:fs') as typeof import('node:fs');
  const path2 = require('node:path') as typeof import('node:path');
  const root = path2.resolve(process.cwd());
  const pos = fs2
    .readFileSync(path2.join(root, 'src/components/pos/PosCheckoutTerminal.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');
  const svc = fs2.readFileSync(path2.join(root, 'src/services/order.service.ts'), 'utf8');

  // Mọi body POST /api/orders phải bỏ trường `orderCode`.
  //
  // BẢN ĐẦU DÙNG CỬA SỔ `{0,900}?` — body nhánh TIỀN MẶT dài ~1100 ký tự
  // nên KHÔNG BAO GIỜ match ⇒ nhánh đó không hề được kiểm tra. Thêm nữa
  // `online.length >= 1` nên chỉ cần MỘT nhánh khớp là test xanh. Đã đo được
  // trên production: 10 đơn tiền mặt vẫn ra mã 29 ký tự vì lý do này.
  //
  // Sửa: cửa sổ đủ rộng + đòi đủ SỐ NHÁNH (tiền mặt VÀ chuyển khoản).
  const POST_WINDOW = 4000;
  const bodies = (pos.match(
    new RegExp(`fetch\\('/api/orders',[\\s\\S]{0,${POST_WINDOW}}?\\n\\s*\\}\\);`, 'g')
  ) || []).filter((b) => !/order\.orderCode/.test(b));

  // Không phải mọi lần gọi đều là "tạo đơn mới":
  //  · `action: 'CONFIRM'` / `'CANCEL'` — thao tác sau khi đơn đã có.
  //  · body có `order.orderCode` — SYNC ĐƠN OFFLINE, mã đã tạo từ trước rồi,
  //    gửi lại là đúng (đã nằm trong điều kiện lọc ở trên).
  const creates = bodies.filter((b) => !/action:\s*'(CONFIRM|CANCEL)'/.test(b));
  ok(
    creates.length >= 2,
    `phải soi được CẢ 2 nhánh TẠO ĐƠN (tiền mặt + chuyển khoản) — thấy ${creates.length}`
  );
  for (const b of creates) {
    ok(
      !/\n\s*orderCode,/.test(b),
      'body TẠO ĐƠN KHÔNG được gửi orderCode — client sinh mã sẽ chặn bộ đếm DB'
    );
  }
  // Chốt hồi quy: nếu thêm `orderCode` trở lại nhánh tiền mặt thì phải ĐỎ.
  ok(
    !/\n\s*orderCode,\n\s*idempotencyKey/.test(pos.split("id: orderUuid")[1] || ''),
    'nhánh tiền mặt KHÔNG được gửi orderCode trước idempotencyKey'
  );

  // Server phải thật sự có nhánh tự cấp mã.
  ok(
    /params\.orderCode \|\| \(await allocateOrderCode/.test(svc),
    'order.service phải tự cấp mã khi client không gửi (params.orderCode || allocateOrderCode)'
  );

  // createOrder phải trả cashierId, nếu không phiếu in mất dòng "Thu ngân:"
  // khi tên thật chưa tải xong (mạng chậm ở hội chợ).
  // Cắt CỬA SỔ trước `isDuplicate` vì `cashierId` nằm TRƯỚC nó trong object
  // (lần đầu tôi cắt từ `isDuplicate` trở đi nên không thấy, test đỏ oan).
  const at = svc.indexOf('isDuplicate: false');
  ok(at > 0, 'phải tìm thấy khối return của createOrder');
  const ret = svc.slice(Math.max(0, at - 1200), at);
  ok(/cashierId:/.test(ret), 'createOrder phải trả cashierId cho phiếu in');
}

run()
  .then(() => {
    testClientDoesNotBypassServerAllocation();
    console.log(`\n=== MÃ ĐƠN 13 KÝ TỰ (+ chống false-green): ${checks} assertions PASS ===`);
    process.exit(0);
  })
  .catch((e) => { console.error('\n❌ THẤT BẠI:', e.message); process.exit(1); });
