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

  const rawClient = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(rawClient);

  // Seed basic warehouses and staff
  await db.insert(schema.warehouses).values([
    { id: 'wh-au-co', code: 'KHO_AU_CO', name: 'Kho Âu Cơ', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
    { id: 'wh-quynh-mai', code: 'KHO_QUYNH_MAI', name: 'Kho Quỳnh Mai', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
  ]);

  // A1-H: createRequest chuẩn hóa giá bìa từ DB (bỏ qua unitPrice client) —
  // fixture phải có catalog thật khớp giá test (ed-h01 150000, ed-h21 200000).
  await db.insert(schema.works).values([
    { id: 'work-h01', code: 'W-H01', title: 'Sach H01', author: 'Tac gia H01' },
    { id: 'work-h21', code: 'W-H21', title: 'Sach H21', author: 'Tac gia H21' },
  ]);
  await db.insert(schema.editions).values([
    { id: 'ed-h01', code: 'H01', workId: 'work-h01', title: 'Sach H01', isbn: '9780000000001', isbnLast4: '0001', coverPrice: 150000, isActive: true },
    { id: 'ed-h21', code: 'H21', workId: 'work-h21', title: 'Sach H21', isbn: '9780000000002', isbnLast4: '0002', coverPrice: 200000, isActive: true },
  ]);

  const MGR = { staffId: 'staff-la', role: 'ROLE_MANAGER', fullName: 'Lan Anh (Manager)' };
  const CASHIER = { staffId: 'staff-tn', role: 'ROLE_CASHIER', fullName: 'Thu Ngân 1' };

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

  // Test 9: Lazy Expiration
  console.log('\n[Case 9] Lazy Expiration sau 5 phút');
  // Set expires_at in the past
  await db
    .update(schema.discountApprovalRequests)
    .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
    .where(eq(schema.discountApprovalRequests.id, req6.id));

  // Try to approve expired request
  let expiredCaught = false;
  try {
    await DiscountApprovalService.approveRequest({
      requestId: req6.id,
      method: 'ONE_TOUCH',
      actorContext: MGR,
    });
  } catch (err: any) {
    expiredCaught = true;
  }
  assert.ok(expiredCaught, 'Yêu cầu quá hạn phải bị từ chối');

  rawClient.close();
  console.log('\n🎉 TOÀN BỘ TEST DISCOUNT APPROVAL SERVICE PASS 100%!');
}

run().catch((err) => {
  console.error('❌ Test thất bại:', err);
  process.exit(1);
});
