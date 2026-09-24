/**
 * Bug #4b: "Chuyển hàng loạt" 500 trên Cloudflare Workers
 * (Too many subrequests — getATP gọi 1 query/cuốn, 81 cuốn = vượt giới hạn).
 * Kiểm: checkBatchAvailability phải dùng đúng SỐ QUERY cố định, không phụ thuộc số dòng.
 */
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_batch_atp.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}
process.env.AUTH_STRICT = 'true';
process.env.AUTH_SECRET = 'test-batch-atp-secret-32-chars-minimum!!!';

let pass = 0; let fail = 0;
const ok = (n: string, c: boolean, e = '') => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n}${e ? ` — ${e}` : ''}`); } };

async function run() {
  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL });

  const { db } = await import('../src/db');
  const schema = await import('../src/db/schema');
  const { InventoryService } = await import('../src/services/inventory.service');
  const { hashStaffPasscodeV2 } = await import('../src/lib/auth-session');

  await db.insert(schema.warehouses).values([
    { id: 'wh-src', code: 'SRC', name: 'Kho nguồn', warehouseType: 'PHYSICAL_MAIN', isActive: true, isSellableOnPos: true },
    { id: 'wh-dst', code: 'DST', name: 'Kho đích', warehouseType: 'PHYSICAL_MAIN', isActive: true, isSellableOnPos: false },
  ]);
  await db.insert(schema.works).values({ id: 'wk-b', code: 'WK-B', title: 'Sách batch', shortCode: 'B', author: 'A' });

  // 90 ấn bản — vượt ngưỡng subrequest của Worker nếu gọi 1 query/cuốn.
  const editions = Array.from({ length: 90 }, (_, i) => ({
    id: `ed-b${String(i).padStart(3, '0')}`,
    code: `B${i}`,
    workId: 'wk-b',
    title: `Sách ${i}`,
    coverPrice: 50000,
    isbn: `978000000${String(i).padStart(4, '0')}`,
    isbnLast4: String(i).padStart(4, '0'),
  }));
  await db.insert(schema.editions).values(editions as any);
  await db.insert(schema.stockBalances).values(
    editions.map((e, i) => ({
      id: `sb-${e.id}`, editionId: e.id, warehouseId: 'wh-src', condition: 'NEW', physicalQuantity: 10 + i,
    })) as any
  );
  await db.insert(schema.staffAccounts).values({
    staffId: 'BAT-QL', fullName: 'QL', role: 'ROLE_MANAGER',
    passcodeHash: await hashStaffPasscodeV2('8888', 's'), salt: 's', isActive: true, sessionVersion: 1,
  } as any);

  console.log('\n[B1] Số query phải KHÔNG phụ thuộc số dòng (giới hạn subrequest Workers)');
  const src = fs.readFileSync(path.resolve(process.cwd(), 'src/services/inventory.service.ts'), 'utf8');
  const method = src.slice(src.indexOf('static async checkBatchAvailability'));
  const body = method.slice(0, method.indexOf('\n  /**'));
  ok('checkBatchAvailability không gọi getATP trong vòng lặp',
    !/for\s*\([^)]*\)\s*\{[^}]*getATP/.test(body.replace(/\n\s*/g, ' ')),
    'vẫn còn N+1 query');
  ok('có hàm batch ATP dùng chung', /getBatchATP|batchAtp/.test(src), 'chưa có helper batch');

  console.log('\n[B2] 120 dòng: validate trong giới hạn subrequest, đúng số lượng');
  const items = editions.map((e) => ({ editionId: e.id, quantity: 1 }));
  const t0 = Date.now();
  const res = await InventoryService.checkBatchAvailability({
    fromWarehouseId: 'wh-src', toWarehouseId: 'wh-dst', items,
  });
  const ms = Date.now() - t0;
  ok('90 dòng hợp lệ → ok:true', (res as any).ok === true, JSON.stringify(res).slice(0, 160));
  ok('thời gian < 15s (trước đây ~165 round-trip)', ms < 15000, `${ms}ms`);

  console.log('\n[B3] Vẫn phát hiện đúng dòng thiếu tồn (ngữ nghĩa không đổi)');
  const short = editions.slice(0, 3).map((e) => ({ editionId: e.id, quantity: 9999 }));
  const res2 = await InventoryService.checkBatchAvailability({
    fromWarehouseId: 'wh-src', toWarehouseId: 'wh-dst', items: short,
  });
  const stale = (res2 as any).staleItems || [];
  ok('thiếu tồn → ok:false + staleItems', (res2 as any).ok === false && stale.length === 3, JSON.stringify(res2).slice(0, 160));
  ok('staleItems ghi đúng số lượng khả dụng', stale[0]?.availableNow === 10, `availableNow=${stale[0]?.availableNow}`);

  console.log('\n[B4] Trừ giữ chỗ đơn PENDING_CONFIRMATION (không đổi semantics getATP)');
  const now = new Date().toISOString();
  await db.insert(schema.orders).values({
    id: 'ord-hold', orderCode: 'HOLD-1', warehouseId: 'wh-src', channel: 'FAIR_EVENT',
    status: 'PENDING_CONFIRMATION', subtotal: 200000, finalAmount: 200000,
    paymentMethod: 'CASH', fiscalScope: 'RETAIL', syncStatus: 'SYNCED',
    cashierId: 'BAT-QL', idempotencyKey: 'hold-idem-1', createdAt: now,
  } as any);
  await db.insert(schema.orderItems).values({
    id: 'oi-hold', orderId: 'ord-hold', editionId: 'ed-b000', quantity: 4,
    unitCoverPrice: 50000, unitSellingPrice: 50000, discountRate: 0, lineTotal: 200000, totalAmount: 200000,
  } as any);
  const res3 = await InventoryService.checkBatchAvailability({
    fromWarehouseId: 'wh-src', toWarehouseId: 'wh-dst', items: [{ editionId: 'ed-b000', quantity: 7 }],
  });
  const s3 = (res3 as any).staleItems?.[0];
  ok('ATP trừ giữ chỗ (10 - 4 = 6 < 7) → stale', s3?.availableNow === 6, `availableNow=${s3?.availableNow}`);

  console.log(`\n${fail === 0 ? '🎉' : '💥'} BATCH ATP: ${pass}/${pass + fail} PASS`);
  assert.equal(fail, 0, `${fail} case FAIL`);
}

run().then(() => process.exit(0)).catch((e) => { console.error('💥 CRASH:', e); process.exit(1); });
