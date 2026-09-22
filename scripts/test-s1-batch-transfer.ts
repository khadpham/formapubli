/**
 * scripts/test-s1-batch-transfer.ts — Kiểm thử Sprint 1 (V4.1 lock mục 8).
 *
 * DB riêng formapubli_test_s1_batch.db (migrate fresh + seed tối thiểu), KHÔNG chạm prod.
 * Chạy: DATABASE_URL=file:formapubli_test_s1_batch.db npx tsx scripts/test-s1-batch-transfer.ts
 *
 * Cases:
 *  1. validate 40 dòng (1 dòng thiếu) → {ok:false, staleItems} — không ném lỗi
 *  2. commit 40 dòng thiếu 1 → 409 TRANSFER_TOCTOU_ATP_STALE + kho nguyên vẹn (atomicity)
 *  3. re-cap dòng thiếu → commit OK, PCK server-cấp, OUT/IN khớp từng cuốn
 *  4. idempotency: trùng key → isDuplicate (kho không đổi); key trùng nội dung khác → CONFLICT
 *  5. PCK tăng liên tục 0001 → 0002 (không nhảy số khi rollback case 2)
 *  6. kho hội chợ tạo động (không seed trước) vẫn chuyển được — hết hardcode
 *  7. role CASHIER → FORBIDDEN; thiếu key → INVALID_INPUT
 *  8. ATP chia theo kho: main trừ giữ chỗ PENDING; giữ chỗ ở kho fair → INVALID_INPUT; fair ATP = physical
 */
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

assertIsolatedTestDb('test-s1-batch-transfer');

const failures: string[] = [];
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`✅ PASS: ${name}`);
  else { console.error(`❌ FAIL: ${name}${detail ? ` — ${detail}` : ''}`); failures.push(name); }
}

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_s1_batch.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

async function main() {
  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-s1-batch-transfer');

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const { and, eq } = await import('drizzle-orm');
  const schema = await import('../src/db/schema');
  const { InventoryService } = await import('../src/services/inventory.service');
  const { OrderService } = await import('../src/services/order.service');
  const { toActorContext } = await import('../src/services/actor-context');

  const MGR = toActorContext('s1-manager', 'ROLE_MANAGER');
  const CASHIER = toActorContext('s1-cashier', 'ROLE_CASHIER');
  const MAIN = 'wh-main';
  const FAIR_A = 'wh-fair-a';

  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });
  const raw = createClient({ url: process.env.DATABASE_URL! });
  const seedDb = drizzle(raw);

  // Seed: 42 ấn bản + kho chính + kho hội chợ A (FAIR_EVENT, sellable).
  await seedDb.insert(schema.works).values(
    Array.from({ length: 42 }, (_, i) => ({
      id: `work-s1-${i + 1}`, code: `S1-${i + 1}`, title: `S1 Book ${i + 1}`, author: 'S1',
    }))
  );
  const ed = (n: number) => `ed-s1-${n}`;
  await seedDb.insert(schema.editions).values(
    Array.from({ length: 42 }, (_, i) => ({
      id: ed(i + 1), code: `S1-${i + 1}`, workId: `work-s1-${i + 1}`,
      isbn: `9786000000${String(i + 1).padStart(3, '0')}`, isbnLast4: '0000', coverPrice: 100000,
    }))
  );
  await seedDb.insert(schema.warehouses).values([
    { id: MAIN, code: 'KHO_MAIN', name: 'Kho chinh S1', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
    { id: FAIR_A, code: 'KHO_FAIR_A', name: 'Kho Hoi cho A S1', isActive: true, isSellableOnPos: true, warehouseType: 'FAIR_EVENT' },
  ]);
  // ed-1..39: 50 cuốn; ed-40: 5 cuốn (dòng thiếu); ed-41/42: 50 cuốn (test ATP).
  for (let n = 1; n <= 42; n++) {
    const qty = n === 40 ? 5 : 50;
    await seedDb.insert(schema.inventoryLedger).values({
      id: `led-s1-open-${n}`, editionId: ed(n), warehouseId: MAIN,
      eventType: 'OPENING_BALANCE', quantityDelta: qty, condition: 'NEW',
      documentRef: 'OPEN-S1', actorId: 's1', idempotencyKey: `idem-s1-open-${n}`,
    });
    await seedDb.insert(schema.stockBalances).values({
      id: `sb-s1-${n}`, editionId: ed(n), warehouseId: MAIN, condition: 'NEW', physicalQuantity: qty,
    });
  }
  raw.close();

  const bal = (editionId: string, wh: string) => InventoryService.getBalance(editionId, wh, 'NEW');
  const items40 = Array.from({ length: 40 }, (_, i) => ({ editionId: ed(i + 1), quantity: 10 }));

  // 1. validate → ok:false + staleItems, không ném.
  const v = await InventoryService.checkBatchAvailability({ fromWarehouseId: MAIN, toWarehouseId: FAIR_A, items: items40 });
  ok('T1 validate 40 dòng thiếu 1 → ok:false + stale ed-s1-40 (10 cần/5 có)',
    !v.ok && (v as any).staleItems?.length === 1 &&
    (v as any).staleItems[0].editionId === ed(40) &&
    (v as any).staleItems[0].requested === 10 && (v as any).staleItems[0].availableNow === 5,
    JSON.stringify(v));

  // 2. commit thiếu → 409 TOCTOU + kho nguyên vẹn.
  let err2: any = null;
  try {
    await InventoryService.transferBatch({ fromWarehouseId: MAIN, toWarehouseId: FAIR_A, items: items40, actorContext: MGR, idempotencyKey: 's1-key-1' });
  } catch (e: any) { err2 = e; }
  ok('T2 commit thiếu → TRANSFER_TOCTOU_ATP_STALE', err2?.code === 'TRANSFER_TOCTOU_ATP_STALE', `${err2?.code}: ${err2?.message}`);
  ok('T2 kho nguyên vẹn sau rollback (main ed-s1-1 = 50, fair = 0)',
    (await bal(ed(1), MAIN)) === 50 && (await bal(ed(1), FAIR_A)) === 0);

  // 3. re-cap → commit OK, PCK server-cấp.
  const recapped = items40.map((it) => (it.editionId === ed(40) ? { ...it, quantity: 5 } : it));
  const r3: any = await InventoryService.transferBatch({ fromWarehouseId: MAIN, toWarehouseId: FAIR_A, items: recapped, note: 'Hoi cho A dot 1', actorContext: MGR, idempotencyKey: 's1-key-1' });
  ok('T3 commit sau re-cap OK + PCK-xxxx-0001', /^PCK-\d{4}-0001$/.test(r3.pckCode), r3.pckCode);
  ok('T3 40 dòng OUT/IN đủ', r3.lines?.length === 40 && r3.lines.every((l: any) => l.outLedgerId && l.inLedgerId));
  ok('T3 trừ/nhập khớp (main 50→40, fair 0→10; dòng thiếu 5→0/0→5)',
    (await bal(ed(1), MAIN)) === 40 && (await bal(ed(1), FAIR_A)) === 10 &&
    (await bal(ed(40), MAIN)) === 0 && (await bal(ed(40), FAIR_A)) === 5);

  // 4. idempotency.
  const r4: any = await InventoryService.transferBatch({ fromWarehouseId: MAIN, toWarehouseId: FAIR_A, items: recapped, actorContext: MGR, idempotencyKey: 's1-key-1' });
  ok('T4 trùng key → isDuplicate, kho không đổi',
    r4.isDuplicate === true && r4.pckCode === r3.pckCode && (await bal(ed(1), MAIN)) === 40);
  let err4: any = null;
  try {
    await InventoryService.transferBatch({ fromWarehouseId: MAIN, toWarehouseId: FAIR_A, items: [{ editionId: ed(41), quantity: 1 }], actorContext: MGR, idempotencyKey: 's1-key-1' });
  } catch (e: any) { err4 = e; }
  ok('T4 key trùng nội dung khác → IDEMPOTENCY_CONFLICT', err4?.code === 'IDEMPOTENCY_CONFLICT', err4?.code);

  // 5. PCK liên tục (rollback case 2 không đốt số).
  const r5: any = await InventoryService.transferBatch({ fromWarehouseId: MAIN, toWarehouseId: FAIR_A, items: [{ editionId: ed(41), quantity: 2 }], actorContext: MGR, idempotencyKey: 's1-key-2' });
  ok('T5 PCK thứ 2 là ...-0002', /^PCK-\d{4}-0002$/.test(r5.pckCode), r5.pckCode);

  // 6. kho hội chợ tạo động.
  const raw2 = createClient({ url: process.env.DATABASE_URL! });
  const seedDb2 = drizzle(raw2);
  await seedDb2.insert(schema.warehouses).values({ id: 'wh-fair-b', code: 'KHO_FAIR_B', name: 'Kho Hoi cho B (dong)', isActive: true, isSellableOnPos: true, warehouseType: 'FAIR_EVENT' });
  raw2.close();
  const r6: any = await InventoryService.transferBatch({ fromWarehouseId: MAIN, toWarehouseId: 'wh-fair-b', items: [{ editionId: ed(42), quantity: 3 }], actorContext: MGR, idempotencyKey: 's1-key-3' });
  ok('T6 kho tạo động nhận hàng (fair-b ed-s1-42 = 3)', r6.lines?.length === 1 && (await bal(ed(42), 'wh-fair-b')) === 3);

  // 7. guards.
  let err7a: any = null;
  try {
    await InventoryService.transferBatch({ fromWarehouseId: MAIN, toWarehouseId: FAIR_A, items: [{ editionId: ed(41), quantity: 1 }], actorContext: CASHIER, idempotencyKey: 's1-key-4' });
  } catch (e: any) { err7a = e; }
  ok('T7a CASHIER → FORBIDDEN', err7a?.code === 'FORBIDDEN', err7a?.code);
  let err7b: any = null;
  try {
    await InventoryService.transferBatch({ fromWarehouseId: MAIN, toWarehouseId: FAIR_A, items: [{ editionId: ed(41), quantity: 1 }], actorContext: MGR, idempotencyKey: '  ' });
  } catch (e: any) { err7b = e; }
  ok('T7b thiếu key → INVALID_INPUT', err7b?.code === 'INVALID_INPUT', err7b?.code);

  // 8. ATP chia theo kho.
  await OrderService.createOrder({
    warehouseId: MAIN, channel: 'ONLINE', customerName: 'Online S1',
    confirmImmediately: false, idempotencyKey: 's1-pending-1',
    items: [{ editionId: ed(41), quantity: 45 }], actorContext: MGR,
  });
  const atpMain = await OrderService.getATP(ed(41), MAIN);
  ok('T8a main trừ giữ chỗ PENDING (50-2 đã chuyển-45 giữ = 3)', atpMain === 3, `ATP=${atpMain}`);
  const v8 = await InventoryService.checkBatchAvailability({ fromWarehouseId: MAIN, toWarehouseId: FAIR_A, items: [{ editionId: ed(41), quantity: 10 }] });
  ok('T8b batch main dính giữ chỗ → stale', !v8.ok, JSON.stringify(v8));
  let err8c: any = null;
  try {
    await OrderService.createOrder({
      warehouseId: FAIR_A, channel: 'ONLINE', customerName: 'Online Fair',
      confirmImmediately: false, idempotencyKey: 's1-pending-2',
      items: [{ editionId: ed(1), quantity: 1 }], actorContext: MGR,
    });
  } catch (e: any) { err8c = e; }
  ok('T8c giữ chỗ ở kho fair → INVALID_INPUT', err8c?.code === 'INVALID_INPUT', err8c?.code);
  const atpFair = await OrderService.getATP(ed(1), FAIR_A);
  ok('T8d fair ATP = physical (=10)', atpFair === 10, `ATP=${atpFair}`);

  if (failures.length > 0) { console.error(`\n❌ S1: ${failures.length} case FAIL: ${failures.join(', ')}`); process.exit(1); }
  console.log('\n🎉 S1 BATCH TRANSFER: tất cả cases PASS!');
}

main().catch((e) => { console.error('❌ S1 sập:', e); process.exit(1); });
