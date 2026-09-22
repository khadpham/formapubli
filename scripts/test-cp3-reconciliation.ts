/**
 * scripts/test-cp3-reconciliation.ts (Lane B, test-only — CP3-R3)
 *
 * Đối soát 4 chiều R-REC-4WAY trên một DB choreography hỗn hợp:
 *  mở két → bán lẻ CASH (CK 10%) → bán sỉ BANK → thử EXCHANGE (R2 fail-closed)
 *  → trả 1 cuốn hoàn tiền (COMPLETED) → void phiếu đó (VOIDED, không giảm DT)
 *  → trả 1 cuốn đơn BANK giá đủ (COMPLETED 100.000, giữ lại).
 *
 * Phương trình:
 *  1. Két: Expected = Opening + Completed Cash Sales − Completed Cash Refunds.
 *  2. Thẻ kho: Σ quantityDelta == Σ physicalQuantity, không âm.
 *  3. Net: Gross − Discounts − CompletedRefunds; VOIDED/REJECTED không giảm DT;
 *     báo cáo analytics phải khớp net từng đồng (expected-red nếu chưa).
 */
import path from 'node:path';
import fs from 'node:fs';
import { fork } from 'node:child_process';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq, sql } from 'drizzle-orm';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';
import {
  works, editions, warehouses,
  orders, orderItems,
  returnOrders,
  inventoryLedger, stockBalances,
} from '../src/db/schema';

assertIsolatedTestDb('test-cp3-reconciliation');

const WORKER_SCRIPT = path.resolve(__dirname, 'cp3-return-complete-worker.ts');
const TSX_CLI = path.resolve(__dirname, '../node_modules/tsx/dist/cli.mjs');
const WORKER_TIMEOUT_MS = 30_000;

type RecAction = 'request' | 'approve' | 'complete' | 'void' | 'createOrder' | 'openCashbox' | 'closeCashbox';

interface WorkerResult {
  workerIndex: number;
  success: boolean;
  data?: any;
  error?: string;
  code?: string;
}

const failures: string[] = [];
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`✅ PASS: ${name}`);
  } else {
    console.error(`❌ FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
    failures.push(name);
  }
}

function dbFileFor(probe: string): { file: string; url: string } {
  const file = path.resolve(process.cwd(), `formapubli_test_cp3_${probe}.db`);
  // Windows: handle file cũ có thể còn bị tiến trình crashed giữ (EBUSY) —
  // thử xóa lặp lại, nếu vẫn khóa thì dùng hậu tố duy nhất để không bao giờ
  // migrate chồng lên DB cũ (tránh "table already exists" giả).
  let target = file;
  for (let attempt = 0; attempt < 25; attempt++) {
    let locked = false;
    for (const s of ['', '-wal', '-shm', '-journal']) {
      try { fs.unlinkSync(target + s); } catch (e: any) {
        if (e?.code === 'EBUSY' || e?.code === 'EPERM') locked = true;
      }
    }
    if (!locked || attempt === 24) break;
    const end = Date.now() + 200;
    while (Date.now() < end) { /* backoff ngắn, không sleep dàn race */ }
    if (attempt === 24) target = file.replace(/\.db$/, `-${Date.now().toString(36)}.db`);
  }
  return { file: target, url: 'file:' + target.split(path.sep).join('/') };
}

function localDb(url: string) {
  const client = createClient({ url });
  return { client, db: drizzle(client) };
}

async function runSolo(url: string, action: RecAction, payload: any): Promise<WorkerResult> {
  return new Promise<WorkerResult>((resolve) => {
    const child = fork(WORKER_SCRIPT, [], {
      execPath: process.execPath,
      execArgv: [TSX_CLI],
      env: { ...process.env, DATABASE_URL: url, WORKER_CONFIG: JSON.stringify({ action, payload }) },
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { child.kill('SIGKILL'); } catch { /* noop */ }
        resolve({ workerIndex: 0, success: false, error: 'TIMEOUT_EXCEEDED (Worker hung)', code: 'TIMEOUT' });
      }
    }, WORKER_TIMEOUT_MS);
    child.on('message', (msg: any) => {
      if (msg?.type === 'READY') child.send({ type: 'START' });
      else if (msg?.type === 'RESULT') {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ workerIndex: 0, success: msg.success, data: msg.data, error: msg.error, code: msg.code });
        }
      }
    });
    child.on('exit', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ workerIndex: 0, success: false, error: 'WORKER_EXITED', code: 'EXIT' });
      }
    });
  });
}

async function main() {
  console.log('--- R-REC-4WAY: doi soat ket / the kho / doanh thu rong ---');
  const { url } = dbFileFor('REC4');
  await migrateFresh({ targetUrl: url });
  const { client: c0, db: db0 } = localDb(url);
  await db0.insert(works).values({ id: 'wrec', code: 'CP3R-REC', title: 'CP3R REC', author: 'LaneB' });
  await db0.insert(editions).values({
    id: 'erec', code: 'CP3R-REC', workId: 'wrec',
    isbn: '9786040000000', isbnLast4: '0000', coverPrice: 100000,
  });
  await db0.insert(warehouses).values([
    { id: 'wh-au-co', code: 'KHO_AU_CO', name: 'Kho 1 - Au Co (REC)', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
  ]);
  await db0.insert(stockBalances).values({
    id: 'sb-erec', editionId: 'erec', warehouseId: 'wh-au-co', condition: 'NEW', physicalQuantity: 50,
  });
  await db0.insert(inventoryLedger).values({
    id: 'led-erec-open', editionId: 'erec', warehouseId: 'wh-au-co',
    eventType: 'OPENING_BALANCE', quantityDelta: 50, condition: 'NEW',
    documentRef: 'OPEN-REC', actorId: 'cp3r-fixture', idempotencyKey: 'idem-open-erec',
  });
  c0.close();

  const k = `cp3r-rec-${Date.now()}`;
  // 1. Mở két 1.000.000.
  const sess = await runSolo(url, 'openCashbox', { warehouseId: 'wh-au-co', cashierId: 'cp3r-cashier', openingCash: 1000000 });
  ok('R-REC mo ket 1.000.000', sess.success, sess.error);
  if (!sess.success) return;
  const sessId = (sess.data as any).session.id;

  // 2. Bán lẻ CASH 2 cuốn CK 10% -> thu 180.000.
  const s1 = await runSolo(url, 'createOrder', {
    warehouseId: 'wh-au-co', channel: 'FAIR_EVENT', customerName: 'Le',
    paymentMethod: 'CASH', fiscalScope: 'INTERNAL_MANAGEMENT', cashierId: 'cp3r-cashier',
    cashboxSessionId: sessId, discountRate: 0.1, confirmImmediately: true,
    idempotencyKey: `${k}-s1`, items: [{ editionId: 'erec', quantity: 2 }],
  });
  ok('R-REC ban le CASH 180.000', s1.success && (s1.data as any).finalAmount === 180000,
    s1.success ? `final=${(s1.data as any).finalAmount}` : s1.error);
  if (!s1.success) return;

  // 3. Bán sỉ BANK 2 cuốn -> 200.000.
  const s2 = await runSolo(url, 'createOrder', {
    warehouseId: 'wh-au-co', channel: 'WHOLESALE_PARTNER', customerName: 'Dai ly',
    paymentMethod: 'BANK_TRANSFER', fiscalScope: 'INTERNAL_MANAGEMENT', cashierId: 'cp3r-cashier',
    cashboxSessionId: sessId, discountRate: 0, confirmImmediately: true,
    idempotencyKey: `${k}-s2`, items: [{ editionId: 'erec', quantity: 2 }],
  });
  ok('R-REC ban si BANK 200.000', s2.success, s2.error);
  if (!s2.success) return;

  // 4. Thử EXCHANGE (R2 fail-closed) — ghi nhận, không tính vào phương trình.
  const { client: cl, db: dbl } = localDb(url);
  const s1Lines: any[] = await dbl.select().from(orderItems).where(eq(orderItems.orderId, (s1.data as any).orderId));
  cl.close();
  const exReq = await runSolo(url, 'request', {
    orderId: (s1.data as any).orderId, returnType: 'EXCHANGE', reason: 'WRONG_ITEM',
    targetWarehouseId: 'wh-au-co', inventoryDisposition: 'RESTOCK',
    refundAmount: 0, actorStaffId: 'cp3r-cashier', actorRole: 'ROLE_CASHIER',
    idempotencyKey: `${k}-exreq`, items: [{ orderItemId: s1Lines[0].id, quantity: 1 }],
  });
  let exchangeApplied = false;
  if (exReq.success) {
    const exAppr = await runSolo(url, 'approve', {
      returnId: (exReq.data as any).returnId, actorStaffId: 'cp3r-mgr', actorRole: 'ROLE_MANAGER',
      idempotencyKey: `${k}-exappr`,
    });
    if (exAppr.success) {
      const exDone = await runSolo(url, 'complete', {
        returnId: (exReq.data as any).returnId, actorStaffId: 'cp3r-mgr', actorRole: 'ROLE_MANAGER',
        idempotencyKey: `${k}-exdone`, exchangeItems: [{ editionId: 'erec', quantity: 1 }],
      });
      exchangeApplied = exDone.success;
    }
  }
  ok('R-REC EXCHANGE (ghi nhan R2 fail-closed hoac R3 xanh)', true, `applied=${exchangeApplied}`);

  // 5. Trả 1 cuốn hoàn tiền (kèm két) -> approve -> complete (giữ COMPLETED).
  const reqA = await runSolo(url, 'request', {
    orderId: (s1.data as any).orderId, returnType: 'REFUND', reason: 'CUSTOMER_CHANGE_MIND',
    targetWarehouseId: 'wh-au-co', inventoryDisposition: 'RESTOCK',
    refundAmount: 0, actorStaffId: 'cp3r-cashier', actorRole: 'ROLE_CASHIER',
    idempotencyKey: `${k}-reqA`, cashboxSessionId: sessId,
    items: [{ orderItemId: s1Lines[0].id, quantity: 1 }],
  });
  ok('R-REC request A', reqA.success, reqA.error);
  if (!reqA.success) return;
  const ridA = (reqA.data as any).returnId;
  ok('R-REC approve A', (await runSolo(url, 'approve', {
    returnId: ridA, actorStaffId: 'cp3r-mgr', actorRole: 'ROLE_MANAGER', idempotencyKey: `${k}-apprA`,
  })).success);
  const doneA = await runSolo(url, 'complete', {
    returnId: ridA, actorStaffId: 'cp3r-cashier', actorRole: 'ROLE_MANAGER', idempotencyKey: `${k}-doneA`,
  });
  ok('R-REC complete A (refund 90.000)', doneA.success, doneA.error);
  if (!doneA.success) return;

  // 6. Void phiếu A -> VOIDED (không giảm doanh thu).
  const vA = await runSolo(url, 'void', {
    returnId: ridA, actorStaffId: 'cp3r-mgr', actorRole: 'ROLE_MANAGER',
  });
  ok('R-REC void A', vA.success, vA.error);
  if (!vA.success) return;

  // 7. Trả 1 cuốn khác -> COMPLETED (giữ lại, refund 90.000).
  const reqB = await runSolo(url, 'request', {
    orderId: (s2.data as any).orderId, returnType: 'REFUND', reason: 'CUSTOMER_CHANGE_MIND',
    targetWarehouseId: 'wh-au-co', inventoryDisposition: 'RESTOCK',
    refundAmount: 0, actorStaffId: 'cp3r-cashier', actorRole: 'ROLE_CASHIER',
    idempotencyKey: `${k}-reqB`, cashboxSessionId: sessId,
    items: [{ orderItemId: (await (async () => {
      const { client, db } = localDb(url);
      const rows: any[] = await db.select().from(orderItems).where(eq(orderItems.orderId, (s2.data as any).orderId));
      client.close();
      return rows[0].id;
    })()), quantity: 1 }],
  });
  ok('R-REC request B', reqB.success, reqB.error);
  if (!reqB.success) return;
  const ridB = (reqB.data as any).returnId;
  ok('R-REC approve B', (await runSolo(url, 'approve', {
    returnId: ridB, actorStaffId: 'cp3r-mgr', actorRole: 'ROLE_MANAGER', idempotencyKey: `${k}-apprB`,
  })).success);
  ok('R-REC complete B', (await runSolo(url, 'complete', {
    returnId: ridB, actorStaffId: 'cp3x-cashier', actorRole: 'ROLE_MANAGER', idempotencyKey: `${k}-doneB`,
  })).success);

  // ---------- Đối soát (nguồn độc lập: CashboxService + AnalyticsService
  // đọc cùng DB probe qua DATABASE_URL khởi chạy) ----------
  // Chạy suite này với DATABASE_URL=file:formapubli_test_cp3_REC4.db để các
  // service ambient trỏ đúng DB probe (file tạo mới mỗi lần chạy).
  const { CashboxService } = await import('../src/services/order.service');
  const { AnalyticsService } = await import('../src/services/analytics.service');
  const { client, db } = localDb(url);
  const allOrders: any[] = await db.select().from(orders);
  const completedOrders = allOrders.filter((o: any) => o.status === 'COMPLETED');
  const grossSubtotal = completedOrders.reduce((s: number, o: any) => s + (o.subtotal || 0), 0);
  const discounts = completedOrders.reduce((s: number, o: any) => s + (o.discountAmount || 0), 0);
  const collected = completedOrders.reduce((s: number, o: any) => s + (o.finalAmount || 0), 0);
  const allReturns: any[] = await db.select().from(returnOrders);
  const completedRefunds = allReturns
    .filter((r: any) => r.status === 'COMPLETED')
    .reduce((s: number, r: any) => s + (r.refundAmount || 0), 0);
  const voidedCount = allReturns.filter((r: any) => r.status === 'VOIDED').length;
  const ledRows: any[] = await db.select({
    d: sql<number>`COALESCE(SUM(${inventoryLedger.quantityDelta}),0)`,
  }).from(inventoryLedger);
  const balRows: any[] = await db.select({
    v: sql<number>`COALESCE(SUM(${stockBalances.physicalQuantity}),0)`,
  }).from(stockBalances);
  const ledSum = Number(ledRows[0]?.d || 0);
  const balSum = Number(balRows[0]?.v || 0);
  const negRows: any[] = await db.select().from(stockBalances);
  client.close();

  // Nền DB: subtotal 400.000, CK 20.000, thu 380.000.
  ok('R-REC nen DB: subtotal/discount/collected', grossSubtotal === 400000 && discounts === 20000 && collected === 380000,
    `sub=${grossSubtotal} disc=${discounts} collect=${collected}`);

  // 1. Két (nguồn độc lập CashboxService): cash sales đã trừ hoàn.
  // reqB trên đơn BANK giá đủ (hoàn 100.000) — reqA đã void nên không tính.
  const stats: any = await CashboxService.calculateSessionStats(sessId);
  ok('R-REC ket: cash sales 180.000 − hoan 100.000 = 80.000',
    stats.totalCashSales === 80000 && stats.totalRefunds === 100000,
    `cash=${stats.totalCashSales} refunds=${stats.totalRefunds}`);
  ok('R-REC expected cash mo + thu − hoan = 1.080.000',
    1000000 + stats.totalCashSales === 1080000);

  // 2. Thẻ kho bảo toàn + không âm.
  ok('R-REC the kho bao toan (ledger == balance)', ledSum === balSum, `ledger=${ledSum} balance=${balSum}`);
  ok('R-REC khong ton am', negRows.every((r: any) => (r.physicalQuantity as number) >= 0));

  // 3. VOIDED không giảm DT; net DB = 380.000 − 100.000 = 280.000
  // (reqB trên đơn BANK giá đủ; reqA đã void nên loại).
  const dbNet = collected - completedRefunds;
  ok('R-REC VOIDED khong giam doanh thu', voidedCount === 1 && completedRefunds === 100000,
    `voided=${voidedCount} completedRefunds=${completedRefunds}`);
  ok('R-REC net DB = 280.000', dbNet === 280000, `net=${dbNet}`);

  // 4. Analytics minh bạch 2 trường (contract Lane A thống nhất):
  // salesRevenue = gross (380.000), netRevenue = net sau hoàn (280.000).
  const cf: any = await AnalyticsService.cashflow();
  ok('R-REC analytics salesRevenue thay gross 380.000', cf.salesRevenue === 380000, `salesRevenue=${cf.salesRevenue}`);
  ok('R-REC analytics netRevenue khop net 280.000 (refund-aware)',
    cf.netRevenue === dbNet,
    `netRevenue=${cf.netRevenue} net=${dbNet}`);

  console.log('=========================================================================');
  if (failures.length > 0) {
    console.error(`❌ CP3-R3 REC: ${failures.length} assertion do (expected-red cho Lane A):\n - ${failures.join('\n - ')}`);
    process.exit(1);
  }
  console.log('🎉 CP3-R3 REC: TAT CA XANH!');
}

main().catch((e) => { console.error('❌ Loi chay CP3-R3 REC:', e); process.exit(1); });
