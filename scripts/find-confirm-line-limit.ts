/**
 * TÌM CHÍNH XÁC ngưỡng và nguyên nhân: confirmOrder vỡ từ N dòng trở lên.
 *
 * CHẠY: npx tsx scripts/find-confirm-line-limit.ts
 *
 * BẰNG CHỨNG production (30/09): đơn 1–4 dòng COMPLETED, đơn 5, 12, 16, 17 dòng
 * hỏng với ledger = 0. Tức ngưỡng nằm giữa 4 và 5 dòng — KHÔNG phải trần 50
 * subrequest (cái đó sẽ vỡ muộn hơn nhiều).
 *
 * Script này chạy trên DB CÁCH LY, tăng dần số dòng, in lỗi thật ở lần vỡ đầu
 * tiên. Không đoán: in stack.
 */
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_confirm_limit.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

async function run() {
  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('find-confirm-line-limit');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const raw = createClient({ url: process.env.DATABASE_URL! });
  const { OrderService } = await import('../src/services/order.service');

  const WH = 'wh-lim';
  await raw.execute({
    sql: `INSERT INTO warehouses (id,code,name,warehouse_type,is_active,is_sellable_on_pos)
          VALUES ('${WH}','KHO_LIM','Kho giới hạn','FAIR_EVENT',1,1)`,
    args: [],
  });
  // 20 ấn bản, mỗi cuốn tồn 1000 (không bao giờ thiếu tồn)
  for (let i = 1; i <= 20; i++) {
    const id = `ed-l${i}`;
    await raw.execute({ sql: `INSERT INTO works (id,code,title,author) VALUES (?,?,?,?)`, args: [`w-${id}`, `W${i}`, `T${i}`, 'A'] });
    await raw.execute({ sql: `INSERT INTO editions (id,work_id,code,isbn,isbn_last4,cover_price) VALUES (?,?,?,?,?,?)`, args: [id, `w-${id}`, `ED${i}`, `9780000000${i}`, String(i % 10), 50000] });
    await raw.execute({ sql: `INSERT INTO stock_balances (id,edition_id,warehouse_id,condition,physical_quantity) VALUES (?,?,?,'NEW',1000)`, args: [`sb-${id}`, id, WH] });
  }
  await raw.execute({ sql: `INSERT INTO cashbox_sessions (id,warehouse_id,cashier_id,status,opening_cash) VALUES ('cbs-lim',?,?,'OPEN',0)`, args: [WH, 'CA-01'] });

  const actorContext = { staffId: 'CA-01', role: 'ROLE_CASHIER' as const, fullName: 'T' };

  console.log('\n=== DÒ LẦN TĂNG DẦN SỐ DÒNG ===');
  for (let n = 1; n <= 20; n++) {
    const items = Array.from({ length: n }, (_, k) => ({ editionId: `ed-l${k + 1}`, quantity: 1 }));
    let orderId = '';
    try {
      const created: any = await OrderService.createOrder({
        warehouseId: WH,
        channel: 'FAIR_EVENT',
        paymentMethod: 'BANK_TRANSFER',
        cashierId: 'CA-01',
        confirmImmediately: false,
        actorContext,
        items,
      } as any);
      orderId = created.orderId;

      const done: any = await OrderService.confirmOrder(
        orderId,
        'ROLE_CASHIER',
        'CA-01',
        actorContext as any,
        { id: `p-${n}`, capturedAt: new Date().toISOString() }
      );
      console.log(`  ${String(n).padStart(2)} dòng: ✅ ${done.status}`);
    } catch (e: any) {
      console.log(`  ${String(n).padStart(2)} dòng: ❌ ${e?.constructor?.name} code=${e?.code ?? '-'} :: ${e?.message}`);
      console.log('     stack (5 dòng đầu):');
      for (const line of String(e?.stack || '').split('\n').slice(1, 6)) {
        console.log(`       ${line.trim().slice(0, 120)}`);
      }
      break;
    }
  }
  raw.close();
}

run().then(() => process.exit(0)).catch((e) => { console.error('  LOI:', e?.message || e); process.exit(1); });
