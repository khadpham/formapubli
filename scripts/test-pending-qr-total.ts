/**
 * TEST: `paymentBreakdown.pendingQr` — tiền chuyển khoản đang chờ xác nhận.
 *
 * Vì sao cần test riêng: TTL là 48h và đơn quá hạn VẪN CÒN trong DB với
 * status PENDING_CONFIRMATION, trong khi ATP đã nhả giữ chỗ. Tính bằng SUM
 * thuần sẽ thổi phồng số tiền đang chờ.
 *
 * CHẠY: npx tsx scripts/test-pending-qr-total.ts
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_pending_qr.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

async function run() {
  console.log('--- TEST: tiền chuyển khoản đang chờ xác nhận ---');

  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-pending-qr-total');

  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../src/db/schema');
  const { DailySettlementService } = await import('../src/services/daily-settlement.service');
  const { businessDateOf } = await import('../src/services/order.service');

  const client = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(client, { schema });

  const WH = 'wh-au-co';
  await db.insert(schema.warehouses).values({
    id: WH, code: 'KHO_AU_CO', name: 'Kho test', isActive: true,
  } as any);
  await db.insert(schema.works).values({
    id: 'w1', code: 'W1', title: 'Sách 1', author: 'A', isActive: true,
  } as any);
  await db.insert(schema.editions).values({
    id: 'e1', code: 'E1', workId: 'w1', isbn: '9786040000001', isbnLast4: '0001',
    coverPrice: 100000, isActive: true,
  } as any);

  const todayVn = businessDateOf(new Date());

  const mk = async (id: string, over: any) => {
    await db.insert(schema.orders).values({
      id, orderCode: id.toUpperCase(),
      warehouseId: WH, status: 'PENDING_CONFIRMATION', paymentMethod: 'QR_TRANSFER',
      subtotal: 100000, discountAmount: 0, finalAmount: 100000,
      cashierId: 'ADMIN-01', customerName: 'Khách lẻ',
      idempotencyKey: `test-pending-${id}`,
      createdAt: new Date().toISOString(),
      ...over,
    } as any);
    await db.insert(schema.orderItems).values({
      id: `${id}-i`, orderId: id, editionId: 'e1', productId: 'e1',
      quantity: 1, unitCoverPrice: 100000, unitSellingPrice: 100000, totalAmount: 100000,
    } as any);
  };

  // Giá trị `payment_method` PHẢI là giá trị thật của hệ thống: schema khai
  // CASH | BANK_TRANSFER | QR_CODE. Nếu test dùng giá trị bịa (QR_TRANSFER…) thì
  // nó xanh với cả code sai — đúng cái bẫy đã xảy ra ở lần viết đầu.
  await mk('o-live', { paymentMethod: 'QR_CODE' });
  await mk('o-live-bank', { paymentMethod: 'BANK_TRANSFER' });
  await mk('o-expired', { paymentMethod: 'QR_CODE', paymentExpiresAt: '2000-01-01T00:00:00.000Z' });
  await mk('o-cash', { paymentMethod: 'CASH' });
  // 23:50 VN hôm qua = 16:50 UTC hôm qua.
  await mk('o-yesterday', { paymentMethod: 'QR_CODE', createdAt: new Date(Date.now() - 7 * 3600_000).toISOString() });
  await mk('o-done', { status: 'COMPLETED', paymentMethod: 'QR_CODE' });

  const r: any = await DailySettlementService.getDailyFairSettlement({
    warehouseId: WH,
    date: todayVn,
  });

  assert.ok(r.paymentBreakdown.pendingQr, 'phải có paymentBreakdown.pendingQr');
  assert.equal(
    r.paymentBreakdown.pendingQr.ordersCount, 2,
    'đúng 2 đơn chuyển khoản còn hạn trong ngày (QR_CODE + BANK_TRANSFER)'
  );
  assert.equal(
    r.paymentBreakdown.pendingQr.total, 200000,
    'tiền chờ = tổng finalAmount của 2 đơn đó'
  );
  assert.equal(
    r.financials.netSales, 100000,
    'đơn đã COMPLETED vẫn vào Thực thu; đơn chờ KHÔNG được cộng vào'
  );

  // Ngày không có đơn chờ nào ⇒ vẫn phải có trường, bằng 0 (UI không vỡ).
  const empty: any = await DailySettlementService.getDailyFairSettlement({
    warehouseId: WH,
    date: '2020-01-01',
  });
  assert.equal(empty.paymentBreakdown.pendingQr.total, 0, 'ngày trống ⇒ pendingQr.total = 0');
  assert.equal(empty.paymentBreakdown.pendingQr.ordersCount, 0, 'ngày trống ⇒ pendingQr.ordersCount = 0');

  console.log('✓ test-pending-qr-total PASS');
}

run().catch((e) => {
  console.error('✗ test-pending-qr-total FAIL:', e);
  process.exit(1);
});