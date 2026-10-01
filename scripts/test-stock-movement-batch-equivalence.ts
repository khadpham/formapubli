/**
 * CHỨNG MINH `recordMovementsBatch` cho KẾT QUẢ Y HỆT gọi lặp `recordMovement`.
 *
 * CHẠY: npx tsx scripts/run-isolated.ts --only=test-stock-movement-batch-equivalence
 *
 * Đây là tiền và tồn kho: chỉ được phép khác nhau ở SỐ CÂU SQL, tuyệt đối không
 * được khác ở số liệu. Vì vậy test so sánh trực tiếp hai cách trên CÙNG một dữ
 * liệu đầu vào, rồi đối chiếu tồn kho và sổ cái.
 *
 * BỐI CẢNH (30/09): `confirmOrder` gọi `recordMovement` từng dòng = ~4 câu SQL/dòng.
 * Trên Turso từ xa mỗi câu là 1 subrequest từ Cloudflare Worker, Worker chỉ chịu
 * 50 ⇒ đơn từ 5 dòng trở lên hỏng, lỗi bị che thành "Lỗi hệ thống". Đo thật trên
 * production: 1–4 dòng được, 5/12/16/17 dòng hỏng (ledger = 0).
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_movebatch.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

let checks = 0;
let failures = 0;
function ok(cond: boolean, name: string, detail = '') {
  checks++;
  if (cond) console.log(`  ✅ ${name}${detail ? `\n       ↳ ${detail}` : ''}`);
  else { failures++; console.log(`  ❌ ${name}${detail ? `\n       ↳ ${detail}` : ''}`); }
}

const WH = 'wh-eq';
const ED = ['ed-q1', 'ed-q2', 'ed-q3', 'ed-q4', 'ed-q5'];

async function seed(raw: any) {
  await raw.execute({
    sql: `INSERT OR IGNORE INTO warehouses (id,code,name,warehouse_type,is_active,is_sellable_on_pos)
          VALUES ('${WH}','KHO_EQ','Kho so sanh','FAIR_EVENT',1,1)`,
    args: [],
  });
  for (let i = 0; i < ED.length; i++) {
    const id = ED[i];
    await raw.execute({ sql: `INSERT OR IGNORE INTO works (id,code,title,author) VALUES (?,?,?,?)`, args: [`w-${id}`, `W${i}`, `T${i}`, 'A'] });
    await raw.execute({ sql: `INSERT OR IGNORE INTO editions (id,work_id,code,isbn,isbn_last4,cover_price) VALUES (?,?,?,?,?,?)`, args: [id, `w-${id}`, `E${i}`, `9780000000${i}`, String(i), 50000] });
    await raw.execute({ sql: `INSERT OR IGNORE INTO stock_balances (id,edition_id,product_id,warehouse_id,condition,physical_quantity) VALUES (?,?,?,?,'NEW',?)`, args: [`sb-${id}`, id, id, WH, 50] });
    await raw.execute({ sql: `UPDATE stock_balances SET physical_quantity = 50 WHERE id = ?`, args: [`sb-${id}`] });
  }
}

/** Service nhận transaction của drizzle (tx.insert/tx.select/tx.run), không phải
 *  transaction thô của libsql — nên phải đi qua `db` của ứng dụng. */
async function inTx<T>(fn: (tx: any) => Promise<T>): Promise<T> {
  const { db } = await import('../src/db');
  return (await db.transaction(fn as any)) as T;
}

async function readStock(raw: any): Promise<Record<string, number>> {
  const r = await raw.execute({
    sql: `SELECT edition_id, physical_quantity FROM stock_balances WHERE warehouse_id = ? ORDER BY edition_id`,
    args: [WH],
  });
  const out: Record<string, number> = {};
  for (const x of r.rows as any[]) out[`${x.edition_id}`] = Number(x.physical_quantity);
  return out;
}

async function readLedger(raw: any): Promise<Array<{ editionId: string; delta: number }>> {
  const r = await raw.execute({
    sql: `SELECT edition_id, quantity_delta FROM inventory_ledger ORDER BY edition_id, quantity_delta`,
    args: [],
  });
  return (r.rows as any[]).map((x) => ({ editionId: `${x.edition_id}`, delta: Number(x.quantity_delta) }));
}

async function run() {
  console.log('\n=== GỘP BÚT TOÁN KHO: KẾT QUẢ PHẢI Y HỆT GỌI LẶP ===');
  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-stock-movement-batch-equivalence');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const raw = createClient({ url: process.env.DATABASE_URL! });
  const { InventoryService } = await import('../src/services/inventory.service');
  await seed(raw);

  const batches: Array<{ label: string; deltas: Array<[string, number]> }> = [
    { label: '5 dòng, mỗi dòng 1 cuốn', deltas: ED.map((e) => [e, -1]) },
    { label: '5 dòng, có dòng trừ 3 cuốn', deltas: [[ED[0], -3], [ED[1], -1], [ED[2], -2], [ED[3], -1], [ED[4], -1]] },
    { label: 'cùng 1 ấn bản 2 dòng (gộp delta)', deltas: [[ED[0], -1], [ED[0], -2], [ED[1], -1], [ED[2], -1], [ED[3], -1]] },
    { label: 'trộn tăng và giảm', deltas: [[ED[0], -2], [ED[1], 5], [ED[2], -1], [ED[3], -1], [ED[4], -1]] },
  ];

  for (const b of batches) {
    await raw.execute({ sql: `DELETE FROM inventory_ledger`, args: [] });
    await raw.execute({ sql: `DELETE FROM stock_balances`, args: [] });
    await seed(raw);

    // Cách 1: gọi lặp recordMovement
    await inTx(async (tx: any) => {
      for (const [editionId, quantityDelta] of b.deltas) {
        await InventoryService.recordMovement({
          editionId,
          warehouseId: WH,
          eventType: 'DISPATCH_SALE',
          quantityDelta,
          condition: 'NEW',
          documentRef: 'DOC-LAP',
          actorId: 'CA-01',
          tx,
        });
      }
    });
    const stockLoop = await readStock(raw);
    const ledgerLoop = await readLedger(raw);

    await raw.execute({ sql: `DELETE FROM inventory_ledger`, args: [] });
    await raw.execute({ sql: `DELETE FROM stock_balances`, args: [] });
    await seed(raw);

    // Cách 2: gộp
    await inTx(async (tx: any) => {
      await InventoryService.recordMovementsBatch(
        b.deltas.map(([editionId, quantityDelta]) => ({ editionId, quantityDelta, condition: 'NEW' as const })),
        { warehouseId: WH, eventType: 'DISPATCH_SALE', documentRef: 'DOC-GOP', actorId: 'CA-01', correlationId: 'corr-1' },
        tx
      );
    });
    const stockBatch = await readStock(raw);
    const ledgerBatch = await readLedger(raw);

    ok(JSON.stringify(stockLoop) === JSON.stringify(stockBatch),
       `Tồn kho giống hệt — ${b.label}`,
       `lặp=${JSON.stringify(stockLoop)} | gộp=${JSON.stringify(stockBatch)}`);
    ok(ledgerLoop.length === ledgerBatch.length
       && ledgerBatch.every((x, i) => x.editionId === ledgerLoop[i].editionId && x.delta === ledgerLoop[i].delta),
       `Sổ cái giống hệt (${ledgerBatch.length} bút toán) — ${b.label}`);
  }

  // Chặn âm: phải ném lỗi và KHÔNG để lọt tồn âm.
  await raw.execute({ sql: `DELETE FROM inventory_ledger`, args: [] });
  await raw.execute({ sql: `UPDATE stock_balances SET physical_quantity = 2 WHERE edition_id = ?`, args: [ED[0]] });
  let blocked = false;
  let msg = '';
  try {
    await inTx(async (tx: any) => {
      await InventoryService.recordMovementsBatch(
        [{ editionId: ED[0], quantityDelta: -5, condition: 'NEW' as const }],
        { warehouseId: WH, eventType: 'DISPATCH_SALE', documentRef: 'DOC-AM', actorId: 'CA-01' },
        tx
      );
    });
  } catch (e: any) {
    blocked = true;
    msg = e?.message || String(e);
  }
  ok(blocked, 'Trừ nhiều hơn tồn ⇒ phải bị chặn', msg.slice(0, 80));

  const after = await readStock(raw);
  const neg = Object.keys(after).filter((k) => after[k] < 0);
  ok(neg.length === 0, 'Không còn tồn âm nào lọt qua', `tồn âm: ${neg.length ? neg.join(',') : 'không có'}`);

  // Delta 0 / không nguyên ⇒ từ chối.
  let badBlocked = false;
  try {
    await inTx(async (tx: any) => {
      await InventoryService.recordMovementsBatch(
        [{ editionId: ED[1], quantityDelta: 0, condition: 'NEW' as const }],
        { warehouseId: WH, eventType: 'DISPATCH_SALE', documentRef: 'DOC-0', actorId: 'CA-01' },
        tx
      );
    });
  } catch { badBlocked = true; }
  ok(badBlocked, 'Delta 0 bị từ chối (giữ đúng luật cũ)');

  const empty = await inTx(async (tx: any) =>
    InventoryService.recordMovementsBatch([], { warehouseId: WH, eventType: 'DISPATCH_SALE', documentRef: 'D', actorId: 'A' }, tx)
  );
  ok(empty === 0, 'Danh sách rỗng trả về 0, không lỗi');

  // Tiền tố idempotencyKey phải do CALLER quyết định: `confirmOrder` dò nhánh
  // idempotent bằng `idem-confirm-<orderId>-`, đổi tiền tố là lần gọi lại báo nhầm
  // "COMPLETED nhưng không có bút toán". Test này giữ hợp đồng đó.
  await raw.execute({ sql: `DELETE FROM inventory_ledger`, args: [] });
  await inTx(async (tx: any) => {
    await InventoryService.recordMovementsBatch(
      [{ editionId: ED[0], quantityDelta: -1, condition: 'NEW' as const }],
      {
        warehouseId: WH,
        eventType: 'DISPATCH_SALE',
        documentRef: 'ORD-TEST',
        actorId: 'CA-01',
        correlationId: 'ORDER-XYZ',
        idempotencyPrefix: 'idem-confirm-ORDER-XYZ',
      },
      tx
    );
  });
  const key = await raw.execute({
    sql: `SELECT idempotency_key FROM inventory_ledger WHERE correlation_id = 'ORDER-XYZ' LIMIT 1`,
    args: [],
  });
  ok(String((key.rows[0] as any)?.idempotency_key || '').startsWith('idem-confirm-ORDER-XYZ-'),
     'Tiền tố idempotencyKey do caller truyền vào được giữ nguyên',
     String((key.rows[0] as any)?.idempotency_key || '(khong co)'));

  raw.close();
  console.log(`\nTổng ${checks} kiểm tra — đạt ${checks - failures}, lỗi ${failures}.`);
  if (failures > 0) throw new Error('có kiểm tra đỏ');
  console.log('\n✅ Gộp bút toán kho cho số liệu y hệt gọi lặp, vẫn chặn tồn âm.');
}

run().then(() => process.exit(0)).catch((e) => { console.error('  ❌', e?.message || e); process.exit(1); });
