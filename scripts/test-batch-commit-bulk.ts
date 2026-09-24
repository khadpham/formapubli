/**
 * Bug #4c: COMMIT chuyển kho hàng loạt 500 "Too many subrequests".
 * recordMovement = 5 query × 2/dòng = 10/dòng → 5 dòng đã vượt trần 50 của Worker.
 * Yêu cầu: ghi gom lô (số query cố định), giữ nguyên tính nguyên tử + chặn xuất âm + sổ kho.
 */
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_batch_commit.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}
process.env.AUTH_STRICT = 'true';
process.env.AUTH_SECRET = 'test-batch-commit-secret-32-chars!!!';

let pass = 0; let fail = 0;
const ok = (n: string, c: boolean, e = '') => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n}${e ? ` — ${e}` : ''}`); } };

async function run() {
  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL });

  const { db } = await import('../src/db');
  const schema = await import('../src/db/schema');
  const { InventoryService } = await import('../src/services/inventory.service');
  const { hashStaffPasscodeV2 } = await import('../src/lib/auth-session');
  const { eq, and, inArray } = await import('drizzle-orm');

  await db.insert(schema.warehouses).values([
    { id: 'wh-c-src', code: 'CSRC', name: 'Kho nguồn', warehouseType: 'PHYSICAL_MAIN', isActive: true, isSellableOnPos: true },
    { id: 'wh-c-dst', code: 'CDST', name: 'Kho hội chợ', warehouseType: 'FAIR_EVENT', isActive: true, isSellableOnPos: true },
  ]);
  await db.insert(schema.works).values({ id: 'wk-c', code: 'WK-C', title: 'Sách', shortCode: 'C', author: 'A' });
  const eds = Array.from({ length: 60 }, (_, i) => ({
    id: `ed-c${String(i).padStart(3, '0')}`, code: `C${i}`, workId: 'wk-c', title: `Sách ${i}`,
    coverPrice: 50000, isbn: `978000001${String(i).padStart(4, '0')}`, isbnLast4: String(i).padStart(4, '0'),
  }));
  await db.insert(schema.editions).values(eds as any);
  await db.insert(schema.stockBalances).values(eds.map((e, i) => ({
    id: `sb-${e.id}`, editionId: e.id, warehouseId: 'wh-c-src', condition: 'NEW', physicalQuantity: 20 + i,
  })) as any);
  await db.insert(schema.staffAccounts).values({
    staffId: 'C-QL', fullName: 'QL', role: 'ROLE_MANAGER',
    passcodeHash: await hashStaffPasscodeV2('8888', 's'), salt: 's', isActive: true, sessionVersion: 1,
  } as any);

  const actorContext = { staffId: 'C-QL', role: 'ROLE_MANAGER' as const, fullName: 'QL' };
  const bal = async (editionId: string, wh: string) => {
    const rows = await db.select().from(schema.stockBalances).where(and(
      eq(schema.stockBalances.editionId, editionId),
      eq(schema.stockBalances.warehouseId, wh),
      eq(schema.stockBalances.condition, 'NEW')
    ));
    return Number(rows[0]?.physicalQuantity ?? 0);
  };

  console.log('\n[C1] Code đường commit không được gọi recordMovement từng dòng');
  const src = fs.readFileSync(path.resolve(process.cwd(), 'src/services/inventory.service.ts'), 'utf8');
  const commitStart = src.indexOf('static async transferBatch');
  const commitEnd = src.indexOf('static async checkBatchAvailability');
  const commitSrc = src.slice(commitStart, commitEnd);
  ok('transferBatch không lặp recordMovement theo dòng',
    !/for\s*\([^)]*merged[^)]*\)\s*\{[\s\S]{0,600}recordMovement/.test(commitSrc),
    'vẫn N+1 ghi');

  console.log('\n[C2] Commit 60 dòng: thành công, số lượng dịch chuyển đúng');
  const items = eds.map((e) => ({ editionId: e.id, quantity: 2 }));
  const t0 = Date.now();
  const res: any = await InventoryService.transferBatch({
    fromWarehouseId: 'wh-c-src', toWarehouseId: 'wh-c-dst', items,
    idempotencyKey: 'batch-c-1', actorContext: actorContext as any,
  });
  const ms = Date.now() - t0;
  ok('commit 60 dòng không lỗi', !!res?.pckCode, JSON.stringify(res).slice(0, 160));
  ok('có mã phiếu thật', /^PCK-/.test(res?.pckCode || ''), `pckCode=${res?.pckCode}`);
  ok('trả đủ 60 dòng kết quả', (res?.lines || []).length === 60, `lines=${res?.lines?.length}`);
  ok('thời gian < 15s', ms < 15000, `${ms}ms`);
  ok('tồn nguồn giảm đúng (ed-c000: 20 → 18)', (await bal('ed-c000', 'wh-c-src')) === 18, `còn ${await bal('ed-c000', 'wh-c-src')}`);
  ok('tồn đích tăng đúng (bucket mới = 2)', (await bal('ed-c000', 'wh-c-dst')) === 2, `còn ${await bal('ed-c000', 'wh-c-dst')}`);
  const ledgers = await db.select().from(schema.inventoryLedger).where(eq(schema.inventoryLedger.documentRef, res.pckCode));
  ok('sổ kho ghi đủ 120 bút toán (60 OUT + 60 IN)', ledgers.length === 120, `ledgers=${ledgers.length}`);

  console.log('\n[C3] Chặn xuất âm — rollback trọn vẹn');
  const before = await bal('ed-c001', 'wh-c-src');
  let threw: any = null;
  try {
    await InventoryService.transferBatch({
      fromWarehouseId: 'wh-c-src', toWarehouseId: 'wh-c-dst',
      items: [{ editionId: 'ed-c001', quantity: 1 }, { editionId: 'ed-c002', quantity: 999999 }],
      idempotencyKey: 'batch-c-2', actorContext: actorContext as any,
    });
  } catch (e: any) { threw = e; }
  ok('phiếu thiếu tồn bị từ chối', !!threw, 'không ném lỗi');
  ok('tồn nguồn KHÔNG bị trừ dòng hợp lệ (rollback)', (await bal('ed-c001', 'wh-c-src')) === before,
    `trước=${before} sau=${await bal('ed-c001', 'wh-c-src')}`);
  const dstBefore = await bal('ed-c001', 'wh-c-dst');
  ok('tồn đích không nhận dòng nào (rollback)', dstBefore === 2, `đích=${dstBefore}`);

  console.log('\n[C4] Idempotency: retry cùng key trả phiếu cũ, không ghi thêm');
  const res2: any = await InventoryService.transferBatch({
    fromWarehouseId: 'wh-c-src', toWarehouseId: 'wh-c-dst', items,
    idempotencyKey: 'batch-c-1', actorContext: actorContext as any,
  });
  ok('retry cùng key = isDuplicate', res2?.isDuplicate === true, `isDuplicate=${res2?.isDuplicate}`);
  const ledgers2 = await db.select().from(schema.inventoryLedger).where(eq(schema.inventoryLedger.documentRef, res.pckCode));
  ok('không phát sinh bút toán thêm', ledgers2.length === 120, `ledgers=${ledgers2.length}`);
  const after2 = await bal('ed-c000', 'wh-c-src');
  ok('tồn không đổi sau retry', after2 === 18, `tồn=${after2}`);

  console.log('\n[C5] Batch nhỏ vẫn đúng (1 dòng)');
  const res3: any = await InventoryService.transferBatch({
    fromWarehouseId: 'wh-c-src', toWarehouseId: 'wh-c-dst',
    items: [{ editionId: 'ed-c000', quantity: 1 }],
    idempotencyKey: 'batch-c-3', actorContext: actorContext as any,
  });
  ok('1 dòng thành công', !!res3?.pckCode, JSON.stringify(res3).slice(0, 120));
  ok('tồn đích ed-c000 = 3', (await bal('ed-c000', 'wh-c-dst')) === 3, `đích=${await bal('ed-c000', 'wh-c-dst')}`);

  console.log(`\n${fail === 0 ? '🎉' : '💥'} BATCH COMMIT: ${pass}/${pass + fail} PASS`);
  assert.equal(fail, 0, `${fail} case FAIL`);
}

run().then(() => process.exit(0)).catch((e) => { console.error('💥 CRASH:', e); process.exit(1); });
