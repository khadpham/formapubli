import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_s4_settlement.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

async function run() {
  console.log('--- TEST S4: DAILY FAIR SETTLEMENT & STOCK RECONCILIATION ---');

  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-s4-settlement');

  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../src/db/schema');
  const { DailySettlementService } = await import('../src/services/daily-settlement.service');

  const rawClient = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(rawClient);

  // Khởi tạo kho hội chợ
  await db.insert(schema.warehouses).values({
    id: 'wh-fair-s4',
    code: 'KHO_HOI_CHO_S4',
    name: 'Gian Hàng Hội Chợ S4',
    warehouseType: 'FAIR_EVENT',
    isSellableOnPos: true,
    isActive: true,
  });

  // Khởi tạo Tác phẩm & Ấn bản
  await db.insert(schema.works).values({
    id: 'work-s4-1',
    code: 'FORMA-S4-1',
    title: 'Nghệ Thuật Sống',
    author: 'Forma Author',
    isActive: true,
  });

  await db.insert(schema.editions).values({
    id: 'ed-s4-1',
    code: 'S4-01',
    workId: 'work-s4-1',
    isbn: '9786040000011',
    isbnLast4: '0011',
    coverPrice: 100000,
    isActive: true,
  });

  await db.insert(schema.editions).values({
    id: 'ed-s4-2',
    code: 'S4-02',
    workId: 'work-s4-1',
    isbn: '9786040000022',
    isbnLast4: '0022',
    coverPrice: 200000,
    isActive: true,
  });

  // Tồn kho ban đầu tại hội chợ
  await db.insert(schema.stockBalances).values([
    {
      id: 'sb-s4-1',
      editionId: 'ed-s4-1',
      warehouseId: 'wh-fair-s4',
      physicalQuantity: 50,
      condition: 'NEW',
    },
    {
      id: 'sb-s4-2',
      editionId: 'ed-s4-2',
      warehouseId: 'wh-fair-s4',
      physicalQuantity: 30,
      condition: 'NEW',
    },
  ]);

  const todayIso = new Date().toISOString().slice(0, 10);

  // Tạo 1 phiên ca làm việc đã đóng
  await db.insert(schema.cashboxSessions).values({
    id: 'cbs-s4-001',
    warehouseId: 'wh-fair-s4',
    cashierId: 'cashier-lananh',
    openingCash: 500000,
    closingCashActual: 1400000, // Thực đếm
    expectedCash: 1400000, // Khớp lý thuyết (500k + 900k)
    cashDiscrepancy: 0,
    totalCashSales: 900000,
    totalTransferSales: 300000,
    totalOrdersCount: 2,
    status: 'CLOSED',
    openedAt: `${todayIso}T08:00:00.000Z`,
    closedAt: `${todayIso}T14:00:00.000Z`,
  });

  // Tạo 2 đơn hàng trong ngày
  // Đơn 1: Tiền mặt, CK 10%
  await db.insert(schema.orders).values({
    id: 'ord-s4-1',
    orderCode: 'ORD-S4-001',
    warehouseId: 'wh-fair-s4',
    cashierId: 'cashier-lananh',
    cashboxSessionId: 'cbs-s4-001',
    subtotal: 1000000,
    discountRate: 0.1,
    discountAmount: 100000,
    finalAmount: 900000,
    paymentMethod: 'CASH',
    status: 'COMPLETED',
    idempotencyKey: 'idemp-s4-1',
    createdAt: `${todayIso}T09:30:00.000Z`,
  });

  await db.insert(schema.orderItems).values([
    {
      id: 'item-s4-1',
      orderId: 'ord-s4-1',
      editionId: 'ed-s4-1',
      quantity: 10,
      unitCoverPrice: 100000,
      unitSellingPrice: 90000,
      totalAmount: 900000,
    },
  ]);

  // Đơn 2: Chuyển khoản QR, CK 25% (Vượt trần)
  await db.insert(schema.orders).values({
    id: 'ord-s4-2',
    orderCode: 'ORD-S4-002',
    warehouseId: 'wh-fair-s4',
    cashierId: 'cashier-lananh',
    cashboxSessionId: 'cbs-s4-001',
    subtotal: 400000,
    discountRate: 0.25,
    discountAmount: 100000,
    finalAmount: 300000,
    paymentMethod: 'BANK_TRANSFER',
    status: 'COMPLETED',
    idempotencyKey: 'idemp-s4-2',
    createdAt: `${todayIso}T11:00:00.000Z`,
  });

  await db.insert(schema.orderItems).values([
    {
      id: 'item-s4-2',
      orderId: 'ord-s4-2',
      editionId: 'ed-s4-2',
      quantity: 2,
      unitCoverPrice: 200000,
      unitSellingPrice: 150000,
      totalAmount: 300000,
    },
  ]);

  // Ghi nhận duyệt chiết khấu cho đơn 2
  await db.insert(schema.discountApprovalRequests).values({
    id: 'appr-s4-2',
    orderCode: 'ORD-S4-002',
    warehouseId: 'wh-fair-s4',
    cashierId: 'cashier-lananh',
    cartHash: 'fakehash',
    requestedDiscountRate: 0.25,
    originalAmount: 400000,
    discountAmount: 100000,
    finalAmount: 300000,
    status: 'CONSUMED',
    approvedBy: 'Quản lý Đức',
    approvalMethod: 'ONE_TOUCH',
    nonce: 'nonce123',
    expiresAt: `${todayIso}T12:00:00.000Z`,
    createdAt: `${todayIso}T10:55:00.000Z`,
  });

  // [Case 1] Tổng hợp doanh thu & Cơ cấu thanh toán
  console.log('\n[Case 1] Tổng hợp doanh thu & cơ cấu thanh toán (Cash / QR)');
  const report = await DailySettlementService.getDailyFairSettlement(
    { warehouseId: 'wh-fair-s4', date: todayIso },
    db
  );

  assert.strictEqual(report.financials.totalOrdersCount, 2, 'Tổng 2 đơn hàng');
  assert.strictEqual(report.financials.grossSales, 1400000, 'Doanh thu gộp 1.400.000 đ');
  assert.strictEqual(report.financials.totalDiscount, 200000, 'Tổng chiết khấu 200.000 đ');
  assert.strictEqual(report.financials.netSales, 1200000, 'Doanh thu thực thu 1.200.000 đ');

  // Breakdown
  assert.strictEqual(report.paymentBreakdown.cash.sales, 900000, 'Tiền mặt 900.000 đ');
  assert.strictEqual(report.paymentBreakdown.cash.ordersCount, 1, '1 đơn tiền mặt');
  assert.strictEqual(report.paymentBreakdown.qrTransfer.sales, 300000, 'Chuyển khoản QR 300.000 đ');
  assert.strictEqual(report.paymentBreakdown.qrTransfer.ordersCount, 1, '1 đơn QR');

  console.log('✓ Doanh số và phân bổ thanh toán khớp 100%');

  // [Case 2] Cảnh báo chiết khấu bình quân ngày
  console.log('\n[Case 2] Giám sát tỷ lệ chiết khấu bình quân ngày');
  // 200.000 / 1.400.000 = ~14.28% > 12% -> Cảnh báo bật
  assert.strictEqual(report.financials.isDiscountRateWarning, true, 'Kích hoạt cảnh báo CK > 12%');
  console.log(`✓ Tỷ lệ CK bình quân: ${(report.financials.averageDiscountRate * 100).toFixed(2)}% (Cảnh báo: ${report.financials.isDiscountRateWarning})`);

  // [Case 3] Danh sách đơn duyệt đặc biệt (> 20%)
  console.log('\n[Case 3] Báo cáo đơn chiết khấu vượt trần (> 20%)');
  assert.strictEqual(report.discountSupervision.overCapOrdersCount, 1, 'Có 1 đơn vượt trần 20%');
  assert.strictEqual(report.discountSupervision.orders[0].orderCode, 'ORD-S4-002', 'Đúng mã đơn vượt trần');
  assert.strictEqual(report.discountSupervision.orders[0].approvalMethod, 'ONE_TOUCH', 'Đúng phương thức duyệt');
  console.log('✓ Báo cáo giám sát chiết khấu đặc biệt chính xác');

  // [Case 4] Đối soát két tiền (Cashbox Reconciliation)
  console.log('\n[Case 4] Đối soát két tiền ca làm việc');
  assert.strictEqual(report.cashboxReconciliation.openingCashTotal, 500000, 'Tiền đầu ca 500.000 đ');
  assert.strictEqual(report.cashboxReconciliation.expectedCashTotal, 1400000, 'Kỳ vọng két 1.400.000 đ');
  assert.strictEqual(report.cashboxReconciliation.closingCashActualTotal, 1400000, 'Thực tế đếm 1.400.000 đ');
  assert.strictEqual(report.cashboxReconciliation.cashVariance, 0, 'Khớp 100% không lệch');
  console.log('✓ Đối soát két tiền hoàn toàn chính xác');

  // [Case 5] Top ấn phẩm bán chạy tại gian hàng
  console.log('\n[Case 5] Top ấn phẩm bán chạy tại hội chợ');
  assert.strictEqual(report.topSellers.length, 2, 'Top 2 ấn phẩm bán chạy');
  assert.strictEqual(report.topSellers[0].code, 'S4-01', 'Top 1: S4-01 (10 cuốn)');
  assert.strictEqual(report.topSellers[0].soldCopies, 10);
  assert.strictEqual(report.topSellers[1].code, 'S4-02', 'Top 2: S4-02 (2 cuốn)');
  assert.strictEqual(report.topSellers[1].soldCopies, 2);
  console.log('✓ Xếp hạng bán chạy chính xác');

  // [Case 6] Đối soát tồn kho sách trên kệ vs Máy
  console.log('\n[Case 6] Đối soát tồn kho sách trên kệ (Shelf vs Machine)');
  assert(report.inventoryReconciliation.length >= 2, 'Có danh sách tồn kho đối soát');
  const book1 = report.inventoryReconciliation.find((it: any) => it.code === 'S4-01');
  assert.strictEqual(book1.soldToday, 10, 'S4-01 đã bán 10 cuốn');
  assert.strictEqual(book1.theoreticalStock, 50, 'S4-01 tồn lý thuyết còn 50 cuốn');
  console.log('✓ Bảng đối soát tồn kho kệ vs máy chính xác');

  console.log('\n🎉 TOÀN BỘ TEST DAILY SETTLEMENT (SPRINT 4) PASS 100%!');
}

run()
  .catch((err) => {
    console.error('❌ TEST FAILED:', err);
    process.exit(1);
  })
  .finally(() => {
    for (const s of ['', '-wal', '-shm', '-journal']) {
      try { fs.unlinkSync(DB_FILE + s); } catch {}
    }
  });
