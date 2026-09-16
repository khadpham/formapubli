/**
 * scripts/test-cp3-transfer-concurrency.ts (Lane B, test-only — CP3-B1)
 *
 * 10 transfer probes trên base CP3-A (schema+contract, chưa có implementation CP3-B):
 *  1. T-DS  dispatch vs immediate sale
 *  2. T-RR  receive vs receive (hai key khác nhau)
 *  3. T-RC  receive vs cancel
 *  4. T-DP  direct transfer vs pending hold
 *  5. T-IK  same key / different dispatch payload
 *  6. Same key + same fingerprint dispatch replay
 *  7. Receive same key + same fingerprint replay
 *  8. Receive same key + different fingerprint conflict
 *  9. Direct transfer role/pair fail-closed
 * 10. Missing idempotency key -> INVALID_INPUT
 *
 * Quy tắc: 2 process độc lập, còi START chung, không mutex, không sleep dàn
 * thứ tự thắng, timeout 30s/process (kill SIGKILL), DB mới mỗi probe,
 * SQLITE_BUSY/timeout thoát ra ngoài = FAIL, kiểm tra orphan sau mỗi đua.
 *
 * NOTE CP3-B1: Lane A đang triển khai song song nên các probe đòi hỏi
 * implementation CP3-B (idempotency transfer, ATP transfer, fail-closed pair)
 * được PHÉP ĐỎ trên base này. File này khẳng định contract; không sửa service.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fork } from 'node:child_process';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq, and, sql } from 'drizzle-orm';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';
import {
  works, editions, warehouses,
  transferShipments, transferShipmentItems,
  inventoryLedger, stockBalances, orders,
} from '../src/db/schema';

assertIsolatedTestDb('test-cp3-transfer-concurrency');

const WORKER_SCRIPT = path.resolve(__dirname, 'cp3-concurrency-worker.ts');
const TSX_CLI = path.resolve(__dirname, '../node_modules/tsx/dist/cli.mjs');
const WORKER_TIMEOUT_MS = 30_000;

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

/** Dựng DB probe mới: replay journal + seed tối thiểu (2 kho + 1 ấn bản + tồn). */
async function freshProbeDb(probe: string, openingQty: number) {
  const { file, url } = dbFileFor(probe);
  await migrateFresh({ targetUrl: url });
  const { client, db } = localDb(url);
  const wid = `cp3-${probe.toLowerCase()}`;
  await db.insert(works).values({ id: wid, code: `CP3-${probe}`, title: `CP3 ${probe}`, author: 'LaneB' });
  await db.insert(editions).values({
    id: wid, code: `CP3-${probe}`, workId: wid,
    isbn: '9786040000000', isbnLast4: '0000', coverPrice: 100000,
  });
  await db.insert(warehouses).values([
    { id: 'wh-au-co', code: 'KHO_AU_CO', name: 'Kho 1 - Au Co (CP3)', isActive: true },
    { id: 'wh-quynh-mai', code: 'KHO_QUYNH_MAI', name: 'Kho 2 - Quynh Mai (CP3)', isActive: true },
  ]);
  await db.insert(inventoryLedger).values({
    id: `led-${wid}-open`, editionId: wid, warehouseId: 'wh-au-co',
    eventType: 'OPENING_BALANCE', quantityDelta: openingQty, condition: 'NEW',
    documentRef: `OPEN-${probe}`, actorId: 'cp3-fixture', idempotencyKey: `idem-open-${wid}`,
  });
  await db.insert(stockBalances).values({
    id: `sb-${wid}-auco`, editionId: wid, warehouseId: 'wh-au-co',
    condition: 'NEW', physicalQuantity: openingQty,
  });
  client.close();
  return { file, url, editionId: wid };
}

async function phys(url: string, editionId: string, warehouseId: string): Promise<number> {
  const { client, db } = localDb(url);
  const rows: any[] = await db.select().from(stockBalances)
    .where(and(
      eq(stockBalances.editionId, editionId),
      eq(stockBalances.warehouseId, warehouseId),
      eq(stockBalances.condition, 'NEW'),
    ));
  client.close();
  return rows.length > 0 ? (rows[0].physicalQuantity as number) : 0;
}

/** Chạy N worker đồng thời qua còi START chung. */
async function runRace(
  url: string,
  configs: Array<{ action: Cp3Action; payload: any }>,
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
      env: {
        ...process.env,
        DATABASE_URL: url,
        WORKER_CONFIG: JSON.stringify(configs[i]),
      },
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });
    const idx = i;
    child.on('message', (msg: any) => {
      if (msg?.type === 'READY') markReady();
      else if (msg?.type === 'RESULT') {
        results[idx] = {
          workerIndex: idx, success: msg.success,
          data: msg.data, error: msg.error, code: msg.code,
        };
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

type Cp3Action = 'dispatch' | 'receive' | 'cancel' | 'directTransfer' | 'createOrder';

const runSolo = (url: string, action: Cp3Action, payload: any) =>
  runRace(url, [{ action, payload }]).then((r) => r[0]);

function noBusyOrTimeout(results: WorkerResult[]): boolean {
  return !results.some((r) =>
    r.code === 'TIMEOUT' || r.code === 'SQLITE_BUSY' ||
    (r.error || '').includes('database is locked') ||
    (r.error || '').includes('TIMEOUT_EXCEEDED'));
}

/** Orphan check: shipment có items; OUT+LOSS cân bằng IN theo correlationId. */
async function orphanCheck(url: string, shipmentId: string): Promise<{ clean: boolean; detail: string }> {
  const { client, db } = localDb(url);
  const ships: any[] = await db.select().from(transferShipments).where(eq(transferShipments.id, shipmentId));
  if (ships.length !== 1) { client.close(); return { clean: false, detail: `shipment rows=${ships.length}, expect 1` }; }
  const items: any[] = await db.select().from(transferShipmentItems)
    .where(eq(transferShipmentItems.shipmentId, shipmentId));
  if (items.length < 1) { client.close(); return { clean: false, detail: 'shipment without items (orphan)' }; }
  const led: any[] = await db.select().from(inventoryLedger)
    .where(eq(inventoryLedger.correlationId, shipmentId));
  const out = led.filter((l) => l.eventType === 'TRANSFER_OUT' || l.eventType === 'TRANSFER_LOSS').length;
  const inn = led.filter((l) => l.eventType === 'TRANSFER_IN').length;
  client.close();
  if (out !== inn) return { clean: false, detail: `OUT+LOSS=${out} vs IN=${inn} (partial ledger)` };
  return { clean: true, detail: `items=${items.length} OUT=${out} IN=${inn}` };
}

const salePayload = (editionId: string, qty: number, key: string, confirmImmediately = true) => ({
  warehouseId: 'wh-au-co', channel: 'FAIR_EVENT', customerName: 'Khach CP3',
  paymentMethod: 'CASH', fiscalScope: 'INTERNAL_MANAGEMENT', cashierId: 'cp3-cashier',
  confirmImmediately, idempotencyKey: key,
  items: [{ editionId, quantity: qty }],
});

// ---------------------------------------------------------------- T-DS ---
async function probeTDS() {
  console.log('--- T-DS: dispatch vs immediate sale (ton 3, dispatch 2 vs ban 3) ---');
  const { url, editionId } = await freshProbeDb('TDS', 3);
  const k = `cp3-tds-${Date.now()}`;
  const results = await runRace(url, [
    {
      action: 'dispatch',
      payload: {
        fromWarehouseId: 'wh-au-co', toWarehouseId: 'wh-quynh-mai',
        dispatcherId: 'cp3-a', idempotencyKey: `${k}-d`,
        items: [{ editionId, quantity: 2 }],
      },
    },
    { action: 'createOrder', payload: salePayload(editionId, 3, `${k}-s`) },
  ]);
  const succ = results.filter((r) => r.success);
  const fail = results.filter((r) => !r.success);
  ok('T-DS dung 1 thang', succ.length === 1 && fail.length === 1, JSON.stringify(results.map((r) => ({ s: r.success, c: r.code }))));
  ok('T-DS khong BUSY/timeout thoat ra ngoai', noBusyOrTimeout(results));
  if (succ.length === 1 && results[0].success) {
    // dispatch thang
    ok('T-DS thua nhan INSUFFICIENT_ATP', fail[0].code === 'INSUFFICIENT_ATP', fail[0].code);
    ok('T-DS ton cuoi = 1', (await phys(url, editionId, 'wh-au-co')) === 1);
    const oc = await orphanCheck(url, succ[0].data.shipmentId);
    ok('T-DS cap OUT/IN nguyen tu, khong orphan', oc.clean, oc.detail);
  } else if (succ.length === 1) {
    // sale thang
    ok('T-DS ton cuoi = 0 khi sale thang', (await phys(url, editionId, 'wh-au-co')) === 0);
    const { client, db } = localDb(url);
    const ships: any[] = await db.select().from(transferShipments);
    client.close();
    ok('T-DS khong sinh shipment khi sale thang', ships.length === 0, `ships=${ships.length}`);
  }
}

// ---------------------------------------------------------------- T-RR ---
async function probeTRR() {
  console.log('--- T-RR: receive vs receive (hai key khac nhau) ---');
  const { url, editionId } = await freshProbeDb('TRR', 10);
  const k = `cp3-trr-${Date.now()}`;
  const d = await runSolo(url, 'dispatch', {
    fromWarehouseId: 'wh-au-co', toWarehouseId: 'wh-quynh-mai',
    dispatcherId: 'cp3-a', idempotencyKey: `${k}-d`,
    items: [{ editionId, quantity: 5 }],
  });
  ok('T-RR setup dispatch thanh cong', d.success, d.error);
  if (!d.success) return;
  const sid = d.data.shipmentId;
  const full = (key: string) => ({
    shipmentId: sid, receiverId: 'cp3-b', idempotencyKey: key,
    items: [{ editionId, receivedQty: 5 }],
  });
  const results = await runRace(url, [
    { action: 'receive', payload: full(`${k}-r1`) },
    { action: 'receive', payload: full(`${k}-r2`) },
  ]);
  const succ = results.filter((r) => r.success);
  const fail = results.filter((r) => !r.success);
  ok('T-RR dung 1 receive thang', succ.length === 1, JSON.stringify(results.map((r) => ({ s: r.success, c: r.code }))));
  ok('T-RR thua la STATE_CONFLICT', fail.length === 1 && fail[0].code === 'STATE_CONFLICT', fail[0]?.code);
  ok('T-RR khong BUSY/timeout thoat ra ngoai', noBusyOrTimeout(results));
  ok('T-RR dich +5 dung 1 lan, transit 0', (await phys(url, editionId, 'wh-quynh-mai')) === 5);
  const oc = await orphanCheck(url, sid);
  ok('T-RR khong orphan/nhan doi ledger', oc.clean, oc.detail);
}

// ---------------------------------------------------------------- T-RC ---
async function probeTRC() {
  console.log('--- T-RC: receive vs cancel ---');
  const { url, editionId } = await freshProbeDb('TRC', 10);
  const k = `cp3-trc-${Date.now()}`;
  const d = await runSolo(url, 'dispatch', {
    fromWarehouseId: 'wh-au-co', toWarehouseId: 'wh-quynh-mai',
    dispatcherId: 'cp3-a', idempotencyKey: `${k}-d`,
    items: [{ editionId, quantity: 4 }],
  });
  ok('T-RC setup dispatch thanh cong', d.success, d.error);
  if (!d.success) return;
  const sid = d.data.shipmentId;
  const results = await runRace(url, [
    {
      action: 'receive',
      payload: {
        shipmentId: sid, receiverId: 'cp3-b', idempotencyKey: `${k}-r`,
        items: [{ editionId, receivedQty: 4 }],
      },
    },
    { action: 'cancel', payload: { shipmentId: sid, actorId: 'cp3-a' } },
  ]);
  const succ = results.filter((r) => r.success);
  ok('T-RC dung 1 trang thai cuoi', succ.length === 1, JSON.stringify(results.map((r) => ({ s: r.success, c: r.code }))));
  ok('T-RC khong BUSY/timeout thoat ra ngoai', noBusyOrTimeout(results));
  const { client, db } = localDb(url);
  const ship: any = (await db.select().from(transferShipments).where(eq(transferShipments.id, sid)))[0];
  client.close();
  if (results[0].success) {
    ok('T-RC receive thang -> RECEIVED_*', ship.status === 'RECEIVED_FULL' || ship.status === 'RECEIVED_DISCREPANCY', ship.status);
    ok('T-RC dich +4', (await phys(url, editionId, 'wh-quynh-mai')) === 4);
  } else {
    ok('T-RC cancel thang -> CANCELLED', ship.status === 'CANCELLED', ship.status);
    ok('T-RC hang ve nguon du 10', (await phys(url, editionId, 'wh-au-co')) === 10);
  }
  const oc = await orphanCheck(url, sid);
  ok('T-RC khong orphan', oc.clean, oc.detail);
}

// ---------------------------------------------------------------- T-DP ---
async function probeTDP() {
  console.log('--- T-DP: direct transfer vs pending hold (ton 3, pending giu 2, ATP 1) ---');
  const { url, editionId } = await freshProbeDb('TDP', 3);
  const k = `cp3-tdp-${Date.now()}`;
  const pend = await runSolo(url, 'createOrder', salePayload(editionId, 2, `${k}-p`, false));
  ok('T-DP setup pending giu 2 thanh cong', pend.success, pend.error);
  if (!pend.success) return;
  const t = (key: string) => ({
    fromWarehouseId: 'wh-au-co', toWarehouseId: 'wh-quynh-mai',
    dispatcherId: 'cp3-owner', actorRole: 'ROLE_OWNER', idempotencyKey: key,
    items: [{ editionId, quantity: 1 }],
  });
  const results = await runRace(url, [
    { action: 'directTransfer', payload: t(`${k}-a`) },
    { action: 'directTransfer', payload: t(`${k}-b`) },
  ]);
  const succ = results.filter((r) => r.success);
  ok('T-DP dung 1 transfer thang', succ.length === 1, JSON.stringify(results.map((r) => ({ s: r.success, c: r.code }))));
  const tdpFail = results.filter((r) => !r.success);
  ok('T-DP thua nhan INSUFFICIENT_ATP', tdpFail.length === 1 && tdpFail[0].code === 'INSUFFICIENT_ATP', tdpFail[0]?.code);
  ok('T-DP khong BUSY/timeout thoat ra ngoai', noBusyOrTimeout(results));
  const { client, db } = localDb(url);
  const porder: any = (await db.select().from(orders).where(eq(orders.id, (pend.data as any).orderId)))[0];
  client.close();
  ok('T-DP pending khong bi xam pham', porder && porder.status === 'PENDING_CONFIRMATION', porder?.status);
}

// ---------------------------------------------------------------- T-IK ---
async function probeTIK() {
  console.log('--- T-IK: same key, different dispatch payload (qty 2 vs 3) ---');
  const { url, editionId } = await freshProbeDb('TIK', 10);
  const key = `cp3-tik-${Date.now()}`;
  const t = (qty: number) => ({
    fromWarehouseId: 'wh-au-co', toWarehouseId: 'wh-quynh-mai',
    dispatcherId: 'cp3-a', idempotencyKey: key,
    items: [{ editionId, quantity: qty }],
  });
  const results = await runRace(url, [
    { action: 'dispatch', payload: t(2) },
    { action: 'dispatch', payload: t(3) },
  ]);
  const succ = results.filter((r) => r.success);
  const fail = results.filter((r) => !r.success);
  ok('T-IK dung 1 thang', succ.length === 1 && fail.length === 1, JSON.stringify(results.map((r) => ({ s: r.success, c: r.code }))));
  ok('T-IK thua nhan IDEMPOTENCY_CONFLICT', fail.length === 1 && fail[0].code === 'IDEMPOTENCY_CONFLICT', fail[0]?.code);
  ok('T-IK khong BUSY/timeout thoat ra ngoai', noBusyOrTimeout(results));
  const { client, db } = localDb(url);
  const ships: any[] = await db.select().from(transferShipments);
  client.close();
  ok('T-IK chi 1 shipment vat ly', ships.length === 1, `ships=${ships.length}`);
}

// --------------------------------- dispatch replay (same key+same fingerprint)
async function probeDispatchReplay() {
  console.log('--- T-REPLAY-D: same key + same fingerprint dispatch ---');
  const { url, editionId } = await freshProbeDb('TREP', 10);
  const key = `cp3-trep-${Date.now()}`;
  const payload = {
    fromWarehouseId: 'wh-au-co', toWarehouseId: 'wh-quynh-mai',
    dispatcherId: 'cp3-a', idempotencyKey: key,
    items: [{ editionId, quantity: 1 }],
  };
  const results = await runRace(url, [
    { action: 'dispatch', payload },
    { action: 'dispatch', payload: { ...payload } },
  ]);
  const succ = results.filter((r) => r.success);
  ok('T-REPLAY-D ca 2 tra ve (1 commit + 1 idempotent)', succ.length === 2, JSON.stringify(results.map((r) => ({ s: r.success, c: r.code }))));
  ok('T-REPLAY-D cung shipmentId', succ.length === 2 && succ[0].data?.shipmentId === succ[1].data?.shipmentId);
  ok('T-REPLAY-D khong BUSY/timeout thoat ra ngoai', noBusyOrTimeout(results));
  const { client, db } = localDb(url);
  const ships: any[] = await db.select().from(transferShipments);
  client.close();
  ok('T-REPLAY-D chi 1 hieu ung vat ly', ships.length === 1, `ships=${ships.length}`);
}

// --------------------------------- receive replay + conflict ---
async function probeReceiveReplayConflict() {
  console.log('--- T-REPLAY-R / T-CONFL-R: receive replay va conflict ---');
  const { url, editionId } = await freshProbeDb('TRRC', 10);
  const k = `cp3-trrc-${Date.now()}`;
  const d = await runSolo(url, 'dispatch', {
    fromWarehouseId: 'wh-au-co', toWarehouseId: 'wh-quynh-mai',
    dispatcherId: 'cp3-a', idempotencyKey: `${k}-d`,
    items: [{ editionId, quantity: 5 }],
  });
  ok('T-RR setup dispatch thanh cong', d.success, d.error);
  if (!d.success) return;
  const sid = d.data.shipmentId;
  // Replay: cung key + cung payload
  const rkey = `${k}-r-same`;
  const same = {
    shipmentId: sid, receiverId: 'cp3-b', idempotencyKey: rkey,
    items: [{ editionId, receivedQty: 5 }],
  };
  const rr = await runRace(url, [
    { action: 'receive', payload: same },
    { action: 'receive', payload: { ...same } },
  ]);
  const rsucc = rr.filter((r) => r.success);
  ok('T-REPLAY-R 1 hieu ung (1 thang hoac idempotent doi)', rsucc.length >= 1, JSON.stringify(rr.map((r) => ({ s: r.success, c: r.code }))));
  ok('T-REPLAY-R dich +5 dung 1 lan', (await phys(url, editionId, 'wh-quynh-mai')) === 5);
  // Conflict: can shipment moi de tranh key khac payload (doc lap voi replay)
  const d2 = await runSolo(url, 'dispatch', {
    fromWarehouseId: 'wh-au-co', toWarehouseId: 'wh-quynh-mai',
    dispatcherId: 'cp3-a', idempotencyKey: `${k}-d2`,
    items: [{ editionId, quantity: 4 }],
  });
  ok('T-CONFL-R setup dispatch 2 thanh cong', d2.success, d2.error);
  if (!d2.success) return;
  const sid2 = d2.data.shipmentId;
  const ckey = `${k}-r-diff`;
  const rc = await runRace(url, [
    {
      action: 'receive',
      payload: { shipmentId: sid2, receiverId: 'cp3-b', idempotencyKey: ckey, items: [{ editionId, receivedQty: 4 }] },
    },
    {
      action: 'receive',
      payload: { shipmentId: sid2, receiverId: 'cp3-b', idempotencyKey: ckey, items: [{ editionId, receivedQty: 3, lostQty: 1 }] },
    },
  ]);
  const csucc = rc.filter((r) => r.success);
  const cfail = rc.filter((r) => !r.success);
  ok('T-CONFL-R dung 1 thang', csucc.length === 1 && cfail.length === 1);
  ok('T-CONFL-R thua nhan IDEMPOTENCY_CONFLICT', cfail.length === 1 && cfail[0].code === 'IDEMPOTENCY_CONFLICT', cfail[0]?.code);
  ok('T-CONFL-R khong BUSY/timeout thoat ra ngoai', noBusyOrTimeout(rc));
}

// ------------------------------------------------- fail-closed + key ---
async function probeFailClosed() {
  console.log('--- T-FC: role/pair fail-closed + missing key (tuan tu) ---');
  const { url, editionId } = await freshProbeDb('TFC', 10);
  const k = `cp3-tfc-${Date.now()}`;
  const cashier = await runSolo(url, 'directTransfer', {
    fromWarehouseId: 'wh-au-co', toWarehouseId: 'wh-quynh-mai',
    dispatcherId: 'cp3-cashier', actorRole: 'ROLE_CASHIER', idempotencyKey: `${k}-c`,
    items: [{ editionId, quantity: 1 }],
  });
  ok('T-FC CASHIER bi FORBIDDEN', !cashier.success && cashier.code === 'FORBIDDEN', `${cashier.code}: ${cashier.error}`);
  const virtual = await runSolo(url, 'directTransfer', {
    fromWarehouseId: 'wh-au-co', toWarehouseId: 'wh-in-transit',
    dispatcherId: 'cp3-owner', actorRole: 'ROLE_OWNER', idempotencyKey: `${k}-v`,
    items: [{ editionId, quantity: 1 }],
  });
  ok('T-FC cap khong allowlist bi FORBIDDEN', !virtual.success && virtual.code === 'FORBIDDEN', `${virtual.code}: ${virtual.error}`);
  const nokey = await runSolo(url, 'dispatch', {
    fromWarehouseId: 'wh-au-co', toWarehouseId: 'wh-quynh-mai',
    dispatcherId: 'cp3-a',
    items: [{ editionId, quantity: 1 }],
  });
  ok('T-FC thieu key tra INVALID_INPUT', !nokey.success && nokey.code === 'INVALID_INPUT', `${nokey.code}: ${nokey.error}`);
}

async function main() {
  console.log('CP3-B1 TRANSFER PROBES — base CP3-A (cho phep do: thieu implementation)');
  await probeTDS();
  await probeTRR();
  await probeTRC();
  await probeTDP();
  await probeTIK();
  await probeDispatchReplay();
  await probeReceiveReplayConflict();
  await probeFailClosed();
  console.log('=========================================================================');
  if (failures.length > 0) {
    console.error(`❌ CP3-B1: ${failures.length} assertion do:\n - ${failures.join('\n - ')}`);
    process.exit(1);
  }
  console.log('🎉 CP3-B1: TAT CA TRANSFER PROBES XANH!');
}

main().catch((e) => { console.error('❌ Loi chay CP3-B1:', e); process.exit(1); });
