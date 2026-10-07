import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_partner_debt.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

const daysAgoIso = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

async function run() {
  console.log('--- TEST PARTNER DEBT: phải thu + thu gối đầu FIFO + quá hạn ---');

  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-partner-debt');

  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const { eq } = await import('drizzle-orm');
  const schema = await import('../src/db/schema');
  const { DeliveryOrderService } = await import('../src/services/delivery-order.service');
  const { PartnerDebtService } = await import('../src/services/partner-debt.service');

  const rawClient = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(rawClient);
  await db.insert(schema.warehouses).values([
    { id: 'wh-au-co', code: 'KHO_AU_CO', name: 'Kho Âu Cơ', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
  ]);
  await db.insert(schema.partners).values([
    { id: 'part-debt', code: 'DL_DEBT', name: 'Đại lý Nợ', type: 'WHOLESALE', discountRate: 0.35, creditLimit: 1000000, paymentDueDays: 30 },
  ]);
  await db.insert(schema.works).values([{ id: 'work-db', code: 'W-DB', title: 'TP DB', author: 'TG' }]);
  await db.insert(schema.editions).values([
    { id: 'ed-db-1', code: 'D01', workId: 'work-db', isbn: '9780000000611', isbnLast4: '0611', coverPrice: 100000 },
  ]);
  await db.insert(schema.stockBalances).values([
    { id: 'sb-db-1', productId: 'ed-db-1', editionId: 'ed-db-1', warehouseId: 'wh-au-co', physicalQuantity: 100, condition: 'NEW' },
  ]);
  const STAFF = { staffId: 'staff-tk', role: 'ROLE_WAREHOUSE', fullName: 'Thủ Kho' };
  const mkPxk = async (key: string) => {
    const d = await DeliveryOrderService.createDraft({
      partnerId: 'part-debt', fromWarehouseId: 'wh-au-co', discountRate: 0.35,
      fiscalScope: 'COMMERCIAL_WHOLESALE',
      items: [{ editionId: 'ed-db-1', quantity: 10, unitCoverPrice: 100000, unitSellingPrice: 65000 }],
      actorContext: STAFF,
    });
    await DeliveryOrderService.dispatchAndLock({ deliveryOrderId: d.id, idempotencyKey: key, actorContext: STAFF });
    return d.id;
  };
  const idA = await mkPxk('idem-debt-A');
  const idB = await mkPxk('idem-debt-B');
  // Giả lập tuổi nợ: A khóa 40 ngày trước (quá hạn 30), B khóa 5 ngày trước.
  await db.update(schema.deliveryOrders).set({ dispatchedAt: daysAgoIso(40) }).where(eq(schema.deliveryOrders.id, idA));
  await db.update(schema.deliveryOrders).set({ dispatchedAt: daysAgoIso(5) }).where(eq(schema.deliveryOrders.id, idB));

  // 1. Thu 500k gối đầu → FIFO trừ phiếu cũ trước; A còn 150k quá hạn 10 ngày.
  const rc1: any = await PartnerDebtService.recordReceipt({
    partnerId: 'part-debt', amount: 500000, paymentMethod: 'BANK_TRANSFER',
    reference: 'BILL-001', paidAt: '2026-10-07', receivedBy: 'staff-01', idempotencyKey: 'rc-key-001',
  });
  assert.equal(rc1.isDuplicate, false);
  const s1 = await PartnerDebtService.summary('part-debt');
  assert.equal(s1.receivable, 1300000);
  assert.equal(s1.received, 500000);
  assert.equal(s1.balance, 800000);
  assert.equal(s1.overdue, 150000);
  assert.equal(s1.overdueCount, 1);
  assert.ok(s1.oldestOverdueDays >= 9 && s1.oldestOverdueDays <= 11, `tuổi quá hạn ~10 ngày, thực ${s1.oldestOverdueDays}`);
  console.log('✓ Thu gối đầu FIFO: phiếu cũ trừ trước, quá hạn tính đúng');

  // 2. Thu trùng key không ghi 2 lần.
  const dup: any = await PartnerDebtService.recordReceipt({
    partnerId: 'part-debt', amount: 500000, paymentMethod: 'BANK_TRANSFER',
    reference: 'BILL-001', paidAt: '2026-10-07', receivedBy: 'staff-01', idempotencyKey: 'rc-key-001',
  });
  assert.equal(dup.isDuplicate, true);
  const s2 = await PartnerDebtService.summary('part-debt');
  assert.equal(s2.received, 500000);
  console.log('✓ Thu trùng key không ghi 2 lần');

  // 3. Hủy phiếu thu → nợ quay lại.
  await PartnerDebtService.voidReceipt({ id: rc1.id, reason: 'Nhập nhầm số', actorId: 'staff-01' });
  const s3 = await PartnerDebtService.summary('part-debt');
  assert.equal(s3.received, 0);
  assert.equal(s3.balance, 1300000);
  assert.equal(s3.overdue, 650000 + 0); // A quá hạn toàn bộ 650k
  assert.equal(s3.overLimit, true); // hạn mức 1tr < nợ 1.3tr → cờ cảnh báo
  console.log('✓ Hủy phiếu thu: nợ quay lại + cờ vượt hạn mức');

  // 4. Validate đầu vào (tiền âm, thiếu bill, đại lý lạ).
  for (const bad of [
    { amount: 0, reference: 'B1' },
    { amount: -5, reference: 'B2' },
    { amount: 1000, reference: '' },
  ]) {
    let threw = false;
    try {
      await PartnerDebtService.recordReceipt({
        partnerId: 'part-debt', amount: bad.amount, paymentMethod: 'CASH',
        reference: bad.reference, paidAt: '2026-10-07', receivedBy: 's', idempotencyKey: `k-${Date.now()}-${Math.random()}`,
      });
    } catch { threw = true; }
    assert.equal(threw, true, `phải từ chối ${JSON.stringify(bad)}`);
  }
  console.log('✓ Từ chối tiền âm/thiếu bill');

  console.log('🎉 TOÀN BỘ TEST PARTNER DEBT PASS!');
}

run().catch((e) => { console.error('❌ FAIL:', e.message); process.exit(1); });
