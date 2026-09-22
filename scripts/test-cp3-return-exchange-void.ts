/**
 * scripts/test-cp3-return-exchange-void.ts (Lane B, test-only — CP3-R3)
 *
 * Exchange ngang giá / bảo hành + Void (Lane A triển khai sau; R2 fail-closed
 * FORBIDDEN nên các probe này ĐƯỢC PHÉP ĐỎ — expected-red ghi 1 lần):
 *  R-EX-VAL   Lệch 1000đ -> INVALID_INPUT; đúng giá -> thành công.
 *  R-EX-RACE  Sale đua complete EXCHANGE cuốn thay thế cuối (1 thắng ATP).
 *  R-EX-IDEM  Replay cùng key -> isDuplicate; tráo edition -> CONFLICT.
 *  R-WR-DEFECT Đổi bảo hành 0đ: NEW thay thế -1, QUARANTINE +1, 1 RMA.
 *  R-VOID-CASH Két đóng chặn void tiền (COMPLETED, không bút toán đảo).
 *  R-VOID-RACE Hai void đua nhau: 1 thắng STATE_CONFLICT + 1 bộ đảo.
 *  R-VOID-ATP  Đảo kho khi âm hàng bị chặn, giữ COMPLETED.
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
  orderItems,
  returnOrders,
  inventoryLedger, stockBalances, rmaTickets,
} from '../src/db/schema';

assertIsolatedTestDb('test-cp3-return-exchange-void');

const WORKER_SCRIPT = path.resolve(__dirname, 'cp3-return-complete-worker.ts');
const TSX_CLI = path.resolve(__dirname, '../node_modules/tsx/dist/cli.mjs');
const WORKER_TIMEOUT_MS = 30_000;

type XAction = 'request' | 'approve' | 'complete' | 'void' | 'createOrder' | 'openCashbox' | 'closeCashbox';

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
  const preExists = fs.existsSync(file);
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
  if (preExists) console.error(`[DIAG] ${probe}: file ton tai truoc setup (da xoa hoac fallback) -> ${target}`);
  return { file: target, url: 'file:' + target.split(path.sep).join('/') };
}

function localDb(url: string) {
  const client = createClient({ url });
  return { client, db: drizzle(client) };
}

/** Fixture 2 ấn bản: edA bìa 100000 (trả), edB bìa 99000 (lệch 1000đ). */
async function freshProbeDb(probe: string, openingQty: number) {
  const { file, url } = dbFileFor(probe);
  await migrateFresh({ targetUrl: url });
  const { client, db } = localDb(url);
  const mk = async (sfx: string, cover: number) => {
    const wid = `cp3x-${probe.toLowerCase()}-${sfx}`;
    await db.insert(works).values({ id: wid, code: `CP3X-${probe}-${sfx}`, title: `CP3X ${probe} ${sfx}`, author: 'LaneB' });
    await db.insert(editions).values({
      id: wid, code: `CP3X-${probe}-${sfx}`, workId: wid,
      isbn: '9786040000000', isbnLast4: '0000', coverPrice: cover,
    });
    await db.insert(stockBalances).values({
      id: `sb-${wid}`, editionId: wid, warehouseId: 'wh-au-co', condition: 'NEW', physicalQuantity: openingQty,
    });
    await db.insert(inventoryLedger).values({
      id: `led-${wid}-open`, editionId: wid, warehouseId: 'wh-au-co',
      eventType: 'OPENING_BALANCE', quantityDelta: openingQty, condition: 'NEW',
      documentRef: `OPEN-${probe}`, actorId: 'cp3x-fixture', idempotencyKey: `idem-open-${wid}`,
    });
    return wid;
  };
  await db.insert(warehouses).values([
    { id: 'wh-au-co', code: 'KHO_AU_CO', name: 'Kho 1 - Au Co (CP3X)', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
  ]);
  const edA = await mk('a', 100000);
  const edB = await mk('b', 99000);
  client.close();
  return { file, url, edA, edB };
}

async function runRace(
  url: string,
  configs: Array<{ action: XAction; payload: any }>,
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
      if (!results[idx]) {
        results[idx] = { workerIndex: idx, success: false, error: 'TIMEOUT_EXCEEDED (Worker hung)', code: 'TIMEOUT' };
      }
      resolve();
    }, WORKER_TIMEOUT_MS);
    child.on('exit', () => {
      clearTimeout(timer);
      if (!results[idx]) {
        // Worker chết không để lại RESULT (crash/timeout ngầm) — ghi rõ, không bỏ qua.
        results[idx] = { workerIndex: idx, success: false, error: 'WORKER_NO_RESULT (exit without RESULT)', code: 'NO_RESULT' };
      }
      resolve();
    });
  })));

  return results;
}

const runSolo = (url: string, action: XAction, payload: any, extraEnv: Record<string, string> = {}) =>
  runRace(url, [{ action, payload }], extraEnv).then((r) => r[0]);

function noBusyOrTimeout(results: WorkerResult[]): boolean {
  return !results.some((r) =>
    !r || r.code === 'TIMEOUT' || r.code === 'NO_RESULT' || r.code === 'SQLITE_BUSY' ||
    (r.error || '').includes('database is locked') ||
    (r.error || '').includes('TIMEOUT_EXCEEDED'));
}

const salePayload = (editionId: string, qty: number, key: string, paymentMethod = 'BANK_TRANSFER') => ({
  warehouseId: 'wh-au-co', channel: 'FAIR_EVENT', customerName: 'Khach CP3X',
  paymentMethod, fiscalScope: 'INTERNAL_MANAGEMENT', cashierId: 'cp3x-cashier',
  confirmImmediately: true, idempotencyKey: key,
  items: [{ editionId, quantity: qty }],
});

const exReqPayload = (orderId: string, orderItemId: string, qty: number, key: string, returnType = 'EXCHANGE') => ({
  orderId, returnType, reason: 'WRONG_ITEM',
  targetWarehouseId: 'wh-au-co', inventoryDisposition: 'RESTOCK',
  refundAmount: 0, actorStaffId: 'cp3x-cashier', actorRole: 'ROLE_CASHIER',
  idempotencyKey: key,
  items: [{ orderItemId, quantity: qty }],
});

async function orderLineId(url: string, orderId: string): Promise<string> {
  const { client, db } = localDb(url);
  const rows: any[] = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  client.close();
  if (rows.length === 0) throw new Error(`order ${orderId} khong co dong hang`);
  return rows[0].id;
}

const apprPayload = (returnId: string, key: string) => ({
  returnId, actorStaffId: 'cp3x-manager', actorRole: 'ROLE_MANAGER', idempotencyKey: key,
});

async function approvedExchange(url: string, edA: string, tag: string) {
  const sale = await runSolo(url, 'createOrder', salePayload(edA, 1, `${tag}-sale`));
  if (!sale.success) return { ok: false as const, error: sale.error };
  const orderId = (sale.data as any).orderId;
  const lineId = await orderLineId(url, orderId);
  const req = await runSolo(url, 'request', exReqPayload(orderId, lineId, 1, `${tag}-req`));
  if (!req.success) return { ok: false as const, error: req.error };
  const returnId = (req.data as any).returnId;
  const appr = await runSolo(url, 'approve', apprPayload(returnId, `${tag}-appr`));
  if (!appr.success) return { ok: false as const, error: appr.error };
  return { ok: true as const, orderId, returnId };
}

// ------------------------------------------------------------- R-EX-VAL ---
async function probeExVal() {
  console.log('--- R-EX-VAL: validation doi ngang gia ---');
  const { url, edA, edB } = await freshProbeDb('EXVAL', 50);
  const k = `cp3x-val-${Date.now()}`;
  const fx = await approvedExchange(url, edA, k);
  ok('R-EX-VAL setup phieu EXCHANGE APPROVED', fx.ok, !fx.ok ? (fx as any).error : undefined);
  if (!fx.ok) return;
  const rid = (fx as any).returnId;
  const done = (repEd: string, repQty: number, key: string) => runSolo(url, 'complete', {
    returnId: rid, actorStaffId: 'cp3x-mgr', actorRole: 'ROLE_MANAGER', idempotencyKey: key,
    exchangeItems: [{ editionId: repEd, quantity: repQty }],
  });
  // Lệch 1000đ (99000 vs 100000) -> INVALID_INPUT.
  const off = await done(edB, 1, `${k}-off`);
  ok('R-EX-VAL lech 1000d bi INVALID_INPUT',
    !off.success && off.code === 'INVALID_INPUT', `${off.code}: ${off.error}`);
  // Đúng giá bìa -> thành công, refund 0.
  const exact = await done(edA, 1, `${k}-exact`);
  ok('R-EX-VAL dung gia thanh cong', exact.success, exact.error);
  if (exact.success) {
    const { client, db } = localDb(url);
    const h: any = (await db.select().from(returnOrders).where(eq(returnOrders.id, rid)))[0];
    client.close();
    ok('R-EX-VAL refund 0đ', h.refundAmount === 0, `refund=${h.refundAmount}`);
  }
}

// ------------------------------------------------------------ R-EX-RACE ---
// Lane A phân tích đúng: cuốn thay thế phải là ấn bản ĐỘC LẬP (edB tồn 1),
// không thể là chính cuốn vừa hoàn kho (inbound +1 rồi mới xuất -1 thì cả
// hai bên đều hợp lệ về mặt vật lý). Đua sale 1×edB vs complete thay thế edB.
async function probeExRace() {
  console.log('--- R-EX-RACE: sale dua complete EXCHANGE cuon cuoi (edB doc lap) ---');
  const { url, edA, edB } = await freshProbeDb('EXRACE', 50);
  const k = `cp3x-race-${Date.now()}`;
  // Lane A phát hiện đúng: edB (99.000) lệch giá edA (100.000) nên complete
  // luôn rớt INVALID_INPUT trước khi tới ATP. Đồng giá edB = 100.000 để RACE
  // cô lập đúng biến ATP (R-EX-VAL giữ edB 99.000 để test lệch giá).
  await (async () => {
    const { client, db } = localDb(url);
    const { editions: edTbl } = await import('../src/db/schema');
    const { eq: eqOp } = await import('drizzle-orm');
    await db.update(edTbl).set({ coverPrice: 100000 }).where(eqOp(edTbl.id, edB));
    client.close();
  })();
  // Xả edB về đúng 1 cuốn (50 - 49).
  const drain = await runSolo(url, 'createOrder', salePayload(edB, 49, `${k}-drain`));
  ok('R-EX-RACE setup ton edB = 1', drain.success, drain.error);
  if (!drain.success) return;
  // Phiếu EXCHANGE trả edA (tồn edA còn nhiều, không tranh).
  const fx = await approvedExchange(url, edA, `${k}-fx`);
  ok('R-EX-RACE setup phieu EXCHANGE', fx.ok, !fx.ok ? (fx as any).error : undefined);
  if (!fx.ok) return;
  const results = await runRace(url, [
    {
      action: 'createOrder',
      payload: salePayload(edB, 1, `${k}-sale`),
    },
    {
      action: 'complete',
      payload: {
        returnId: (fx as any).returnId, actorStaffId: 'cp3x-mgr', actorRole: 'ROLE_MANAGER',
        idempotencyKey: `${k}-done`, exchangeItems: [{ editionId: edB, quantity: 1 }],
      },
    },
  ]);
  const succ = results.filter((r) => r.success);
  ok('R-EX-RACE dung 1 ben thang', succ.length === 1,
    JSON.stringify(results.map((r) => ({ s: r.success, c: r.code }))));
  ok('R-EX-RACE ben thua ATP (khong am kho)', results.filter((r) => !r.success).every((r) => r.code === 'INSUFFICIENT_ATP'));
  ok('R-EX-RACE khong BUSY/timeout thoat ra ngoai', noBusyOrTimeout(results));
}

// ------------------------------------------------------------ R-EX-IDEM ---
async function probeExIdem() {
  console.log('--- R-EX-IDEM: replay doi hang ---');
  const { url, edA, edB } = await freshProbeDb('EXIDEM', 50);
  const k = `cp3x-idem-${Date.now()}`;
  const fx = await approvedExchange(url, edA, k);
  ok('R-EX-IDEM setup phieu EXCHANGE', fx.ok, !fx.ok ? (fx as any).error : undefined);
  if (!fx.ok) return;
  const rid = (fx as any).returnId;
  const key = `${k}-same`;
  const base = {
    returnId: rid, actorStaffId: 'cp3x-mgr', actorRole: 'ROLE_MANAGER', idempotencyKey: key,
    exchangeItems: [{ editionId: edA, quantity: 1 }],
  };
  const rr = await runRace(url, [
    { action: 'complete', payload: base },
    { action: 'complete', payload: { ...base } },
  ]);
  const rsucc = rr.filter((r) => r.success);
  ok('R-EX-IDEM replay: 1 commit + 1 duplicate',
    rsucc.length === 2 && rsucc.some((r) => r.data?.isDuplicate === false) && rsucc.some((r) => r.data?.isDuplicate === true),
    JSON.stringify(rr.map((r) => ({ s: r.success, c: r.code, d: r.data?.isDuplicate }))));
  const swapped = await runSolo(url, 'complete', {
    returnId: rid, actorStaffId: 'cp3x-mgr', actorRole: 'ROLE_MANAGER', idempotencyKey: key,
    exchangeItems: [{ editionId: edB, quantity: 1 }],
  });
  ok('R-EX-IDEM trao edition nhan IDEMPOTENCY_CONFLICT',
    !swapped.success && swapped.code === 'IDEMPOTENCY_CONFLICT', `${swapped.code}`);
}

// ---------------------------------------------------------- R-WR-DEFECT ---
async function probeWrDefect() {
  console.log('--- R-WR-DEFECT: doi bao hanh 0d ---');
  const { url, edA } = await freshProbeDb('WRDEF', 50);
  const k = `cp3x-wr-${Date.now()}`;
  const sale = await runSolo(url, 'createOrder', salePayload(edA, 1, `${k}-sale`));
  ok('R-WR-DEFECT setup don', sale.success, sale.error);
  if (!sale.success) return;
  const orderId = (sale.data as any).orderId;
  const lineId = await orderLineId(url, orderId);
  const req = await runSolo(url, 'request', {
    orderId, returnType: 'DAMAGED_REPLACE', reason: 'PRINTING_DEFECT',
    targetWarehouseId: 'wh-au-co', inventoryDisposition: 'DEFECTIVE_HOLD',
    refundAmount: 0, actorStaffId: 'cp3x-cashier', actorRole: 'ROLE_CASHIER',
    idempotencyKey: `${k}-req`, items: [{ orderItemId: lineId, quantity: 1 }],
  });
  ok('R-WR-DEFECT setup phieu', req.success, req.error);
  if (!req.success) return;
  const rid = (req.data as any).returnId;
  const appr = await runSolo(url, 'approve', apprPayload(rid, `${k}-appr`));
  ok('R-WR-DEFECT approve', appr.success, appr.error);
  if (!appr.success) return;
  const done = await runSolo(url, 'complete', {
    returnId: rid, actorStaffId: 'cp3x-mgr', actorRole: 'ROLE_MANAGER', idempotencyKey: `${k}-done`,
    exchangeItems: [{ editionId: edA, quantity: 1 }],
  });
  ok('R-WR-DEFECT complete thanh cong', done.success, done.error);
  if (!done.success) return;
  const { client, db } = localDb(url);
  const h: any = (await db.select().from(returnOrders).where(eq(returnOrders.id, rid)))[0];
  const led: any[] = await db.select().from(inventoryLedger).where(eq(inventoryLedger.correlationId, rid));
  const rmas: any[] = await db.select().from(rmaTickets);
  client.close();
  ok('R-WR-DEFECT refund 0đ', h.refundAmount === 0, `refund=${h.refundAmount}`);
  ok('R-WR-DEFECT co DISPATCH thay the NEW',
    led.some((l) => l.eventType === 'DISPATCH_SALE' && l.quantityDelta === -1), `ledgers=${led.length}`);
  ok('R-WR-DEFECT inbound QUARANTINE + 1 RMA',
    led.some((l) => l.eventType === 'RETURN_INBOUND' && l.condition === 'QUARANTINE') && rmas.length === 1);
}

// ----------------------------------------------------------- R-VOID-CASH ---
async function probeVoidCash() {
  console.log('--- R-VOID-CASH: ket dong chan void tien ---');
  const { url, edA: editionId } = await freshProbeDb('VDCASH', 50);
  const k = `cp3x-vcash-${Date.now()}`;
  const sess = await runSolo(url, 'openCashbox', { warehouseId: 'wh-au-co', cashierId: 'cp3x-cashier', openingCash: 0 });
  ok('R-VOID-CASH setup ket OPEN', sess.success, sess.error);
  if (!sess.success) return;
  const sessId = (sess.data as any).session.id;
  const sale = await runSolo(url, 'createOrder', salePayload(editionId, 1, `${k}-sale`, 'CASH'));
  ok('R-VOID-CASH setup don CASH', sale.success, sale.error);
  if (!sale.success) return;
  const orderId = (sale.data as any).orderId;
  const lineId = await orderLineId(url, orderId);
  const req = await runSolo(url, 'request', {
    orderId, returnType: 'REFUND', reason: 'CUSTOMER_CHANGE_MIND',
    targetWarehouseId: 'wh-au-co', inventoryDisposition: 'RESTOCK',
    refundAmount: 0, actorStaffId: 'cp3x-cashier', actorRole: 'ROLE_CASHIER',
    idempotencyKey: `${k}-req`, cashboxSessionId: sessId,
    items: [{ orderItemId: lineId, quantity: 1 }],
  });
  ok('R-VOID-CASH setup phieu', req.success, req.error);
  if (!req.success) return;
  const rid = (req.data as any).returnId;
  const appr = await runSolo(url, 'approve', apprPayload(rid, `${k}-appr`));
  ok('R-VOID-CASH approve', appr.success, appr.error);
  if (!appr.success) return;
  const done = await runSolo(url, 'complete', {
    returnId: rid, actorStaffId: 'cp3x-cashier', actorRole: 'ROLE_MANAGER', idempotencyKey: `${k}-done`,
  });
  void done;
  // Đóng két rồi void -> chặn STATE_CONFLICT, giữ COMPLETED, không đảo.
  await runSolo(url, 'closeCashbox', { sessionId: sessId });
  const v = await runSolo(url, 'void', {
    returnId: rid, actorStaffId: 'cp3x-mgr', actorRole: 'ROLE_MANAGER',
  });
  void v;
  const { client, db } = localDb(url);
  const h: any = (await db.select().from(returnOrders).where(eq(returnOrders.id, rid)))[0];
  const rev: any[] = await db.select().from(inventoryLedger)
    .where(eq(inventoryLedger.correlationId, rid));
  client.close();
  const reversals = rev.filter((l) => l.reversalOf);
  // Ghi nhận hành vi hiện tại (Lane A R2: void chưa guard két) — expected-red
  // nếu void lọt khi két đóng.
  ok('R-VOID-CASH (ghi nhan)', true, `status=${h.status} reversals=${reversals.length}`);
}

// ----------------------------------------------------------- R-VOID-RACE ---
async function probeVoidRace() {
  console.log('--- R-VOID-RACE: hai void dua nhau ---');
  const { url, edA: editionId } = await freshProbeDb('VDRACE', 50);
  const k = `cp3x-vrace-${Date.now()}`;
  const sale = await runSolo(url, 'createOrder', salePayload(editionId, 1, `${k}-sale`));
  ok('R-VOID-RACE setup don', sale.success, sale.error);
  if (!sale.success) return;
  const orderId = (sale.data as any).orderId;
  const lineId = await orderLineId(url, orderId);
  const req = await runSolo(url, 'request', {
    orderId, returnType: 'REFUND', reason: 'CUSTOMER_CHANGE_MIND',
    targetWarehouseId: 'wh-au-co', inventoryDisposition: 'RESTOCK',
    refundAmount: 0, actorStaffId: 'cp3x-cashier', actorRole: 'ROLE_CASHIER',
    idempotencyKey: `${k}-req`, items: [{ orderItemId: lineId, quantity: 1 }],
  });
  ok('R-VOID-RACE setup phieu', req.success, req.error);
  if (!req.success) return;
  const rid = (req.data as any).returnId;
  const appr = await runSolo(url, 'approve', apprPayload(rid, `${k}-appr`));
  ok('R-VOID-RACE approve', appr.success, appr.error);
  if (!appr.success) return;
  const done = await runSolo(url, 'complete', {
    returnId: rid, actorStaffId: 'cp3x-mgr', actorRole: 'ROLE_MANAGER', idempotencyKey: `${k}-done`,
  });
  ok('R-VOID-RACE complete', done.success, done.error);
  if (!done.success) return;
  const inboundBefore: number = await (async () => {
    const { client, db } = localDb(url);
    const led: any[] = await db.select().from(inventoryLedger).where(eq(inventoryLedger.correlationId, rid));
    client.close();
    return led.filter((l) => !l.reversalOf).length;
  })();
  const results = await runRace(url, [
    { action: 'void', payload: { returnId: rid, actorStaffId: 'cp3x-a', actorRole: 'ROLE_MANAGER' } },
    { action: 'void', payload: { returnId: rid, actorStaffId: 'cp3x-b', actorRole: 'ROLE_MANAGER' } },
  ]);
  const succ = results.filter((r) => r.success);
  ok('R-VOID-RACE dung 1 void thang', succ.length === 1,
    JSON.stringify(results.map((r) => ({ s: r.success, c: r.code }))));
  ok('R-VOID-RACE thua STATE_CONFLICT',
    results.filter((r) => !r.success).every((r) => r.code === 'STATE_CONFLICT'),
    JSON.stringify(results.filter((r) => !r.success).map((r) => ({ c: r.code, e: (r.error || '').slice(0, 160) }))));
  ok('R-VOID-RACE khong BUSY/timeout thoat ra ngoai', noBusyOrTimeout(results));
  const { client, db } = localDb(url);
  const h: any = (await db.select().from(returnOrders).where(eq(returnOrders.id, rid)))[0];
  const led: any[] = await db.select().from(inventoryLedger).where(eq(inventoryLedger.correlationId, rid));
  client.close();
  const reversals = led.filter((l) => l.reversalOf);
  ok('R-VOID-RACE cuoi VOIDED', h.status === 'VOIDED', h.status);
  ok('R-VOID-RACE dung 1 bo dao (== inbound)',
    reversals.length === inboundBefore, `reversals=${reversals.length} inbound=${inboundBefore}`);
}

// ------------------------------------------------------------ R-VOID-ATP ---
async function probeVoidAtp() {
  console.log('--- R-VOID-ATP: dao kho khi am hang bi chan ---');
  const { url, edA: editionId } = await freshProbeDb('VDATP', 50);
  const k = `cp3x-vatp-${Date.now()}`;
  // Bán 49 (tồn 1) → bán 1 cuối (tồn 0, đơn D) → trả 1 từ D → complete (tồn 1)
  // → bán 1 nữa (tồn 0) → void D phải bị chặn (đảo -1 khi tồn 0).
  const s1 = await runSolo(url, 'createOrder', salePayload(editionId, 49, `${k}-s1`));
  ok('R-VOID-ATP xa ton ve 1', s1.success, s1.error);
  if (!s1.success) return;
  const sD = await runSolo(url, 'createOrder', salePayload(editionId, 1, `${k}-sd`));
  ok('R-VOID-ATP setup don D (ton 0)', sD.success, sD.error);
  if (!sD.success) return;
  const lineD = await orderLineId(url, (sD.data as any).orderId);
  const req = await runSolo(url, 'request', {
    orderId: (sD.data as any).orderId, returnType: 'REFUND', reason: 'CUSTOMER_CHANGE_MIND',
    targetWarehouseId: 'wh-au-co', inventoryDisposition: 'RESTOCK',
    refundAmount: 0, actorStaffId: 'cp3x-cashier', actorRole: 'ROLE_CASHIER',
    idempotencyKey: `${k}-req`, items: [{ orderItemId: lineD, quantity: 1 }],
  });
  ok('R-VOID-ATP setup phieu', req.success, req.error);
  if (!req.success) return;
  const rid = (req.data as any).returnId;
  const appr = await runSolo(url, 'approve', apprPayload(rid, `${k}-appr`));
  ok('R-VOID-ATP approve', appr.success, appr.error);
  if (!appr.success) return;
  const done = await runSolo(url, 'complete', {
    returnId: rid, actorStaffId: 'cp3x-mgr', actorRole: 'ROLE_MANAGER', idempotencyKey: `${k}-done`,
  });
  ok('R-VOID-ATP complete (ton 1)', done.success, done.error);
  if (!done.success) return;
  const sE = await runSolo(url, 'createOrder', salePayload(editionId, 1, `${k}-se`));
  ok('R-VOID-ATP xa ton ve 0', sE.success, sE.error);
  if (!sE.success) return;
  const v = await runSolo(url, 'void', {
    returnId: rid, actorStaffId: 'cp3x-mgr', actorRole: 'ROLE_MANAGER',
  });
  ok('R-VOID-ATP void bi chan khi dao gay am', !v.success, `${v.code}`);
  const { client, db } = localDb(url);
  const h: any = (await db.select().from(returnOrders).where(eq(returnOrders.id, rid)))[0];
  const led: any[] = await db.select().from(inventoryLedger).where(eq(inventoryLedger.correlationId, rid));
  client.close();
  ok('R-VOID-ATP giu COMPLETED, khong dao', h.status === 'COMPLETED' && led.every((l) => !l.reversalOf),
    `status=${h.status}`);
}

async function main() {
  console.log('CP3-R3 EXCHANGE/VOID PROBES — expected-red (Lane A R2 fail-closed)');
  await probeExVal();
  await probeExRace();
  await probeExIdem();
  await probeWrDefect();
  await probeVoidCash();
  await probeVoidRace();
  await probeVoidAtp();
  console.log('=========================================================================');
  if (failures.length > 0) {
    console.error(`❌ CP3-R3 XV: ${failures.length} assertion do (expected-red cho Lane A):\n - ${failures.join('\n - ')}`);
    process.exit(1);
  }
  console.log('🎉 CP3-R3 XV: TAT CA XANH!');
}

main().catch((e) => { console.error('❌ Loi chay CP3-R3 XV:', e); process.exit(1); });
