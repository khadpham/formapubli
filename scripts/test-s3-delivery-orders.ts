import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_s3_delivery.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

async function run() {
  console.log('--- TEST S3: DELIVERY ORDER SERVICE (PXK, Atomic Sequences, Ledger & Reversal) ---');

  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-s3-delivery-orders');

  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const { eq } = await import('drizzle-orm');
  const schema = await import('../src/db/schema');
  const {
    DeliveryOrderService,
  } = await import('../src/services/delivery-order.service');

  const rawClient = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(rawClient);

  // 1. Seed warehouse, partner, work, edition, opening stock
  const WAREHOUSE_ID = 'wh-au-co';
  const PARTNER_ID = 'part-ca-chep';
  const EDITION_ID_1 = 'ed-book-1';
  const EDITION_ID_2 = 'ed-book-2';

  await db.insert(schema.warehouses).values([
    { id: WAREHOUSE_ID, code: 'KHO_AU_CO', name: 'Kho Âu Cơ', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
  ]);

  await db.insert(schema.partners).values([
    { id: PARTNER_ID, code: 'NS_CA_CHEP', name: 'Nhà sách Cá Chép', type: 'WHOLESALE', discountRate: 0.4, contactInfo: 'Hà Nội' },
  ]);

  await db.insert(schema.works).values([
    { id: 'work-1', code: 'W-01', title: 'Tác phẩm 1', author: 'Tác giả 1' },
    { id: 'work-2', code: 'W-02', title: 'Tác phẩm 2', author: 'Tác giả 2' },
  ]);

  await db.insert(schema.editions).values([
    { id: EDITION_ID_1, code: 'B01', workId: 'work-1', isbn: '978000000001', isbnLast4: '0001', coverPrice: 100000 },
    { id: EDITION_ID_2, code: 'B02', workId: 'work-2', isbn: '978000000002', isbnLast4: '0002', coverPrice: 200000 },
  ]);

  // Initial stock: Book 1 has 50, Book 2 has 20
  await db.insert(schema.stockBalances).values([
    { id: `sb-${EDITION_ID_1}`, editionId: EDITION_ID_1, warehouseId: WAREHOUSE_ID, physicalQuantity: 50, condition: 'NEW' },
    { id: `sb-${EDITION_ID_2}`, editionId: EDITION_ID_2, warehouseId: WAREHOUSE_ID, physicalQuantity: 20, condition: 'NEW' },
  ]);

  const STAFF_WAREHOUSE = { staffId: 'staff-tk', role: 'ROLE_WAREHOUSE', fullName: 'Thủ Kho 1' };
  const STAFF_CASHIER = { staffId: 'staff-tn', role: 'ROLE_CASHIER', fullName: 'Thu Ngân 1' };

  // Case 1: Create Draft
  console.log('\n[Case 1] Lập phiếu xuất bán sỉ DRAFT');
  const draft1 = await DeliveryOrderService.createDraft({
    partnerId: PARTNER_ID,
    fromWarehouseId: WAREHOUSE_ID,
    discountRate: 0.4, // 40% discount
    fiscalScope: 'COMMERCIAL_WHOLESALE',
    note: 'Xuất sách đợt 1 hội sách',
    items: [
      { editionId: EDITION_ID_1, quantity: 10, unitCoverPrice: 100000, unitSellingPrice: 60000 },
      { editionId: EDITION_ID_2, quantity: 5, unitCoverPrice: 200000, unitSellingPrice: 120000 },
    ],
    actorContext: STAFF_WAREHOUSE,
  });

  assert.equal(draft1.status, 'DRAFT');
  assert.equal(draft1.subtotal, 2000000); // (10 * 100k) + (5 * 200k) = 2,000,000
  assert.equal(draft1.finalAmount, 1200000); // (10 * 60k) + (5 * 120k) = 1,200,000
  assert.equal(draft1.items.length, 2);
  console.log('✓ Lập phiếu DRAFT thành công với đúng số tiền và tỷ lệ chiết khấu');

  // Case 2: Insufficient Stock Check on Dispatch
  console.log('\n[Case 2] Kiểm tra tồn kho khi xuất (ATP Guard)');
  const draftOverStock = await DeliveryOrderService.createDraft({
    partnerId: PARTNER_ID,
    fromWarehouseId: WAREHOUSE_ID,
    discountRate: 0.4,
    items: [
      { editionId: EDITION_ID_1, quantity: 999, unitCoverPrice: 100000, unitSellingPrice: 60000 }, // Cần 999 nhưng chỉ có 50
    ],
    actorContext: STAFF_WAREHOUSE,
  });

  let atpErrorCaught = false;
  try {
    await DeliveryOrderService.dispatchAndLock({
      deliveryOrderId: draftOverStock.id,
      idempotencyKey: 'idem-pxk-overstock',
      actorContext: STAFF_WAREHOUSE,
    });
  } catch (err: any) {
    atpErrorCaught = true;
    assert.equal(err.code, 'INSUFFICIENT_ATP');
  }
  assert.ok(atpErrorCaught, 'Xuất quá số lượng tồn phải bị chặn ngay');
  console.log('✓ Kiểm tra tồn ATP chặn xuất vượt tồn thành công');

  // Case 3: Successful Dispatch & Lock (PXK-YYYY-0001)
  console.log('\n[Case 3] Ký xuất kho bất biến & cấp mã PXK-YYYY-XXXX liên tục');
  const year = new Date().getFullYear();
  const locked1 = await DeliveryOrderService.dispatchAndLock({
    deliveryOrderId: draft1.id,
    idempotencyKey: 'idem-pxk-001',
    actorContext: STAFF_WAREHOUSE,
  });

  const expectedPxk1 = `PXK-${year}-0001`;
  assert.equal(locked1.code, expectedPxk1);
  assert.equal(locked1.status, 'DISPATCHED_LOCKED');
  assert.equal(locked1.dispatchedBy, STAFF_WAREHOUSE.staffId);
  assert.ok(locked1.dispatchedAt);

  // Verify stockBalances decreased
  const [sb1] = await db.select().from(schema.stockBalances).where(eq(schema.stockBalances.id, `sb-${EDITION_ID_1}`));
  const [sb2] = await db.select().from(schema.stockBalances).where(eq(schema.stockBalances.id, `sb-${EDITION_ID_2}`));
  assert.equal(sb1.physicalQuantity, 40); // 50 - 10 = 40
  assert.equal(sb2.physicalQuantity, 15); // 20 - 5 = 15

  // Verify inventoryLedger has DISPATCH_SALE entries
  const ledgers = await db
    .select()
    .from(schema.inventoryLedger)
    .where(eq(schema.inventoryLedger.documentRef, expectedPxk1));
  assert.equal(ledgers.length, 2);
  assert.equal(ledgers[0].eventType, 'DISPATCH_SALE');
  console.log(`✓ Ký xuất kho thành công: cấp mã ${expectedPxk1}, trừ thẻ kho và khóa DISPATCHED_LOCKED`);

  // Case 4: Idempotency of dispatch
  console.log('\n[Case 4] Idempotency: Gửi lại cùng key không trừ kho 2 lần');
  const replay = await DeliveryOrderService.dispatchAndLock({
    deliveryOrderId: draft1.id,
    idempotencyKey: 'idem-pxk-001',
    actorContext: STAFF_WAREHOUSE,
  });
  assert.equal(replay.code, expectedPxk1);
  const [sb1Check] = await db.select().from(schema.stockBalances).where(eq(schema.stockBalances.id, `sb-${EDITION_ID_1}`));
  assert.equal(sb1Check.physicalQuantity, 40, 'Kho không được trừ thêm lần 2');
  console.log('✓ Idempotency bảo vệ xuất kho kép thành công');

  // Case 5: Continuous Sequence for second order (PXK-YYYY-0002)
  console.log('\n[Case 5] Phiếu xuất thứ hai nhận mã PXK-YYYY-0002 liên tục');
  const draft2 = await DeliveryOrderService.createDraft({
    partnerId: PARTNER_ID,
    fromWarehouseId: WAREHOUSE_ID,
    discountRate: 0.4,
    items: [
      { editionId: EDITION_ID_1, quantity: 5, unitCoverPrice: 100000, unitSellingPrice: 60000 },
    ],
    actorContext: STAFF_WAREHOUSE,
  });
  const locked2 = await DeliveryOrderService.dispatchAndLock({
    deliveryOrderId: draft2.id,
    idempotencyKey: 'idem-pxk-002',
    actorContext: STAFF_WAREHOUSE,
  });
  const expectedPxk2 = `PXK-${year}-0002`;
  assert.equal(locked2.code, expectedPxk2);
  console.log(`✓ Phiếu thứ 2 nhận mã liên tục: ${expectedPxk2}`);

  // Case 6: Reversal (PXK_R-YYYY-0001)
  console.log('\n[Case 6] Đảo bút toán hủy phiếu (Reversal PXK_R)');
  const reversal = await DeliveryOrderService.reverse({
    deliveryOrderId: draft1.id,
    reason: 'Đại lý báo thừa số lượng so với hợp đồng',
    idempotencyKey: 'idem-pxk-rev-001',
    actorContext: STAFF_WAREHOUSE,
  });

  const expectedRevCode = `PXK_R-${year}-0001`;
  assert.equal(reversal.code, expectedRevCode);
  assert.equal(reversal.reversalOf, expectedPxk1);
  assert.equal(reversal.status, 'DISPATCHED_LOCKED');

  // Verify original order marked VOIDED_REVERSED
  const originalCheck = await DeliveryOrderService.getDeliveryOrder(draft1.id);
  assert.equal(originalCheck.status, 'VOIDED_REVERSED');

  // Verify stock restored
  const [sb1Restored] = await db.select().from(schema.stockBalances).where(eq(schema.stockBalances.id, `sb-${EDITION_ID_1}`));
  const [sb2Restored] = await db.select().from(schema.stockBalances).where(eq(schema.stockBalances.id, `sb-${EDITION_ID_2}`));
  assert.equal(sb1Restored.physicalQuantity, 45); // 40 - 5 (đơn 2) + 10 (hoàn đơn 1) = 45
  assert.equal(sb2Restored.physicalQuantity, 20); // 15 + 5 (hoàn đơn 1) = 20

  // Verify RECEIPT_RETURN in ledger
  const revLedgers = await db
    .select()
    .from(schema.inventoryLedger)
    .where(eq(schema.inventoryLedger.documentRef, expectedRevCode));
  assert.equal(revLedgers.length, 2);
  assert.equal(revLedgers[0].eventType, 'RECEIPT_RETURN');
  console.log(`✓ Đảo bút toán thành công: sinh ${expectedRevCode}, hoàn kho RECEIPT_RETURN và chuyển đơn gốc sang VOIDED_REVERSED`);

  // Case 7: Cannot reverse already voided order
  console.log('\n[Case 7] Chặn đảo bút toán lần 2');
  let doubleRevCaught = false;
  try {
    await DeliveryOrderService.reverse({
      deliveryOrderId: draft1.id,
      reason: 'Hủy tiếp',
      idempotencyKey: 'idem-pxk-rev-002',
      actorContext: STAFF_WAREHOUSE,
    });
  } catch (err: any) {
    doubleRevCaught = true;
    assert.equal(err.code, 'STATE_CONFLICT');
  }
  assert.ok(doubleRevCaught, 'Đảo bút toán lần 2 phải bị từ chối');
  console.log('✓ Chặn đảo bút toán lần 2 trên đơn đã VOIDED_REVERSED');

  rawClient.close();
  console.log('\n🎉 TOÀN BỘ TEST DELIVERY ORDER SERVICE PASS 100%!');
}

run().catch((err) => {
  console.error('❌ Test thất bại:', err);
  process.exit(1);
});
