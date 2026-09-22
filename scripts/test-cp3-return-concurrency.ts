/**
 * scripts/test-cp3-return-concurrency.ts (Lane A CP3-R1, test-only)
 *
 * 3 return probes + validation tuần tự (chỉ REQUESTED/APPROVED/REJECTED —
 * chưa complete/void/refund/ket):
 *  R-QQ  Hai request tranh quota (thắng 1, thua OVER_RETURN_LIMIT 409).
 *  R-AR  Approve cạnh tranh Reject (một transition, thua STATE_CONFLICT 409).
 *  R-I1  Idempotency request (replay / conflict / không giữ quota 2 lần).
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
import { eq, and } from 'drizzle-orm';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';
import {
  works, editions, warehouses,
  orders, orderItems,
  returnOrders, returnOrderItems, returnActions,
  inventoryLedger, stockBalances, rmaTickets,
} from '../src/db/schema';

assertIsolatedTestDb('test-cp3-return-concurrency');

const WORKER_SCRIPT = path.resolve(__dirname, 'cp3-return-concurrency-worker.ts');
const TSX_CLI = path.resolve(__dirname, '../node_modules/tsx/dist/cli.mjs');
const WORKER_TIMEOUT_MS = 30_000;

type RetAction = 'request' | 'approve' | 'reject' | 'createOrder';

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

/** DB probe mới: replay journal + seed tối thiểu (kho + ấn bản + tồn). */
async function freshProbeDb(probe: string, openingQty: number) {
  const { file, url } = dbFileFor(probe);
  await migrateFresh({ targetUrl: url });
  const { client, db } = localDb(url);
  const wid = `cp3r-${probe.toLowerCase()}`;
  await db.insert(works).values({ id: wid, code: `CP3R-${probe}`, title: `CP3R ${probe}`, author: 'LaneA' });
  await db.insert(editions).values({
    id: wid, code: `CP3R-${probe}`, workId: wid,
    isbn: '9786040000000', isbnLast4: '0000', coverPrice: 100000,
  });
  await db.insert(warehouses).values([
    { id: 'wh-au-co', code: 'KHO_AU_CO', name: 'Kho 1 - Au Co (CP3R)', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
  ]);
  await db.insert(stockBalances).values({
    id: `sb-${wid}`, editionId: wid, warehouseId: 'wh-au-co', condition: 'NEW', physicalQuantity: openingQty,
  });
  await db.insert(inventoryLedger).values({
    id: `led-${wid}-open`, editionId: wid, warehouseId: 'wh-au-co',
    eventType: 'OPENING_BALANCE', quantityDelta: openingQty, condition: 'NEW',
    documentRef: `OPEN-${probe}`, actorId: 'cp3r-fixture', idempotencyKey: `idem-open-${wid}`,
  });
  client.close();
  return { file, url, editionId: wid };
}

async function runRace(
  url: string,
  configs: Array<{ action: RetAction; payload: any }>,
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

const runSolo = (url: string, action: RetAction, payload: any) =>
  runRace(url, [{ action, payload }]).then((r) => r[0]);

function noBusyOrTimeout(results: WorkerResult[]): boolean {
  return !results.some((r) =>
    r.code === 'TIMEOUT' || r.code === 'SQLITE_BUSY' ||
    (r.error || '').includes('database is locked') ||
    (r.error || '').includes('TIMEOUT_EXCEEDED'));
}

const salePayload = (editionId: string, qty: number, key: string, confirmImmediately = true) => ({
  warehouseId: 'wh-au-co', channel: 'FAIR_EVENT', customerName: 'Khach CP3R',
  paymentMethod: 'BANK_TRANSFER', fiscalScope: 'INTERNAL_MANAGEMENT', cashierId: 'cp3r-cashier',
  confirmImmediately, idempotencyKey: key,
  items: [{ editionId, quantity: qty }],
});

const reqPayload = (orderId: string, orderItemId: string, qty: number, key: string, role = 'ROLE_CASHIER', staff = 'cp3r-cashier') => ({
  orderId, returnType: 'REFUND', reason: 'CUSTOMER_CHANGE_MIND',
  targetWarehouseId: 'wh-au-co', inventoryDisposition: 'RESTOCK',
  refundAmount: 0, actorStaffId: staff, actorRole: role,
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

async function counts(url: string) {
  const { client, db } = localDb(url);
  const n = async (t: any) => (await db.select().from(t)).length;
  const out = {
    returns: await n(returnOrders),
    returnItems: await n(returnOrderItems),
    actions: await n(returnActions),
  };
  client.close();
  return out;
}

// ------------------------------------------------------------------ R-QQ ---
async function probeRQQ() {
  console.log('--- R-QQ: hai request tranh quota (ban 2, moi ben xin 2) ---');
  const { url, editionId } = await freshProbeDb('RQQ', 50);
  const k = `cp3r-qq-${Date.now()}`;
  const sale = await runSolo(url, 'createOrder', salePayload(editionId, 2, `${k}-sale`));
  ok('R-QQ setup don COMPLETED', sale.success, sale.error);
  if (!sale.success) return;
  const lineId = await orderLineId(url, (sale.data as any).orderId);
  const results = await runRace(url, [
    { action: 'request', payload: reqPayload((sale.data as any).orderId, lineId, 2, `${k}-a`) },
    { action: 'request', payload: reqPayload((sale.data as any).orderId, lineId, 2, `${k}-b`) },
  ]);
  const succ = results.filter((r) => r.success);
  const fail = results.filter((r) => !r.success);
  ok('R-QQ dung 1 request thanh cong', succ.length === 1 && fail.length === 1,
    JSON.stringify(results.map((r) => ({ s: r.success, c: r.code }))));
  ok('R-QQ thua nhan OVER_RETURN_LIMIT (409)', fail.length === 1 && fail[0].code === 'OVER_RETURN_LIMIT',
    fail[0]?.code);
  ok('R-QQ khong BUSY/timeout thoat ra ngoai', noBusyOrTimeout(results));
  const c = await counts(url);
  ok('R-QQ tong quota giu khong vuot 2 (1 phieu x 2)', c.returns === 1, `returns=${c.returns}`);
  // Không ledger / RMA / tiền ở pha request.
  const { client, db } = localDb(url);
  const led: any[] = await db.select().from(inventoryLedger)
    .where(eq(inventoryLedger.documentRef, succ.length === 1 ? (succ[0].data as any).returnCode : 'nope'));
  const rmas: any[] = await db.select().from(rmaTickets);
  client.close();
  ok('R-QQ khong ledger kho cho phieu request', led.length === 0, `ledger=${led.length}`);
  ok('R-QQ khong RMA', rmas.length === 0, `rma=${rmas.length}`);
}

// ------------------------------------------------------------------ R-AR ---
async function probeRAR() {
  console.log('--- R-AR: approve canh tranh reject ---');
  const { url, editionId } = await freshProbeDb('RAR', 50);
  const k = `cp3r-ar-${Date.now()}`;
  const sale = await runSolo(url, 'createOrder', salePayload(editionId, 2, `${k}-sale`));
  ok('R-AR setup don COMPLETED', sale.success, sale.error);
  if (!sale.success) return;
  const lineId = await orderLineId(url, (sale.data as any).orderId);
  const req = await runSolo(url, 'request',
    reqPayload((sale.data as any).orderId, lineId, 1, `${k}-req`));
  ok('R-AR setup phieu REQUESTED', req.success, req.error);
  if (!req.success) return;
  const rid = (req.data as any).returnId;
  const results = await runRace(url, [
    {
      action: 'approve',
      payload: { returnId: rid, actorStaffId: 'cp3r-manager', actorRole: 'ROLE_MANAGER', idempotencyKey: `${k}-appr` },
    },
    {
      action: 'reject',
      payload: { returnId: rid, actorStaffId: 'cp3r-manager2', actorRole: 'ROLE_MANAGER', rejectNote: 'Het han', idempotencyKey: `${k}-rej` },
    },
  ]);
  const succ = results.filter((r) => r.success);
  const fail = results.filter((r) => !r.success);
  ok('R-AR dung 1 transition thang', succ.length === 1 && fail.length === 1,
    JSON.stringify(results.map((r) => ({ s: r.success, c: r.code }))));
  ok('R-AR thua nhan STATE_CONFLICT (409)', fail.length === 1 && fail[0].code === 'STATE_CONFLICT',
    fail[0]?.code);
  ok('R-AR khong BUSY/timeout thoat ra ngoai', noBusyOrTimeout(results));
  const { client, db } = localDb(url);
  const header: any = (await db.select().from(returnOrders).where(eq(returnOrders.id, rid)))[0];
  const acts: any[] = await db.select().from(returnActions).where(eq(returnActions.returnId, rid));
  const led: any[] = await db.select().from(inventoryLedger).where(eq(inventoryLedger.correlationId, rid));
  const rmas: any[] = await db.select().from(rmaTickets);
  client.close();
  ok('R-AR trang thai cuoi APPROVED hoac REJECTED',
    header.status === 'APPROVED' || header.status === 'REJECTED', header.status);
  ok('R-AR dung 1 action duoc ghi', acts.length === 1, `actions=${acts.length}`);
  ok('R-AR khong ledger kho', led.length === 0, `ledger=${led.length}`);
  ok('R-AR khong RMA', rmas.length === 0, `rma=${rmas.length}`);
}

// ------------------------------------------------------------------ R-I1 ---
async function probeRI1() {
  console.log('--- R-I1: idempotency request ---');
  const { url, editionId } = await freshProbeDb('RI1', 50);
  const k = `cp3r-i1-${Date.now()}`;
  const sale = await runSolo(url, 'createOrder', salePayload(editionId, 3, `${k}-sale`));
  ok('R-I1 setup don COMPLETED', sale.success, sale.error);
  if (!sale.success) return;
  const orderId = (sale.data as any).orderId;
  const lineId = await orderLineId(url, orderId);
  const base = reqPayload(orderId, lineId, 1, `${k}-same`);
  // Cùng key + cùng payload đua nhau.
  const rr = await runRace(url, [
    { action: 'request', payload: base },
    { action: 'request', payload: { ...base } },
  ]);
  const rsucc = rr.filter((r) => r.success);
  ok('R-I1 cung key+payload: ca 2 tra ve', rsucc.length === 2,
    JSON.stringify(rr.map((r) => ({ s: r.success, c: r.code }))));
  ok('R-I1 cung return ID',
    rsucc.length === 2 && rsucc[0].data?.returnId === rsucc[1].data?.returnId);
  ok('R-I1 khong BUSY/timeout thoat ra ngoai', noBusyOrTimeout(rr));
  // Cùng key, đổi quantity -> CONFLICT.
  const diff = await runSolo(url, 'request',
    reqPayload(orderId, lineId, 2, `${k}-same`));
  ok('R-I1 doi quantity nhan IDEMPOTENCY_CONFLICT',
    !diff.success && diff.code === 'IDEMPOTENCY_CONFLICT', `${diff.code}: ${diff.error}`);
  // Replay không giữ quota lần hai: chỉ 1 phiếu tồn tại.
  const c = await counts(url);
  ok('R-I1 replay khong nhan doi phieu', c.returns === 1, `returns=${c.returns}`);
}

// ------------------------------------------------------- validation -------
async function probeValidation() {
  console.log('--- R-VAL: validation tuan tu ---');
  const { url, editionId } = await freshProbeDb('RVAL', 50);
  const k = `cp3r-val-${Date.now()}`;
  const sale = await runSolo(url, 'createOrder', salePayload(editionId, 2, `${k}-sale`));
  ok('R-VAL setup don COMPLETED', sale.success, sale.error);
  if (!sale.success) return;
  const orderId = (sale.data as any).orderId;
  const lineId = await orderLineId(url, orderId);
  const good = reqPayload(orderId, lineId, 1, `${k}-good`);
  const goodRes = await runSolo(url, 'request', good);
  ok('R-VAL base request thanh cong', goodRes.success, goodRes.error);

  // Đơn chưa COMPLETED (pending) bị chặn.
  const pend = await runSolo(url, 'createOrder', salePayload(editionId, 1, `${k}-pend`, false));
  ok('R-VAL setup don PENDING', pend.success, pend.error);
  if (pend.success) {
    const pendLine = await orderLineId(url, (pend.data as any).orderId);
    const r = await runSolo(url, 'request', reqPayload((pend.data as any).orderId, pendLine, 1, `${k}-p`));
    ok('R-VAL don chua COMPLETED bi chan', !r.success, `${r.code}`);
  }
  // orderItemId không thuộc đơn bị chặn.
  const sale2 = await runSolo(url, 'createOrder', salePayload(editionId, 1, `${k}-sale2`));
  ok('R-VAL setup don 2', sale2.success, sale2.error);
  if (sale2.success) {
    const foreignLine = await orderLineId(url, (sale2.data as any).orderId);
    const r = await runSolo(url, 'request', reqPayload(orderId, foreignLine, 1, `${k}-foreign`));
    ok('R-VAL orderItemId la bi chan', !r.success, `${r.code}`);
  }
  // Quantity 0 / âm / 1.5 bị chặn.
  for (const q of [0, -1, 1.5]) {
    const r = await runSolo(url, 'request', reqPayload(orderId, lineId, q, `${k}-q${String(q)}`));
    ok(`R-VAL quantity ${q} bi chan`, !r.success, `${r.code}`);
  }
  // Thiếu key bị chặn.
  const noKey: any = { ...good };
  delete noKey.idempotencyKey;
  const rnk = await runSolo(url, 'request', noKey);
  ok('R-VAL thieu key bi chan', !rnk.success, `${rnk.code}`);
  // TAX / WAREHOUSE lập phiếu bị chặn.
  for (const role of ['ROLE_TAX', 'ROLE_WAREHOUSE']) {
    const r = await runSolo(url, 'request', reqPayload(orderId, lineId, 1, `${k}-${role}`, role, `cp3r-${role}`));
    ok(`R-VAL ${role} bi chan`, !r.success && r.code === 'FORBIDDEN', `${r.code}`);
  }
  // TAX duyệt bị chặn.
  const req0 = await runSolo(url, 'request', { ...good, idempotencyKey: `${k}-forappr` });
  ok('R-VAL setup phieu cho approve', req0.success, req0.error);
  if (req0.success) {
    const taxAppr = await runSolo(url, 'approve', {
      returnId: (req0.data as any).returnId, actorStaffId: 'cp3r-tax', actorRole: 'ROLE_TAX',
      idempotencyKey: `${k}-taxappr`,
    });
    ok('R-VAL TAX approve bi chan', !taxAppr.success && taxAppr.code === 'FORBIDDEN', `${taxAppr.code}`);
  }
  // Orphan check: mọi return đều có items.
  const { client: c2, db: d2 } = localDb(url);
  const rets: any[] = await d2.select().from(returnOrders);
  const ritems: any[] = await d2.select().from(returnOrderItems);
  c2.close();
  ok('R-VAL khong return mo coi (thieu items)',
    rets.every((r) => ritems.some((i) => i.returnId === r.id)), `returns=${rets.length} items=${ritems.length}`);

  // CP3-R1 repair (mục 8): approve/reject thiếu key bị chặn.
  // Dùng đơn mới (đủ quota) để không phụ thuộc quota đơn R-VAL chính.
  const saleB = await runSolo(url, 'createOrder', salePayload(editionId, 5, `${k}-saleB`));
  ok('R-VAL setup don B cho key-check', saleB.success, saleB.error);
  if (!saleB.success) return;
  const orderB = (saleB.data as any).orderId;
  const lineB = await orderLineId(url, orderB);
  const goodB = reqPayload(orderB, lineB, 1, `${k}-goodB`);
  // Actor client tự khai bị bỏ qua (createdBy ghi từ session/context).
  const hacked = await runSolo(url, 'request', {
    ...goodB, idempotencyKey: `${k}-hack`, cashierId: 'hacker-never', createdBy: 'hacker-never',
    actorStaffId: 'cp3r-legit', actorRole: 'ROLE_CASHIER',
  });
  ok('R-VAL request hop le van qua', hacked.success, hacked.error);
  if (hacked.success) {
    const { client, db } = localDb(url);
    const h: any = (await db.select().from(returnOrders).where(eq(returnOrders.id, (hacked.data as any).returnId)))[0];
    client.close();
    ok('R-VAL actor ghi tu context, khong phai body',
      h.createdBy === 'cp3r-legit', `createdBy=${h.createdBy}`);
  }
  const reqK = await runSolo(url, 'request', goodB);
  ok('R-VAL setup phieu cho key-check', reqK.success, reqK.error);
  if (reqK.success) {
    const ridK = (reqK.data as any).returnId;
    const apNoKey = await runSolo(url, 'approve', {
      returnId: ridK, actorStaffId: 'cp3r-manager', actorRole: 'ROLE_MANAGER',
    });
    ok('R-VAL approve thieu key bi chan', !apNoKey.success, `${apNoKey.code}`);
    const rjNoKey = await runSolo(url, 'reject', {
      returnId: ridK, actorStaffId: 'cp3r-manager', actorRole: 'ROLE_MANAGER', rejectNote: 'x',
    });
    ok('R-VAL reject thieu key bi chan', !rjNoKey.success, `${rjNoKey.code}`);
    // Service thiếu actorContext bị chặn (request + approve) — dùng đơn B còn quota
    // để chắc chắn từ chối vì actorContext, không phải vì quota.
    const noCtxReq = await runSolo(url, 'request', {
      ...goodB, idempotencyKey: `${k}-noctx`, noActorContext: true,
      actorStaffId: 'cp3r-legit', actorRole: 'ROLE_CASHIER',
    });
    ok('R-VAL request thieu actorContext bi chan',
      !noCtxReq.success && /actorContext/.test(noCtxReq.error || ''), `${noCtxReq.code}: ${noCtxReq.error}`);
    const noCtxAppr = await runSolo(url, 'approve', {
      returnId: ridK, actorStaffId: 'cp3r-manager', actorRole: 'ROLE_MANAGER',
      idempotencyKey: `${k}-noctx-appr`, noActorContext: true,
    });
    ok('R-VAL approve thieu actorContext bi chan', !noCtxAppr.success, `${noCtxAppr.code}`);
  }
  // CP3-R1 repair (mục 4+8): client khai refund sai nhưng DB lưu đúng giá thực bán.
  const wrongRefund = await runSolo(url, 'request', {
    ...goodB, idempotencyKey: `${k}-wrongrefund`, refundAmount: 1,
  });
  ok('R-VAL refund sai van lap phieu', wrongRefund.success, wrongRefund.error);
  if (wrongRefund.success) {
    const { client: c3, db: d3 } = localDb(url);
    const h3: any = (await d3.select().from(returnOrders).where(eq(returnOrders.id, (wrongRefund.data as any).returnId)))[0];
    c3.close();
    // Cover 100000 x qty 1 = 100000 (không phải 1đ client khai).
    ok('R-VAL DB luu dung gia thuc ban', h3.refundAmount === 100000, `refundAmount=${h3.refundAmount}`);
  }
  // CP3-R1 repair (mục 3+8): [1+1] và [2] cùng orderItemId, cùng key
  // -> cùng fingerprint -> replay (cùng return ID).
  const splitKey = `${k}-split`;
  const splitBase = reqPayload(orderB, lineB, 1, splitKey);
  const splitA = await runSolo(url, 'request', {
    ...splitBase,
    items: [{ orderItemId: lineB, quantity: 1 }, { orderItemId: lineB, quantity: 1 }],
  });
  const splitB = await runSolo(url, 'request', {
    ...splitBase,
    items: [{ orderItemId: lineB, quantity: 2 }],
  });
  ok('R-VAL [1+1] thanh cong', splitA.success, splitA.error);
  ok('R-VAL [2] replay cung return ID (cung fingerprint sau gop)',
    splitB.success && (splitB.data as any).returnId === (splitA.data as any)?.returnId &&
    (splitB.data as any).isDuplicate === true,
    `a=${(splitA.data as any)?.returnId} b=${(splitB.data as any)?.returnId} dup=${(splitB.data as any)?.isDuplicate}`);
}

async function main() {
  console.log('CP3-R1 RETURN PROBES — REQUESTED/APPROVED/REJECTED (chua complete/void)');
  await probeRQQ();
  await probeRAR();
  await probeRI1();
  await probeValidation();
  console.log('=========================================================================');
  if (failures.length > 0) {
    console.error(`❌ CP3-R1: ${failures.length} assertion do:\n - ${failures.join('\n - ')}`);
    process.exit(1);
  }
  console.log('🎉 CP3-R1: TAT CA RETURN PROBES XANH!');
}

main().catch((e) => { console.error('❌ Loi chay CP3-R1:', e); process.exit(1); });
