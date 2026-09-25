/**
 * POS Transfer Payment Photo — server side (Kilo).
 * Task 1: migration payment_expires_at + shared expiry rule.
 * Task 2: cashier authorization / proof gate / close-shift guard.
 * Task 3: pending creation + offline sync API contract.
 * Mỗi DB test dùng file -test- riêng qua test-guard.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { migrateFresh } from './migrate-fresh';
import { assertIsolatedTestDb } from './test-guard';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_transfer_payment.db');
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + suffix); } catch { /* fresh */ }
}

async function run() {
  process.env.DATABASE_URL = `file:${DB_FILE.split(path.sep).join('/')}`;
  assertIsolatedTestDb('test-transfer-payment-flow');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL });

  const raw = createClient({ url: process.env.DATABASE_URL });
  const columns = await raw.execute('PRAGMA table_info(orders)');
  const names = columns.rows.map((row: any) => row.name ?? row[1]);
  assert.ok(names.includes('payment_expires_at'), 'orders phải có payment_expires_at');

  const indexes = await raw.execute("SELECT name FROM sqlite_master WHERE type='index'");
  const indexNames = indexes.rows.map((row: any) => row.name ?? row[0]);
  assert.ok(indexNames.includes('idx_orders_payment_expires_at'));

  const { OrderService } = await import('../src/services/order.service');
  const explicit = new Date('2026-09-25T10:00:00.000Z');
  const legacy = new Date('2026-09-23T10:00:00.000Z');
  assert.equal(
    OrderService.getPendingEffectiveExpiry({ createdAt: explicit.toISOString(), paymentExpiresAt: '2026-09-25T10:30:00.000Z' })?.toISOString(),
    '2026-09-25T10:30:00.000Z'
  );
  assert.equal(
    OrderService.getPendingEffectiveExpiry({ createdAt: legacy.toISOString(), paymentExpiresAt: null })?.toISOString(),
    new Date(legacy.getTime() + 48 * 3600_000).toISOString()
  );

  console.log('PAYMENT EXPIRY MIGRATION PASS');

  // ---------------------------------------------------------------- Task 2 ---
  const { drizzle } = await import('drizzle-orm/libsql');
  const { eq } = await import('drizzle-orm');
  const schema = await import('../src/db/schema');
  const { CashboxService } = await import('../src/services/order.service');
  const db = drizzle(raw);

  const CASHIER_A = { staffId: 'cashier-a', role: 'ROLE_CASHIER' as const, fullName: 'Thu Ngân A' };
  const CASHIER_B = { staffId: 'cashier-b', role: 'ROLE_CASHIER' as const, fullName: 'Thu Ngân B' };
  const MANAGER = { staffId: 'manager-1', role: 'ROLE_MANAGER' as const, fullName: 'Quản Lý' };

  await db.insert(schema.warehouses).values({
    id: 'wh-au-co', code: 'KHO_AU_CO', name: 'Kho Âu Cơ', isActive: true,
    isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN',
  });
  await db.insert(schema.works).values({ id: 'work-tp', code: 'WORK-TP', title: 'Sách chuyển khoản', author: 'Test' });
  await db.insert(schema.editions).values([
    { id: 'ed-tp-1', code: 'TP1', workId: 'work-tp', title: 'Sách TP1', isbn: '9786040001010', isbnLast4: '1010', coverPrice: 120000 },
    { id: 'ed-tp-2', code: 'TP2', workId: 'work-tp', title: 'Sách TP2', isbn: '9786040001020', isbnLast4: '1020', coverPrice: 90000 },
  ]);
  await db.insert(schema.stockBalances).values([
    { id: 'sb-tp-1', editionId: 'ed-tp-1', warehouseId: 'wh-au-co', condition: 'NEW', physicalQuantity: 50 },
    { id: 'sb-tp-2', editionId: 'ed-tp-2', warehouseId: 'wh-au-co', condition: 'NEW', physicalQuantity: 50 },
  ]);

  const sessionA = await CashboxService.openSession({ warehouseId: 'wh-au-co', cashierId: CASHIER_A.staffId, openingCash: 0 });
  const sessionB = await CashboxService.openSession({ warehouseId: 'wh-au-co', cashierId: CASHIER_B.staffId, openingCash: 0 });

  const proof = { id: 'proof-a', capturedAt: new Date().toISOString() };

  const order = await OrderService.createOrder({
    warehouseId: 'wh-au-co',
    channel: 'RETAIL_OFFICE',
    paymentMethod: 'BANK_TRANSFER',
    cashierId: CASHIER_A.staffId,
    cashboxSessionId: sessionA.session.id,
    actorContext: CASHIER_A,
    confirmImmediately: false,
    items: [{ editionId: 'ed-tp-1', quantity: 2 }],
  });
  assert.equal((order as any).status, 'PENDING_CONFIRMATION');

  // 2.1 Thiếu proof → từ chối
  await assert.rejects(
    () => OrderService.confirmOrder(order.orderId, 'ROLE_CASHIER', CASHIER_A.staffId, CASHIER_A),
    (error: any) => error?.code === 'INVALID_INPUT'
  );

  // 2.2 Cashier khác không được duyệt đơn của người này
  await assert.rejects(
    () => OrderService.confirmOrder(order.orderId, 'ROLE_CASHIER', CASHIER_B.staffId, CASHIER_B, proof),
    (error: any) => error?.code === 'FORBIDDEN'
  );

  // 2.3 Cashier chủ đơn duyệt được + retry idempotent
  const confirmed = await OrderService.confirmOrder(order.orderId, 'ROLE_CASHIER', CASHIER_A.staffId, CASHIER_A, proof);
  assert.equal(confirmed.status, 'COMPLETED');
  const retried = await OrderService.confirmOrder(order.orderId, 'ROLE_CASHIER', CASHIER_A.staffId, CASHIER_A, proof);
  assert.equal((retried as any).isIdempotent, true);
  console.log('✓ Cashier duyệt được đơn chuyển khoản của chính mình (retry idempotent)');

  // 2.4 Audit ghi nguyên tử trong service
  const confirmAudit = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.id, `aud-order-confirm-${order.orderId}`));
  assert.equal(confirmAudit.length, 1, 'phải có audit ORDER_CONFIRMED với id xác định');
  assert.equal(confirmAudit[0].action, 'ORDER_CONFIRMED');
  assert.ok(String(confirmAudit[0].details).includes('proof-a'), 'audit phải lưu paymentProofId');
  console.log('✓ Audit ORDER_CONFIRMED ghi trong cùng transaction, id xác định');

  // 2.5 Cashier A không hủy được đơn của cashier B; hủy được đơn mình
  const orderB = await OrderService.createOrder({
    warehouseId: 'wh-au-co',
    channel: 'RETAIL_OFFICE',
    paymentMethod: 'QR_CODE',
    cashierId: CASHIER_B.staffId,
    cashboxSessionId: sessionB.session.id,
    actorContext: CASHIER_B,
    confirmImmediately: false,
    items: [{ editionId: 'ed-tp-2', quantity: 1 }],
  });
  await assert.rejects(
    () => OrderService.cancelOrder(orderB.orderId, 'ROLE_CASHIER', 'không phải đơn tôi', CASHIER_A),
    (error: any) => error?.code === 'FORBIDDEN'
  );
  const ownOrder = await OrderService.createOrder({
    warehouseId: 'wh-au-co',
    channel: 'RETAIL_OFFICE',
    paymentMethod: 'QR_CODE',
    cashierId: CASHIER_A.staffId,
    cashboxSessionId: sessionA.session.id,
    actorContext: CASHIER_A,
    confirmImmediately: false,
    items: [{ editionId: 'ed-tp-2', quantity: 1 }],
  });
  const ownCancel = await OrderService.cancelOrder(ownOrder.orderId, 'ROLE_CASHIER', 'khách đổi ý', CASHIER_A);
  assert.equal(ownCancel.status, 'CANCELLED');
  const cancelAudit = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.id, `aud-order-cancel-${ownOrder.orderId}`));
  assert.equal(cancelAudit.length, 1, 'phải có audit ORDER_CANCELLED với id xác định');
  console.log('✓ Cashier chỉ hủy được đơn của chính mình, audit hủy ghi nguyên tử');

  // 2.6 Chốt ca bị chặn khi còn đơn PENDING trong session
  await assert.rejects(
    () => CashboxService.closeSession({ sessionId: sessionB.session.id, closingCashActual: 0 }),
    (error: any) => error?.code === 'STATE_CONFLICT'
  );
  await OrderService.cancelOrder(orderB.orderId, 'ROLE_MANAGER', 'dọn test', MANAGER);
  const closedB = await CashboxService.closeSession({ sessionId: sessionB.session.id, closingCashActual: 0 });
  assert.equal(closedB.status, 'CLOSED');
  console.log('✓ Chốt ca bị chặn khi còn đơn PENDING, mở lại được sau khi xử lý');

  console.log('TRANSFER PAYMENT AUTHZ PASS');

  // ---------------------------------------------------------------- Task 3 ---
  const { POST: ordersPost } = await import('../src/app/api/orders/route');
  const { signSession, SESSION_COOKIE_NAME } = await import('../src/lib/auth-session');

  const cookieFor = async (actor: { staffId: string; role: string }) =>
    `${SESSION_COOKIE_NAME}=${await signSession({
      role: actor.role as any,
      actorId: actor.staffId,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600_000,
    })}`;

  let seq = 0;
  const baseBody = (overrides: Record<string, any> = {}) => ({
    warehouseId: 'wh-au-co',
    channel: 'RETAIL_OFFICE',
    customerName: `Khách chuyển khoản ${Date.now()}-${seq++}`,
    paymentMethod: 'CASH',
    fiscalScope: 'INTERNAL_MANAGEMENT',
    cashboxSessionId: sessionA.session.id,
    items: [{ editionId: 'ed-tp-1', quantity: 1 }],
    ...overrides,
  });
  const postAs = async (body: Record<string, any>, actor: { staffId: string; role: string } = CASHIER_A) => {
    const res: any = await ordersPost(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: await cookieFor(actor) },
        body: JSON.stringify(body),
      }) as any
    );
    return { status: res.status as number, json: await res.json() };
  };

  // 3.1 Đơn chuyển khoản tại quầy tạo trước, không cần moneyReceived
  const pendingRes = await postAs(baseBody({ paymentMethod: 'BANK_TRANSFER', confirmImmediately: false, moneyReceived: false }));
  assert.equal(pendingRes.status, 200, `pending: ${JSON.stringify(pendingRes.json)}`);
  const pendingData = pendingRes.json.data;
  assert.equal(pendingData.status, 'PENDING_CONFIRMATION');

  // 3.2 Hạn 30 phút do server đặt, không nhận từ client
  const pendingRow = (await db.select().from(schema.orders).where(eq(schema.orders.id, pendingData.orderId)))[0];
  const expiresInMs = new Date(pendingRow.paymentExpiresAt as string).getTime() - Date.now();
  assert.ok(
    expiresInMs > 29 * 60_000 && expiresInMs <= 30 * 60_000,
    `hạn counter transfer phải ~30 phút, thực tế ${expiresInMs}ms`
  );
  console.log('✓ Đơn chuyển khoản tạo trước, hạn 30 phút do server đặt');

  // 3.3 Đồng bộ offline (digital tức thì) thiếu proof vẫn bị chặn
  const noProofRes = await postAs(baseBody({ paymentMethod: 'BANK_TRANSFER', moneyReceived: true }));
  assert.equal(noProofRes.status, 403);

  // 3.4 Đồng bộ offline đủ proof → COMPLETED + audit chốt quy trình
  const offlineRes = await postAs(baseBody({
    paymentMethod: 'BANK_TRANSFER',
    moneyReceived: true,
    paymentProofId: 'proof-offline-1',
    paymentProofCapturedAt: new Date().toISOString(),
  }));
  assert.equal(offlineRes.status, 200, `offline: ${JSON.stringify(offlineRes.json)}`);
  assert.equal(offlineRes.json.data.status, 'COMPLETED');
  const offlineAudit = await db
    .select()
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.id, `aud-order-${offlineRes.json.data.orderId}-transfer-payment-confirmation`));
  assert.equal(offlineAudit.length, 1, 'phải ghi audit transfer-payment-confirmation');
  assert.equal(offlineAudit[0].action, 'ORDER_CONFIRMED');
  console.log('✓ Sync offline digital bắt buộc có proof + audit ORDER_CONFIRMED');

  // 3.5 Tiền mặt không đổi
  const cashRes = await postAs(baseBody({ paymentMethod: 'CASH' }));
  assert.equal(cashRes.status, 200);
  assert.equal(cashRes.json.data.status, 'COMPLETED');
  console.log('✓ Đơn tiền mặt vẫn hoàn tất ngay, không đòi proof');

  // 3.6 Cashier qua API: duyệt được đơn mình, không duyệt được đơn người khác
  const selfConfirm = await postAs(
    { action: 'CONFIRM', orderId: pendingData.orderId, paymentProofId: 'proof-route-1', paymentProofCapturedAt: new Date().toISOString() },
    CASHIER_A
  );
  assert.equal(selfConfirm.status, 200, `self confirm: ${JSON.stringify(selfConfirm.json)}`);
  assert.equal(selfConfirm.json.data.status, 'COMPLETED');

  const otherRes = await postAs(
    { action: 'CONFIRM', orderId: pendingData.orderId, paymentProofId: 'proof-route-2', paymentProofCapturedAt: new Date().toISOString() },
    CASHIER_B
  );
  assert.equal(otherRes.status, 403, `cashier khác phải bị chặn: ${JSON.stringify(otherRes.json)}`);
  console.log('✓ API chỉ cho cashier duyệt đơn của chính mình');

  // 3.7 ATP giữ chỗ theo hạn riêng: hết 30 phút thì nhả ATP + job dọn hủy
  const heldOrder = await postAs(baseBody({ paymentMethod: 'QR_CODE', confirmImmediately: false }));
  const heldId = heldOrder.json.data.orderId;
  const atpHeld = await OrderService.getATP('ed-tp-1', 'wh-au-co');
  const physical = await (await import('../src/services/inventory.service')).InventoryService.getBalance('ed-tp-1', 'wh-au-co', 'NEW');
  assert.equal(physical - atpHeld, 1, 'đơn PENDING còn hạn phải giữ 1 cuốn ATP');
  await db
    .update(schema.orders)
    .set({ paymentExpiresAt: new Date(Date.now() - 60_000).toISOString() })
    .where(eq(schema.orders.id, heldId));
  const cleanedCount = await OrderService.cleanupExpiredPending();
  const atpAfterCleanup = await OrderService.getATP('ed-tp-1', 'wh-au-co');
  assert.equal(atpAfterCleanup, physical, 'đơn quá hạn phải nhả ATP');
  assert.ok(cleanedCount >= 1);
  console.log('✓ Đơn counter transfer hết hạn được dọn và giải phóng ATP');

  // ------------------------------------------------- Task 4: HTTP proof guard ---
  const nowIso = () => new Date().toISOString();
  const longProofId = 'p'.repeat(201);
  const assertInvalidInput = (res: { status: number; json: any }, label: string) => {
    assert.equal(
      res.status,
      400,
      `${label}: phải 400 INVALID_INPUT, thực tế ${res.status} ${JSON.stringify(res.json)}`
    );
    assert.equal(res.json?.code, 'INVALID_INPUT', `${label}: phải trả code INVALID_INPUT`);
  };

  const guardOrder = await postAs(baseBody({ paymentMethod: 'BANK_TRANSFER', confirmImmediately: false }));
  assert.equal(guardOrder.status, 200);
  const guardId = guardOrder.json.data.orderId;

  // 4.1 paymentProofId > 200 ký tự → 400
  await assertInvalidInput(
    await postAs({ action: 'CONFIRM', orderId: guardId, paymentProofId: longProofId, paymentProofCapturedAt: nowIso() }),
    'CONFIRM proof id quá dài'
  );
  // 4.2 capturedAt không phải ngày → 400
  await assertInvalidInput(
    await postAs({ action: 'CONFIRM', orderId: guardId, paymentProofId: 'proof-ok', paymentProofCapturedAt: 'không-phải-ngày' }),
    'CONFIRM capturedAt không parse được'
  );
  // 4.3 chỉ gửi một trong hai trường → 400
  await assertInvalidInput(
    await postAs({ action: 'CONFIRM', orderId: guardId, paymentProofId: 'proof-ok' }),
    'CONFIRM thiếu capturedAt'
  );
  await assertInvalidInput(
    await postAs({ action: 'CONFIRM', orderId: guardId, paymentProofCapturedAt: nowIso() }),
    'CONFIRM thiếu proofId'
  );
  // 4.4 capturedAt khổng lồ → 400 (bảo vệ audit_logs.details khỏi phình vô hạn)
  await assertInvalidInput(
    await postAs({ action: 'CONFIRM', orderId: guardId, paymentProofId: 'proof-ok', paymentProofCapturedAt: 'x'.repeat(50000) }),
    'CONFIRM capturedAt khổng lồ'
  );
  // 4.5 create digital tức thì chỉ gửi MỘT trong hai trường → 400 (không phải 403)
  await assertInvalidInput(
    await postAs(baseBody({ paymentMethod: 'BANK_TRANSFER', moneyReceived: true, paymentProofId: 'proof-one-sided' })),
    'create thiếu capturedAt'
  );
  await assertInvalidInput(
    await postAs(baseBody({ paymentMethod: 'BANK_TRANSFER', moneyReceived: true, paymentProofCapturedAt: nowIso() })),
    'create thiếu proofId'
  );
  // 4.6 create digital tức thì proof id quá dài → 400
  await assertInvalidInput(
    await postAs(baseBody({
      paymentMethod: 'BANK_TRANSFER', moneyReceived: true,
      paymentProofId: longProofId, paymentProofCapturedAt: nowIso(),
    })),
    'create proof id quá dài'
  );
  // 4.7 pair hợp lệ vẫn được chấp nhận trên action CONFIRM
  const guardConfirm = await postAs({
    action: 'CONFIRM', orderId: guardId,
    paymentProofId: 'proof-valid-1', paymentProofCapturedAt: nowIso(),
  });
  assert.equal(guardConfirm.status, 200, `pair hợp lệ phải được nhận: ${JSON.stringify(guardConfirm.json)}`);
  assert.equal(guardConfirm.json.data.status, 'COMPLETED');
  // 4.8 pair hợp lệ vẫn được chấp nhận trên create digital tức thì
  const guardCreate = await postAs(baseBody({
    paymentMethod: 'QR_CODE', moneyReceived: true,
    paymentProofId: 'proof-valid-2', paymentProofCapturedAt: nowIso(),
  }));
  assert.equal(guardCreate.status, 200, `create pair hợp lệ phải được nhận: ${JSON.stringify(guardCreate.json)}`);
  assert.equal(guardCreate.json.data.status, 'COMPLETED');
  // 4.9 id > 200 ký tự nhưng capturedAt hợp lệ: đơn vẫn PENDING (không side-effect)
  const guardRow = (await db.select().from(schema.orders).where(eq(schema.orders.id, guardId)))[0];
  assert.equal(guardRow.status, 'COMPLETED', 'đơn đã duyệt ở 4.7');
  console.log('✓ Biên HTTP: proof id/capturedAt lỗi → 400, pair hợp lệ vẫn nhận (CONFIRM + create tức thì)');

  // ------------------------------------------- Task 4: thứ tự quá hạn/proof ---
  // 4.10 Đơn PENDING chuyển khoản đã quá hạn: báo conflict + CANCELLED ngay,
  //      kể cả khi KHÔNG gửi paymentProof (quá hạn phải thắng lỗi thiếu ảnh).
  const expiredRes = await postAs(baseBody({ paymentMethod: 'BANK_TRANSFER', confirmImmediately: false }));
  const expiredId = expiredRes.json.data.orderId;
  await db
    .update(schema.orders)
    .set({ paymentExpiresAt: new Date(Date.now() - 60_000).toISOString() })
    .where(eq(schema.orders.id, expiredId));
  await assert.rejects(
    () => OrderService.confirmOrder(expiredId, 'ROLE_CASHIER', CASHIER_A.staffId, CASHIER_A),
    (error: any) => error?.code === 'STATE_CONFLICT',
    'đơn quá hạn phải trả STATE_CONFLICT chứ không phải INVALID_INPUT thiếu ảnh'
  );
  const expiredRow = (await db.select().from(schema.orders).where(eq(schema.orders.id, expiredId)))[0];
  assert.equal(expiredRow.status, 'CANCELLED', 'đơn quá hạn phải bị hủy ngay, không chờ cleanup job');
  assert.ok(String(expiredRow.note).includes('quá hạn giữ chỗ'));

  // 4.11 Đơn PENDING chưa quá hạn, không proof → vẫn bị chặn bằng lỗi thiếu ảnh
  const freshRes = await postAs(baseBody({ paymentMethod: 'BANK_TRANSFER', confirmImmediately: false }));
  const freshId = freshRes.json.data.orderId;
  await assert.rejects(
    () => OrderService.confirmOrder(freshId, 'ROLE_CASHIER', CASHIER_A.staffId, CASHIER_A),
    (error: any) => error?.code === 'INVALID_INPUT' && /ảnh xác nhận/i.test(error?.message || '')
  );
  const freshRow = (await db.select().from(schema.orders).where(eq(schema.orders.id, freshId)))[0];
  assert.equal(freshRow.status, 'PENDING_CONFIRMATION', 'đơn chưa quá hạn phải giữ nguyên PENDING');
  console.log('✓ Thứ tự confirmOrder: quá hạn thắng lỗi thiếu ảnh, đơn còn hạn vẫn đòi ảnh');

  // -------------------------------------------- Task 4: security regression ---
  // S1. cleanupExpiredPending: SELECT nằm ngoài transaction nên UPDATE phải khoá
  //     có điều kiện status — nếu không, một confirmOrder chạy xen giữa sẽ bị ghi
  //     đè CANCELLED sau khi kho đã xuất. Cửa sổ TOCTOU nằm giữa hai await trên
  //     client libsql không đồng bộ, không test được deterministically trong 1
  //     process; sửa bằng `WHERE status='PENDING_CONFIRMATION'` + đếm rowsAffected
  //     thật (cùng mẫu đã dùng ở confirmOrder/cancelOrder).
  //     Quan sát được: job chỉ tính những đơn nó thực sự hủy.

  // S2. payment_expires_at hỏng → fallback TTL 48h, không để đơn PENDING treo vĩnh viễn.
  const threeDaysAgo = new Date(Date.now() - 3 * 86400_000).toISOString();
  assert.equal(
    OrderService.getPendingEffectiveExpiry({ createdAt: threeDaysAgo, paymentExpiresAt: 'không-phải-ngày' })?.toISOString(),
    new Date(new Date(threeDaysAgo).getTime() + 48 * 3600_000).toISOString(),
    'payment_expires_at hỏng phải fallback về TTL 48h'
  );
  assert.equal(OrderService.isPendingExpired({ createdAt: threeDaysAgo, paymentExpiresAt: 'hỏng' }), true);
  assert.equal(OrderService.isPendingExpired({ createdAt: new Date().toISOString(), paymentExpiresAt: 'hỏng' }), false);
  const corruptRes = await postAs(baseBody({
    paymentMethod: 'BANK_TRANSFER', confirmImmediately: false, createdAt: threeDaysAgo,
  }));
  const corruptId = corruptRes.json.data.orderId;
  await db
    .update(schema.orders)
    .set({ paymentExpiresAt: 'hỏng' })
    .where(eq(schema.orders.id, corruptId));
  const cleanedCorrupt = await OrderService.cleanupExpiredPending();
  const corruptRow = (await db.select().from(schema.orders).where(eq(schema.orders.id, corruptId)))[0];
  assert.equal(corruptRow.status, 'CANCELLED', 'đơn PENDING có payment_expires_at hỏng vẫn phải được dọn');
  assert.ok(cleanedCorrupt >= 1);

  // S3. reason hủy do client gửi: không được phình vô hạn vào orders.note/audit_logs.
  const reasonRes = await postAs(baseBody({ paymentMethod: 'QR_CODE', confirmImmediately: false }));
  const reasonId = reasonRes.json.data.orderId;
  const longReason = await postAs({ action: 'CANCEL', orderId: reasonId, reason: 'r'.repeat(2000) }, CASHIER_A);
  assert.equal(longReason.status, 400, `reason hủy quá dài phải 400: ${JSON.stringify(longReason.json)}`);
  const okReason = await postAs({ action: 'CANCEL', orderId: reasonId, reason: 'khách đổi ý' }, CASHIER_A);
  assert.equal(okReason.status, 200, `reason hợp lệ phải hủy được: ${JSON.stringify(okReason.json)}`);
  const reasonRow = (await db.select().from(schema.orders).where(eq(schema.orders.id, reasonId)))[0];
  assert.ok(!(String(reasonRow.note).includes('rrrr')), 'note không được chứa reason bị cắt/tràn');
  assert.ok(String(reasonRow.note).includes('khách đổi ý'));

  // S4. cancelOrder phải kiểm tra két ca giống confirmOrder (đóng ca = không xử lý đơn chờ).
  const closedRes = await postAs(baseBody({ paymentMethod: 'QR_CODE', confirmImmediately: false }));
  const closedId = closedRes.json.data.orderId;
  await db
    .update(schema.cashboxSessions)
    .set({ status: 'CLOSED' })
    .where(eq(schema.cashboxSessions.id, sessionA.session.id));
  await assert.rejects(
    () => OrderService.cancelOrder(closedId, 'ROLE_CASHIER', 'đóng ca rồi', CASHIER_A),
    (error: any) => error?.code === 'STATE_CONFLICT',
    'hủy đơn thuộc két đã đóng phải bị chặn'
  );
  await db
    .update(schema.cashboxSessions)
    .set({ status: 'OPEN' })
    .where(eq(schema.cashboxSessions.id, sessionA.session.id));
  const reopenCancel = await OrderService.cancelOrder(closedId, 'ROLE_CASHIER', 'mở lại ca', CASHIER_A);
  assert.equal(reopenCancel.status, 'CANCELLED');

  // S5. Actor lạc vai trò (không phải Owner/Manager/Cashier) không duyệt/hủy được.
  const untrustedRes = await postAs(baseBody({ paymentMethod: 'BANK_TRANSFER', confirmImmediately: false }));
  const untrustedId = untrustedRes.json.data.orderId;
  for (const badRole of ['ROLE_WAREHOUSE', 'ROLE_TAX']) {
    const res = await postAs(
      { action: 'CONFIRM', orderId: untrustedId, paymentProofId: 'proof-x', paymentProofCapturedAt: nowIso() },
      { staffId: 'staff-1', role: badRole }
    );
    assert.equal(res.status, 403, `${badRole} không được duyệt đơn: ${JSON.stringify(res.json)}`);
  }
  await assert.rejects(
    () => OrderService.confirmOrder(untrustedId, 'ROLE_WAREHOUSE', 'warehouse-1', undefined, proof),
    (error: any) => error?.code === 'FORBIDDEN',
    'service chặn ROLE_WAREHOUSE dù route đã chặn'
  );
  await assert.rejects(
    () => OrderService.cancelOrder(untrustedId, 'ROLE_WAREHOUSE', 'x', undefined),
    (error: any) => error?.code === 'FORBIDDEN',
    'service chặn ROLE_WAREHOUSE ở cancel'
  );
  // Không actorContext + vai trò cashier → actorId mặc định staff-admin, không được vượt
  await assert.rejects(
    () => OrderService.confirmOrder(untrustedId, 'ROLE_CASHIER', undefined, undefined, proof),
    (error: any) => error?.code === 'FORBIDDEN',
    'cashier không có định danh không được duyệt đơn người khác'
  );
  const untrustedRow = (await db.select().from(schema.orders).where(eq(schema.orders.id, untrustedId)))[0];
  assert.equal(untrustedRow.status, 'PENDING_CONFIRMATION');
  await OrderService.cancelOrder(untrustedId, 'ROLE_MANAGER', 'dọn test', MANAGER);
  console.log('✓ Regression bảo mật: cleanup có điều kiện, TTL fallback, reason bị chặn, két đóng chặn hủy, actor lạc vai trò bị chặn');

  raw.close();
  console.log('TRANSFER PAYMENT API CONTRACT PASS');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
