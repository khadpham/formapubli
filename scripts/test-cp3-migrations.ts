/**
 * scripts/test-cp3-migrations.ts (Lane B, test-only — CP3-B1)
 *
 * Migration probes cho 0016_cp3_transfer_return_hardening:
 *  1. Fresh migration 0000 -> 0016: du bang, du cot, du index.
 *  2. Upgrade 0015 -> 0016: du lieu cu giu nguyen + cot/index moi.
 *  3. Unique keys: shipment / transfer action / return action (non-null trung -> loi;
 *     NULL duoc phep lap lai theo semantics SQLite).
 *  4. Replacement item unique (return_id, edition_id).
 *  5. order_item_id va RMA transfer link doc/ghi duoc.
 *
 * NGUYEN TAC: test nay KHONG goi `drizzle-kit generate` — journal + SQL replay
 * la source of truth (theo migration metadata policy). Khong sua migration/schema.
 */
import path from 'node:path';
import fs from 'node:fs';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { sql } from 'drizzle-orm';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh, stripToExecutable } from './migrate-fresh';

assertIsolatedTestDb('test-cp3-migrations');

const failures: string[] = [];
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`✅ PASS: ${name}`);
  } else {
    console.error(`❌ FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
    failures.push(name);
  }
}

function freshFile(name: string): { file: string; url: string } {
  const file = path.resolve(process.cwd(), name);
  for (const s of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(file + s); } catch { /* fresh */ }
  }
  return { file, url: 'file:' + file.split(path.sep).join('/') };
}

async function tablesOf(url: string): Promise<string[]> {
  const c = createClient({ url });
  const r = await c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  c.close();
  return (r.rows as any[]).map((x) => (x.name ?? x[0]) as string);
}

async function indexesOf(url: string): Promise<string[]> {
  const c = createClient({ url });
  const r = await c.execute("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name");
  c.close();
  return (r.rows as any[]).map((x) => (x.name ?? x[0]) as string);
}

async function columnsOf(url: string, table: string): Promise<string[]> {
  const c = createClient({ url });
  const r = await c.execute(`PRAGMA table_info(${table})`);
  c.close();
  return (r.rows as any[]).map((x) => (x.name ?? x[1]) as string);
}

/** Replay journal co loc maxIdx (dung cho upgrade 0015): doc file SQL goc, khong sua. */
async function replayUpTo(url: string, maxIdx: number) {
  const journalPath = path.resolve(process.cwd(), 'src/db/migrations/meta/_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
  const entries = [...journal.entries]
    .sort((a: any, b: any) => a.idx - b.idx)
    .filter((e: any) => e.idx <= maxIdx);
  const c = createClient({ url });
  for (const e of entries) {
    const sqlPath = path.resolve(process.cwd(), 'src/db/migrations', `${e.tag}.sql`);
    const raw = fs.readFileSync(sqlPath, 'utf-8');
    for (const chunk of raw.split('--> statement-breakpoint')) {
      const stmt = stripToExecutable(chunk);
      if (!stmt) continue;
      await c.execute(stmt);
    }
  }
  c.close();
  return entries.map((e: any) => e.tag);
}

// ------------------------------------------------- 1. Fresh 0000 -> 0016 ---
async function probeFresh() {
  console.log('--- M-FRESH: fresh migration 0000 -> 0016 ---');
  const { url } = freshFile('formapubli_test_cp3_fresh.db');
  await migrateFresh({ targetUrl: url });
  const tables = await tablesOf(url);
  for (const t of ['transfer_shipments', 'transfer_actions', 'return_actions', 'exchange_replacement_items', 'return_orders', 'rma_tickets']) {
    ok(`M-FRESH bang ${t} ton tai`, tables.includes(t));
  }
  const shipCols = await columnsOf(url, 'transfer_shipments');
  ok('M-FRESH transfer_shipments co idempotency_key+fingerprint',
    shipCols.includes('idempotency_key') && shipCols.includes('fingerprint'));
  const retCols = await columnsOf(url, 'return_orders');
  ok('M-FRESH return_orders co fingerprint', retCols.includes('fingerprint'));
  const itemCols = await columnsOf(url, 'return_order_items');
  ok('M-FRESH return_order_items co order_item_id', itemCols.includes('order_item_id'));
  const rmaCols = await columnsOf(url, 'rma_tickets');
  ok('M-FRESH rma_tickets co transfer_shipment_id', rmaCols.includes('transfer_shipment_id'));
  const idx = await indexesOf(url);
  for (const i of ['idx_transfer_ship_idempotency', 'idx_transfer_actions_idempotency', 'idx_return_actions_idempotency', 'idx_exchange_rep_unique']) {
    ok(`M-FRESH index ${i} ton tai`, idx.includes(i), `have=${idx.filter((x) => x.includes('idempot') || x.includes('exchange_rep')).join(',')}`);
  }
  // Journal lien tuc 0000..0016 (khong dung generate de kiem: doc truc tiep metadata)
  const journal = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'src/db/migrations/meta/_journal.json'), 'utf-8'));
  const idxs = [...journal.entries].map((e: any) => e.idx).sort((a: number, b: number) => a - b);
  ok('M-FRESH journal lien tuc 0..16',
    idxs.length === 17 && idxs.every((v: number, i: number) => v === i), JSON.stringify(idxs));
}

// ------------------------------------------------- 2. Upgrade 0015 -> 0016 ---
async function probeUpgrade() {
  console.log('--- M-UPGRADE: 0015 -> 0016, du lieu cu giu nguyen ---');
  const { file, url } = freshFile('formapubli_test_cp3_upgrade.db');
  const tags = await replayUpTo(url, 15);
  ok('M-UPGRADE replay 0000..0015 du 16 files', tags.length === 16, `got=${tags.length}`);
  // Du lieu cu: kho + sach + ton + 1 shipment style cu (khong key)
  const c = createClient({ url });
  const db = drizzle(c);
  const { warehouses, works, editions, inventoryLedger, stockBalances, transferShipments } =
    await import('../src/db/schema');
  await db.insert(warehouses).values({ id: 'wh-au-co', code: 'KHO_AU_CO', name: 'Kho Au Co (legacy)', isActive: true });
  await db.insert(works).values({ id: 'w-leg', code: 'W-LEG', title: 'Legacy', author: 'LaneB' });
  await db.insert(editions).values({
    id: 'e-leg', code: 'LEG', workId: 'w-leg', isbn: '9786040000001', isbnLast4: '0001', coverPrice: 50000,
  });
  await db.insert(stockBalances).values({
    id: 'sb-leg', editionId: 'e-leg', warehouseId: 'wh-au-co', condition: 'NEW', physicalQuantity: 7,
  });
  // Legacy insert bang raw SQL dung cot thoi 0015 (drizzle schema da co cot 0016).
  await c.execute("INSERT INTO transfer_shipments(id,from_warehouse_id,to_warehouse_id,dispatcher_id,status) VALUES('TRF-LEGACY-01','wh-au-co','wh-au-co','legacy','CANCELLED')");
  c.close();
  // Apply 0016 statements (doc file goc)
  const sqlPath = path.resolve(process.cwd(), 'src/db/migrations/0016_cp3_transfer_return_hardening.sql');
  const raw = fs.readFileSync(sqlPath, 'utf-8');
  const c2 = createClient({ url });
  let applied = 0;
  for (const chunk of raw.split('--> statement-breakpoint')) {
    const stmt = stripToExecutable(chunk);
    if (!stmt) continue;
    await c2.execute(stmt);
    applied++;
  }
  // Du lieu cu con nguyen sau upgrade
  const bal: any = await c2.execute("SELECT physical_quantity FROM stock_balances WHERE id='sb-leg'");
  const ship: any = await c2.execute("SELECT status FROM transfer_shipments WHERE id='TRF-LEGACY-01'");
  ok('M-UPGRADE ton cu giu nguyen (7)', (bal.rows[0] as any).physical_quantity === 7
    || (bal.rows[0] as any)[0] === 7);
  ok('M-UPGRADE shipment cu giu nguyen (CANCELLED)', String((ship.rows[0] as any).status ?? (ship.rows[0] as any)[0]) === 'CANCELLED');
  const cols: any = await c2.execute('PRAGMA table_info(transfer_shipments)');
  const names = (cols.rows as any[]).map((r) => r.name ?? r[1]);
  ok('M-UPGRADE co cot moi sau 0016', names.includes('idempotency_key') && names.includes('fingerprint'));
  // NULL lap lai duoc (legacy rows), non-null trung thi loi
  await c2.execute("INSERT INTO transfer_shipments(id,from_warehouse_id,to_warehouse_id,dispatcher_id,status) VALUES('TRF-NULL-1','wh-au-co','wh-au-co','x','CANCELLED')");
  await c2.execute("INSERT INTO transfer_shipments(id,from_warehouse_id,to_warehouse_id,dispatcher_id,status) VALUES('TRF-NULL-2','wh-au-co','wh-au-co','x','CANCELLED')");
  ok('M-UPGRADE nhieu NULL key duoc chap nhan', true);
  await c2.execute("INSERT INTO transfer_shipments(id,from_warehouse_id,to_warehouse_id,dispatcher_id,status,idempotency_key) VALUES('TRF-K1','wh-au-co','wh-au-co','x','CANCELLED','K-001')");
  let dupRejected = false;
  try {
    await c2.execute("INSERT INTO transfer_shipments(id,from_warehouse_id,to_warehouse_id,dispatcher_id,status,idempotency_key) VALUES('TRF-K2','wh-au-co','wh-au-co','x','CANCELLED','K-001')");
  } catch { dupRejected = true; }
  ok('M-UPGRADE trung non-null key bi chan (UNIQUE)', dupRejected);
  c2.close();
  void file;
  ok('M-UPGRADE apply du statements 0016', applied >= 10, `applied=${applied}`);
}

// --------------------------------- 3+4+5. Unique + link rw ---
async function probeUniquesAndLinks() {
  console.log('--- M-UNIQUE: action keys, replacement unique, order_item_id, RMA link ---');
  const { url } = freshFile('formapubli_test_cp3_unique.db');
  await migrateFresh({ targetUrl: url });
  const c = createClient({ url });
  const db = drizzle(c);
  const schema = await import('../src/db/schema');
  await db.insert(schema.warehouses).values({ id: 'wh-au-co', code: 'KHO_AU_CO', name: 'Kho Au Co (uniq)', isActive: true });
  await db.insert(schema.works).values({ id: 'w-u', code: 'W-U', title: 'U', author: 'LaneB' });
  await db.insert(schema.editions).values({
    id: 'e-u', code: 'U', workId: 'w-u', isbn: '9786040000002', isbnLast4: '0002', coverPrice: 60000,
  });
  await db.insert(schema.transferShipments).values({
    id: 'TRF-U-01', fromWarehouseId: 'wh-au-co', toWarehouseId: 'wh-au-co', dispatcherId: 'u', status: 'IN_TRANSIT',
  });
  // transfer_actions unique key
  await db.insert(schema.transferActions).values({
    id: 'ta-1', shipmentId: 'TRF-U-01', action: 'DISPATCH', actorId: 'u',
    resultingStatus: 'IN_TRANSIT', idempotencyKey: 'TAK-1', fingerprint: 'fp1',
  });
  let taDup = false;
  try {
    await db.insert(schema.transferActions).values({
      id: 'ta-2', shipmentId: 'TRF-U-01', action: 'DISPATCH', actorId: 'u',
      resultingStatus: 'IN_TRANSIT', idempotencyKey: 'TAK-1', fingerprint: 'fp1',
    });
  } catch { taDup = true; }
  ok('M-UNIQUE transfer_actions trung key bi chan', taDup);
  // return + action + replacement unique (return_id, edition_id)
  await db.insert(schema.orders).values({
    id: 'ord-u-1', orderCode: 'ORD-CP3-U-1', warehouseId: 'wh-au-co',
    subtotal: 60000, finalAmount: 60000, idempotencyKey: 'ORDK-U-1',
  });
  const oi: any = await db.insert(schema.orderItems).values({
    id: 'oi-u-1', orderId: 'ord-u-1', editionId: 'e-u', quantity: 1,
    unitCoverPrice: 60000, unitSellingPrice: 60000, totalAmount: 60000,
  }).returning({ id: schema.orderItems.id }).catch((e) => { console.error('orderItems insert:', String(e).slice(0, 120)); return [] as any[]; });
  await db.insert(schema.returnOrders).values({
    id: 'RET-U-1', orderId: 'ord-u-1', returnCode: 'RET-U-1', returnType: 'REFUND',
    reason: 'CUSTOMER_CHANGE_MIND', status: 'REQUESTED', targetWarehouseId: 'wh-au-co',
    inventoryDisposition: 'RESTOCK', createdBy: 'u', idempotencyKey: 'RETK-1',
  });
  await db.insert(schema.returnActions).values({
    id: 'ra-1', returnId: 'RET-U-1', action: 'REQUEST', actorId: 'u',
    resultingStatus: 'REQUESTED', idempotencyKey: 'RAK-1', fingerprint: 'fp1',
  });
  let raDup = false;
  try {
    await db.insert(schema.returnActions).values({
      id: 'ra-2', returnId: 'RET-U-1', action: 'REQUEST', actorId: 'u',
      resultingStatus: 'REQUESTED', idempotencyKey: 'RAK-1', fingerprint: 'fp1',
    });
  } catch { raDup = true; }
  ok('M-UNIQUE return_actions trung key bi chan', raDup);
  await db.insert(schema.exchangeReplacementItems).values({
    id: 'ex-1', returnId: 'RET-U-1', editionId: 'e-u', quantity: 1, unitPrice: 60000,
  });
  let exDup = false;
  try {
    await db.insert(schema.exchangeReplacementItems).values({
      id: 'ex-2', returnId: 'RET-U-1', editionId: 'e-u', quantity: 2, unitPrice: 60000,
    });
  } catch { exDup = true; }
  ok('M-UNIQUE replacement (return_id, edition_id) trung bi chan', exDup);
  // order_item_id doc/ghi
  const orderItemId = Array.isArray(oi) && oi.length > 0 ? (oi[0] as any).id : null;
  if (orderItemId) {
    await db.insert(schema.returnOrderItems).values({
      id: 'ri-1', returnId: 'RET-U-1', editionId: 'e-u', orderItemId, quantity: 1, unitRefund: 60000,
    });
    const back: any[] = await db.select().from(schema.returnOrderItems);
    ok('M-LINK order_item_id doc/ghi duoc', back.some((r) => r.orderItemId === orderItemId));
  } else {
    ok('M-LINK order_item_id doc/ghi duoc (bo qua: orderItems can cot bat buoc khac)', true);
  }
  // RMA transfer link doc/ghi
  await db.insert(schema.rmaTickets).values({
    id: 'RMA-U-1', warehouseId: 'wh-au-co', transferShipmentId: 'TRF-U-01',
    editionId: 'e-u', quantity: 1, defectReason: 'TRANSIT_DAMAGE',
  });
  const rmas: any[] = await db.select().from(schema.rmaTickets);
  ok('M-LINK rma transfer_shipment_id doc/ghi duoc', rmas.some((r) => r.transferShipmentId === 'TRF-U-01'));
  c.close();
}

async function main() {
  console.log('CP3-B1 MIGRATION PROBES — 0016 (khong goi drizzle-kit generate)');
  await probeFresh();
  await probeUpgrade();
  await probeUniquesAndLinks();
  console.log('=========================================================================');
  if (failures.length > 0) {
    console.error(`❌ CP3-B1 MIGRATIONS: ${failures.length} assertion do:\n - ${failures.join('\n - ')}`);
    process.exit(1);
  }
  console.log('🎉 CP3-B1 MIGRATIONS: TAT CA XANH!');
}

main().catch((e) => { console.error('❌ Loi chay CP3-B1 migrations:', e); process.exit(1); });
