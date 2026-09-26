import { generateUUIDv7, extractTimestampFromUUIDv7 } from '../src/lib/uuidv7';
import {
  applySyncErrorToOfflineOrder,
  getOfflineOrderRepairAction,
  isPaymentWindowExpired,
  needsManualReview,
  normalizeOfflinePaymentState,
  OfflineOrder,
  OfflinePaymentState,
} from '../src/lib/offline-db';
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

  // Trạng thái thanh toán cục bộ: tiền mặt sẵn sàng sync, chuyển khoản/QR cần ảnh
  // trước khi được coi là đã thu tiền.
  const normalizeBase: OfflineOrder = {
    ...blockedBase,
    id: generateUUIDv7(),
    orderCode: 'OFF-STATE',
    idempotencyKey: 'idem-offline-state',
    syncStatus: 'PENDING',
  };
  const states: Array<[string, OfflineOrder, OfflinePaymentState]> = [
    ['Tiền mặt offline sẵn sàng đồng bộ', { ...normalizeBase, paymentMethod: 'CASH' }, 'READY_TO_SYNC'],
    ['Chuyển khoản đã thu tiền → chờ sync', { ...normalizeBase, paymentMethod: 'BANK_TRANSFER', moneyReceived: true }, 'PAID_PENDING_SYNC'],
    ['QR chưa có ảnh xác nhận → cần đối soát', { ...normalizeBase, paymentMethod: 'QR_CODE' }, 'NEEDS_RECONCILIATION'],
    [
      'paymentState tường minh được giữ, moneyReceived false không nâng cấp sai',
      { ...normalizeBase, paymentMethod: 'BANK_TRANSFER', moneyReceived: false, paymentState: 'AWAITING_PAYMENT' },
      'AWAITING_PAYMENT',
    ],
    [
      'Đơn hủy cục bộ giữ nguyên trạng thái',
      { ...normalizeBase, paymentMethod: 'BANK_TRANSFER', moneyReceived: true, paymentState: 'CANCELLED_LOCAL' },
      'CANCELLED_LOCAL',
    ],
  ];
  for (const [name, order, expected] of states) {
    const actual = normalizeOfflinePaymentState(order as OfflineOrder);
    assert(actual === expected, `Trạng thái thanh toán offline: ${name}`, `Kỳ vọng ${expected}, nhận ${actual}`);
  }

  // Xung đột ATP / idempotency / két đã đóng phải vào đối soát; lỗi mạng thì
  // giữ nguyên để retry được, không kẹt đơn vào đối soát.
  const reconcileBase: OfflineOrder = { ...normalizeBase, paymentMethod: 'BANK_TRANSFER', moneyReceived: true };
  for (const code of ['INSUFFICIENT_ATP', 'IDEMPOTENCY_CONFLICT', 'CASHBOX_SESSION_NOT_FOUND']) {
    const actual = applySyncErrorToOfflineOrder(reconcileBase, code);
    assert(
      actual === 'NEEDS_RECONCILIATION',
      `Lỗi sync ${code} chuyển đơn sang NEEDS_RECONCILIATION`,
      `Nhận ${actual}`
    );
  }
  const networkState = applySyncErrorToOfflineOrder(reconcileBase, 'NETWORK');
  assert(
    networkState === 'PAID_PENDING_SYNC',
    'Lỗi mạng giữ nguyên trạng thái để thử lại được, không kẹt vào đối soát',
    `Nhận ${networkState}`
  );
  const cashState = applySyncErrorToOfflineOrder({ ...normalizeBase, paymentMethod: 'CASH' }, 'INSUFFICIENT_ATP');
  assert(
    cashState === 'READY_TO_SYNC',
    'Đơn tiền mặt không bị đổi trạng thái vì lỗi ATP của luồng chuyển khoản',
    `Nhận ${cashState}`
  );

  // --- Rà soát đối soát: đơn kẹt phải nhìn thấy, và không ai được tự dán nhãn ---
  // getPendingOfflineOrders chỉ trả về READY_TO_SYNC/PAID_PENDING_SYNC. Đơn đã
  // kẹt ở AWAITING_PAYMENT (khách bỏ đi giữa chừng) hoặc NEEDS_RECONCILIATION
  // (xung đột ATP/idempotency/két) không bao giờ đi qua đường tự động, nên bề mặt
  // rà soát phải lấy chúng từ getOfflineOrdersForReview chứ không lọc bằng
  // danh sách pending — nếu không chúng vô hình vĩnh viễn trên máy cashier.
  const stuck: Array<[string, OfflineOrder, boolean]> = [
    [
      'Đơn chờ khách chuyển (AWAITING_PAYMENT) phải hiện ra rà soát',
      { ...normalizeBase, paymentMethod: 'BANK_TRANSFER', moneyReceived: false, paymentState: 'AWAITING_PAYMENT' },
      true,
    ],
    [
      'Đơn xung đột ATP (NEEDS_RECONCILIATION) phải hiện ra rà soát',
      { ...reconcileBase, paymentState: 'NEEDS_RECONCILIATION' },
      true,
    ],
    [
      'Đơn chuyển khoản đã thu tiền chờ sync không cần rà soát thủ công',
      { ...reconcileBase, paymentState: 'PAID_PENDING_SYNC' },
      false,
    ],
    [
      'Đơn tiền mặt sẵn sàng không cần rà soát thủ công',
      { ...normalizeBase, paymentMethod: 'CASH' },
      false,
    ],
    [
      'Đơn quà tặng chuyển khoản KHÔNG bị kẹt (discountRate 1 nghĩa là không thu tiền)',
      { ...normalizeBase, paymentMethod: 'BANK_TRANSFER', discountRate: 1, moneyReceived: false },
      false,
    ],
    [
      'Đơn quà tặng có isGift=true cũng không bị kẹt',
      { ...normalizeBase, paymentMethod: 'QR_CODE', isGift: true, moneyReceived: false },
      false,
    ],
  ];
  for (const [name, order, expected] of stuck) {
    const actual = needsManualReview(order as OfflineOrder);
    assert(actual === expected, name, `Kỳ vọng ${expected}, nhận ${actual}`);
  }
  assert(
    needsManualReview({ ...normalizeBase, paymentMethod: 'BANK_TRANSFER', isGift: true, discountRate: 1 } as OfflineOrder) === false,
    'Đơn quà tặng không bao giờ rơi vào hàng đối soát dù hình thức là chuyển khoản',
    'isGift và discountRate 1 đều được miễn'
  );
  // Đơn đã huỷ cục bộ thì không rà soát nữa, nhưng cũng không được coi là hợp lệ.
  assert(
    normalizeOfflinePaymentState({ ...reconcileBase, paymentState: 'CANCELLED_LOCAL' }) === 'CANCELLED_LOCAL' &&
      needsManualReview({ ...reconcileBase, paymentState: 'CANCELLED_LOCAL' }) === false,
    'Đơn huỷ cục bộ: giữ trạng thái huỷ và không mở vô ích hàng rà soát'
  );

  // --- Cửa sổ 30 phút: hết hạn là quyết định của server, client chỉ chặn sớm ---
  const windowNow = Date.parse('2026-09-25T10:00:00.000Z');
  assert(
    isPaymentWindowExpired('2026-09-25T10:30:00.000Z', windowNow) === false &&
      isPaymentWindowExpired('2026-09-25T10:00:00.000Z', windowNow) === true &&
      isPaymentWindowExpired('2026-09-25T09:59:59.000Z', windowNow) === true,
    'isPaymentWindowExpired chặn đúng mốc 30 phút, không nới trước 1 phút',
    `Còn hạn=${isPaymentWindowExpired('2026-09-25T10:30:00.000Z', windowNow)}`
  );
  assert(
    isPaymentWindowExpired(undefined, windowNow) === false && isPaymentWindowExpired('không-phải-ngày', windowNow) === false,
    'Thiếu hạn hoặc hạn hỏng thì không khoá nhầm cashier (server vẫn là chủ quyết định)'
  );

  await db.delete(orders).where(eq(orders.id, offlineUuid));

  console.log('\n=======================================================');
  console.log(`🎉 TẤT CẢ ${passed}/${total} BÀI KIỂM THỬ OFFLINE ENGINE ĐÃ PASS 100%!`);
  console.log('=======================================================\n');
}

testOfflineEngine().catch((err) => {
  console.error('Lỗi khi chạy bộ kiểm thử offline engine:', err);
  process.exit(1);
});
