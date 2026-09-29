/**
 * ATP kho hội chợ KHÔNG trừ đơn PENDING — dẫn tới bán vượt tồn.
 *
 * getBatchATP (order.service.ts:1152) thoát sớm khi warehouseType = 'FAIR_EVENT'
 * và trả thẳng tồn vật lý. Doc (:1118-1123) giải thích lý do: "API giữ chỗ online
 * từ chối kho hội chợ bằng 422 nên không cần trừ".
 *
 * Giả định đó ĐÃ LỆCH thực tế: quầy tại kho hội chợ tạo đơn chuyển khoản
 * PENDING_CONFIRMATION ngay tại chính kho đó (đã kiểm end-to-end ở A5.5). Đơn đó
 * giữ hàng thật nhưng không được trừ khỏi ATP, còn createOrder (:754) lại dùng
 * đúng số ATP sai đó để chặn ⇒ chặn không có tác dụng.
 *
 * Suite này chứng minh bằng dữ liệu thật, không bằng đọc mã.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_fair_atp.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

const ED = 'ed-test';
const sqlNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const in30min = () => new Date(Date.now() + 30 * 60_000).toISOString().slice(0, 19).replace('T', ' ');

let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; assert.ok(cond, msg); };

async function run() {
  console.log('--- TEST: ATP KHO HOI CHO KHONG TRU DON GIU CHO ---');
  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-fair-atp-hold');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const raw = createClient({ url: process.env.DATABASE_URL! });
  const { OrderService } = await import('../src/services/order.service');
  const schema = await import('../src/db/schema');
  const { db } = await import('../src/db');

  await raw.execute({ sql: `INSERT INTO warehouses (id,code,name,warehouse_type,is_active,is_sellable_on_pos) VALUES ('wh-fair','KHO_F','Kho hoi cho','FAIR_EVENT',1,1)`, args: [] });
  await raw.execute({ sql: `INSERT INTO warehouses (id,code,name,warehouse_type,is_active,is_sellable_on_pos) VALUES ('wh-main','KHO_M','Kho vat ly','PHYSICAL_MAIN',1,1)`, args: [] });
  await raw.execute({ sql: `INSERT INTO staff_accounts (staff_id,full_name,role,passcode_hash,salt,is_active,session_version) VALUES ('C1','T1','ROLE_CASHIER',?,?,1,1)`, args: ['v2$100000$' + '0'.repeat(64), 's'] });
  await raw.execute({ sql: `INSERT OR REPLACE INTO works (id,code,title,author) VALUES ('wk-test','WK-T','Tac pham thu nghiem','Tac gia')`, args: [] });
  await raw.execute({ sql: `INSERT OR REPLACE INTO editions (id,code,work_id,title,isbn,isbn_last4,cover_price) VALUES (?,?,?,?,?,?,100000)`, args: [ED, 'ED-TEST', 'wk-test', 'An ban thu nghiem', '9780000000001', '0001'] });
  await raw.execute({ sql: `INSERT OR REPLACE INTO stock_balances (id,edition_id,warehouse_id,condition,physical_quantity) VALUES ('sb1',?,'wh-fair','NEW',5)`, args: [ED] });
  await raw.execute({ sql: `INSERT OR REPLACE INTO stock_balances (id,edition_id,warehouse_id,condition,physical_quantity) VALUES ('sb2',?,'wh-main','NEW',5)`, args: [ED] });
  await raw.execute({ sql: `INSERT OR REPLACE INTO cashbox_sessions (id,warehouse_id,cashier_id,opening_cash,status,opened_at) VALUES ('sx','wh-fair','C1',0,'OPEN',?)`, args: [sqlNow()] });

  const addPending = async (id: string, code: string, wh: string, cashier: string, sess: string | null) => {
    await raw.execute({
      sql: `INSERT OR REPLACE INTO orders (id,order_code,idempotency_key,warehouse_id,cashier_id,cashbox_session_id,status,payment_method,subtotal,final_amount,discount_amount,discount_rate,created_at,payment_expires_at)
            VALUES (?,?,?,?,?,?, 'PENDING_CONFIRMATION','BANK_TRANSFER',500000,500000,0,0,?,?)`,
      args: [id, code, 'k-' + id, wh, cashier, sess, sqlNow(), in30min()],
    });
    await raw.execute({
      sql: `INSERT OR REPLACE INTO order_items (id,order_id,edition_id,quantity,unit_cover_price,unit_selling_price,total_amount) VALUES (?,?,?,5,100000,100000,500000)`,
      args: ['oi-' + id, id, ED],
    });
  };

  console.log('\n[P1] Kho VAT LY: ATP co tru don giu cho');
  await addPending('pv1', 'ORD-PV1', 'wh-main', 'C1', null);
  const atpMain = await OrderService.getATP(ED, 'wh-main');
  ok(atpMain === 0, `Kho vat ly: 5 ton - 5 giu cho = 0, thuc te ${atpMain}`);

  console.log('\n[P2] Kho HOI CHO: ATP KHONG tru don giu cho — DAY LA LOI');
  await addPending('pf1', 'ORD-PF1', 'wh-fair', 'C1', 'sx');
  const atpFair = await OrderService.getATP(ED, 'wh-fair');
  ok(
    atpFair === 0,
    `Kho hoi cho: 5 ton - 5 giu cho phai = 0, thuc te ${atpFair} ⇒ CONG KHONG GIAN, ban vuot ton`
  );

  console.log('\n[P3] Hai don quay: don thu hai phai bi chan');
  // createOrder (:754) chuyen ATP bang `atp < qty` roi nem loi. Tao don thu hai
  // cung 5 cuon o cung kho hoi cho roi do lai ATP: neu ATP < 5 thi don thu hai
  // se bi chan. Truoc khi sua, ATP luon = 5 nen don thu hai lot.
  await addPending('pf2', 'ORD-PF2', 'wh-fair', 'C1', 'sx');
  const atpAfter2 = await OrderService.getATP(ED, 'wh-fair');
  const holdTot = (await raw.execute({ sql: `SELECT COALESCE(SUM(quantity),0) n FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE warehouse_id='wh-fair' AND status='PENDING_CONFIRMATION')`, args: [] })).rows[0].n;
  const phys = (await raw.execute({ sql: `SELECT physical_quantity n FROM stock_balances WHERE id='sb1'`, args: [] })).rows[0].n;
  console.log(`   ton vat ly = ${phys}, dang giu cho = ${holdTot}, ATP sau 2 don = ${atpAfter2}`);
  ok(
    atpAfter2 < 5,
    `ATP sau 2 don phai < 5 de chan don thu hai, thuc te ${atpAfter2}`
  );
  ok(
    Number(holdTot) > Number(phys),
    `Tong dang giu cho ${holdTot} > ton vat ly ${phys} ⇒ neu ATP khong tru, don thu hai lot va BAN VUOT TON`
  );

  console.log('\n[P4] Nhanh thoat som da bi xoa, de khong ai them lai');
  const src = fs.readFileSync(path.resolve(process.cwd(), 'src/services/order.service.ts'), 'utf8');
  ok(
    !/if \(wh\?\.warehouseType === 'FAIR_EVENT'\)[\s\S]{0,200}return out;/.test(src),
    'KHONG duoc con nhanh thoat som tra ton vat ly cho kho hoi cho'
  );
  ok(
    /test-fair-atp-hold/.test(src),
    'Phai tro ve suite khoa hien loi nay de trinh xoa nham'
  );

  // Dọn dẹp: bảo đảm không đụng DB thật. File `formapubli.db` là gitignore nên có
  // trên máy chính, không có trong worktree khác — thiếu file thì không có gì để
  // kiểm, bỏ qua cho đúng thay vì báo lỗi.
  const devDb = path.resolve(process.cwd(), 'formapubli.db');
  if (fs.existsSync(devDb) && fs.statSync(devDb).size > 0) {
    const real = await createClient({ url: 'file:formapubli.db' });
    const cnt = (await real.execute({ sql: `SELECT COUNT(*) n FROM warehouses WHERE id='wh-fair'`, args: [] })).rows[0].n;
    ok(Number(cnt) === 0, 'DB thật không bị dính dữ liệu thử');
  } else {
    console.log('   (bỏ qua kiểm tra DB thật: file formapubli.db không có ở worktree này)');
  }

  console.log(`\n=== FAIR ATP: ${checks} assertions PASS ===`);
}

run()
  .then(() => process.exit(0))
  .catch((e) => { console.error('\n❌ THẤT BẠI:', e.message); process.exit(1); });
