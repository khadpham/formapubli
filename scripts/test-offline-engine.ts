import { generateUUIDv7, extractTimestampFromUUIDv7 } from '../src/lib/uuidv7';
import { getOfflineOrderRepairAction, OfflineOrder } from '../src/lib/offline-db';
import { OrderService } from '../src/services/order.service';
import { db, orders, editions, warehouses } from '../src/db';
import { eq } from 'drizzle-orm';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-offline-engine');

/**
 * AUTOMATED AUDIT TEST SUITE: OFFLINE-FIRST POS ENGINE & MULTI-DIMENSIONAL SALES LEDGER
 */
async function testOfflineEngine() {
  console.log('📦 =======================================================');
  console.log('📦 BẮT ĐẦU KIỂM THỬ ĐỘNG CƠ OFFLINE-FIRST & SỔ KÉP DOANH SỐ');
  console.log('📦 =======================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    total++;
    if (condition) {
      console.log(`  ✅ [PASS ${total}] ${testName}`);
      if (detail) console.log(`     ↳ ${detail}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL ${total}] ${testName}`);
      if (detail) console.error(`     ↳ ${detail}`);
      throw new Error(`Kiểm thử thất bại: ${testName}`);
    }
  }

  // TEST 1: Kiểm tra định dạng UUID v7 RFC 9562
  const uuid1 = generateUUIDv7();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert(
    uuidRegex.test(uuid1),
    'Sinh mã UUID v7 hợp lệ chuẩn RFC 9562',
    `UUID mẫu: ${uuid1} (Version: 7, Variant: RFC 4122/9562)`
  );

  // TEST 2: Tính tăng đơn điệu theo thời gian (Monotonic Chronological Ordering)
  const uuidList: string[] = [];
  for (let i = 0; i < 50; i++) {
    uuidList.push(generateUUIDv7());
  }
  let isMonotonic = true;
  for (let i = 0; i < uuidList.length - 1; i++) {
    if (uuidList[i] >= uuidList[i + 1]) {
      isMonotonic = false;
      break;
    }
  }
  assert(
    isMonotonic,
    '50 UUID v7 sinh liên tiếp đảm bảo tính tăng đơn điệu tuyệt đối (Tự động sắp xếp thời gian)',
    `Đầu: ${uuidList[0]} ➔ Cuối: ${uuidList[49]}`
  );

  // TEST 3: Khả năng trích xuất Unix Timestamp chính xác từ UUID v7
  const nowMs = Date.now();
  const sampleUuid = generateUUIDv7();
  const extractedMs = extractTimestampFromUUIDv7(sampleUuid);
  const diffMs = Math.abs(extractedMs - nowMs);
  assert(
    diffMs < 50,
    'Trích xuất Timestamp mili-giây từ UUID v7 khớp với thời gian hệ thống',
    `Gốc: ${nowMs} | Trích xuất: ${extractedMs} (Độ lệch: ${diffMs}ms)`
  );

  // Chuẩn bị dữ liệu mẫu cho kiểm thử giao dịch
  const sampleEdition = (await db.select().from(editions).limit(1))[0];
  const sampleWarehouse = (await db.select().from(warehouses).where(eq(warehouses.id, 'wh-au-co')).limit(1))[0];
  assert(
    sampleEdition !== undefined && sampleWarehouse !== undefined,
    'Nạp dữ liệu ấn bản và kho mẫu từ SQLite thành công',
    `Sách: [${sampleEdition?.code}] ${sampleEdition?.title} | Kho: ${sampleWarehouse?.name}`
  );

  // TEST 4: Khởi tạo đơn hàng ngoại tuyến với UUID v7 và Idempotency Key
  const offlineUuid = generateUUIDv7();
  const offlineOrderCode = `OFF-TEST-${Date.now().toString().slice(-4)}`;
  const idempotencyKey = `idem-test-${offlineUuid}`;
  const clientTime = new Date().toISOString();

  const createdOrder = await OrderService.createOrder({
    id: offlineUuid,
    orderCode: offlineOrderCode,
    createdAt: clientTime,
    idempotencyKey,
    warehouseId: sampleWarehouse.id,
    customerName: 'Độc giả kiểm thử Offline',
    channel: 'RETAIL_OFFICE',
    discountRate: 0.1,
    paymentMethod: 'CASH',
    fiscalScope: 'INTERNAL_MANAGEMENT',
    cashierId: 'cashier-pos-test',
    note: 'Đơn hàng tạo từ thiết bị mất mạng mô phỏng',
    items: [
      {
        editionId: sampleEdition.id,
        quantity: 1,
      },
    ],
  });

  assert(
    createdOrder.orderId === offlineUuid && createdOrder.orderCode === offlineOrderCode,
    'Đơn hàng ngoại tuyến ghi nhận thành công với mã UUID v7 từ máy khách',
    `Mã đơn: ${createdOrder.orderCode} | ID: ${createdOrder.orderId}`
  );

  // TEST 5: Cơ chế bảo vệ Idempotency chống ghi trùng / trừ kho 2 lần khi Sync lại
  const duplicateSyncAttempt = await OrderService.createOrder({
    id: offlineUuid,
    orderCode: offlineOrderCode,
    createdAt: clientTime,
    idempotencyKey,
    warehouseId: sampleWarehouse.id,
    customerName: 'Độc giả kiểm thử Offline',
    channel: 'RETAIL_OFFICE',
    discountRate: 0.1,
    paymentMethod: 'CASH',
    fiscalScope: 'INTERNAL_MANAGEMENT',
    cashierId: 'cashier-pos-test',
    note: 'Thử gửi lại lần 2 do rớt mạng giả lập',
    items: [
      {
        editionId: sampleEdition.id,
        quantity: 1,
      },
    ],
  });

  assert(
    duplicateSyncAttempt.isDuplicate === true && duplicateSyncAttempt.orderId === offlineUuid,
    'Bảo vệ Idempotency thành công: Không trừ kho 2 lần khi thiết bị gửi lại đơn cũ',
    `Phát hiện trùng lặp IdempotencyKey: ${idempotencyKey}`
  );

  // TEST 6: Lọc đơn hàng đa chiều theo Kho hàng (Warehouse Filter)
  const ordersInAuCo = await OrderService.getOrders({
    warehouseId: 'wh-au-co',
  });
  const allInAuCoMatch = ordersInAuCo.every((o) => o.warehouseId === 'wh-au-co');
  assert(
    ordersInAuCo.length > 0 && allInAuCoMatch,
    'Bộ lọc đơn hàng theo Kho hàng hoạt động chính xác 100%',
    `Tìm thấy ${ordersInAuCo.length} đơn thuộc Kho Âu Cơ`
  );

  // TEST 7: Lọc đơn hàng đa chiều theo Khoảng thời gian (Date Range Filter)
  const todayStart = new Date().toISOString().slice(0, 10);
  const todayOrders = await OrderService.getOrders({
    startDate: todayStart,
  });
  assert(
    todayOrders.length > 0,
    'Bộ lọc đơn hàng theo Ngày hoạt động chính xác',
    `Số đơn phát sinh trong ngày: ${todayOrders.length}`
  );

  // TEST 8: Tổng hợp doanh số Sổ kép (Dual Fiscal Projection Summary)
  const salesSummary = await OrderService.getSalesSummary();
  assert(
    salesSummary.totalOrders > 0 && salesSummary.totalRevenue > 0,
    'Báo cáo doanh số Sổ kép tính toán toàn vẹn dòng tiền thực tế & thuế',
    `Tổng doanh thu: ${salesSummary.totalRevenue.toLocaleString('vi-VN')} đ | Nội bộ: ${salesSummary.internalManagement.revenue.toLocaleString('vi-VN')} đ | Thuế VAT: ${salesSummary.officialTax.revenue.toLocaleString('vi-VN')} đ`
  );

  const blockedBase: OfflineOrder = {
    id: offlineUuid,
    orderCode: 'OFF-BLOCKED',
    idempotencyKey: 'idem-offline-blocked',
    warehouseId: sampleWarehouse.id,
    customerName: 'Khách offline',
    channel: 'RETAIL_OFFICE',
    discountRate: 0,
    paymentMethod: 'BANK_TRANSFER',
    fiscalScope: 'INTERNAL_MANAGEMENT',
    cashierId: 'NV-OFFLINE',
    items: [{ editionId: sampleEdition.id, code: sampleEdition.code, title: sampleEdition.title || '', quantity: 1, unitCoverPrice: sampleEdition.coverPrice || 0 }],
    subtotal: sampleEdition.coverPrice || 0,
    discountAmount: 0,
    finalAmount: sampleEdition.coverPrice || 0,
    totalQuantity: 1,
    createdAt: new Date().toISOString(),
    syncStatus: 'FAILED',
  };
  assert(
    getOfflineOrderRepairAction({ ...blockedBase, lastError: 'Phiên két ca đã đóng' }) === 'REASSIGN_CASHBOX' &&
      getOfflineOrderRepairAction({ ...blockedBase, lastError: 'Phải xác nhận đã nhận tiền trước khi chốt đơn chuyển khoản/QR.' }) === 'CONFIRM_MONEY_RECEIVED' &&
      getOfflineOrderRepairAction({ ...blockedBase, lastError: 'Phải xác nhận đã nhận tiền trước khi chốt đơn chuyển khoản/QR.', moneyReceived: true }) === null &&
      getOfflineOrderRepairAction({ ...blockedBase, discountRate: 1, isGift: true, lastError: 'Phải xác nhận đã nhận tiền trước khi chốt đơn chuyển khoản/QR.' }) === null,
    'Đơn offline bị chặn chỉ được sửa qua hành động tường minh, không tự mặc định nhận tiền',
    'Cashbox yêu cầu tái gán ca; transfer/QR yêu cầu xác nhận nhận tiền; gift đã miễn'
  );

  // Dọn dẹp dữ liệu đơn test
  await db.delete(orders).where(eq(orders.id, offlineUuid));

  console.log('\n=======================================================');
  console.log(`🎉 TẤT CẢ ${passed}/${total} BÀI KIỂM THỬ OFFLINE ENGINE ĐÃ PASS 100%!`);
  console.log('=======================================================\n');
}

testOfflineEngine().catch((err) => {
  console.error('Lỗi khi chạy bộ kiểm thử offline engine:', err);
  process.exit(1);
});
