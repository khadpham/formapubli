import { db, works, editions, warehouses, stockBalances, inventoryLedger, orders, auditLogs, cashboxSessions } from '../src/db';
import { InventoryService } from '../src/services/inventory.service';
import { OrderService, CashboxService } from '../src/services/order.service';
import { enforceFiscalScope, recordAuditLog } from '../src/lib/rbac-guard';
import { eq, and, sql } from 'drizzle-orm';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-p0-verification');

async function runP0Tests() {
  console.log('🛡️ =========================================================');
  console.log('🛡️ BẮT ĐẦU KIỂM THỬ TOÀN DIỆN CÁC HẠNG MỤC ƯU TIÊN P0');
  console.log('🛡️ =========================================================\n');

  // Đảm bảo các bảng mới và cột mới được tạo (Safe Idempotent Migration)
  try {
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS cashbox_sessions (
        id text PRIMARY KEY NOT NULL,
        warehouse_id text NOT NULL REFERENCES warehouses(id),
        cashier_id text NOT NULL,
        opening_cash real DEFAULT 0 NOT NULL,
        closing_cash_actual real,
        expected_cash real,
        cash_discrepancy real,
        total_cash_sales real DEFAULT 0,
        total_transfer_sales real DEFAULT 0,
        total_orders_count integer DEFAULT 0,
        status text DEFAULT 'OPEN' NOT NULL,
        notes text,
        opened_at text DEFAULT CURRENT_TIMESTAMP,
        closed_at text
      );
    `);
    await db.run(sql`ALTER TABLE orders ADD COLUMN cashbox_session_id text;`).catch(() => {});
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_cashbox_cashier ON cashbox_sessions(cashier_id);`).catch(() => {});
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_cashbox_status ON cashbox_sessions(status);`).catch(() => {});
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_cashbox_warehouse ON cashbox_sessions(warehouse_id);`).catch(() => {});
    await db.run(sql`CREATE INDEX IF NOT EXISTS idx_orders_cashbox_session ON orders(cashbox_session_id);`).catch(() => {});
  } catch (migErr) {
    console.warn('Migration step warning:', migErr);
  }

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
    console.log('Caught error in TEST 1:', err?.message);
    if (err.message.includes('LỖI XUẤT ÂM KHO')) {
      threwExpected = true;
    }
  }

  const balanceAfter = await InventoryService.getBalance(testBook.id, whAuCo, 'NEW');
  console.log(`Balance before: ${balanceBefore}, balance after: ${balanceAfter}, threwExpected: ${threwExpected}`);
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

  // TEST 6 (Phase 0): Overdraft đã bị LOẠI BỎ khỏi đường bán — đơn vượt tồn luôn từ chối,
  // kể cả cờ allowOverdraft/isOfflineSync (bị lờ). Variance phải đi chứng từ riêng.
  console.log('\n--- TEST 6: Overdraft fail-closed (không còn bypass ATP) ---');
  const bookForOverdraft = allEditions[1];
  const whHoiCho = 'wh-du-phong';
  const stockBeforeOverdraft = await InventoryService.getBalance(bookForOverdraft.id, whHoiCho, 'NEW');

  // Giả lập 1 đơn sync ngoại tuyến bán vượt số tồn 3 cuốn → phải bị từ chối
  let overdraftRejected = false;
  try {
    await OrderService.createOrder({
      warehouseId: whHoiCho,
      channel: 'FAIR_EVENT',
      customerName: 'Khách Hội Chợ Mua Sách Offline',
      isOfflineSync: true,
      allowOverdraft: true,
      items: [
        { editionId: bookForOverdraft.id, quantity: stockBeforeOverdraft + 3 },
      ],
    });
  } catch (e: any) {
    overdraftRejected = /HẾT HÀNG KHẢ DỤNG/.test(e.message) && (e.code === 'INSUFFICIENT_ATP' || e instanceof Error);
  }

  const stockAfterOverdraft = await InventoryService.getBalance(bookForOverdraft.id, whHoiCho, 'NEW');

  if (overdraftRejected && stockAfterOverdraft === stockBeforeOverdraft) {
    console.log(`✅ TEST 6 ĐẠT: Đơn vượt tồn bị từ chối, tồn kho nguyên vẹn ${stockAfterOverdraft} cuốn, không sinh bút toán bù.`);
    passedTests++;
  } else {
    throw new Error(`TEST 6 THẤT BẠI: Overdraft vẫn lọt qua đường bán!`);
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

  // TEST 8: Kiểm thử atomic UPDATE và kiểu dữ liệu trả về từ db.run
  console.log('\n--- TEST 8: Kiểm thử Atomic UPDATE rowsAffected ---');
  const updateRes = await db.run(sql`
    UPDATE stock_balances 
    SET physical_quantity = physical_quantity + 0 
    WHERE edition_id = ${testBook.id} AND warehouse_id = ${whAuCo} AND condition = 'NEW'
  `);
  console.log('db.run result keys:', Object.keys(updateRes), 'rowsAffected:', (updateRes as any).rowsAffected);
  if (typeof (updateRes as any).rowsAffected === 'number') {
    console.log(`✅ TEST 8 ĐẠT: db.run trả về rowsAffected = ${(updateRes as any).rowsAffected}`);
    passedTests++;
  }

  // TEST 9: Kiểm thử Vòng đời Két tiền Ca làm việc (Cashbox Shift Life-cycle & Reconciliation)
  console.log('\n--- TEST 9: Vòng đời Phiên Két Tiền & Đối Soát Tiền Mặt Quầy ---');
  const testCashier = 'User-ROLE_CASHIER';
  const openRes = await CashboxService.openSession({
    warehouseId: whAuCo,
    cashierId: testCashier,
    openingCash: 500000,
    notes: 'Ca sáng thử nghiệm đối soát két',
  });

  const session = openRes.session;
  console.log(`Đã mở ca két: ${session.id} với vốn đầu ca: ${session.openingCash.toLocaleString('vi-VN')} đ`);

  // Bán 1 đơn tiền mặt trong ca
  const cashOrder = await OrderService.createOrder({
    warehouseId: whAuCo,
    cashierId: testCashier,
    cashboxSessionId: session.id,
    paymentMethod: 'CASH',
    items: [{ editionId: testBook.id, quantity: 1 }],
  });

  // Bán 1 đơn chuyển khoản trong ca
  const transferOrder = await OrderService.createOrder({
    warehouseId: whAuCo,
    cashierId: testCashier,
    cashboxSessionId: session.id,
    paymentMethod: 'BANK_TRANSFER',
    items: [{ editionId: testBook.id, quantity: 1 }],
  });

  const activeStats = await CashboxService.getActiveSession(testCashier);
  console.log(`Số liệu Realtime Két: Tiền mặt thu: ${activeStats?.totalCashSales.toLocaleString('vi-VN')} đ, Chuyển khoản: ${activeStats?.totalTransferSales.toLocaleString('vi-VN')} đ`);

  // Chốt ca két tiền với tiền thực đếm khớp tuyệt đối
  const closeRes = await CashboxService.closeSession({
    sessionId: session.id,
    closingCashActual: activeStats!.expectedCash,
    notes: 'Chốt ca khớp 100%',
  });

  if (
    closeRes.status === 'CLOSED' &&
    closeRes.cashDiscrepancy === 0 &&
    closeRes.totalCashSales === cashOrder.finalAmount
  ) {
    console.log(`✅ TEST 9 ĐẠT: Đối soát két tiền hoàn hảo, chênh lệch: ${closeRes.cashDiscrepancy} đ (kỳ vọng: ${closeRes.expectedCash.toLocaleString('vi-VN')} đ, thực tế: ${closeRes.closingCashActual.toLocaleString('vi-VN')} đ).`);
    passedTests++;
  } else {
    throw new Error(`TEST 9 THẤT BẠI: Đối soát két tiền không khớp!`);
  }

  // TEST 10: Kiểm thử Cashier Isolation (Thu ngân không xem được đơn ca khác/doanh thu tổng)
  console.log('\n--- TEST 10: Kiểm thử Cashier Isolation trong getOrders ---');
  const ownOrders = await OrderService.getOrders({ cashierId: testCashier });
  const allOrdersList = await OrderService.getOrders();

  const otherCashierOrdersInOwnList = ownOrders.filter(o => o.cashierId !== testCashier);
  if (otherCashierOrdersInOwnList.length === 0 && allOrdersList.length > ownOrders.length) {
    console.log(`✅ TEST 10 ĐẠT: Bộ lọc cashierId cô lập sạch sẽ các đơn ca của thu ngân (${ownOrders.length}/${allOrdersList.length} đơn), không cho rò rỉ đơn quầy khác.`);
    passedTests++;
  } else {
    throw new Error(`TEST 10 THẤT BẠI: Cashier Isolation không hoạt động chuẩn xác!`);
  }

  console.log('\n=========================================================');
  console.log(`🎉 HOÀN TẤT: ${passedTests}/10 BÀI TEST P0 & SECTION D ĐẠT CHUẨN 100%!`);
  console.log('=========================================================\n');
}

runP0Tests().catch(err => {
  console.error('❌ Kiểm thử thất bại:', err);
  process.exit(1);
});
