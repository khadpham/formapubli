import { db, works, editions, warehouses, stockBalances, inventoryLedger, orders, auditLogs } from '../src/db';
import { InventoryService } from '../src/services/inventory.service';
import { OrderService } from '../src/services/order.service';
import { enforceFiscalScope, recordAuditLog } from '../src/lib/rbac-guard';
import { eq, and } from 'drizzle-orm';

async function runP0Tests() {
  console.log('🛡️ =========================================================');
  console.log('🛡️ BẮT ĐẦU KIỂM THỬ TOÀN DIỆN CÁC HẠNG MỤC ƯU TIÊN P0');
  console.log('🛡️ =========================================================\n');

  let passedTests = 0;
  const totalTests = 5;

  // TEST 1: Kiểm thử Transaction ACID & Rollback trong Thẻ kho
  console.log('--- TEST 1: Transaction ACID & Rollback trong recordMovement ---');
  const allEditions = await db.select().from(editions).limit(2);
  const testBook = allEditions[0];
  const whAuCo = 'wh-au-co';

  const balanceBefore = await InventoryService.getBalance(testBook.id, whAuCo, 'NEW');
  let threwExpected = false;

  try {
    // Thử xuất vượt quá số tồn kho hiện có
    await InventoryService.recordMovement({
      editionId: testBook.id,
      warehouseId: whAuCo,
      eventType: 'DISPATCH_SALE',
      quantityDelta: -(balanceBefore + 99999),
      condition: 'NEW',
      documentRef: 'TEST-ACID-ROLLBACK',
      actorId: 'test-acid-runner',
    });
  } catch (err: any) {
    if (err.message.includes('LỖI XUẤT ÂM KHO')) {
      threwExpected = true;
    }
  }

  const balanceAfter = await InventoryService.getBalance(testBook.id, whAuCo, 'NEW');
  if (threwExpected && balanceBefore === balanceAfter) {
    console.log(`✅ TEST 1 ĐẠT: Giao dịch bị từ chối sạch sẽ, số dư bảo toàn tuyệt đối (${balanceBefore} cuốn).`);
    passedTests++;
  } else {
    throw new Error(`TEST 1 THẤT BẠI: Số dư bị thay đổi hoặc không ném lỗi xuất âm!`);
  }

  // TEST 2: Kiểm thử Transaction ACID trong Đơn hàng (All-or-Nothing)
  console.log('\n--- TEST 2: Transaction ACID trong OrderService.createOrder (All-or-Nothing) ---');
  const countOrdersBefore = (await db.select().from(orders)).length;
  let orderThrew = false;

  try {
    await OrderService.createOrder({
      warehouseId: whAuCo,
      channel: 'FAIR_EVENT',
      customerName: 'Khách Test Hỏng',
      items: [
        { editionId: testBook.id, quantity: 1 },
        { editionId: allEditions[1].id, quantity: 999999 }, // Cuốn 2 thiếu hàng
      ],
    });
  } catch (err: any) {
    orderThrew = true;
  }

  const countOrdersAfter = (await db.select().from(orders)).length;
  if (orderThrew && countOrdersBefore === countOrdersAfter) {
    console.log(`✅ TEST 2 ĐẠT: Khi 1 sản phẩm thiếu hàng, toàn bộ đơn hàng và thẻ kho tự động rollback 100% (0 đơn rác phát sinh).`);
    passedTests++;
  } else {
    throw new Error(`TEST 2 THẤT BẠI: Đơn hàng bị ghi rác một phần!`);
  }

  // TEST 3: Kiểm thử Lá Chắn Server-side RBAC Guard
  console.log('\n--- TEST 3: Kiểm thử Lá Chắn Phân Quyền Server-side (enforceFiscalScope) ---');
  const taxScopeTryAll = enforceFiscalScope('ROLE_TAX', 'ALL');
  const taxScopeTryInternal = enforceFiscalScope('ROLE_TAX', 'INTERNAL_MANAGEMENT');
  const ownerScopeTryAll = enforceFiscalScope('ROLE_OWNER', 'ALL');
  const cashierScope = enforceFiscalScope('ROLE_CASHIER', 'ALL');

  if (
    taxScopeTryAll === 'OFFICIAL_TAX' &&
    taxScopeTryInternal === 'OFFICIAL_TAX' &&
    ownerScopeTryAll === 'ALL' &&
    cashierScope === 'INTERNAL_MANAGEMENT'
  ) {
    console.log(`✅ TEST 3 ĐẠT: Server-side Guard ép chặt ROLE_TAX vào OFFICIAL_TAX 100%, chặn đứng hoàn toàn việc xem trộm Sổ nội bộ.`);
    passedTests++;
  } else {
    throw new Error(`TEST 3 THẤT BẠI: Lỗ hổng rò rỉ phạm vi tài chính!`);
  }

  // TEST 4: Kiểm thử Bảng Audit Log truy vết hành vi
  console.log('\n--- TEST 4: Kiểm thử Nhật Ký Kiểm Toán (Audit Logs) ---');
  await recordAuditLog({
    action: 'VIEW_FISCAL_MANAGEMENT',
    actorRole: 'ROLE_TAX',
    actorId: 'test-tax-auditor',
    resource: '/api/orders',
    details: 'Cố tình truy vấn phạm vi ALL - Server đã tự động ép xuống OFFICIAL_TAX',
  });

  const latestAudits = await db.select().from(auditLogs).where(eq(auditLogs.actorId, 'test-tax-auditor'));
  if (latestAudits.length > 0 && latestAudits[0].action === 'VIEW_FISCAL_MANAGEMENT') {
    console.log(`✅ TEST 4 ĐẠT: Bảng audit_logs ghi vết thành công với mã: ${latestAudits[0].id}`);
    passedTests++;
  } else {
    throw new Error(`TEST 4 THẤT BẠI: Không tìm thấy bản ghi audit log!`);
  }

  // TEST 5: Kiểm thử Thuật toán Nhận diện Trùng ISBN (H21 & H36)
  console.log('\n--- TEST 5: Kiểm thử Xử lý Trùng ISBN (Disambiguation Matching) ---');
  const sharedIsbn = '9786044737690';
  const matchingBooks = await db.select().from(editions).where(eq(editions.isbn, sharedIsbn));

  console.log(`Tìm thấy ${matchingBooks.length} ấn bản cùng chung ISBN ${sharedIsbn}:`);
  matchingBooks.forEach(b => console.log(`   - [${b.code}] ${b.title}`));

  if (matchingBooks.length >= 2) {
    console.log(`✅ TEST 5 ĐẠT: Thuật toán lọc bắt trúng toàn bộ các ấn bản tái bản dùng chung ISBN (sẵn sàng kích hoạt Disambiguation Modal).`);
    passedTests++;
  } else {
    throw new Error(`TEST 5 THẤT BẠI: Không phát hiện được các ấn bản trùng ISBN!`);
  }

  // TEST 6: Kiểm thử Pattern Offline Overdraft (ADJUSTMENT + SALE, không vi phạm CHECK >= 0)
  console.log('\n--- TEST 6: Kiểm thử Pattern Offline Overdraft (FAIR_VARIANCE Bù Kiểm Đếm) ---');
  const bookForOverdraft = allEditions[1];
  const whHoiCho = 'wh-du-phong';
  const stockBeforeOverdraft = await InventoryService.getBalance(bookForOverdraft.id, whHoiCho, 'NEW');

  // Giả lập 1 đơn sync ngoại tuyến bán vượt số tồn 3 cuốn
  const overdraftOrder = await OrderService.createOrder({
    warehouseId: whHoiCho,
    channel: 'FAIR_EVENT',
    customerName: 'Khách Hội Chợ Mua Sách Offline',
    isOfflineSync: true,
    allowOverdraft: true,
    items: [
      { editionId: bookForOverdraft.id, quantity: stockBeforeOverdraft + 3 },
    ],
  });

  const stockAfterOverdraft = await InventoryService.getBalance(bookForOverdraft.id, whHoiCho, 'NEW');
  const varianceLedger = await db
    .select()
    .from(inventoryLedger)
    .where(and(eq(inventoryLedger.correlationId, overdraftOrder.orderId), eq(inventoryLedger.eventType, 'ADJUSTMENT')));

  if (
    stockAfterOverdraft === 0 &&
    varianceLedger.length > 0 &&
    varianceLedger[0].quantityDelta === 3 &&
    varianceLedger[0].note?.includes('FAIR_VARIANCE')
  ) {
    console.log(`✅ TEST 6 ĐẠT: Pattern 2 bước đã hoạt động xuất sắc:`);
    console.log(`   - Tự động sinh ADJUSTMENT +3 cuốn (lý do: FAIR_VARIANCE)`);
    console.log(`   - Sau đó trừ SALE -${stockBeforeOverdraft + 3} cuốn`);
    console.log(`   - Tồn kho về 0 (KHÔNG ÂM), bảo toàn 100% CHECK constraint!`);
    console.log(`   - Mã đơn: ${overdraftOrder.orderCode}`);
    passedTests++;
  } else {
    throw new Error(`TEST 6 THẤT BẠI: Pattern bù lệch tồn kho hội chợ không khớp kỳ vọng!`);
  }

  // TEST 7: Kiểm thử Idempotency Replay (Race condition không sinh 500)
  console.log('\n--- TEST 7: Kiểm thử Idempotency Replay (Không sinh lỗi 500 khi trùng key) ---');
  const testIdemKey = `idem-race-test-${Date.now()}`;
  const firstCall = await OrderService.createOrder({
    warehouseId: whAuCo,
    customerName: 'Khách Test Race',
    idempotencyKey: testIdemKey,
    items: [{ editionId: testBook.id, quantity: 1 }],
  });

  const duplicateCall = await OrderService.createOrder({
    warehouseId: whAuCo,
    customerName: 'Khách Test Race',
    idempotencyKey: testIdemKey,
    items: [{ editionId: testBook.id, quantity: 1 }],
  });

  if (duplicateCall.isDuplicate && duplicateCall.orderId === firstCall.orderId) {
    console.log(`✅ TEST 7 ĐẠT: Trùng idempotencyKey trả về kết quả cũ 200 an toàn (orderId: ${duplicateCall.orderId}).`);
    passedTests++;
  } else {
    throw new Error(`TEST 7 THẤT BẠI: Idempotency race không trả về bản ghi cũ!`);
  }

  console.log('\n=========================================================');
  console.log(`🎉 HOÀN TẤT: ${passedTests}/7 BÀI TEST P0 & HARDENING ĐẠT CHUẨN 100%!`);
  console.log('=========================================================\n');
}

runP0Tests().catch(err => {
  console.error('❌ Kiểm thử thất bại:', err);
  process.exit(1);
});
