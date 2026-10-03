import assert from 'node:assert';
import { db, editions, products, warehouses, stockBalances, inventoryLedger, orders, orderItems, cashboxSessions, auditLogs } from '../src/db';
import { InventoryService } from '../src/services/inventory.service';
import { OrderService } from '../src/services/order.service';
import { eq, and, desc } from 'drizzle-orm';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-void-completed-order');

async function runTests() {
  console.log('🧪 BẮT ĐẦU KIỂM THỬ NGHIỆP VỤ HỦY ĐƠN HOÀN TẤT (VOID COMPLETED ORDER TEST)\n');

  // Lấy ấn bản và hàng hóa mẫu
  const allEditions = await db.select().from(editions).limit(2);
  assert.ok(allEditions.length > 0, 'Cần có ít nhất 1 ấn bản trong DB test');
  const book = allEditions[0];

  // Tìm hoặc tạo sản phẩm quà tặng trong bảng products
  const giftProducts = await db.select().from(products).where(eq(products.isGiftItem, true)).limit(1);
  let giftProductId = giftProducts[0]?.id;
  if (!giftProductId) {
    giftProductId = 'pr-gift-bookmark-test';
    await db.insert(products).values({
      id: giftProductId,
      code: 'SP-GIFT-BM01',
      name: 'Bookmark Sơn Mài Tri Ân',
      productKind: 'GOODS',
      sellingPrice: 0,
      isGiftItem: true,
      isActive: true,
    }).onConflictDoNothing();
  }

  const warehouseId = 'wh-du-phong';
  const cashierId = 'staff-test-cashier';
  const managerId = 'staff-test-manager';
  const ownerId = 'staff-test-owner';

  // 1. Nhập tồn kho ban đầu
  console.log('--- 1. Thiết lập tồn kho ban đầu ---');
  await InventoryService.recordMovement({
    editionId: book.id,
    warehouseId,
    eventType: 'RECEIPT',
    quantityDelta: 100,
    condition: 'NEW',
    documentRef: 'TEST-INIT-BOOK',
    note: 'Nhập sách kiểm thử',
    actorId: 'test-runner',
    idempotencyKey: `init-book-${Date.now()}`,
  });

  await InventoryService.recordMovement({
    editionId: giftProductId,
    isBook: false,
    warehouseId,
    eventType: 'RECEIPT',
    quantityDelta: 50,
    condition: 'NEW',
    documentRef: 'TEST-INIT-GIFT',
    note: 'Nhập quà tặng kiểm thử',
    actorId: 'test-runner',
    idempotencyKey: `init-gift-${Date.now()}`,
  });

  const getStock = async (prodId: string) => {
    const row = await db.select().from(stockBalances).where(
      and(
        eq(stockBalances.productId, prodId),
        eq(stockBalances.warehouseId, warehouseId),
        eq(stockBalances.condition, 'NEW')
      )
    ).limit(1);
    return row[0]?.physicalQuantity ?? 0;
  };

  const initialBookStock = await getStock(book.id);
  const initialGiftStock = await getStock(giftProductId);
  console.log(`Tồn ban đầu: Sách = ${initialBookStock}, Quà = ${initialGiftStock}`);

  // 2. Mở ca két thu ngân
  console.log('--- 2. Mở ca két kiểm thử 1 ---');
  const shift1Id = `cbs-void-shift-1-${Date.now()}`;
  await db.insert(cashboxSessions).values({
    id: shift1Id,
    warehouseId,
    cashierId,
    openingCash: 500000,
    status: 'OPEN',
  });

  // 3. Tạo đơn hàng COMPLETED có 2 cuốn sách + 1 quà tặng bình thường + 1 quà hết tồn (shortfall)
  console.log('--- 3. Tạo đơn COMPLETED ---');
  const orderRes = await OrderService.createOrder({
    warehouseId,
    cashierId,
    cashboxSessionId: shift1Id,
    channel: 'FAIR_EVENT',
    paymentMethod: 'CASH',
    confirmImmediately: true,
    items: [
      { editionId: book.id, quantity: 2, unitCoverPrice: 100000, unitDiscountRate: 0.1 },
    ],
  });

  const orderId = orderRes.orderId;
  const orderCode = orderRes.orderCode;
  console.log(`Đã tạo đơn: ${orderCode} (ID: ${orderId})`);

  // Bổ sung quà tặng vào orderItems
  await db.insert(orderItems).values([
    {
      id: `oi-gift-norm-${Date.now()}`,
      orderId,
      productId: giftProductId,
      quantity: 1,
      unitCoverPrice: 0,
      unitSellingPrice: 0,
      totalAmount: 0,
      isGiftLine: true,
      isGiftShortfall: false,
    },
    {
      id: `oi-gift-short-${Date.now()}`,
      orderId,
      productId: giftProductId,
      quantity: 1,
      unitCoverPrice: 0,
      unitSellingPrice: 0,
      totalAmount: 0,
      isGiftLine: true,
      isGiftShortfall: true, // quà ảo không trừ kho
    },
  ]);

  // Trừ kho quà bình thường
  await InventoryService.recordMovement({
    editionId: giftProductId,
    isBook: false,
    warehouseId,
    eventType: 'DISPATCH_GIFT',
    quantityDelta: -1,
    condition: 'NEW',
    documentRef: orderCode,
    note: 'Xuất quà tặng theo đơn',
    actorId: cashierId,
    idempotencyKey: `gift-out-${orderId}`,
  });

  const stockAfterOrderBook = await getStock(book.id);
  const stockAfterOrderGift = await getStock(giftProductId);
  assert.strictEqual(stockAfterOrderBook, initialBookStock - 2, 'Tồn sách phải giảm 2 cuốn');
  assert.strictEqual(stockAfterOrderGift, initialGiftStock - 1, 'Tồn quà phải giảm 1 cái');

  // 4. Test Case: Thu ngân không được quyền hủy
  console.log('--- 4. Kiểm tra phân quyền: Thu ngân không được hủy đơn COMPLETED ---');
  let cashierBlocked = false;
  try {
    await OrderService.voidCompletedOrder({
      orderId,
      actorRole: 'ROLE_CASHIER',
      actorId: cashierId,
      reason: 'Thu ngân bấm nhầm',
    });
  } catch (err: any) {
    cashierBlocked = true;
    console.log(`✓ Thu ngân bị chặn chuẩn xác: ${err.message}`);
  }
  assert.ok(cashierBlocked, 'Lỗi: Thu ngân phải bị chặn khi hủy đơn hoàn tất');

  // 5. Test Case: Quản lý hủy đơn trong ca OPEN thành công
  console.log('--- 5. Quản lý hủy đơn thành công trong ca OPEN ---');
  const voidRes = await OrderService.voidCompletedOrder({
    orderId,
    actorRole: 'ROLE_MANAGER',
    actorId: managerId,
    reason: 'Khách muốn đổi sang chuyển khoản VietQR',
  });

  assert.strictEqual(voidRes.status, 'CANCELLED');
  assert.strictEqual(voidRes.orderId, orderId);

  // Kiểm tra trạng thái đơn trong DB
  const ordAfterVoid = (await db.select().from(orders).where(eq(orders.id, orderId)))[0];
  assert.strictEqual(ordAfterVoid.status, 'CANCELLED', 'Trạng thái đơn phải là CANCELLED');
  assert.ok(ordAfterVoid.note?.includes('[HỦY ĐƠN: Khách muốn đổi sang chuyển khoản VietQR]'), 'Note phải chứa lý do hủy');

  // Kiểm tra hoàn tồn kho
  const stockAfterVoidBook = await getStock(book.id);
  const stockAfterVoidGift = await getStock(giftProductId);
  assert.strictEqual(stockAfterVoidBook, initialBookStock, 'Tồn sách phải được hoàn trả đủ về mức ban đầu');
  assert.strictEqual(stockAfterVoidGift, initialGiftStock, 'Tồn quà bình thường phải được hoàn trả đủ về mức ban đầu');

  // Kiểm tra bút toán thẻ kho RETURN_INBOUND
  const ledgerEntries = await db.select().from(inventoryLedger).where(
    and(
      eq(inventoryLedger.correlationId, orderId),
      eq(inventoryLedger.eventType, 'RETURN_INBOUND')
    )
  );
  assert.strictEqual(ledgerEntries.length, 2, 'Phải có đúng 2 bút toán RETURN_INBOUND (1 cho sách + 1 cho quà bình thường)');
  for (const entry of ledgerEntries) {
    assert.ok(entry.quantityDelta > 0, 'quantityDelta trong RETURN_INBOUND phải là số dương');
  }

  // Kiểm tra nhật ký kiểm toán (audit_logs)
  const auditEntry = (await db.select().from(auditLogs).where(
    and(
      eq(auditLogs.action, 'ORDER_VOIDED'),
      eq(auditLogs.actorId, managerId)
    )
  ))[0];
  assert.ok(auditEntry, 'Phải có bản ghi audit log với action ORDER_VOIDED');

  // Kiểm tra tính lũy biến (idempotency)
  const reVoidRes = await OrderService.voidCompletedOrder({
    orderId,
    actorRole: 'ROLE_MANAGER',
    actorId: managerId,
    reason: 'Thử lại cùng thao tác',
  });
  assert.strictEqual(reVoidRes.isIdempotent, true, 'Lần gọi thứ hai phải trả về idempotent: true');

  // 6. Test Case: Chốt chặn ca két đã đóng
  console.log('--- 6. Kiểm tra chốt chặn ca két đã đóng ---');
  const shift2Id = `cbs-void-shift-2-${Date.now()}`;
  await db.insert(cashboxSessions).values({
    id: shift2Id,
    warehouseId,
    cashierId,
    openingCash: 200000,
    status: 'OPEN',
  });

  const order2Res = await OrderService.createOrder({
    warehouseId,
    cashierId,
    cashboxSessionId: shift2Id,
    channel: 'FAIR_EVENT',
    paymentMethod: 'CASH',
    confirmImmediately: true,
    items: [
      { editionId: book.id, quantity: 1, unitCoverPrice: 100000 },
    ],
  });

  // Giờ đóng ca két
  await db.update(cashboxSessions).set({
    status: 'CLOSED',
    closingCashActual: 300000,
  }).where(eq(cashboxSessions.id, shift2Id));

  // Quản lý cố hủy đơn ca đóng -> Bị từ chối
  let managerClosedBlocked = false;
  try {
    await OrderService.voidCompletedOrder({
      orderId: order2Res.orderId,
      actorRole: 'ROLE_MANAGER',
      actorId: managerId,
      reason: 'Hủy đơn ca đã đóng',
    });
  } catch (err: any) {
    managerClosedBlocked = true;
    console.log(`✓ Quản lý bị chặn khi hủy đơn ca đóng: ${err.message}`);
  }
  assert.ok(managerClosedBlocked, 'Quản lý không được hủy đơn thuộc ca đã đóng');

  // Chủ cố hủy không có forceCloseBypass -> Bị từ chối
  let ownerNoForceBlocked = false;
  try {
    await OrderService.voidCompletedOrder({
      orderId: order2Res.orderId,
      actorRole: 'ROLE_OWNER',
      actorId: ownerId,
      reason: 'Chủ hủy nhưng chưa tick cờ xác nhận lệch biên bản',
      forceCloseBypass: false,
    });
  } catch (err: any) {
    ownerNoForceBlocked = true;
    console.log(`✓ Chủ chưa bật cờ cưỡng chế bị chặn: ${err.message}`);
  }
  assert.ok(ownerNoForceBlocked, 'Chủ phải bật forceCloseBypass khi hủy ca đóng');

  // Chủ bật forceCloseBypass -> Thành công
  const ownerForceRes = await OrderService.voidCompletedOrder({
    orderId: order2Res.orderId,
    actorRole: 'ROLE_OWNER',
    actorId: ownerId,
    reason: 'Chủ duyệt cưỡng chế do đối soát biên bản phát hiện quét thừa',
    forceCloseBypass: true,
  });
  assert.strictEqual(ownerForceRes.status, 'CANCELLED', 'Chủ hủy cưỡng chế ca đóng thành công');

  console.log('\n🎉 TOÀN BỘ TEST CASES NGHIỆP VỤ HỦY ĐƠN HOÀN TẤT ĐẠT 100%!');
}

runTests().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
