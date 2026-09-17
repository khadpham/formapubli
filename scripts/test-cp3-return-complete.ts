/**
 * scripts/test-cp3-return-complete.ts (Lane A CP3-R2, test-only)
 *
 * Complete cho phiếu REFUND (EXCHANGE/DAMAGED_REPLACE fail-closed giữ cho R3):
 *  R-CC  Hai complete đua nhau: 1 hiệu ứng kho + refund duy nhất.
 *  R-DQ  Hàng lỗi chỉ tăng QUARANTINE (NEW không tăng), đúng 1 RMA.
 *  R-CASH Két đóng / sai kho / sai chủ sở hữu -> rollback toàn bộ.
 *  R-I2  Cùng key replay; khác payload conflict.
 *  R-ATOMIC Ép lỗi giữa chừng (fault hook) -> phiếu ở APPROVED, không orphan.
 *
 * Quy tắc: 2 process độc lập, còi START chung, không mutex, không sleep dàn
 * thứ tự thắng, timeout 30s/process (kill SIGKILL), DB mới mỗi probe,
 * SQLITE_BUSY/timeout thoát ra ngoài = FAIL, kiểm tra orphan sau mỗi đua.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fork } from 'node:child_process';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq } from 'drizzle-orm';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';
import {
  works, editions, warehouses,
  orders, orderItems,
  returnOrders, returnOrderItems, returnActions,
  inventoryLedger, stockBalances, rmaTickets,
} from '../src/db/schema';

assertIsolatedTestDb('test-cp3-return-complete');

const WORKER_SCRIPT = path.resolve(__dirname, 'cp3-return-complete-worker.ts');
const TSX_CLI = path.resolve(__dirname, '../node_modules/tsx/dist/cli.mjs');
const WORKER_TIMEOUT_MS = 30_000;

type Ret2Action = 'request' | 'approve' | 'complete' | 'createOrder' | 'openCashbox' | 'closeCashbox';

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
  for (const s of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(file + s); } catch { /* fresh */ }
  }
  return { file, url: 'file:' + file.split(path.sep).join('/') };
}

function localDb(url: string) {
  const client = createClient({ url });
  return { client, db: drizzle(client) };
}

async function freshProbeDb(probe: string, openingQty: number) {
  const { file, url } = dbFileFor(probe);
  await migrateFresh({ targetUrl: url });
  const { client, db } = localDb(url);
  const wid = `cp3c-${probe.toLowerCase()}`;
  await db.insert(works).values({ id: wid, code: `CP3C-${probe}`, title: `CP3C ${probe}`, author: 'LaneA' });
  await db.insert(editions).values({
    id: wid, code: `CP3C-${probe}`, workId: wid,
    isbn: '9786040000000', isbnLast4: '0000', coverPrice: 100000,
  });
  await db.insert(warehouses).values([
    { id: 'wh-au-co', code: 'KHO_AU_CO', name: 'Kho 1 - Au Co (CP3C)', isActive: true },
    { id: 'wh-quynh-mai', code: 'KHO_QUYNH_MAI', name: 'Kho 2 - Quynh Mai (CP3C)', isActive: true },
  ]);
  await db.insert(stockBalances).values({
    id: `sb-${wid}`, editionId: wid, warehouseId: 'wh-au-co', condition: 'NEW', physicalQuantity: openingQty,
  });
  await db.insert(inventoryLedger).values({
    id: `led-${wid}-open`, editionId: wid, warehouseId: 'wh-au-co',
    eventType: 'OPENING_BALANCE', quantityDelta: openingQty, condition: 'NEW',
    documentRef: `OPEN-${probe}`, actorId: 'cp3c-fixture', idempotencyKey: `idem-open-${wid}`,
  });
  client.close();
  return { file, url, editionId: wid };
}

async function runRace(
  url: string,
  configs: Array<{ action: Ret2Action; payload: any }>,
  extraEnv: Record<string, string> = {},
): Promise<WorkerResult[]> {
  const n = configs.length;
  const results: WorkerResult[] = new Array(n);
  const children: any[] = [];
  const ready: Array<Promise<void>> = [];

  for (let i = 0; i < n; i++) {
    let markReady!: () => void;
    ready.push(new Promise<void>((r) => { markReady = r; }));
    const child = fork(WORKER_SCRIPT, [], {
      execPath: process.execPath,
      execArgv: [TSX_CLI],
      env: { ...process.env, DATABASE_URL: url, WORKER_CONFIG: JSON.stringify(configs[i]), ...extraEnv },
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });
    const idx = i;
    child.on('message', (msg: any) => {
      if (msg?.type === 'READY') markReady();
      else if (msg?.type === 'RESULT') {
        results[idx] = { workerIndex: idx, success: msg.success, data: msg.data, error: msg.error, code: msg.code };
      }
    });
    children.push(child);
  }

  await Promise.all(ready);
  for (const c of children) c.send({ type: 'START' });

  await Promise.all(children.map((child, idx) => new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* noop */ }
      results[idx] = { workerIndex: idx, success: false, error: 'TIMEOUT_EXCEEDED (Worker hung)', code: 'TIMEOUT' };
      resolve();
    }, WORKER_TIMEOUT_MS);
    child.on('exit', () => { clearTimeout(timer); resolve(); });
  })));

  return results;
}

const runSolo = (url: string, action: Ret2Action, payload: any, extraEnv: Record<string, string> = {}) =>
  runRace(url, [{ action, payload }], extraEnv).then((r) => r[0]);

function noBusyOrTimeout(results: WorkerResult[]): boolean {
  return !results.some((r) =>
    r.code === 'TIMEOUT' || r.code === 'SQLITE_BUSY' ||
    (r.error || '').includes('database is locked') ||
    (r.error || '').includes('TIMEOUT_EXCEEDED'));
}

const salePayload = (editionId: string, qty: number, key: string, paymentMethod = 'BANK_TRANSFER') => ({
  warehouseId: 'wh-au-co', channel: 'FAIR_EVENT', customerName: 'Khach CP3C',
  paymentMethod, fiscalScope: 'INTERNAL_MANAGEMENT', cashierId: 'cp3c-cashier',
  confirmImmediately: true, idempotencyKey: key,
  items: [{ editionId, quantity: qty }],
});

const reqPayload = (orderId: string, orderItemId: string, qty: number, key: string, disposition = 'RESTOCK', cashboxSessionId?: string) => ({
  orderId, returnType: 'REFUND', reason: 'CUSTOMER_CHANGE_MIND',
  targetWarehouseId: 'wh-au-co', inventoryDisposition: disposition,
  refundAmount: 0, actorStaffId: 'cp3c-cashier', actorRole: 'ROLE_CASHIER',
  idempotencyKey: key, cashboxSessionId,
  items: [{ orderItemId, quantity: qty }],
});

const apprPayload = (returnId: string, key: string) => ({
  returnId, actorStaffId: 'cp3c-manager', actorRole: 'ROLE_MANAGER', idempotencyKey: key,
});

async function orderLineId(url: string, orderId: string): Promise<string> {
  const { client, db } = localDb(url);
  const rows: any[] = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  client.close();
  if (rows.length === 0) throw new Error(`order ${orderId} khong co dong hang`);
  return rows[0].id;
}

/** Dựng đơn COMPLETED + phiếu APPROVED (REFUND). Trả về { orderId, returnId }. */
async function approvedReturn(
  url: string, editionId: string, saleQty: number, retQty: number, tag: string,
  paymentMethod = 'BANK_TRANSFER', disposition = 'RESTOCK', cashboxSessionId?: string,
) {
  const sale = await runSolo(url, 'createOrder', salePayload(editionId, saleQty, `${tag}-sale`, paymentMethod));
  if (!sale.success) return { ok: false as const, error: sale.error };
  const orderId = (sale.data as any).orderId;
  const lineId = await orderLineId(url, orderId);
  const req = await runSolo(url, 'request', reqPayload(orderId, lineId, retQty, `${tag}-req`, disposition, cashboxSessionId));
  if (!req.success) return { ok: false as const, error: req.error };
  const returnId = (req.data as any).returnId;
  const appr = await runSolo(url, 'approve', apprPayload(returnId, `${tag}-appr`));
  if (!appr.success) return { ok: false as const, error: appr.error };
  return { ok: true as const, orderId, returnId };
}

// ------------------------------------------------------------------ R-CC ---
async function probeRCC() {
  console.log('--- R-CC: hai complete cung phieu ---');
  const { url, editionId } = await freshProbeDb('RCC', 50);
  const k = `cp3c-cc-${Date.now()}`;
  const fx = await approvedReturn(url, editionId, 4, 2, k);
  ok('R-CC setup phieu APPROVED', fx.ok, !fx.ok ? (fx as any).error : undefined);
  if (!fx.ok) return;
  const before = await (async () => {
    const { client, db } = localDb(url);
    const rows: any[] = await db.select().from(stockBalances)
      .where(eq(stockBalances.editionId, editionId));
    client.close();
    return rows.reduce((s, r) => s + (r.physicalQuantity as number), 0);
  })();
  const comp = (key: string, staff: string) => ({
    returnId: (fx as any).returnId, actorStaffId: staff, actorRole: 'ROLE_MANAGER', idempotencyKey: key,
  });
  const results = await runRace(url, [
    { action: 'complete', payload: comp(`${k}-c1`, 'cp3c-mgr1') },
    { action: 'complete', payload: comp(`${k}-c2`, 'cp3c-mgr2') },
  ]);
  const succ = results.filter((r) => r.success);
  const fail = results.filter((r) => !r.success);
  ok('R-CC dung 1 complete thang', succ.length === 1 && fail.length === 1,
    JSON.stringify(results.map((r) => ({ s: r.success, c: r.code }))));
  ok('R-CC thua nhan STATE_CONFLICT', fail.length === 1 && fail[0].code === 'STATE_CONFLICT',
    fail[0]?.code);
  ok('R-CC khong BUSY/timeout thoat ra ngoai', noBusyOrTimeout(results));
  const { client, db } = localDb(url);
  const header: any = (await db.select().from(returnOrders).where(eq(returnOrders.id, (fx as any).returnId)))[0];
  const inbound: any[] = await db.select().from(inventoryLedger)
    .where(eq(inventoryLedger.correlationId, (fx as any).returnId));
  const acts: any[] = await db.select().from(returnActions).where(eq(returnActions.returnId, (fx as any).returnId));
  const bals: any[] = await db.select().from(stockBalances).where(eq(stockBalances.editionId, editionId));
  client.close();
  const after = bals.reduce((s, r: any) => s + (r.physicalQuantity as number), 0);
  ok('R-CC trang thai cuoi COMPLETED', header.status === 'COMPLETED', header.status);
  ok('R-CC dung 1 hieu ung kho (ton +2)', after - before === 2, `delta=${after - before}`);
  ok('R-CC dung 1 RETURN_INBOUND',
    inbound.filter((l) => l.eventType === 'RETURN_INBOUND').length === 1, `inbound=${inbound.length}`);
  ok('R-CC dung 1 action COMPLETE', acts.filter((a) => a.action === 'COMPLETE').length === 1, `actions=${acts.length}`);
  ok('R-CC refund dung so server chot', header.refundAmount === 2 * 100000, `refund=${header.refundAmount}`);
}

// ------------------------------------------------------------------ R-DQ ---
async function probeRDQ() {
  console.log('--- R-DQ: hang loi chi tang QUARANTINE ---');
  const { url, editionId } = await freshProbeDb('RDQ', 50);
  const k = `cp3c-dq-${Date.now()}`;
  const fx = await approvedReturn(url, editionId, 4, 2, k, 'BANK_TRANSFER', 'DEFECTIVE_HOLD');
  ok('R-DQ setup phieu APPROVED (DEFECTIVE_HOLD)', fx.ok, !fx.ok ? (fx as any).error : undefined);
  if (!fx.ok) return;
  const comp = await runSolo(url, 'complete', {
    returnId: (fx as any).returnId, actorStaffId: 'cp3c-mgr', actorRole: 'ROLE_MANAGER', idempotencyKey: `${k}-done`,
  });
  ok('R-DQ complete thanh cong', comp.success, comp.error);
  const { client, db } = localDb(url);
  const bals: any[] = await db.select().from(stockBalances).where(eq(stockBalances.editionId, editionId));
  const rmas: any[] = await db.select().from(rmaTickets);
  const inbound: any[] = await db.select().from(inventoryLedger)
    .where(eq(inventoryLedger.correlationId, (fx as any).returnId));
  client.close();
  // NEW giữ nguyên mức sau bán (50 - 4 đã bán = 46); QUARANTINE +2.
  const newBal = bals.find((b: any) => b.condition === 'NEW')?.physicalQuantity;
  const qBal = bals.find((b: any) => b.condition === 'QUARANTINE')?.physicalQuantity;
  ok('R-DQ NEW khong doi sau complete', newBal === 46, `NEW=${newBal}`);
  ok('R-DQ QUARANTINE +2', qBal === 2, `Q=${qBal}`);
  ok('R-DQ dung 1 RMA', rmas.length === 1, `rma=${rmas.length}`);
  ok('R-DQ inbound QUARANTINE dung 1',
    inbound.filter((l) => l.eventType === 'RETURN_INBOUND' && l.condition === 'QUARANTINE').length === 1);
}

// ---------------------------------------------------------------- R-CASH ---
async function probeRCash() {
  console.log('--- R-CASH: ket dong / sai kho / sai chu -> rollback ---');
  const { url, editionId } = await freshProbeDb('RCASH', 50);
  const k = `cp3c-cash-${Date.now()}`;
  // Ca két đúng: kho au-co, thu ngân cp3c-cashier.
  const sess = await runSolo(url, 'openCashbox', { warehouseId: 'wh-au-co', cashierId: 'cp3c-cashier', openingCash: 0 });
  ok('R-CASH setup ket OPEN', sess.success, sess.error);
  if (!sess.success) return;
  const sessId = (sess.data as any).session.id;

  async function cashReturn(tag: string, sessionId: string, completer: string) {
    const fx = await approvedReturn(url, editionId, 3, 1, tag, 'CASH', 'RESTOCK', sessionId);
    if (!fx.ok) return { setup: false as const, error: (fx as any).error };
    const r = await runSolo(url, 'complete', {
      returnId: (fx as any).returnId, actorStaffId: completer, actorRole: 'ROLE_MANAGER',
      idempotencyKey: `${tag}-done`,
    });
    return { setup: true as const, returnId: (fx as any).returnId, result: r };
  }

  // 1. Két đã đóng TRƯỚC complete -> rollback toàn bộ.
  const fxClosed = await approvedReturn(url, editionId, 3, 1, `${k}-closed`, 'CASH', 'RESTOCK', sessId);
  ok('R-CASH setup phieu ket-dong', fxClosed.ok, !fxClosed.ok ? (fxClosed as any).error : undefined);
  if (fxClosed.ok) {
    await runSolo(url, 'closeCashbox', { sessionId: sessId });
    const done = await runSolo(url, 'complete', {
      returnId: (fxClosed as any).returnId, actorStaffId: 'cp3c-mgr', actorRole: 'ROLE_MANAGER',
      idempotencyKey: `${k}-closed-done`,
    });
    ok('R-CASH ket dong bi chan', !done.success, `${done.code}`);
    const { client, db } = localDb(url);
    const h: any = (await db.select().from(returnOrders).where(eq(returnOrders.id, (fxClosed as any).returnId)))[0];
    const led: any[] = await db.select().from(inventoryLedger).where(eq(inventoryLedger.correlationId, (fxClosed as any).returnId));
    client.close();
    ok('R-CASH ket dong: phieu o APPROVED, khong ledger', h.status === 'APPROVED' && led.length === 0,
      `status=${h.status} ledger=${led.length}`);
  }
  // Dựng lại két mới cho các ca còn lại (két cũ đã đóng).
  const sess2 = await runSolo(url, 'openCashbox', { warehouseId: 'wh-au-co', cashierId: 'cp3c-cashier', openingCash: 0 });
  ok('R-CASH setup ket 2 OPEN', sess2.success, sess2.error);
  if (!sess2.success) return;
  const sess2Id = (sess2.data as any).session.id;

  // 2. Sai kho: két kho khác.
  const sessW = await runSolo(url, 'openCashbox', { warehouseId: 'wh-quynh-mai', cashierId: 'cp3c-cashier', openingCash: 0 });
  ok('R-CASH setup ket sai kho', sessW.success, sessW.error);
  if (sessW.success) {
    const bad = await cashReturn(`${k}-wrongwh`, (sessW.data as any).session.id, 'cp3c-mgr');
    ok('R-CASH sai kho bi chan', bad.setup && !(bad as any).result.success,
      bad.setup ? `${(bad as any).result.code}` : (bad as any).error);
    if (bad.setup) {
      const { client, db } = localDb(url);
      const h: any = (await db.select().from(returnOrders).where(eq(returnOrders.id, (bad as any).returnId)))[0];
      const led: any[] = await db.select().from(inventoryLedger).where(eq(inventoryLedger.correlationId, (bad as any).returnId));
      client.close();
      ok('R-CASH sai kho: phieu o APPROVED, khong ledger', h.status === 'APPROVED' && led.length === 0,
        `status=${h.status} ledger=${led.length}`);
    }
  }
  // 3. Sai chủ sở hữu: két của thu ngân khác.
  const sessO = await runSolo(url, 'openCashbox', { warehouseId: 'wh-au-co', cashierId: 'cp3c-other', openingCash: 0 });
  ok('R-CASH setup ket sai chu', sessO.success, sessO.error);
  if (sessO.success) {
    const bad = await cashReturn(`${k}-wrongowner`, (sessO.data as any).session.id, 'cp3c-mgr');
    ok('R-CASH sai chu bi chan', bad.setup && !(bad as any).result.success,
      bad.setup ? `${(bad as any).result.code}` : (bad as any).error);
  }
  // 4. Đối chứng đúng két: thành công, refund = giá chốt.
  const goodFx = await approvedReturn(url, editionId, 3, 1, `${k}-good`, 'CASH', 'RESTOCK', sess2Id);
  ok('R-CASH setup dung ket', goodFx.ok, !goodFx.ok ? (goodFx as any).error : undefined);
  if (goodFx.ok) {
    const done = await runSolo(url, 'complete', {
      returnId: (goodFx as any).returnId, actorStaffId: 'cp3c-cashier', actorRole: 'ROLE_MANAGER',
      idempotencyKey: `${k}-good-done`,
    });
    ok('R-CASH dung ket complete thanh cong', done.success, done.error);
    if (done.success) {
      const { client, db } = localDb(url);
      const h: any = (await db.select().from(returnOrders).where(eq(returnOrders.id, (goodFx as any).returnId)))[0];
      client.close();
      ok('R-CASH refund dung so server chot', h.status === 'COMPLETED' && h.refundAmount === 100000, `status=${h.status} refund=${h.refundAmount}`);
    }
  }
}

// ------------------------------------------------------------------ R-I2 ---
async function probeRI2() {
  console.log('--- R-I2: complete idempotency ---');
  const { url, editionId } = await freshProbeDb('RI2', 50);
  const k = `cp3c-i2-${Date.now()}`;
  const fx = await approvedReturn(url, editionId, 3, 1, k);
  ok('R-I2 setup phieu APPROVED', fx.ok, !fx.ok ? (fx as any).error : undefined);
  if (!fx.ok) return;
  const rid = (fx as any).returnId;
  const base = { returnId: rid, actorStaffId: 'cp3c-mgr', actorRole: 'ROLE_MANAGER', idempotencyKey: `${k}-same` };
  const rr = await runRace(url, [
    { action: 'complete', payload: base },
    { action: 'complete', payload: { ...base } },
  ]);
  const rsucc = rr.filter((r) => r.success);
  ok('R-I2 cung key+payload: ca 2 tra ve', rsucc.length === 2,
    JSON.stringify(rr.map((r) => ({ s: r.success, c: r.code }))));
  ok('R-I2 replay khong nhan doi hieu ung', rsucc.length === 2 && rsucc.every((r) => r.data?.status === 'COMPLETED'));
  // Cùng key, khác actor -> conflict.
  const fx2 = await approvedReturn(url, editionId, 3, 1, `${k}-b`);
  ok('R-I2 setup phieu 2', fx2.ok, !fx2.ok ? (fx2 as any).error : undefined);
  if (!fx2.ok) return;
  const c1 = await runSolo(url, 'complete', {
    returnId: (fx2 as any).returnId, actorStaffId: 'cp3c-mgr', actorRole: 'ROLE_MANAGER', idempotencyKey: `${k}-diff`,
  });
  ok('R-I2 complete 1 thanh cong', c1.success, c1.error);
  const c2 = await runSolo(url, 'complete', {
    returnId: (fx2 as any).returnId, actorStaffId: 'cp3c-other', actorRole: 'ROLE_MANAGER', idempotencyKey: `${k}-diff`,
  });
  void c1;
  ok('R-I2 khac actor nhan IDEMPOTENCY_CONFLICT', !c2.success && c2.code === 'IDEMPOTENCY_CONFLICT',
    `${c2.code}: ${c2.error}`);
}

// --------------------------------------------------------------- R-ATOMIC ---
async function probeRAtomic() {
  console.log('--- R-ATOMIC: ep loi giua chung (fault hook) ---');
  const { url, editionId } = await freshProbeDb('RATOMIC', 50);
  const k = `cp3c-atomic-${Date.now()}`;
  const fx = await approvedReturn(url, editionId, 3, 1, k);
  ok('R-ATOMIC setup phieu APPROVED', fx.ok, !fx.ok ? (fx as any).error : undefined);
  if (!fx.ok) return;
  const rid = (fx as any).returnId;
  const r = await runSolo(url, 'complete', {
    returnId: rid, actorStaffId: 'cp3c-mgr', actorRole: 'ROLE_MANAGER', idempotencyKey: `${k}-fault`,
  }, { CP3_R2_FAULT: 'after-inbound', CP3_R2_FAULT_RETURN: rid });
  ok('R-ATOMIC loi ep that bai complete', !r.success, `${r.code}`);
  const { client, db } = localDb(url);
  const h: any = (await db.select().from(returnOrders).where(eq(returnOrders.id, rid)))[0];
  const led: any[] = await db.select().from(inventoryLedger).where(eq(inventoryLedger.correlationId, rid));
  const rmas: any[] = await db.select().from(rmaTickets);
  const acts: any[] = await db.select().from(returnActions).where(eq(returnActions.returnId, rid));
  const bals: any[] = await db.select().from(stockBalances).where(eq(stockBalances.editionId, editionId));
  client.close();
  const total = bals.reduce((s: number, b: any) => s + (b.physicalQuantity as number), 0);
  ok('R-ATOMIC phieu o APPROVED', h.status === 'APPROVED', h.status);
  ok('R-ATOMIC khong ledger mo coi', led.length === 0, `ledger=${led.length}`);
  ok('R-ATOMIC khong RMA', rmas.length === 0, `rma=${rmas.length}`);
  ok('R-ATOMIC khong action COMPLETE (chi APPROVE setup)',
    acts.filter((a) => a.action === 'COMPLETE').length === 0, `complete-actions=${acts.filter((a) => a.action === 'COMPLETE').length}`);
  ok('R-ATOMIC ton nguyen 47 (khong doi so voi truoc complete)', total === 47, `stock=${total}`);
}

async function main() {
  console.log('CP3-R2 COMPLETE PROBES — REFUND-only (EXCHANGE/DAMAGED_REPLACE fail-closed R3)');
  await probeRCC();
  await probeRDQ();
  await probeRCash();
  await probeRI2();
  await probeRAtomic();
  console.log('=========================================================================');
  if (failures.length > 0) {
    console.error(`❌ CP3-R2: ${failures.length} assertion do:\n - ${failures.join('\n - ')}`);
    process.exit(1);
  }
  console.log('🎉 CP3-R2: TAT CA COMPLETE PROBES XANH!');
}

main().catch((e) => { console.error('❌ Loi chay CP3-R2:', e); process.exit(1); });
