import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_s3_approval.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

async function run() {
  console.log('--- TEST S3: DISCOUNT APPROVAL SERVICE (State Machine & Canonical Hash) ---');

  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-s3-discount-approval');

  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const { eq } = await import('drizzle-orm');
  const schema = await import('../src/db/schema');
  const {
    DiscountApprovalService,
    generateCanonicalCartHash,
  } = await import('../src/services/discount-approval.service');
  const { OrderService, CashboxService } = await import('../src/services/order.service');
  const { POST: approvalPost, GET: approvalGet } = await import('../src/app/api/pos/discount-approvals/[id]/route');
  const { signSession, SESSION_COOKIE_NAME } = await import('../src/lib/auth-session');

  const rawClient = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(rawClient);

  // Seed basic warehouses and staff
  await db.insert(schema.warehouses).values([
    { id: 'wh-au-co', code: 'KHO_AU_CO', name: 'Kho Âu Cơ', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
    { id: 'wh-quynh-mai', code: 'KHO_QUYNH_MAI', name: 'Kho Quỳnh Mai', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
  ]);
  await db.insert(schema.works).values({
    id: 'work-approval-test',
    code: 'WORK-APPROVAL-TEST',
    title: 'Tác phẩm kiểm thử duyệt chiết khấu',
    author: 'Test',
  });
  await db.insert(schema.editions).values([
    {
      id: 'ed-h01',
      code: 'H01',
      workId: 'work-approval-test',
      title: 'Sách H01',
      isbn: '9786040000001',
      isbnLast4: '0001',
      coverPrice: 150000,
    },
    {
      id: 'ed-h21',
      code: 'H21',
      workId: 'work-approval-test',
      title: 'Sách H21',
      isbn: '9786040000021',
      isbnLast4: '0021',
      coverPrice: 200000,
    },
    {
      id: 'ed-round',
      code: 'ROUND',
      workId: 'work-approval-test',
      title: 'Sách làm tròn',
      isbn: '9786040099',
      isbnLast4: '0099',
      coverPrice: 101,
    },
  ]);
  await db.insert(schema.stockBalances).values([
    {
      id: 'sb-ed-h01-wh-au-co-NEW',
      editionId: 'ed-h01',
      warehouseId: 'wh-au-co',
      condition: 'NEW',
      physicalQuantity: 10,
    },
    {
      id: 'sb-ed-h21-wh-au-co-NEW',
      editionId: 'ed-h21',
      warehouseId: 'wh-au-co',
      condition: 'NEW',
      physicalQuantity: 10,
    },
    {
      id: 'sb-ed-round-wh-au-co-NEW',
      editionId: 'ed-round',
      warehouseId: 'wh-au-co',
      condition: 'NEW',
      physicalQuantity: 10,
    },
  ]);

  const MGR = { staffId: 'staff-la', role: 'ROLE_MANAGER' as const, fullName: 'Lan Anh (Manager)' };
  const CASHIER = { staffId: 'staff-tn', role: 'ROLE_CASHIER' as const, fullName: 'Thu Ngân 1' };

  // Test 1: Canonical Hash Determinism & Order Independence
  console.log('\n[Case 1] Canonical Cart Hash');
  const itemsA = [
    { editionId: 'ed-h01', quantity: 2, unitPrice: 150000 },
    { editionId: 'ed-h21', quantity: 1, unitPrice: 200000 },
  ];
  const itemsB = [
    { editionId: 'ed-h21', quantity: 1, unitPrice: 200000 },
    { editionId: 'ed-h01', quantity: 2, unitPrice: 150000 },
  ];
  const hashA = generateCanonicalCartHash(itemsA, 0.25, 'wh-au-co', 'ORD-2026-4821');
  const hashB = generateCanonicalCartHash(itemsB, 0.25, 'wh-au-co', 'ORD-2026-4821');
  assert.equal(hashA, hashB, 'Hash phải bất biến thứ tự items');

  const hashDiffRate = generateCanonicalCartHash(itemsA, 0.30, 'wh-au-co', 'ORD-2026-4821');
  assert.notEqual(hashA, hashDiffRate, 'Khác discount rate phải sinh hash khác');

  const hashDiffWh = generateCanonicalCartHash(itemsA, 0.25, 'wh-quynh-mai', 'ORD-2026-4821');
  assert.notEqual(hashA, hashDiffWh, 'Khác warehouseId phải sinh hash khác');

  const hashDiffQty = generateCanonicalCartHash(
    [{ editionId: 'ed-h01', quantity: 3, unitPrice: 150000 }, { editionId: 'ed-h21', quantity: 1, unitPrice: 200000 }],
    0.25, 'wh-au-co', 'ORD-2026-4821'
  );
  assert.notEqual(hashA, hashDiffQty, 'Khác quantity phải sinh hash khác');
  console.log('✓ Hash giỏ hàng chuẩn hóa SHA-256 hoàn toàn chính xác');

  // Test 2: Create Request & TTL
  console.log('\n[Case 2] Create Approval Request');
  const orderCode1 = 'ORD-2026-4821';
  const req1 = await DiscountApprovalService.createRequest({
    orderCode: orderCode1,
    warehouseId: 'wh-au-co',
    cashierId: CASHIER.staffId,
    items: itemsA,
    requestedDiscountRate: 0.25,
    actorContext: CASHIER,
  });

  assert.equal(req1.status, 'PENDING');
  assert.equal(req1.originalAmount, 500000);
  assert.equal(req1.discountAmount, 125000);
  assert.equal(req1.finalAmount, 375000);
  assert.equal(req1.shortCode, '4821');
  assert.ok(req1.qrToken, 'Phải có signed qrToken');

  const roundingRequest = await DiscountApprovalService.createRequest({
    orderCode: 'ORD-2026-4822',
    warehouseId: 'wh-au-co',
    cashierId: CASHIER.staffId,
    items: [{ editionId: 'ed-round', quantity: 2, unitPrice: 101 }],
    requestedDiscountRate: 0.25,
    actorContext: CASHIER,
  });
  assert.equal(roundingRequest.originalAmount, 202);
  assert.equal(roundingRequest.discountAmount, 50);
  assert.equal(roundingRequest.finalAmount, 152);
  console.log('✓ Số tiền approval dùng cùng quy tắc làm tròn từng đơn vị');

  const expiresDiffMs = new Date(req1.expiresAt).getTime() - Date.now();
  assert.ok(expiresDiffMs > 4 * 60 * 1000 && expiresDiffMs <= 5 * 60 * 1000 + 2000, 'TTL phải xấp xỉ 5 phút');
  console.log('✓ Tạo yêu cầu duyệt chiết khấu PENDING thành công');

  // Test 3: Modify Cart -> Supersede previous request
  console.log('\n[Case 3] Sửa giỏ hàng -> Vô hiệu hóa đơn cũ (SUPERSEDED)');
  const modifiedItems = [
    { editionId: 'ed-h01', quantity: 3, unitPrice: 150000 }, // Sửa từ 2 thành 3 cuốn
    { editionId: 'ed-h21', quantity: 1, unitPrice: 200000 },
  ];
  const req2 = await DiscountApprovalService.createRequest({
    orderCode: orderCode1,
    warehouseId: 'wh-au-co',
    cashierId: CASHIER.staffId,
    items: modifiedItems,
    requestedDiscountRate: 0.25,
    actorContext: CASHIER,
  });

  assert.notEqual(req2.id, req1.id, 'Phải tạo request mới khi giỏ hàng đổi');
  assert.equal(req2.status, 'PENDING');

  const oldReq = await DiscountApprovalService.getRequest(req1.id);
  assert.equal(oldReq.status, 'SUPERSEDED', 'Yêu cầu cũ phải bị chuyển sang SUPERSEDED');
  console.log('✓ Sửa giỏ hàng tự động chuyển yêu cầu cũ thành SUPERSEDED');

  // Test 4: Approval by ShortCode
  console.log('\n[Case 4] Duyệt bằng ShortCode 4 số');
  // Cashier tries to approve -> FORBIDDEN
  let forbiddenCaught = false;
  try {
    await DiscountApprovalService.approveRequest({
      requestId: req2.id,
      method: 'SHORTCODE_BOUND',
      shortCode: '4821',
      actorContext: CASHIER,
    });
  } catch (err: any) {
    forbiddenCaught = true;
    assert.equal(err.code, 'FORBIDDEN');
  }
  assert.ok(forbiddenCaught, 'Thu ngân không thể tự duyệt');

  // Manager provides wrong shortCode
  let wrongShortCodeCaught = false;
  try {
    await DiscountApprovalService.approveRequest({
      requestId: req2.id,
      method: 'SHORTCODE_BOUND',
      shortCode: '9999',
      actorContext: MGR,
    });
  } catch (err: any) {
    wrongShortCodeCaught = true;
  }
  assert.ok(wrongShortCodeCaught, 'Sai ShortCode phải bị từ chối');

  // Manager provides correct shortCode
  const approvedReq2 = await DiscountApprovalService.approveRequest({
    requestId: req2.id,
    method: 'SHORTCODE_BOUND',
    shortCode: '4821',
    actorContext: MGR,
  });
  assert.equal(approvedReq2.status, 'APPROVED');
  assert.equal(approvedReq2.approvedBy, MGR.staffId);
  assert.equal(approvedReq2.approvalMethod, 'SHORTCODE_BOUND');
  assert.equal(approvedReq2.version, 2);
  console.log('✓ Quản lý duyệt ShortCode 4 số thành công (chuyển APPROVED)');

  // Test 5: Checkout Consumption & Cart Tamper Detection
  console.log('\n[Case 5] Tiêu thụ duyệt chiết khấu & Chống tráo giỏ');
  // Attempt to consume with different items than approved
  let tamperCaught = false;
  try {
    await DiscountApprovalService.consumeApproval({
      requestId: req2.id,
      currentItems: itemsA, // Tráo lại giỏ 2 cuốn thay vì 3 cuốn đã duyệt
      discountRate: 0.25,
      warehouseId: 'wh-au-co',
      orderCode: orderCode1,
    });
  } catch (err: any) {
    tamperCaught = true;
    assert.equal(err.code, 'STATE_CONFLICT');
  }
  assert.ok(tamperCaught, 'Tráo giỏ hàng sau duyệt phải bị chặn ngay');

  // Consume with exact approved items
  await DiscountApprovalService.consumeApproval({
    requestId: req2.id,
    currentItems: modifiedItems,
    discountRate: 0.25,
    warehouseId: 'wh-au-co',
    orderCode: orderCode1,
  });

  const consumedReq = await DiscountApprovalService.getRequest(req2.id);
  assert.equal(consumedReq.status, 'CONSUMED');
  console.log('✓ Tiêu thụ duyệt thành công, chuyển sang CONSUMED');

  // Test 6: Approval by QR JWT
  console.log('\n[Case 6] Duyệt bằng QR JWT');
  const orderCode3 = 'ORD-2026-1234';
  const req3 = await DiscountApprovalService.createRequest({
    orderCode: orderCode3,
    warehouseId: 'wh-au-co',
    cashierId: CASHIER.staffId,
    items: itemsA,
    requestedDiscountRate: 0.22,
    actorContext: CASHIER,
  });

  const approvedReq3 = await DiscountApprovalService.approveRequest({
    requestId: req3.id,
    method: 'QR_JWT',
    qrToken: req3.qrToken,
    actorContext: MGR,
  });
  assert.equal(approvedReq3.status, 'APPROVED');
  assert.equal(approvedReq3.approvalMethod, 'QR_JWT');
  console.log('✓ Quản lý quét QR JWT duyệt thành công');

  // Test 7: Offline Emergency Code with 25% Ceiling
  console.log('\n[Case 7] Mã khẩn cấp Offline với trần 25%');
  const orderCode4 = 'ORD-2026-5555';
  const req4 = await DiscountApprovalService.createRequest({
    orderCode: orderCode4,
    warehouseId: 'wh-au-co',
    cashierId: CASHIER.staffId,
    items: itemsA,
    requestedDiscountRate: 0.30, // 30% exceeds 25% ceiling
    actorContext: CASHIER,
  });

  let ceilingCaught = false;
  try {
    await DiscountApprovalService.approveRequest({
      requestId: req4.id,
      method: 'OFFLINE_EMERGENCY',
      emergencyCode: 'EMG-20260923-1',
      actorContext: MGR,
    });
  } catch (err: any) {
    ceilingCaught = true;
  }
  assert.ok(ceilingCaught, 'Mã khẩn cấp vượt 25% phải bị chặn');

  // Now test valid 25% with emergency code
  const orderCode5 = 'ORD-2026-5556';
  const req5 = await DiscountApprovalService.createRequest({
    orderCode: orderCode5,
    warehouseId: 'wh-au-co',
    cashierId: CASHIER.staffId,
    items: itemsA,
    requestedDiscountRate: 0.25,
    actorContext: CASHIER,
  });
  const approvedReq5 = await DiscountApprovalService.approveRequest({
    requestId: req5.id,
    method: 'OFFLINE_EMERGENCY',
    emergencyCode: 'EMG-20260923-1',
    actorContext: MGR,
  });
  assert.equal(approvedReq5.status, 'APPROVED');
  assert.equal(approvedReq5.approvalMethod, 'OFFLINE_EMERGENCY');
  console.log('✓ Mã khẩn cấp <= 25% duyệt thành công');

  // Test 8: Rejection
  console.log('\n[Case 8] Quản lý từ chối chiết khấu');
  const orderCode6 = 'ORD-2026-6666';
  const req6 = await DiscountApprovalService.createRequest({
    orderCode: orderCode6,
    warehouseId: 'wh-au-co',
    cashierId: CASHIER.staffId,
    items: itemsA,
    requestedDiscountRate: 0.35,
    actorContext: CASHIER,
  });
  const rejectedReq6 = await DiscountApprovalService.rejectRequest({
    requestId: req6.id,
    rejectedReason: 'Chiết khấu quá cao, sách mới phát hành',
    actorContext: MGR,
  });
  assert.equal(rejectedReq6.status, 'REJECTED');
  assert.equal(rejectedReq6.rejectedReason, 'Chiết khấu quá cao, sách mới phát hành');
  console.log('✓ Từ chối chiết khấu lưu đúng lý do');

  console.log('\n[Case 9] Checkout tiêu thụ approval trong cùng transaction');
  const orderCode7 = 'ORD-2026-7777';
  const req7 = await DiscountApprovalService.createRequest({
    orderCode: orderCode7,
    warehouseId: 'wh-au-co',
    cashierId: CASHIER.staffId,
    items: [{ editionId: 'ed-h01', quantity: 2, unitPrice: 150000 }],
    requestedDiscountRate: 0.25,
    actorContext: CASHIER,
  });
  await DiscountApprovalService.approveRequest({
    requestId: req7.id,
    method: 'ONE_TOUCH',
    actorContext: MGR,
  });
  const orderWithApproval = await OrderService.createOrder({
    id: 'order-approval-1',
    orderCode: orderCode7,
    idempotencyKey: 'idem-approval-1',
    warehouseId: 'wh-au-co',
    channel: 'RETAIL_OFFICE',
    discountRate: 0.25,
    paymentMethod: 'CASH',
    actorContext: CASHIER,
    discountApprovalId: req7.id,
    items: [{ editionId: 'ed-h01', quantity: 2 }],
  });
  assert.equal(orderWithApproval.orderCode, orderCode7);
  assert.equal((await DiscountApprovalService.getRequest(req7.id)).status, 'CONSUMED');
  const replayedOrder = await OrderService.createOrder({
    id: 'order-approval-replay-1',
    orderCode: orderCode7,
    idempotencyKey: 'idem-approval-1',
    warehouseId: 'wh-au-co',
    channel: 'RETAIL_OFFICE',
    discountRate: 0.25,
    paymentMethod: 'CASH',
    actorContext: CASHIER,
    discountApprovalId: req7.id,
    items: [{ editionId: 'ed-h01', quantity: 2 }],
  });
  assert.equal(replayedOrder.isDuplicate, true);
  let replayCodeConflict = false;
  try {
    await OrderService.createOrder({
      id: 'order-approval-replay-code-conflict',
      orderCode: 'ORD-2026-9999',
      idempotencyKey: 'idem-approval-1',
      warehouseId: 'wh-au-co',
      channel: 'RETAIL_OFFICE',
      discountRate: 0.25,
      paymentMethod: 'CASH',
      actorContext: CASHIER,
      discountApprovalId: req7.id,
      items: [{ editionId: 'ed-h01', quantity: 2 }],
    });
  } catch {
    replayCodeConflict = true;
  }
  assert.equal(replayCodeConflict, true);
  let consumedCancelRejected = false;
  try {
    await DiscountApprovalService.cancelRequest({ requestId: req7.id, actorContext: CASHIER });
  } catch {
    consumedCancelRejected = true;
  }
  assert.equal(consumedCancelRejected, true);
  console.log('✓ Retry idempotency trả lại order đã commit; không hủy approval đã tiêu thụ');

  const openedCashbox = await CashboxService.openSession({
    warehouseId: 'wh-au-co',
    cashierId: CASHIER.staffId,
    openingCash: 0,
  });
  const cashboxOrder = await OrderService.createOrder({
    id: 'order-cashbox-replay-1',
    orderCode: 'ORD-2026-7789',
    idempotencyKey: 'idem-cashbox-replay-1',
    warehouseId: 'wh-au-co',
    channel: 'RETAIL_OFFICE',
    paymentMethod: 'CASH',
    cashboxSessionId: openedCashbox.session.id,
    actorContext: CASHIER,
    items: [{ editionId: 'ed-h01', quantity: 1 }],
  });
  await CashboxService.closeSession({
    sessionId: openedCashbox.session.id,
    closingCashActual: 0,
  });
  const cashboxReplay = await OrderService.createOrder({
    id: 'order-cashbox-replay-2',
    orderCode: 'ORD-2026-7789',
    idempotencyKey: 'idem-cashbox-replay-1',
    warehouseId: 'wh-au-co',
    channel: 'RETAIL_OFFICE',
    paymentMethod: 'CASH',
    cashboxSessionId: openedCashbox.session.id,
    actorContext: CASHIER,
    items: [{ editionId: 'ed-h01', quantity: 1 }],
  });
  const cashboxCloseReplay = await CashboxService.closeSession({
    sessionId: openedCashbox.session.id,
    closingCashActual: 0,
  });
  assert.equal(cashboxCloseReplay.isIdempotent, true);
  await assert.rejects(
    () => CashboxService.closeSession({ sessionId: openedCashbox.session.id, closingCashActual: 1 }),
    (error: any) => error?.code === 'IDEMPOTENCY_CONFLICT'
  );
  assert.equal(cashboxReplay.isDuplicate, true);
  assert.equal(cashboxReplay.orderId, cashboxOrder.orderId);
  console.log('✓ Retry sau khi két đóng vẫn trả lại order đã commit theo idempotency');

  console.log('\n[Case 10] Giỏ bị đổi sau duyệt phải rollback toàn bộ order');
  const req8 = await DiscountApprovalService.createRequest({
    orderCode: 'ORD-2026-7778',
    warehouseId: 'wh-au-co',
    cashierId: CASHIER.staffId,
    items: [{ editionId: 'ed-h01', quantity: 2, unitPrice: 150000 }],
    requestedDiscountRate: 0.25,
    actorContext: CASHIER,
  });
  await DiscountApprovalService.approveRequest({
    requestId: req8.id,
    method: 'ONE_TOUCH',
    actorContext: MGR,
  });
  let tamperedOrderCaught = false;
  try {
    await OrderService.createOrder({
      id: 'order-approval-tampered',
      orderCode: 'ORD-2026-7778',
      idempotencyKey: 'idem-approval-tampered',
      warehouseId: 'wh-au-co',
      channel: 'RETAIL_OFFICE',
      discountRate: 0.25,
      paymentMethod: 'CASH',
      actorContext: CASHIER,
      discountApprovalId: req8.id,
      items: [{ editionId: 'ed-h01', quantity: 3 }],
    });
  } catch {
    tamperedOrderCaught = true;
  }
  assert.ok(tamperedOrderCaught, 'Giỏ đổi sau duyệt phải bị chặn');
  assert.equal((await db.select().from(schema.orders).where(eq(schema.orders.id, 'order-approval-tampered'))).length, 0);
  assert.equal((await DiscountApprovalService.getRequest(req8.id)).status, 'APPROVED');
  console.log('✓ Approval không bị tiêu thụ và order không được tạo khi hash sai');

  console.log('\n[Case 11] Giỏ đổi mức giảm từng dòng sau duyệt phải bị chặn');
  const req10 = await DiscountApprovalService.createRequest({
    orderCode: 'ORD-2026-7780',
    warehouseId: 'wh-au-co',
    cashierId: CASHIER.staffId,
    items: [{ editionId: 'ed-h01', quantity: 2, unitPrice: 150000 }],
    requestedDiscountRate: 0.25,
    actorContext: CASHIER,
  });
  await DiscountApprovalService.approveRequest({
    requestId: req10.id,
    method: 'ONE_TOUCH',
    actorContext: MGR,
  });
  const cashierToken = await signSession({
    role: CASHIER.role,
    actorId: CASHIER.staffId,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 3600000,
  });
  const cashierApprovalResponse = await approvalPost(
    new Request(`http://localhost/api/pos/discount-approvals/${req10.id}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Cookie: `${SESSION_COOKIE_NAME}=${cashierToken}`,
      },
      body: JSON.stringify({ action: 'APPROVE', method: 'SHORTCODE_BOUND', shortCode: '7780' }),
    }) as any,
    { params: { id: req10.id } }
  );
  assert.equal(cashierApprovalResponse.status, 403, 'Cashier không được tự phê duyệt yêu cầu');
  const otherCashierRequest = await DiscountApprovalService.createRequest({
    orderCode: 'ORD-2026-7780',
    warehouseId: 'wh-au-co',
    cashierId: 'staff-tn-2',
    items: [{ editionId: 'ed-h01', quantity: 1, unitPrice: 150000 }],
    requestedDiscountRate: 0.25,
    actorContext: { ...CASHIER, staffId: 'staff-tn-2' },
  });
  assert.notEqual(otherCashierRequest.id, req10.id, 'Mã đơn giống nhau phải được scope theo cashier');
  const otherCashierResponse = await approvalGet(
    new Request(`http://localhost/api/pos/discount-approvals/${otherCashierRequest.id}`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${cashierToken}` },
    }) as any,
    { params: { id: otherCashierRequest.id } }
  );
  assert.equal(otherCashierResponse.status, 403, 'Cashier không được xem yêu cầu của cashier khác');
  console.log('✓ API chặn cashier tự gửi APPROVE và xem request của cashier khác');
  let lineDiscountCaught = false;
  try {
    await OrderService.createOrder({
      id: 'order-approval-line-tampered',
      orderCode: 'ORD-2026-7780',
      idempotencyKey: 'idem-approval-line-tampered',
      warehouseId: 'wh-au-co',
      channel: 'RETAIL_OFFICE',
      discountRate: 0.25,
      paymentMethod: 'CASH',
      actorContext: CASHIER,
      discountApprovalId: req10.id,
      items: [{ editionId: 'ed-h01', quantity: 2, unitDiscountRate: 1 }],
    });
  } catch {
    lineDiscountCaught = true;
  }
  assert.ok(lineDiscountCaught, 'Mức giảm từng dòng phải khớp mức đã duyệt');
  assert.equal((await db.select().from(schema.orders).where(eq(schema.orders.id, 'order-approval-line-tampered'))).length, 0);
  assert.equal((await DiscountApprovalService.getRequest(req10.id)).status, 'APPROVED');
  console.log('✓ Không thể tăng chiết khấu qua unitDiscountRate sau duyệt');

  console.log('\n[Case 12] Thu ngân tự hủy approval của mình');
  const req9 = await DiscountApprovalService.createRequest({
    orderCode: 'ORD-2026-7779',
    warehouseId: 'wh-au-co',
    cashierId: CASHIER.staffId,
    items: [{ editionId: 'ed-h01', quantity: 1, unitPrice: 150000 }],
    requestedDiscountRate: 0.25,
    actorContext: CASHIER,
  });
  const cancelledReq9 = await DiscountApprovalService.cancelRequest({
    requestId: req9.id,
    actorContext: CASHIER,
  });
  assert.equal(cancelledReq9.status, 'SUPERSEDED');
  console.log('✓ Thu ngân hủy được request của mình');

  console.log('\n[Case 13] Lazy Expiration sau 5 phút');
  const reqExpiry = await DiscountApprovalService.createRequest({
    orderCode: 'ORD-2026-7781',
    warehouseId: 'wh-au-co',
    cashierId: CASHIER.staffId,
    items: [{ editionId: 'ed-h01', quantity: 1, unitPrice: 150000 }],
    requestedDiscountRate: 0.25,
    actorContext: CASHIER,
  });
  await db
    .update(schema.discountApprovalRequests)
    .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
    .where(eq(schema.discountApprovalRequests.id, reqExpiry.id));

  let expiredCaught = false;
  try {
    await DiscountApprovalService.approveRequest({
      requestId: reqExpiry.id,
      method: 'ONE_TOUCH',
      actorContext: MGR,
    });
  } catch {
    expiredCaught = true;
  }
  assert.ok(expiredCaught, 'Yêu cầu quá hạn phải bị từ chối');
  assert.equal((await DiscountApprovalService.getRequest(reqExpiry.id)).status, 'EXPIRED');
  console.log('✓ Request PENDING quá hạn chuyển sang EXPIRED');

  console.log('\n[Case 14] Audit bắt buộc lỗi phải rollback đơn');
  let requiredAuditFailed = false;
  try {
    await OrderService.createOrder({
      id: 'order-required-audit-failure',
      orderCode: 'ORD-2026-7782',
      idempotencyKey: 'idem-required-audit-failure',
      warehouseId: 'wh-au-co',
      channel: 'RETAIL_OFFICE',
      paymentMethod: 'CASH',
      actorContext: CASHIER,
      items: [{ editionId: 'ed-round', quantity: 1 }],
      requiredAudit: [
        { id: 'aud-required-duplicate', action: 'MANAGER_DISCOUNT_APPROVED', actorRole: 'ROLE_MANAGER', actorId: 'staff-la', resource: '/api/orders', details: 'first' },
        { id: 'aud-required-duplicate', action: 'MANAGER_DISCOUNT_APPROVED', actorRole: 'ROLE_MANAGER', actorId: 'staff-la', resource: '/api/orders', details: 'second' },
      ],
    } as any);
  } catch {
    requiredAuditFailed = true;
  }
  assert.equal(requiredAuditFailed, true);
  assert.equal((await db.select().from(schema.orders).where(eq(schema.orders.id, 'order-required-audit-failure'))).length, 0);
  console.log('✓ Audit lỗi không để lại đơn đã commit');

  console.log('\n[Case 15] Phương thức duyệt lạ phải bị từ chối');
  const reqUnknownMethod = await DiscountApprovalService.createRequest({
    orderCode: 'ORD-2026-7783',
    warehouseId: 'wh-au-co',
    cashierId: CASHIER.staffId,
    items: [{ editionId: 'ed-h01', quantity: 1, unitPrice: 150000 }],
    requestedDiscountRate: 0.25,
    actorContext: CASHIER,
  });
  let unknownMethodCaught = false;
  try {
    await DiscountApprovalService.approveRequest({
      requestId: reqUnknownMethod.id,
      method: 'UNKNOWN' as any,
      actorContext: MGR,
    });
  } catch {
    unknownMethodCaught = true;
  }
  assert.equal(unknownMethodCaught, true);
  assert.equal((await DiscountApprovalService.getRequest(reqUnknownMethod.id)).status, 'PENDING');
  console.log('✓ Không duyệt request bằng method ngoài allowlist');

  rawClient.close();
  console.log('\n🎉 TOÀN BỘ TEST DISCOUNT APPROVAL SERVICE PASS 100%!');
}

run().catch((err) => {
  console.error('❌ Test thất bại:', err);
  process.exit(1);
});
