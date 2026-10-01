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
      productId: 'ed-s4-1',
      editionId: 'ed-s4-1',
      warehouseId: 'wh-fair-s4',
      physicalQuantity: 50,
      condition: 'NEW',
    },
    {
      id: 'sb-s4-2',
      productId: 'ed-s4-2',
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
      productId: 'ed-s4-1',
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
      productId: 'ed-s4-2',
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

  // [Case 1c] Ngày nghiệp vụ KHÔNG được phụ thuộc múi giờ máy chủ (2026-09-29)
  //
  // Lỗi thật: `businessDateOf` dùng `getDate()` tức múi giờ của máy đang chạy.
  // Cloudflare Workers luôn UTC, máy dev là GMT+7 ⇒ cùng code trả ngày khác nhau
  // giữa production và dev trong khung 00:00-07:00 giờ VN. Ngày nghiệp vụ là khái
  // niệm kế toán VN, phải cố định ở mọi môi trường.
  console.log('\n[Case 1c] Ngày nghiệp vụ theo giờ Việt Nam, không theo máy chủ');
  const { businessDateOf, VN_TZ } = await import('../src/services/order.service');
  assert.strictEqual(VN_TZ, 'Asia/Ho_Chi_Minh', 'hằng múi giờ phải là Asia/Ho_Chi_Minh');

  // 2026-09-28T20:00:00Z = 03:00 ngày 29 theo giờ VN.
  const crossMidnight = new Date('2026-09-28T20:00:00Z');
  assert.strictEqual(
    businessDateOf(crossMidnight), '2026-09-29',
    '03:00 giờ VN ngày 29 phải ra ngày 29, không phải 28 (UTC)'
  );
  // 2026-09-28T16:00:00Z = 23:00 ngày 28 theo giờ VN.
  assert.strictEqual(
    businessDateOf(new Date('2026-09-28T16:00:00Z')), '2026-09-28',
    '23:00 giờ VN ngày 28 phải ra ngày 28'
  );
  // 2026-09-28T17:00:00Z = 00:00 ngày 29 — ranh giới đúng 00:00 VN.
  assert.strictEqual(
    businessDateOf(new Date('2026-09-28T17:00:00Z')), '2026-09-29',
    '00:00 giờ VN phải sang ngày mới'
  );
  // Chạy lại với TZ môi trường khác: kết quả phải KHÔNG đổi.
  const originalTz = process.env.TZ;
  const seen: string[] = [];
  for (const tz of ['UTC', 'America/New_York', 'Asia/Tokyo', '']) {
    if (tz === '') delete process.env.TZ; else process.env.TZ = tz;
    const v = businessDateOf(crossMidnight);
    if (seen.indexOf(v) === -1) seen.push(v);
  }
  if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;
  assert.strictEqual(
    seen.length, 1,
    `businessDateOf phải cho CÙNG kết quả ở mọi TZ, thấy ${seen.join(' | ')}`
  );
  console.log('✓ Ngày nghiệp vụ nhất quán ở mọi múi giờ máy');

  //
  // Lỗi đã sửa: vòng lặp đối soát két cộng `openingCash + s.totalCashSales` cho ca
  // OPEN. `totalCashSales` là bản chốt lúc đóng ca nên LUÔN = 0 khi ca còn mở ⇒
  // "tiền kỳ vọng" thấp hơt thực tế, mâu thuẫn với dòng "doanh số tiền mặt" ngay
  // bên cạnh. Định nghĩa đúng (giống GET /api/pos/live-monitor): tiền thuộc về CA,
  // gom theo cashboxSessionId, KHÔNG lọc theo lịch.
  // [Case 1d] Ngày nghiệp vụ VN trải trên HAI ngày UTC (2026-09-29)
  //
  // Lỗi THẬT do chính commit trước gây ra: đổi nhãn ngày sang VN nhưng SQL vẫn
  // lọc `LIKE '${targetDate}%'`, mà `created_at` luôn là UTC (app ghi
  // `new Date().toISOString()`, mặc định cột của SQLite là CURRENT_TIMESTAMP).
  // Ngày VN D chạy 17:00 UTC hôm trước → 17:00 UTC hôm D ⇒ nằm trải trên HAI
  // ngày UTC. Chỉ lọc một ngày thì mất 7 tiếng đầu, rồi `closeDay` ghi vĩnh
  // viễn vào `idempotency_keys` — không sửa được sau đó.
  console.log('\n[Case 1d] Ngày VN phải lấy đủ 2 mốc ngày UTC');
  await db.insert(schema.staffAccounts).values({
    staffId: 'CASH-UTC', fullName: 'Thu ngân UTC', role: 'ROLE_CASHIER',
    passcodeHash: 'v2$100000$' + '0'.repeat(64), salt: 'salt-utc', isActive: true, sessionVersion: 1,
  });
  // Ca mở 20:00 UTC ngày 28 = 03:00 ngày 29 theo giờ VN.
  await db.insert(schema.cashboxSessions).values({
    id: 'sess-utc', warehouseId: 'wh-fair-s4', cashierId: 'CASH-UTC',
    openingCash: 111000, status: 'OPEN', openedAt: '2026-09-28 20:00:00',
  });
  const D = '2026-09-29';
  const utcPrev = new Date(Date.parse(`${D}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  assert.strictEqual(utcPrev, '2026-09-28', 'ngày VN 29 bắt đầu từ 17:00 UTC ngày 28');
  const rUtc = await DailySettlementService.getDailyFairSettlement(
    { warehouseId: 'wh-fair-s4', date: D }, db
  );
  assert.ok(
    (rUtc.cashboxReconciliation.sessions as any[]).find((s: any) => s.id === 'sess-utc'),
    'Ca mở lúc 20:00 UTC hôm trước (= 03:00 VN ngày 29) PHẢI vào báo cáo ngày 29 — lọc 1 mốc UTC sẽ bỏ sót'
  );
  const rPrev = await DailySettlementService.getDailyFairSettlement(
    { warehouseId: 'wh-fair-s4', date: '2026-09-28' }, db
  );
  assert.strictEqual(
    (rPrev.cashboxReconciliation.sessions as any[]).find((s: any) => s.id === 'sess-utc')?.id,
    undefined,
    'Ca mở 03:00 giờ VN ngày 29 KHÔNG được tính vào báo cáo ngày 28'
  );
  console.log('✓ Báo cáo ngày VN bắt đủ 2 mốc UTC, không mất 7 tiếng đầu');

  // Cùng ca đó, thêm một đơn ghi theo HỌ TIMESTAMP THỨ HAI: app ghi
  // `new Date().toISOString()` = 'YYYY-MM-DDTHH:MM:SSZ', còn SQLite ghi
  // 'YYYY-MM-DD HH:MM:SS'. Biểu thức `datetime(col,'+7 hours')` phải nhận cả hai.
  await db.insert(schema.orders).values({
    id: 'o-utc-iso', orderCode: 'ORD-UTC-ISO', idempotencyKey: 'k-utc-iso',
    warehouseId: 'wh-fair-s4', cashierId: 'CASH-UTC', cashboxSessionId: 'sess-utc',
    status: 'COMPLETED', paymentMethod: 'CASH', subtotal: 70000, totalAmount: 70000,
    finalAmount: 70000, discountAmount: 0, discountRate: 0,
    // 20:30 UTC ngày 28 = 03:30 VN ngày 29
    createdAt: '2026-09-28T20:30:00Z', completedAt: '2026-09-28T20:30:00Z',
  } as any);
  const rIso = await DailySettlementService.getDailyFairSettlement(
    { warehouseId: 'wh-fair-s4', date: D }, db
  );
  const isoSession = (rIso.cashboxReconciliation.sessions as any[]).find((s: any) => s.id === 'sess-utc');
  assert.strictEqual(
    Number(isoSession?.expectedCashLive), 181000,
    'Tiền mặt phải cộng cả đơn họ SQLite lẫn họ ISO trong cùng ca (111.000 + 70.000)'
  );
  console.log('✓ Lọc ngày VN nhận đúng cả 2 họ timestamp (SQLite và ISO)');

  console.log('\n[Case 1b] Tiền mặt kỳ vọng khi ca còn mở');
  await db.insert(schema.staffAccounts).values({
    staffId: 'CASH-S4', fullName: 'Thu ngân S4', role: 'ROLE_CASHIER',
    passcodeHash: 'v2$100000$' + '0'.repeat(64), salt: 'salt-s4', isActive: true, sessionVersion: 1,
  });
  await db.insert(schema.cashboxSessions).values({
    id: 'sess-open-a', warehouseId: 'wh-fair-s4', cashierId: 'CASH-S4',
    openingCash: 500000, status: 'OPEN', openedAt: `${todayIso} 02:00:00`,
  });
  // Hai ca CÙNG thu ngân, cùng kho, cùng mở: mỗi ca phải ra tổng riêng.
  await db.insert(schema.cashboxSessions).values({
    id: 'sess-open-b', warehouseId: 'wh-fair-s4', cashierId: 'CASH-S4',
    openingCash: 200000, status: 'OPEN', openedAt: `${todayIso} 02:00:00`,
  });
  const mkOrder = async (id: string, code: string, sess: string, amount: number, ts: string) => {
    await db.insert(schema.orders).values({
      id, orderCode: code, idempotencyKey: 'k-' + id, warehouseId: 'wh-fair-s4',
      cashierId: 'CASH-S4', cashboxSessionId: sess, status: 'COMPLETED', paymentMethod: 'CASH',
      subtotal: amount, totalAmount: amount, finalAmount: amount,
      discountAmount: 0, discountRate: 0, createdAt: ts, completedAt: ts,
    } as any);
  };
  await mkOrder('o-open-a', 'ORD-OPEN-A', 'sess-open-a', 100000, `${todayIso} 09:00:00`);
  await mkOrder('o-open-b', 'ORD-OPEN-B', 'sess-open-b', 300000, `${todayIso} 10:00:00`);

  const rOpen = await DailySettlementService.getDailyFairSettlement(
    { warehouseId: 'wh-fair-s4', date: todayIso }, db
  );
  const openById = new Map<string, any>(
    rOpen.cashboxReconciliation.sessions.map((s: any) => [s.id, s])
  );
  assert.ok(openById.has('sess-open-a') && openById.has('sess-open-b'), 'phải thấy cả 2 ca đang mở');
  // Tiền kỳ vọng = openingCash + tiền mặt bán trong CHÍNH ca đó.
  assert.strictEqual(
    Number(openById.get('sess-open-a')?.expectedCashLive), 600000,
    'Ca A: 500.000 bàn giao + 100.000 bán trong ca = 600.000 (KHÔNG phải 500.000)'
  );
  assert.strictEqual(
    Number(openById.get('sess-open-b')?.expectedCashLive), 500000,
    'Ca B: 200.000 bàn giao + 300.000 bán trong ca = 500.000 (KHÔNG phải 200.000)'
  );
  assert.notStrictEqual(
    Number(openById.get('sess-open-a')?.expectedCashLive),
    Number(openById.get('sess-open-b')?.expectedCashLive),
    'Hai ca của cùng thu ngân phải ra hai số KHÁC nhau — trùng là đã gom sai'
  );

  // Dòng chênh lệch không được biến mất im lặng khi còn ca mở.
  assert.strictEqual(
    rOpen.cashboxReconciliation.cashVariance, null,
    'cashVariance giữ null khi còn ca mở (không đổi contract)'
  );
  assert.strictEqual(
    rOpen.cashboxReconciliation.cashVariancePending, true,
    'cashVariancePending phải true để UI nói "chưa thể đối soát" thay vì ẩn dòng'
  );
  assert.ok(
    Number(rOpen.cashboxReconciliation.openSessionCount) >= 2,
    'openSessionCount phải đếm số ca còn mở'
  );
  console.log('✓ Tiền mặt kỳ vọng tính đúng từng ca, dòng đối soát không biến mất');

  // [Case 2] Cảnh báo chiết khấu bình quân ngày (Ngưỡng an toàn 20%)
  console.log('\n[Case 2] Giám sát tỷ lệ chiết khấu bình quân ngày');
  // 200.000 / 1.400.000 = ~14.28% <= 20% -> Nằm trong hạn mức an toàn, không cảnh báo
  assert.strictEqual(report.financials.isDiscountRateWarning, false, 'An toàn dưới ngưỡng 20%');
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
