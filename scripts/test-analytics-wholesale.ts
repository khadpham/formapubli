import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_analytics_wholesale.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

async function run() {
  console.log('--- TEST ANALYTICS WHOLESALE: PXK vào doanh thu 1 lần duy nhất ---');

  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-analytics-wholesale');

  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const { eq, sql } = await import('drizzle-orm');
  const schema = await import('../src/db/schema');
  const { DeliveryOrderService } = await import('../src/services/delivery-order.service');
  const { AnalyticsService } = await import('../src/services/analytics.service');

  const rawClient = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(rawClient);
  await db.insert(schema.warehouses).values([
    { id: 'wh-au-co', code: 'KHO_AU_CO', name: 'Kho Âu Cơ', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
  ]);
  await db.insert(schema.partners).values([
    { id: 'part-aw', code: 'DL_AW', name: 'Đại lý AW', type: 'WHOLESALE', discountRate: 0.35 },
  ]);
  await db.insert(schema.works).values([{ id: 'work-aw', code: 'W-AW', title: 'TP AW', author: 'TG' }]);
  await db.insert(schema.editions).values([
    { id: 'ed-aw-1', code: 'A01', workId: 'work-aw', isbn: '9780000000711', isbnLast4: '0711', coverPrice: 100000 },
  ]);
  await db.insert(schema.stockBalances).values([
    { id: 'sb-aw-1', productId: 'ed-aw-1', editionId: 'ed-aw-1', warehouseId: 'wh-au-co', physicalQuantity: 100, condition: 'NEW' },
  ]);
  const STAFF = { staffId: 'staff-tk', role: 'ROLE_WAREHOUSE', fullName: 'Thủ Kho' };
  const countOrders = async () =>
    Number((await db.select({ n: sql<number>`COUNT(*)` }).from(schema.orders))[0].n || 0);

  const before = await countOrders();

  // 1. Xuất bán đứt + khóa sổ → doanh thu kênh bán đại lý tăng đúng finalAmount.
  const draft = await DeliveryOrderService.createDraft({
    partnerId: 'part-aw',
    fromWarehouseId: 'wh-au-co',
    discountRate: 0.35,
    fiscalScope: 'COMMERCIAL_WHOLESALE',
    items: [{ editionId: 'ed-aw-1', quantity: 10, unitCoverPrice: 100000, unitSellingPrice: 65000 }],
    actorContext: STAFF,
  });
  await DeliveryOrderService.dispatchAndLock({
    deliveryOrderId: draft.id, idempotencyKey: 'idem-aw-001', actorContext: STAFF,
  });
  const channels = await AnalyticsService.byChannel();
  const ws = channels.find((c) => c.channel === 'WHOLESALE_PARTNER');
  assert.ok(ws, 'phải có kênh WHOLESALE_PARTNER');
  assert.equal(Number(ws!.revenue), 650000); // 10 × 65.000
  assert.equal(Number(ws!.orders), 1);
  console.log('✓ PXK bán đứt đã khóa vào doanh thu kênh đúng finalAmount');

  // 2. Cả quy trình không sinh thêm dòng nào trong `orders` (chống đếm trùng).
  assert.equal(await countOrders(), before);
  console.log('✓ Xuất bán không sinh orders sỉ song song — không đếm trùng');

  // 3. Phiếu DRAFT và phiếu ký gửi không vào doanh thu.
  await DeliveryOrderService.createDraft({
    partnerId: 'part-aw',
    fromWarehouseId: 'wh-au-co',
    discountRate: 0.35,
    items: [{ editionId: 'ed-aw-1', quantity: 5, unitCoverPrice: 100000, unitSellingPrice: 65000 }],
    actorContext: STAFF,
  });
  const consDraft = await DeliveryOrderService.createDraft({
    partnerId: 'part-aw',
    fromWarehouseId: 'wh-au-co',
    discountRate: 0.35,
    fiscalScope: 'CONSIGNMENT_DISPATCH',
    items: [{ editionId: 'ed-aw-1', quantity: 5, unitCoverPrice: 100000, unitSellingPrice: 65000 }],
    actorContext: STAFF,
  });
  await DeliveryOrderService.dispatchAndLock({
    deliveryOrderId: consDraft.id, idempotencyKey: 'idem-aw-002', actorContext: STAFF,
  });
  const channels2 = await AnalyticsService.byChannel();
  const ws2 = channels2.find((c) => c.channel === 'WHOLESALE_PARTNER');
  assert.equal(Number(ws2!.revenue), 650000);
  assert.equal(Number(ws2!.orders), 1);
  console.log('✓ DRAFT + ký gửi (kể cả đã khóa) không vào doanh thu');

  // 4. Lọc theo kho vẫn thấy PXK của kho đó.
  const byWh = await AnalyticsService.byChannel({}, { warehouseId: 'wh-au-co' });
  const wsWh = byWh.find((c) => c.channel === 'WHOLESALE_PARTNER');
  assert.equal(Number(wsWh!.revenue), 650000);
  const byGhost = await AnalyticsService.byChannel({}, { warehouseId: 'wh-khong-ton-tai' });
  assert.ok(!byGhost.some((c) => c.channel === 'WHOLESALE_PARTNER' && Number(c.revenue) > 0));
  console.log('✓ Lọc kho: đúng kho thấy, kho lạ không thấy');

  console.log('🎉 TOÀN BỘ TEST ANALYTICS WHOLESALE PASS!');
}

run().catch((e) => { console.error('❌ FAIL:', e.message); process.exit(1); });
