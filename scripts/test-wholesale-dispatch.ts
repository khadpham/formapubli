import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';
import { parsePastedBookList } from '../src/lib/batch-paste-parser';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_wholesale_dispatch.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

async function run() {
  console.log('--- TEST WHOLESALE DISPATCH: dán + CK + khóa sổ 1 lần ---');

  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-wholesale-dispatch');

  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const { eq } = await import('drizzle-orm');
  const schema = await import('../src/db/schema');
  const { DeliveryOrderService } = await import('../src/services/delivery-order.service');

  // 1. Dán Tên + SL (lệch hoa-thường vẫn khớp; tên lạ → not_found, không đoán).
  const catalog = [
    { id: 'ed-wd-1', title: 'Bốn tình yêu', code: 'H01', isbnLast4: '1111' },
    { id: 'ed-wd-2', title: 'May', code: 'H02', isbnLast4: '2222' },
  ];
  const { rows, summary } = parsePastedBookList('Bốn tình yêu\t10\nMAY\t5\nSách Không Tồn Tại\t3', catalog, { defaultQuantity: 5 });
  assert.equal(summary.matched, 2);
  assert.equal(summary.notFound, 1);
  const qtys = new Map(rows.filter((r) => r.status === 'matched').map((r: any) => [r.editionId, r.quantity]));
  assert.equal(qtys.get('ed-wd-1'), 10);
  assert.equal(qtys.get('ed-wd-2'), 5); // MAY hoa hết vẫn khớp May
  console.log('✓ Dán 2 cột: khớp đúng, lệch hoa-thường vẫn nhận, tên lạ không đoán');

  // 2. Seed kho + đối tác + ấn bản (giống shape test-s3-delivery-orders).
  const rawClient = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(rawClient);
  await db.insert(schema.warehouses).values([
    { id: 'wh-au-co', code: 'KHO_AU_CO', name: 'Kho Âu Cơ', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
  ]);
  await db.insert(schema.partners).values([
    { id: 'part-wd', code: 'DL_WD', name: 'Đại lý WD', type: 'WHOLESALE', discountRate: 0.4 },
  ]);
  await db.insert(schema.works).values([{ id: 'work-wd', code: 'W-WD', title: 'Tác phẩm WD', author: 'TG' }]);
  await db.insert(schema.editions).values([
    { id: 'ed-wd-1', code: 'H01', workId: 'work-wd', isbn: '9780000000111', isbnLast4: '1111', coverPrice: 100000 },
  ]);
  await db.insert(schema.stockBalances).values([
    { id: 'sb-wd-1', productId: 'ed-wd-1', editionId: 'ed-wd-1', warehouseId: 'wh-au-co', physicalQuantity: 50, condition: 'NEW' },
  ]);
  const STAFF = { staffId: 'staff-tk', role: 'ROLE_WAREHOUSE', fullName: 'Thủ Kho' };

  // 3. CK sửa tay trên phiếu KHÔNG đổi discountRate gốc của đối tác.
  const draft = await DeliveryOrderService.createDraft({
    partnerId: 'part-wd',
    fromWarehouseId: 'wh-au-co',
    discountRate: 0.35, // sửa tay khác 0.40 hợp đồng
    fiscalScope: 'COMMERCIAL_WHOLESALE',
    items: [{ editionId: 'ed-wd-1', quantity: 10, unitCoverPrice: 100000, unitSellingPrice: 65000 }],
    actorContext: STAFF,
  });
  assert.equal(draft.status, 'DRAFT');
  const [p] = await db.select().from(schema.partners).where(eq(schema.partners.id, 'part-wd'));
  assert.equal(p.discountRate, 0.4);
  console.log('✓ CK tay trên phiếu không đổi CK hợp đồng trong DB');

  // 4. Bấm đúp Ký duyệt (cùng key) chỉ trừ kho 1 lần.
  const KEY = 'idem-wd-double-001';
  const first = await DeliveryOrderService.dispatchAndLock({ deliveryOrderId: draft.id, idempotencyKey: KEY, actorContext: STAFF });
  const again = await DeliveryOrderService.dispatchAndLock({ deliveryOrderId: draft.id, idempotencyKey: KEY, actorContext: STAFF });
  assert.equal((again as any).code, (first as any).code); // replay trả đúng phiếu cũ
  const [bal] = await db.select().from(schema.stockBalances).where(eq(schema.stockBalances.id, 'sb-wd-1'));
  assert.equal(bal.physicalQuantity, 40); // 50 − 10 một lần duy nhất
  console.log('✓ Ký duyệt đúp cùng key: trả đúng phiếu cũ, kho chỉ trừ 1 lần');

  // 5. Modal đã nối dây: dán + nút kiểm tồn + chặn ký duyệt khi chưa kiểm.
  const src = fs.readFileSync(path.resolve(process.cwd(), 'src/components/inventory/WholesaleDispatchModal.tsx'), 'utf8');
  for (const needle of ['parsePastedBookList', 'Kiểm tra tồn kho', '/api/atp?editionIds', 'checkedFingerprint', 'Dán danh sách']) {
    assert.ok(src.includes(needle), `modal thiếu: ${needle}`);
  }
  console.log('✓ Modal nối đủ: dán + kiểm tồn cứng + chặn ký duyệt');

  console.log('🎉 TOÀN BỘ TEST WHOLESALE DISPATCH PASS!');
}

run().catch((e) => { console.error('❌ FAIL:', e.message); process.exit(1); });
