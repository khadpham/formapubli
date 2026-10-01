/**
 * Migration 0027 phải tạo trigger `check_stock_non_negative` trên DB thật và
 * trigger đó phải CHẶN ĐƯỢC tồn kho âm.
 *
 * Vì sao cần test: trước 0027, `schema.ts` khai báo `check(...)` nhưng không
 * .sql nào sinh ra nó, nên production có 0 trigger — khai báo chỉ là văn bản.
 * Test này dựng DB bằng `migrateFresh` (đúng đường đi production sẽ đi), rồi thử
 * ghi tồn kho âm và đòi phải nổ.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh, stripToExecutable } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_stockcheck.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; assert.ok(cond, msg); };

async function run() {
  console.log('--- TEST: TRIGGER CHẶN TỒN KHO ÂM ---');
  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-stock-non-negative');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const db = createClient({ url: process.env.DATABASE_URL! });

  // 1. Trigger có thật sự tồn tại sau migrateFresh không.
  const trig = await db.execute(
    `SELECT name FROM sqlite_master WHERE type='trigger' AND name='check_stock_non_negative'`
  );
  ok(
    trig.rows.length === 1,
    `migrateFresh phải tạo trigger check_stock_non_negative, thực tế ${trig.rows.length}`
  );

  // 2. Trigger có gắn đúng bảng/cột không.
  const ddl = await db.execute(
    `SELECT sql FROM sqlite_master WHERE type='trigger' AND name='check_stock_non_negative'`
  );
  const sqlText = String(ddl.rows[0]?.sql || '');
  ok(/BEFORE\s+UPDATE\s+ON\s+stock_balances/i.test(sqlText), 'trigger phải chạy BEFORE UPDATE trên stock_balances');
  ok(/physical_quantity\s*<\s*0/i.test(sqlText), 'trigger phải chặn đúng khi physical_quantity < 0');

  // 3. Dữ liệu nền: một bản ghi tồn kho hợp lệ.
  await db.execute(
    `INSERT INTO works (id,code,title,author) VALUES ('wk-nn','WK-NN','Tác phẩm âm','Tác giả')`
  );
  await db.execute(
    `INSERT INTO editions (id,code,work_id,title,isbn,isbn_last4,cover_price)
     VALUES ('ed-nn','ED-NN','wk-nn','Sách âm','ISBN-NN','00NN',100000)`
  );
  await db.execute(
    `INSERT INTO warehouses (id,code,name,warehouse_type,is_active,is_sellable_on_pos,created_at)
     VALUES ('wh-nn','KHO_NN','Kho âm','PHYSICAL_MAIN',1,1,'2026-01-01 00:00:00')`
  );
  await db.execute(
    `INSERT INTO stock_balances (id,edition_id,product_id,warehouse_id,condition,physical_quantity)
     VALUES ('sb-nn','ed-nn','ed-nn','wh-nn','NEW',10)`
  );
  const pos = await db.execute(`SELECT physical_quantity FROM stock_balances WHERE id='sb-nn'`);
  ok(Number(pos.rows[0].physical_quantity) === 10, 'ghi tồn kho dương phải thành công');

  // 4. Trừ quá số đang có ⇒ âm ⇒ trigger phải ABORT.
  let blocked = false;
  let errMsg = '';
  try {
    await db.execute(`UPDATE stock_balances SET physical_quantity = -1 WHERE id='sb-nn'`);
  } catch (e: any) {
    blocked = true;
    errMsg = String(e?.message || e);
  }
  ok(blocked, 'ghi physical_quantity âm phải bị trigger CHẶN');
  ok(
    /check_stock_non_negative|physical_quantity >= 0/i.test(errMsg),
    `thông báo lỗi phải nói rõ nguyên nhân, thực tế: ${errMsg.slice(0, 120)}`
  );

  // 5. Dữ liệu phải còn nguyên sau lần ghi bị chặn (không bị chết dở).
  const after = await db.execute(`SELECT physical_quantity FROM stock_balances WHERE id='sb-nn'`);
  ok(
    Number(after.rows[0].physical_quantity) === 10,
    'ghi bị chặn phải để nguyên dữ liệu cũ, không rơi về 0 hay -1'
  );

  // 6. Áp dụng lại riêng câu lệnh trigger phải không sao.
  //
  // KHÔNG chạy lại cả `migrateFresh`: nó không idempotent (0000 dùng CREATE TABLE
  // trần) nên luôn vấp ở lần hai — đó là đặc tính của migrate-fresh, không phải
  // lỗi của migration này. Việc vận hành cần kiểm là: chạy tay câu lệnh trigger
  // lần nữa có abort không. `IF NOT EXISTS` là câu trả lời.
  const triggerSql = stripToExecutable(
    fs.readFileSync(
      path.resolve(process.cwd(), 'src/db/migrations/0027_stock_non_negative_check.sql'),
      'utf8'
    )
  );
  await db.execute(triggerSql);
  ok(true, 'chạy lại câu lệnh trigger không abort (có IF NOT EXISTS)');

  // 7. Trigger vẫn chặn sau khi chạy lại.
  let blockedAgain = false;
  try {
    await db.execute(`UPDATE stock_balances SET physical_quantity = -5 WHERE id='sb-nn'`);
  } catch {
    blockedAgain = true;
  }
  ok(blockedAgain, 'sau khi chạy lại trigger vẫn chặn tồn kho âm');

  console.log(`\n=== TRIGGER TỒN KHO ÂM: ${checks} assertions PASS ===`);
}

run()
  .then(() => process.exit(0))
  .catch((e) => { console.error('\n❌ THẤT BẠI:', e.message); process.exit(1); });
