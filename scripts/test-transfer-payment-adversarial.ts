/**
 * ADVERSARIAL REVIEW — transfer payment photo (kilo, base d3a2ada).
 *
 * Không khen, chỉ phá. Mỗi mục ghi rõ: phát hiện / hành vi trước fix / sau fix.
 * Mọi DB test dùng file -test- riêng qua test-guard.
 *
 * NHÓM 1 (đã SỬA, có test đỏ trước fix):
 *  A1. confirmOrder mặc định actorId = 'staff-admin' → audit + bút toán kho ghi
 *      actor giả; và một đơn legacy (cashierId mặc định 'staff-admin') bị một
 *      caller ROLE_CASHIER không định danh duyệt được (hai "không ai" trùng tên).
 *  A2. Fingerprint idempotency không so `confirmImmediately`: replay key cũ với
 *      confirmImmediately mặc định (đúng payload của sync offline) trả
 *      success + đơn PENDING → client xoá bản ghi offline, không trừ kho.
 *
 * NHÓM 2 (CHƯA SỬA — bằng chứng, cần quyết định sản phẩm):
 *  B1. Trần giữ ATP chỉ tính đơn chuyển khoản/QR: PENDING CASH/COD giữ ATP
 *      vô hạn, không bị trần.
 *  B2. Trần đếm SỐ ĐƠN, không giới hạn SỐ LƯỢNG giữ chỗ.
 *  B3. Cửa sổ 30 phút do client quyết định: bỏ cashboxSessionId → 48h.
 *  B4. warehouseId do client gửi → trần nhân lên theo số kho.
 *  B5. ATP phía confirm: atp + qty < qty ⇔ atp >= 0 (đúng bất biến), chứng minh
 *      bằng trạng thái "bán vượt do race" mô phỏng.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { migrateFresh } from './migrate-fresh';
import { assertIsolatedTestDb } from './test-guard';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_transfer_payment_adversarial.db');
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + suffix); } catch { /* fresh */ }
}

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  ✗ FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function run() {
  process.env.DATABASE_URL = `file:${DB_FILE.split(path.sep).join('/')}`;
  assertIsolatedTestDb('test-transfer-payment-adversarial');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL });

  const raw = createClient({ url: process.env.DATABASE_URL });
  const { drizzle } = await import('drizzle-orm/libsql');
  const { eq, and } = await import('drizzle-orm');
  const schema = await import('../src/db/schema');
  const db = drizzle(raw);
  const { OrderService, CashboxService, MAX_PENDING_HOLD_UNITS_PER_CASHIER: CAP_UNITS } =
    await import('../src/services/order.service');
  const { InventoryService } = await import('../src/services/inventory.service');
  const { POST: ordersPost } = await import('../src/app/api/orders/route');
  const { signSession, SESSION_COOKIE_NAME } = await import('../src/lib/auth-session');

  const WH = 'wh-adv';
  const WH3 = 'wh-adv-3';
  const CASHIER = { staffId: 'cashier-adv', role: 'ROLE_CASHIER' as const, fullName: 'Thu Ngân ADV' };
  const MANAGER = { staffId: 'manager-adv', role: 'ROLE_MANAGER' as const, fullName: 'Quản Lý ADV' };
  const proof = () => ({ id: `proof-${Math.random().toString(36).slice(2)}`, capturedAt: new Date().toISOString() });

  await db.insert(schema.warehouses).values([
    { id: WH, code: 'KHO_ADV', name: 'Kho ADV', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
    { id: 'wh-adv-2', code: 'KHO_ADV2', name: 'Kho ADV 2', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
    { id: WH3, code: 'KHO_ADV3', name: 'Kho ADV 3', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
  ]);
  await db.insert(schema.works).values({ id: 'work-adv', code: 'WORK-ADV', title: 'Sách ADV', author: 'Test' });
  await db.insert(schema.editions).values([
    { id: 'ed-adv-1', code: 'ADV1', workId: 'work-adv', title: 'Sách ADV1', isbn: '9786040003010', isbnLast4: '3010', coverPrice: 100000 },
    { id: 'ed-adv-2', code: 'ADV2', workId: 'work-adv', title: 'Sách ADV2', isbn: '9786040003020', isbnLast4: '3020', coverPrice: 100000 },
  ]);
  await db.insert(schema.stockBalances).values([
    { id: 'sb-adv-1', editionId: 'ed-adv-1', warehouseId: WH, condition: 'NEW', physicalQuantity: 100 },
    { id: 'sb-adv-2', editionId: 'ed-adv-2', warehouseId: WH, condition: 'NEW', physicalQuantity: 100 },
    { id: 'sb-adv-2-w2', editionId: 'ed-adv-2', warehouseId: 'wh-adv-2', condition: 'NEW', physicalQuantity: 100 },
    { id: 'sb-adv-1-w2', editionId: 'ed-adv-1', warehouseId: 'wh-adv-2', condition: 'NEW', physicalQuantity: 100 },
    { id: 'sb-adv-1-w3', editionId: 'ed-adv-1', warehouseId: WH3, condition: 'NEW', physicalQuantity: 100 },
  ]);
  const session = await CashboxService.openSession({ warehouseId: WH, cashierId: CASHIER.staffId, openingCash: 0 });
  // Ca mở ở 2 kho phụ (dùng cho các case cần đơn quầy PENDING hợp lệ).
  const sessionW2 = await CashboxService.openSession({ warehouseId: 'wh-adv-2', cashierId: CASHIER.staffId, openingCash: 0 });
  const sessionW3 = await CashboxService.openSession({ warehouseId: WH3, cashierId: CASHIER.staffId, openingCash: 0 });
  // Ca mở của thu ngân thứ hai (dùng cho case ATP: chỉ ATP mới được là lý do chặn).
  const sessionOther = await CashboxService.openSession({ warehouseId: WH, cashierId: 'other-cashier-adv', openingCash: 0 });

  const auditOf = async (id: string) =>
    (await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.id, id)))[0];
  const ledgerOf = async (correlationId: string) =>
    await db.select().from(schema.inventoryLedger).where(eq(schema.inventoryLedger.correlationId, correlationId));
  const orderRow = async (id: string) =>
    (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];

  // ============================================================== A1 =========
  console.log('\nA1. confirmOrder không được bịa định danh (actorId default staff-admin)');
  // Đơn legacy: không actorContext, không cashierId → cashierId mặc định 'staff-admin'.
  const legacyOrder = await OrderService.createOrder({
    warehouseId: WH,
    channel: 'RETAIL_ONLINE_WEB',
    paymentMethod: 'BANK_TRANSFER',
    confirmImmediately: false,
    idempotencyKey: 'idem-adv-legacy',
    items: [{ editionId: 'ed-adv-1', quantity: 1 }],
  });
  check(
    'đơn legacy được gắn cashierId mặc định staff-admin',
    (await orderRow(legacyOrder.orderId)).cashierId === 'staff-admin',
    `cashierId=${(await orderRow(legacyOrder.orderId)).cashierId}`
  );

  // A1.1 Caller ROLE_CASHIER không định danh (mặc định 'staff-admin' trùng cashierId
  //      của đơn legacy) → trước fix: ĐƯỢC duyệt. Sau fix: FORBIDDEN.
  let a11Code = '';
  try {
    await OrderService.confirmOrder(legacyOrder.orderId, 'ROLE_CASHIER', undefined, undefined, proof());
    a11Code = 'ALLOWED';
  } catch (e: any) {
    a11Code = e?.code || e?.message;
  }
  check(
    'A1.1 caller ROLE_CASHIER không định danh KHÔNG được duyệt đơn cashierId="staff-admin"',
    a11Code === 'FORBIDDEN',
    `kết quả=${a11Code}`
  );
  check(
    'A1.1 đơn legacy vẫn PENDING sau khi chặn',
    (await orderRow(legacyOrder.orderId)).status === 'PENDING_CONFIRMATION'
  );
  check(
    'A1.1 không có bút toán kho nào cho đơn legacy',
    (await ledgerOf(legacyOrder.orderId)).length === 0
  );

  // A1.2 Manager gọi service mà không định danh → trước fix: audit + ledger ghi
  //      'staff-admin' (người giả). Sau fix: fail loud, không ghi dòng audit nào.
  const mgrOrder = await OrderService.createOrder({
    warehouseId: WH,
    channel: 'RETAIL_ONLINE_WEB',
    paymentMethod: 'QR_CODE',
    confirmImmediately: false,
    idempotencyKey: 'idem-adv-mgr-anon',
    items: [{ editionId: 'ed-adv-1', quantity: 1 }],
  });
  let a12Code = '';
  try {
    await OrderService.confirmOrder(mgrOrder.orderId, 'ROLE_MANAGER', undefined, undefined, proof());
    a12Code = 'ALLOWED';
  } catch (e: any) {
    a12Code = e?.code || e?.message;
  }
  check('A1.2 manager không định danh bị từ chối (fail loud)', a12Code === 'FORBIDDEN', `kết quả=${a12Code}`);
  const mgrAudit = await auditOf(`aud-order-confirm-${mgrOrder.orderId}`);
  check('A1.2 KHÔNG sinh dòng audit ORDER_CONFIRMED cho actor giả', !mgrAudit, `audit=${JSON.stringify(mgrAudit ?? null)}`);
  check(
    'A1.2 đơn manager ẩn danh vẫn PENDING, không trừ kho',
    (await orderRow(mgrOrder.orderId)).status === 'PENDING_CONFIRMATION' &&
      (await ledgerOf(mgrOrder.orderId)).length === 0
  );

  // A1.3 Đường thật (có định danh) phải ghi đúng người, vào CẢ audit lẫn bút toán kho.
  const realOrder = await OrderService.createOrder({
    warehouseId: WH,
    channel: 'RETAIL_OFFICE',
    paymentMethod: 'BANK_TRANSFER',
    cashboxSessionId: session.session.id,
    cashierId: CASHIER.staffId,
    actorContext: CASHIER,
    confirmImmediately: false,
    idempotencyKey: 'idem-adv-real',
    items: [{ editionId: 'ed-adv-1', quantity: 1 }],
  });
  await OrderService.confirmOrder(realOrder.orderId, 'ROLE_CASHIER', CASHIER.staffId, CASHIER, proof());
  const realAudit = await auditOf(`aud-order-confirm-${realOrder.orderId}`);
  const realLedger = await ledgerOf(realOrder.orderId);
  check(
    'A1.3 audit + bút toán kho ghi đúng cashier thật',
    realAudit?.actorId === CASHIER.staffId && realLedger[0]?.actorId === CASHIER.staffId,
    `audit=${realAudit?.actorId} ledger=${realLedger[0]?.actorId}`
  );
  check(
    'A1.3 không đơn nào trong DB ghi actor "staff-admin" do đường duyệt đơn',
    realAudit?.actorId !== 'staff-admin'
  );

  // A1.4 Đường quét dọn đơn (cleanup) + hủy không định danh vẫn chạy được.
  const sweepOrder = await OrderService.createOrder({
    warehouseId: WH,
    channel: 'RETAIL_ONLINE_WEB',
    paymentMethod: 'BANK_TRANSFER',
    confirmImmediately: false,
    idempotencyKey: 'idem-adv-sweep',
    items: [{ editionId: 'ed-adv-1', quantity: 1 }],
  });
  await db
    .update(schema.orders)
    .set({ paymentExpiresAt: new Date(Date.now() - 60_000).toISOString() })
    .where(eq(schema.orders.id, sweepOrder.orderId));
  const cleaned = await OrderService.cleanupExpiredPending();
  check(
    'A1.4 job quét dọn đơn quá hạn không cần (và không được nhận) định danh con người',
    cleaned >= 1 && (await orderRow(sweepOrder.orderId)).status === 'CANCELLED',
    `cleaned=${cleaned}`
  );
  check(
    'A1.4 đơn bị hệ thống hủy không sinh audit con người',
    !(await auditOf(`aud-order-cancel-${sweepOrder.orderId}`))
  );
  const anonCancel = await OrderService.createOrder({
    warehouseId: WH,
    channel: 'RETAIL_ONLINE_WEB',
    paymentMethod: 'QR_CODE',
    confirmImmediately: false,
    idempotencyKey: 'idem-adv-anon-cancel',
    items: [{ editionId: 'ed-adv-1', quantity: 1 }],
  });
  const anonCancelRes = await OrderService.cancelOrder(anonCancel.orderId, 'ROLE_MANAGER', 'dọn test');
  const anonCancelAudit = await auditOf(`aud-order-cancel-${anonCancel.orderId}`);
  check(
    'A1.4 hủy không định danh vẫn chạy, audit trung thực (không SYSTEM, không staff-admin)',
    anonCancelRes.status === 'CANCELLED' &&
      anonCancelAudit?.actorId === 'unattributed:ROLE_MANAGER' &&
      anonCancelAudit?.actorRole === 'ROLE_MANAGER',
    `actorId=${anonCancelAudit?.actorId}`
  );

  // ============================================================== A2 =========
  console.log('\nA2. Replay idempotency đổi ngữ nghĩa confirmImmediately phải báo lỗi, không trả success');
  const cookieFor = async (actor: { staffId: string; role: string }) =>
    `${SESSION_COOKIE_NAME}=${await signSession({
      role: actor.role as any,
      actorId: actor.staffId,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600_000,
    })}`;
  const postAs = async (body: Record<string, any>, actor: { staffId: string; role: string } = CASHIER) => {
    const res: any = await ordersPost(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: await cookieFor(actor) },
        body: JSON.stringify(body),
      }) as any
    );
    return { status: res.status as number, json: await res.json() };
  };

  // Kịch bản: mạng chết sau khi server đã commit đơn PENDING (response mất) →
  // client fallback offline → thu tiền + chụp ảnh → sync lại với ĐÚNG payload
  // của PosCheckoutTerminal (không gửi confirmImmediately ⇒ mặc định = hoàn tất).
  const lostResponseBody = {
    warehouseId: WH,
    channel: 'RETAIL_OFFICE',
    customerName: 'Khách mất response',
    paymentMethod: 'BANK_TRANSFER',
    moneyReceived: false,
    fiscalScope: 'INTERNAL_MANAGEMENT',
    cashboxSessionId: session.session.id,
    idempotencyKey: 'idem-adv-lost-response',
    items: [{ editionId: 'ed-adv-2', quantity: 2 }],
  };
  const created = await postAs({ ...lostResponseBody, confirmImmediately: false });
  check('A2.1 đơn PENDING tạo được qua HTTP', created.status === 200, JSON.stringify(created.json));
  const lostId = created.json.data.orderId;
  const physBefore = await InventoryService.getBalance('ed-adv-2', WH, 'NEW');

  const replay = await postAs({
    ...lostResponseBody,
    isOfflineSync: true,
    allowOverdraft: true,
    moneyReceived: true,
    paymentProofId: 'proof-offline-adv',
    paymentProofCapturedAt: new Date().toISOString(),
    // KHÔNG gửi confirmImmediately — đúng payload sync offline.
  });
  check(
    'A2.2 replay "hoàn tất ngay" trên đơn PENDING phải trả IDEMPOTENCY_CONFLICT (409)',
    replay.status === 409 && replay.json?.code === 'IDEMPOTENCY_CONFLICT',
    `status=${replay.status} code=${replay.json?.code} statusTrongData=${replay.json?.data?.status}`
  );
  const afterReplay = await orderRow(lostId);
  check(
    'A2.2 đơn vẫn PENDING, tồn vật lý không đổi (client không được tin là đã bán)',
    afterReplay.status === 'PENDING_CONFIRMATION' &&
      (await InventoryService.getBalance('ed-adv-2', WH, 'NEW')) === physBefore
  );
  check(
    'A2.2 client sẽ giữ đơn + ảnh ở NEEDS_RECONCILIATION (IDEMPOTENCY_CONFLICT đã nằm trong RECONCILIATION_ERROR_CODES)',
    (await import('../src/lib/offline-db')).applySyncErrorToOfflineOrder(
      { paymentMethod: 'BANK_TRANSFER', moneyReceived: true } as any,
      'IDEMPOTENCY_CONFLICT'
    ) === 'NEEDS_RECONCILIATION'
  );

  // A2.3 Chiều vô hại phải giữ nguyên: replay CÙNG ngữ nghĩa vẫn trả bản ghi cũ.
  const sameReplay = await postAs({ ...lostResponseBody, confirmImmediately: false });
  check(
    'A2.3 replay cùng confirmImmediately=false vẫn idempotent (không hỏng happy path)',
    sameReplay.status === 200 && sameReplay.json.data.orderId === lostId,
    `status=${sameReplay.status}`
  );
  const cashDone = await postAs({
    warehouseId: WH,
    channel: 'RETAIL_OFFICE',
    customerName: 'Khách tiền mặt',
    paymentMethod: 'CASH',
    fiscalScope: 'INTERNAL_MANAGEMENT',
    cashboxSessionId: session.session.id,
    idempotencyKey: 'idem-adv-cash-done',
    items: [{ editionId: 'ed-adv-2', quantity: 1 }],
  });
  const cashReplay = await postAs({
    warehouseId: WH,
    channel: 'RETAIL_OFFICE',
    customerName: 'Khách tiền mặt',
    paymentMethod: 'CASH',
    fiscalScope: 'INTERNAL_MANAGEMENT',
    cashboxSessionId: session.session.id,
    idempotencyKey: 'idem-adv-cash-done',
    items: [{ editionId: 'ed-adv-2', quantity: 1 }],
  });
  check(
    'A2.3 replay đơn tiền mặt đã COMPLETED vẫn trả bản ghi cũ (không hỏng tiền mặt)',
    cashDone.json.data.status === 'COMPLETED' &&
      cashReplay.status === 200 &&
      cashReplay.json.data.orderId === cashDone.json.data.orderId
  );
  await OrderService.cancelOrder(lostId, 'ROLE_MANAGER', 'dọn sau test', MANAGER);

  // ============================== B1..B4: BẰNG CHỨNG (chưa sửa) ================
  console.log('\nB1-B4. BẰNG CHỨNG trần giữ ATP (chưa sửa — cần quyết định sản phẩm)');

  // B1. Đơn PENDING CHƯA THU TIỀN mọi phương thức (kể cả CASH/COD) đều bị trần
  //     SỐ LƯỢNG giữ chỗ — trước fix: 8 đơn CASH/COD, 0 lần 409, ATP giữ 48h.
  const b1Before = await OrderService.getATP('ed-adv-1', WH);
  const b1Ids: string[] = [];
  let b1RefusedCode = '';
  for (let i = 0; i < CAP_UNITS + 5 && !b1RefusedCode; i++) {
    try {
      const r = await OrderService.createOrder({
        warehouseId: WH,
        channel: 'RETAIL_ONLINE_WEB',
        paymentMethod: i % 2 === 0 ? 'CASH' : 'COD',
        cashierId: 'webhook-adv',
        confirmImmediately: false,
        idempotencyKey: `idem-adv-b1-${i}`,
        items: [{ editionId: 'ed-adv-1', quantity: 1 }],
      });
      b1Ids.push(r.orderId);
    } catch (e: any) {
      b1RefusedCode = e?.code || e?.message;
    }
  }
  const b1After = await OrderService.getATP('ed-adv-1', WH);
  check(
    `B1 PENDING CASH/COD cũng bị trần ${CAP_UNITS} cuốn: tạo được ${b1Ids.length} đơn (${b1Ids.length} cuốn giữ chỗ), đơn kế tiếp bị chặn ${b1RefusedCode}`,
    b1Ids.length === CAP_UNITS && b1RefusedCode === 'STATE_CONFLICT' && b1After === b1Before - CAP_UNITS,
    `ATP ${b1Before}→${b1After}`
  );
  // Đơn CASH tức thì (checkout tiền mặt) KHÔNG bị trần này chi phối.
  const b1CashImmediate = await OrderService.createOrder({
    warehouseId: WH,
    channel: 'RETAIL_OFFICE',
    paymentMethod: 'CASH',
    cashierId: 'webhook-adv',
    confirmImmediately: true,
    idempotencyKey: 'idem-adv-b1-cash-immediate',
    items: [{ editionId: 'ed-adv-1', quantity: 1 }],
  });
  check(
    'B1 checkout tiền mặt tức thì vẫn COMPLETED, không bị trần giữ chỗ chặn',
    (b1CashImmediate as any).status === 'COMPLETED'
  );
  // Đơn tiền mặt tức thì đã trừ 1 cuốn thật; mọi chỗ giữ phải được trả lại.
  for (const id of b1Ids) {
    await OrderService.cancelOrder(id, 'ROLE_MANAGER', 'dọn B1', MANAGER);
  }
  check(
    'B1 hủy hết đơn giữ chỗ thì ATP trả lại nguyên vẹn (trừ đúng 1 cuốn bán tiền mặt tức thì)',
    (await OrderService.getATP('ed-adv-1', WH)) === b1Before - 1,
    `ATP=${await OrderService.getATP('ed-adv-1', WH)} (kỳ vọng ${b1Before - 1})`
  );

  // B2. Một đơn quá khổng bị từ chối — trần đo SỐ LƯỢNG, không đo số dòng.
  //     Trước fix: 1 đơn 500 cuốn vẫn lọt (chỉ có trần 5 DÒNG).
  let b2BigCode = '';
  try {
    await OrderService.createOrder({
      warehouseId: WH3,
      channel: 'RETAIL_OFFICE',
      paymentMethod: 'BANK_TRANSFER',
    cashierId: CASHIER.staffId,
    actorContext: CASHIER,
    cashboxSessionId: sessionW3.session.id,
    confirmImmediately: false,
    idempotencyKey: 'idem-adv-b2-too-big',
      items: [{ editionId: 'ed-adv-1', quantity: CAP_UNITS + 1 }],
    });
  } catch (e: any) {
    b2BigCode = e?.code || e?.message;
  }
  check(
    `B2.1 một đơn ${CAP_UNITS + 1} cuốn bị từ chối (trước fix lọt vì chỉ đếm dòng)`,
    b2BigCode === 'STATE_CONFLICT',
    `kết quả=${b2BigCode}`
  );
  const b2Exact = await OrderService.createOrder({
    warehouseId: WH3,
    channel: 'RETAIL_OFFICE',
    paymentMethod: 'BANK_TRANSFER',
    cashierId: CASHIER.staffId,
    actorContext: CASHIER,
    cashboxSessionId: sessionW3.session.id,
    confirmImmediately: false,
    idempotencyKey: 'idem-adv-b2-exact',
    items: [{ editionId: 'ed-adv-1', quantity: CAP_UNITS }],
  });
  check(
    `B2.2 một đơn đúng bằng trần (${CAP_UNITS} cuốn) vẫn tạo được`,
    (b2Exact as any).status === 'PENDING_CONFIRMATION'
  );
  let b2NextCode = '';
  try {
    await OrderService.createOrder({
      warehouseId: WH3,
      channel: 'RETAIL_OFFICE',
      paymentMethod: 'QR_CODE',
      cashierId: CASHIER.staffId,
      actorContext: CASHIER,
      cashboxSessionId: sessionW3.session.id,
      confirmImmediately: false,
      idempotencyKey: 'idem-adv-b2-next',
      items: [{ editionId: 'ed-adv-1', quantity: 1 }],
    });
  } catch (e: any) {
    b2NextCode = e?.code || e?.message;
  }
  check('B2.3 đã đầy trần thì mọi đơn PENDING kế tiếp bị chặn', b2NextCode === 'STATE_CONFLICT', `${b2NextCode}`);
  await OrderService.cancelOrder(b2Exact.orderId, 'ROLE_MANAGER', 'dọn B2', MANAGER);
  const b2After = await OrderService.createOrder({
    warehouseId: WH3,
    channel: 'RETAIL_OFFICE',
    paymentMethod: 'BANK_TRANSFER',
    cashierId: CASHIER.staffId,
    actorContext: CASHIER,
    cashboxSessionId: sessionW3.session.id,
    confirmImmediately: false,
    idempotencyKey: 'idem-adv-b2-freed',
    items: [{ editionId: 'ed-adv-1', quantity: 1 }],
  });
  check('B2.4 hủy 1 đơn giải phóng đúng số lượng đã giữ', (b2After as any).status === 'PENDING_CONFIRMATION');
  await OrderService.cancelOrder(b2After.orderId, 'ROLE_MANAGER', 'dọn B2', MANAGER);

  // B2b. Manager/Owner vẫn miễn trần.
  const b2bManager = await OrderService.createOrder({
    warehouseId: WH3,
    channel: 'RETAIL_ONLINE_WEB',
    paymentMethod: 'BANK_TRANSFER',
    cashierId: MANAGER.staffId,
    actorContext: MANAGER,
    confirmImmediately: false,
    idempotencyKey: 'idem-adv-b2b-manager',
    items: [{ editionId: 'ed-adv-1', quantity: CAP_UNITS + 5 }],
  });
  check('B2b Manager miễn trần giữ chỗ', (b2bManager as any).status === 'PENDING_CONFIRMATION');
  await OrderService.cancelOrder(b2bManager.orderId, 'ROLE_MANAGER', 'dọn B2b', MANAGER);

  // B3. Cửa sổ 30 phút phải do KÊNH quyết định, không phải do client tùy chọn.
  const withSession = await postAs({
    warehouseId: WH,
    channel: 'RETAIL_OFFICE',
    customerName: 'B3 có két',
    paymentMethod: 'BANK_TRANSFER',
    confirmImmediately: false,
    cashboxSessionId: session.session.id,
    items: [{ editionId: 'ed-adv-1', quantity: 1 }],
  });
  const noSession = await postAs({
    warehouseId: WH,
    channel: 'RETAIL_OFFICE',
    customerName: 'B3 không két',
    paymentMethod: 'BANK_TRANSFER',
    confirmImmediately: false,
    items: [{ editionId: 'ed-adv-1', quantity: 1 }],
  });
  const onlineWeb = await postAs({
    warehouseId: WH,
    channel: 'RETAIL_ONLINE_WEB',
    customerName: 'B3 web',
    paymentMethod: 'BANK_TRANSFER',
    confirmImmediately: false,
    items: [{ editionId: 'ed-adv-1', quantity: 1 }],
  });
  const onlineSocial = await postAs({
    warehouseId: WH,
    channel: 'RETAIL_ONLINE_SOCIAL',
    customerName: 'B3 social',
    paymentMethod: 'QR_CODE',
    confirmImmediately: false,
    items: [{ editionId: 'ed-adv-1', quantity: 1 }],
  });
  const rowWith = await orderRow(withSession.json.data.orderId);
  const rowWeb = await orderRow(onlineWeb.json.data.orderId);
  const rowSocial = await orderRow(onlineSocial.json.data.orderId);
  const withMs = new Date(rowWith.paymentExpiresAt as string).getTime() - Date.now();
  const ttlOf = (row: any) =>
    OrderService.getPendingEffectiveExpiry({ createdAt: row.createdAt, paymentExpiresAt: row.paymentExpiresAt })!.getTime() -
    new Date(row.createdAt as string).getTime();
  const confirmAsCashier = async (id: string) => {
    try {
      await OrderService.confirmOrder(id, 'ROLE_CASHIER', CASHIER.staffId, CASHIER, proof());
      return 'ALLOWED';
    } catch (e: any) {
      return e?.code || e?.message;
    }
  };
  check(
    'B3.1 đơn quầy CÓ két → hạn ~30 phút',
    withMs > 29 * 60_000 && withMs <= 30 * 60_000,
    `còn ${Math.round(withMs / 60000)} phút`
  );
  check(
    'B3.2 đơn quầy client BỎ cashboxSessionId: server tự gắn ca đang mở nên đơn VẪN xác nhận được (không tạo ra đơn kẹt)',
    noSession.status === 200 &&
      (await orderRow(noSession.json.data.orderId)).cashboxSessionId === session.session.id,
    `status=${noSession.status} cashboxSessionId=${(await orderRow(noSession.json.data.orderId)).cashboxSessionId}`
  );
  check(
    'B3.2b và đơn đó xác nhận được ngay (không rơi vào bẫy "thấy QR, thu tiền, đơn kẹt")',
    (await confirmAsCashier(noSession.json.data.orderId)) === 'ALLOWED'
  );
  check(
    'B3.3 đơn web/social vẫn dùng TTL 48h (không đổi hành vi cũ)',
    rowWeb.paymentExpiresAt === null && ttlOf(rowWeb) === 48 * 3600_000 &&
      rowSocial.paymentExpiresAt === null && ttlOf(rowSocial) === 48 * 3600_000,
    `web=${rowWeb.paymentExpiresAt} social=${rowSocial.paymentExpiresAt}`
  );
  // B3.4 Đơn quầy gắn phiên két nhưng két đã đóng thì không được duyệt.
  const withSessionOrder = await postAs({
    warehouseId: WH,
    channel: 'RETAIL_OFFICE',
    customerName: 'B3 có két 2',
    paymentMethod: 'BANK_TRANSFER',
    confirmImmediately: false,
    cashboxSessionId: session.session.id,
    items: [{ editionId: 'ed-adv-1', quantity: 1 }],
  });
  await db
    .update(schema.cashboxSessions)
    .set({ status: 'CLOSED' })
    .where(eq(schema.cashboxSessions.id, session.session.id));
  const closedSessionCode = await confirmAsCashier(withSessionOrder.json.data.orderId);
  await db
    .update(schema.cashboxSessions)
    .set({ status: 'OPEN' })
    .where(eq(schema.cashboxSessions.id, session.session.id));
  check(
    'B3.4 đơn quầy gắn phiên két đã đóng vẫn bị chặn (két ca đã đóng)',
    closedSessionCode === 'STATE_CONFLICT',
    `kết quả=${closedSessionCode}`
  );
  check(
    'B3.4b mở lại két thì đơn cùng ca đó duyệt được (đường thật không bị chặn nhầm)',
    (await confirmAsCashier(withSessionOrder.json.data.orderId)) === 'ALLOWED'
  );
  // B3.5 Phòng thủ nhiều lớp: một dòng đơn quầy KHÔNG gắn phiên két (dữ liệu cũ
  // đã tồn tại từ trước, hoặc do quản lý tạo — quản lý được miễn rule ca két) thì
  // KHÔNG ai duyệt được, kể cả manager. Lưu ý: qua API/ HTTP thì loại đơn này
  // KHÔNG tạo được nữa (xem mục D) — case này chỉ bảo vệ dữ liệu cũ.
  const NO_SHIFT = { staffId: 'cashier-no-shift', role: 'ROLE_CASHIER' as const, fullName: 'Thu Ngân Không Ca' };
  const noShiftOrder = await OrderService.createOrder({
    warehouseId: WH3,
    channel: 'RETAIL_OFFICE',
    paymentMethod: 'BANK_TRANSFER',
    cashierId: MANAGER.staffId,
    actorContext: MANAGER,
    confirmImmediately: false,
    idempotencyKey: 'idem-adv-b35-no-shift',
    items: [{ editionId: 'ed-adv-1', quantity: 1 }],
  });
  let noShiftCode = '';
  try {
    await OrderService.confirmOrder(noShiftOrder.orderId, 'ROLE_MANAGER', MANAGER.staffId, MANAGER, proof());
    noShiftCode = 'ALLOWED';
  } catch (e: any) {
    noShiftCode = e?.code || e?.message;
  }
  check(
    'B3.5 đơn quầy không két KHÔNG ai duyệt được (kể cả manager) — không phải cửa sau',
    noShiftCode === 'STATE_CONFLICT',
    `kết quả=${noShiftCode}`
  );
  check(
    'B3.5b đơn bị từ chối vẫn PENDING, không trừ kho (không có doanh thu mồ côi)',
    (await orderRow(noShiftOrder.orderId)).status === 'PENDING_CONFIRMATION' &&
      (await ledgerOf(noShiftOrder.orderId)).length === 0
  );
  // B3.6 Nhưng phải HỦY được, nếu không đơn bị kẹt vĩnh viễn giữ ATP. Hủy không
  // ghi dấu doanh thu vào két nào nên vẫn được phép kể cả khi không có ca.
  let noShiftCancelCode = '';
  try {
    const res = await OrderService.cancelOrder(
      noShiftOrder.orderId,
      'ROLE_MANAGER',
      'khách bỏ, không mở ca',
      MANAGER
    );
    noShiftCancelCode = res.status === 'CANCELLED' ? 'CANCELLED' : res.status;
  } catch (e: any) {
    noShiftCancelCode = e?.message;
  }
  check(
    'B3.6 đơn quầy không két VẪN hủy được để không bị kẹt giữ ATP',
    noShiftCancelCode === 'CANCELLED' && (await OrderService.getATP('ed-adv-1', WH3)) === 100,
    `kết quả=${noShiftCancelCode} ATP=${await OrderService.getATP('ed-adv-1', WH3)}`
  );
  // B3.7 Web/social không bị guard két chi phối: vẫn xác nhận được khi không két.
  const webNoSession = await OrderService.createOrder({
    warehouseId: WH3,
    channel: 'RETAIL_ONLINE_WEB',
    paymentMethod: 'BANK_TRANSFER',
    cashierId: NO_SHIFT.staffId,
    actorContext: NO_SHIFT,
    confirmImmediately: false,
    idempotencyKey: 'idem-adv-b37-web',
    items: [{ editionId: 'ed-adv-1', quantity: 1 }],
  });
  const webConfirmed = await OrderService.confirmOrder(
    webNoSession.orderId,
    'ROLE_CASHIER',
    NO_SHIFT.staffId,
    NO_SHIFT,
    proof()
  );
  check(
    'B3.7 đơn web/social không gắn két vẫn duyệt được (guard chỉ cho đơn quầy)',
    webConfirmed.status === 'COMPLETED'
  );
  for (const row of [
    rowWith,
    rowWeb,
    rowSocial,
    await orderRow(withSessionOrder.json.data.orderId),
  ]) {
    if (row.status === 'PENDING_CONFIRMATION') {
      await OrderService.cancelOrder(row.id, 'ROLE_MANAGER', 'dọn B3', MANAGER);
    }
  }

  // B4. warehouseId do client gửi, không có ràng buộc thu ngân↔kho: trần nhân lên
  //     theo số kho. Sau rule "đơn quầy cần ca két", thu ngân phải mở ca ở TỪNG
  //     kho — nhưng CashboxService.openSession không kiểm tra thu ngân có được
  //     phép bán ở kho đó hay không, nên nhân vẫn còn (chỉ tốn thêm một thao tác).
  const b4Ids: string[] = [];
  const b4AtpBefore = [await OrderService.getATP('ed-adv-1', WH), await OrderService.getATP('ed-adv-1', 'wh-adv-2')];
  const b4Session: Record<string, string> = { [WH]: session.session.id, 'wh-adv-2': sessionW2.session.id };
  for (const wh of [WH, 'wh-adv-2']) {
    for (let i = 0; i < CAP_UNITS; i++) {
      const r = await postAs({
        warehouseId: wh,
        channel: 'RETAIL_OFFICE',
        customerName: `B4 ${wh} ${i}`,
        paymentMethod: 'BANK_TRANSFER',
        confirmImmediately: false,
        cashboxSessionId: b4Session[wh],
        items: [{ editionId: 'ed-adv-1', quantity: 1 }],
      });
      check(
        `B4 đơn ${b4Ids.length + 1}/${2 * CAP_UNITS} tại kho ${wh} được tạo`,
        r.status === 200,
        JSON.stringify(r.json).slice(0, 160)
      );
      b4Ids.push(r.json.data.orderId);
    }
  }
  const b4AtpAfter = [await OrderService.getATP('ed-adv-1', WH), await OrderService.getATP('ed-adv-1', 'wh-adv-2')];
  check(
    `B4 không có ràng buộc thu ngân↔kho: cùng một thu ngân giữ được ${2 * CAP_UNITS} cuốn bằng cách chia 2 kho (gấp đôi trần, nhưng vẫn bị chặn ở mức ${CAP_UNITS}/kho)`,
    b4Ids.length === 2 * CAP_UNITS &&
      b4AtpBefore[0] - b4AtpAfter[0] === CAP_UNITS &&
      b4AtpBefore[1] - b4AtpAfter[1] === CAP_UNITS,
    `ATP kho1 ${b4AtpBefore[0]}→${b4AtpAfter[0]}, kho2 ${b4AtpBefore[1]}→${b4AtpAfter[1]}`
  );
  for (const id of b4Ids) {
    await OrderService.cancelOrder(id, 'ROLE_MANAGER', 'dọn B4', MANAGER);
  }

  // ================================ B5. ATP phía confirm ======================
  console.log('\nB5. Chống âm ATP ở đường duyệt đơn (bằng chứng bằng trạng thái bán vượt mô phỏng)');
  // Đơn PENDING giữ 1 cuốn trên tồn vật lý 1. Người thứ hai không tạo được chỗ nữa.
  await db.update(schema.stockBalances).set({ physicalQuantity: 1 }).where(eq(schema.stockBalances.id, 'sb-adv-2'));
  const holdA = await OrderService.createOrder({
    warehouseId: WH,
    channel: 'RETAIL_OFFICE',
    paymentMethod: 'BANK_TRANSFER',
    cashierId: CASHIER.staffId,
    actorContext: CASHIER,
    cashboxSessionId: session.session.id,
    confirmImmediately: false,
    idempotencyKey: 'idem-adv-b5-a',
    items: [{ editionId: 'ed-adv-2', quantity: 1 }],
  });
  let b5Second = '';
  try {
    await OrderService.createOrder({
      warehouseId: WH,
      channel: 'RETAIL_OFFICE',
      paymentMethod: 'BANK_TRANSFER',
      cashierId: 'other-cashier-adv',
      cashboxSessionId: sessionOther.session.id,
      confirmImmediately: false,
      idempotencyKey: 'idem-adv-b5-b',
      items: [{ editionId: 'ed-adv-2', quantity: 1 }],
    });
    b5Second = 'ALLOWED';
  } catch (e: any) {
    b5Second = e?.code || e?.message;
  }
  check('B5.1 thu ngân thứ hai không tạo được chỗ trên cuốn đã bị giữ', b5Second === 'INSUFFICIENT_ATP', `${b5Second}`);
  // Mô phỏng hệ quả của race "2 tiến trình cùng đọc ATP=1": chèn thẳng hàng giữ chỗ
  // thứ hai (bỏ qua ATP như một race thật sẽ bỏ qua) rồi thử duyệt đơn A.
  await db.insert(schema.orders).values({
    id: 'ord-adv-b5-oversold',
    orderCode: 'ORD-B5-OVERSOLD',
    warehouseId: WH,
    subtotal: 100000,
    discountRate: 0,
    discountAmount: 0,
    finalAmount: 100000,
    paymentMethod: 'BANK_TRANSFER',
    fiscalScope: 'INTERNAL_MANAGEMENT',
    vatRate: 0,
    vatInvoiceRequired: false,
    status: 'PENDING_CONFIRMATION',
    syncStatus: 'SYNCED',
    cashierId: 'other-cashier-adv',
    idempotencyKey: 'idem-adv-b5-oversold',
    paymentExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  await db.insert(schema.orderItems).values({
    id: 'oi-adv-b5-oversold',
    orderId: 'ord-adv-b5-oversold',
    editionId: 'ed-adv-2',
    quantity: 1,
    unitCoverPrice: 100000,
    unitDiscountRate: 0,
    unitSellingPrice: 100000,
    totalAmount: 100000,
  });
  let b5Confirm = '';
  try {
    await OrderService.confirmOrder(holdA.orderId, 'ROLE_CASHIER', CASHIER.staffId, CASHIER, proof());
    b5Confirm = 'ALLOWED';
  } catch (e: any) {
    b5Confirm = e?.code || e?.message;
  }
  check(
    'B5.2 trạng thái bán vượt (race 2 tiến trình) bị chặn ở đường duyệt, tồn KHÔNG âm',
    b5Confirm === 'INSUFFICIENT_ATP' &&
      (await InventoryService.getBalance('ed-adv-2', WH, 'NEW')) === 1 &&
      (await ledgerOf(holdA.orderId)).length === 0,
    `confirm=${b5Confirm} tồn=${await InventoryService.getBalance('ed-adv-2', WH, 'NEW')}`
  );
  // Dọn: hủy cả hai, trả tồn về 100
  await OrderService.cancelOrder(holdA.orderId, 'ROLE_MANAGER', 'dọn B5', MANAGER);
  await db.update(schema.orders).set({ status: 'CANCELLED' }).where(eq(schema.orders.id, 'ord-adv-b5-oversold'));
  await db.update(schema.stockBalances).set({ physicalQuantity: 100 }).where(eq(schema.stockBalances.id, 'sb-adv-2'));

  // ======================= C. Trạng thái sau race: confirm/cancel =============
  console.log('\nC. Trạng thái sau race (xác định được trong 1 tiến trình)');
  const raceOrder = await OrderService.createOrder({
    warehouseId: WH,
    channel: 'RETAIL_OFFICE',
    paymentMethod: 'BANK_TRANSFER',
    cashboxSessionId: session.session.id,
    cashierId: CASHIER.staffId,
    actorContext: CASHIER,
    confirmImmediately: false,
    idempotencyKey: 'idem-adv-race',
    items: [{ editionId: 'ed-adv-1', quantity: 1 }],
  });
  const physRace = await InventoryService.getBalance('ed-adv-1', WH, 'NEW');
  const first = await OrderService.confirmOrder(raceOrder.orderId, 'ROLE_CASHIER', CASHIER.staffId, CASHIER, proof());
  const second = await OrderService.confirmOrder(raceOrder.orderId, 'ROLE_CASHIER', CASHIER.staffId, CASHIER, proof());
  const ledRace = await ledgerOf(raceOrder.orderId);
  check(
    'C.1 hai lần duyệt: trừ kho đúng MỘT lần, lần hai idempotent',
    first.status === 'COMPLETED' && (second as any).isIdempotent === true &&
      ledRace.length === 1 &&
      (await InventoryService.getBalance('ed-adv-1', WH, 'NEW')) === physRace - 1,
    `ledger=${ledRace.length} tồn=${await InventoryService.getBalance('ed-adv-1', WH, 'NEW')}`
  );
  let cancelAfterConfirm = '';
  try {
    await OrderService.cancelOrder(raceOrder.orderId, 'ROLE_CASHIER', 'hủy sau duyệt', CASHIER);
    cancelAfterConfirm = 'ALLOWED';
  } catch (e: any) {
    cancelAfterConfirm = e?.code || e?.message;
  }
  check(
    'C.2 hủy sau duyệt bị chặn, kho không bị trả lại',
    cancelAfterConfirm === 'STATE_CONFLICT' &&
      (await InventoryService.getBalance('ed-adv-1', WH, 'NEW')) === physRace - 1,
    `${cancelAfterConfirm}`
  );
  const raceOrder2 = await OrderService.createOrder({
    warehouseId: WH,
    channel: 'RETAIL_OFFICE',
    paymentMethod: 'BANK_TRANSFER',
    cashboxSessionId: session.session.id,
    cashierId: CASHIER.staffId,
    actorContext: CASHIER,
    confirmImmediately: false,
    idempotencyKey: 'idem-adv-race2',
    items: [{ editionId: 'ed-adv-1', quantity: 1 }],
  });
  await OrderService.cancelOrder(raceOrder2.orderId, 'ROLE_CASHIER', 'hủy trước', CASHIER);
  let confirmAfterCancel = '';
  try {
    await OrderService.confirmOrder(raceOrder2.orderId, 'ROLE_CASHIER', CASHIER.staffId, CASHIER, proof());
    confirmAfterCancel = 'ALLOWED';
  } catch (e: any) {
    confirmAfterCancel = e?.code || e?.message;
  }
  check(
    'C.3 duyệt sau hủy bị chặn, không sinh bút toán kho',
    confirmAfterCancel === 'STATE_CONFLICT' && (await ledgerOf(raceOrder2.orderId)).length === 0,
    `${confirmAfterCancel}`
  );
  const raceAudit = await auditOf(`aud-order-confirm-${raceOrder.orderId}`);
  check('C.4 retry duyệt không nhân bản dòng audit', !!raceAudit && raceAudit.actorId === CASHIER.staffId);

  // ============ D. TỪ CHỐI LÚC TẠO: đơn quầy PENDING cần ca két đang mở ========
  console.log('\nD. Đơn quầy PENDING không có ca két thì bị từ chối NGAY LÚC TẠO (bẫy im lặng)');
  const NO_SHIFT2 = { staffId: 'cashier-d-no-shift', role: 'ROLE_CASHIER' as const, fullName: 'Thu Ngân D' };
  const createAs = async (overrides: Record<string, any>, actor: any = NO_SHIFT2) => {
    try {
      const res = await OrderService.createOrder({
        warehouseId: WH3,
        channel: 'RETAIL_OFFICE',
        customerName: `D ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        paymentMethod: 'BANK_TRANSFER',
        cashierId: actor.staffId,
        actorContext: actor,
        confirmImmediately: false,
        items: [{ editionId: 'ed-adv-1', quantity: 1 }],
        ...overrides,
      });
      return { ok: true as const, res };
    } catch (e: any) {
      return { ok: false as const, code: e?.code as string, message: String(e?.message || '') };
    }
  };
  // D1. Thu ngân KHÔNG mở ca, đơn quầy chờ → từ chối, thông báo chỉ cách sửa.
  const dMessage = (r: { ok: boolean; code?: string; message?: string }) =>
    r.ok ? '' : String(r.message ?? r.code ?? '');
  const dAtpBefore = await OrderService.getATP('ed-adv-1', WH3);
  const d1 = await createAs({ idempotencyKey: 'idem-adv-d1' });
  const d1Message = dMessage(d1);
  const dAtpAfterD1 = await OrderService.getATP('ed-adv-1', WH3);
  check(
    'D1 thu ngân không mở ca tạo đơn quầy PENDING bị từ chối',
    !d1.ok && d1.code === 'STATE_CONFLICT' && /mở ca/i.test(d1Message),
    `code=${d1.ok ? 'ALLOWED' : d1.code} message=${d1Message.slice(0, 140)}`
  );
  check(
    'D1b lỗi 409 chặn ở HTTP (STATE_CONFLICT) chứ không phải 500',
    d1.ok === false && d1.code === 'STATE_CONFLICT'
  );
  // D2. Thông báo phải nói rõ cần MỞ CA (hành động được), không chỉ "lỗi".
  check('D2 thông báo có hành động được (mở ca)', !d1.ok && /mở ca/i.test(d1Message));
  // D3. Có ca mở ở đúng kho → tạo được.
  const d3 = await createAs(
    { idempotencyKey: 'idem-adv-d3', cashboxSessionId: sessionW3.session.id },
    { staffId: CASHIER.staffId, role: 'ROLE_CASHIER', fullName: CASHIER.fullName }
  );
  check(
    'D3 có ca mở ở đúng kho thì đơn quầy PENDING tạo được',
    d3.ok && (d3.res as any).status === 'PENDING_CONFIRMATION'
  );
  // D4. Ca tồn tại nhưng đã ĐÓNG → từ chối.
  await db
    .update(schema.cashboxSessions)
    .set({ status: 'CLOSED' })
    .where(eq(schema.cashboxSessions.id, sessionW3.session.id));
  const d4 = await createAs({ idempotencyKey: 'idem-adv-d4' });
  await db
    .update(schema.cashboxSessions)
    .set({ status: 'OPEN' })
    .where(eq(schema.cashboxSessions.id, sessionW3.session.id));
  check(
    'D4 ca tồn tại nhưng đã ĐÓNG thì đơn quầy PENDING bị từ chối',
    !d4.ok && d4.code === 'STATE_CONFLICT',
    `code=${d4.code}`
  );
  // D5. Ca mở ở kho KHÁC không cứu được đơn của kho này.
  const d5 = await createAs({ warehouseId: 'wh-adv-2', idempotencyKey: 'idem-adv-d5' });
  check(
    'D5 ca mở ở kho khác không giúp được: đơn quầy của kho không có ca vẫn bị từ chối',
    !d5.ok && d5.code === 'STATE_CONFLICT',
    `code=${d5.code}`
  );
  // D6. Bán tiền mặt tức thì vẫn được không cần ca (quầy lịch sử cho phép).
  const d6 = await createAs({
    idempotencyKey: 'idem-adv-d6',
    paymentMethod: 'CASH',
    confirmImmediately: true,
  });
  check(
    'D6 bán tiền mặt tức thì KHÔNG cần ca két (không đổi hành vi quầy)',
    d6.ok && (d6.res as any).status === 'COMPLETED',
    d6.ok ? `status=${(d6.res as any).status}` : `code=${d6.code}`
  );
  // D7. Đơn tặng tức thì cũng vậy (tạo bởi quản lý vì chiết khấu 100% vượt trần
  //     20% — quy tắc discount có sẵn, không liên quan rule ca két).
  const d7 = await createAs(
    {
      idempotencyKey: 'idem-adv-d7',
      paymentMethod: 'CASH',
      confirmImmediately: true,
      isGift: true,
      giftReason: 'tặng khách VIP',
      discountRate: 1,
    },
    MANAGER
  );
  check(
    'D7 đơn tặng tức thì KHÔNG cần ca két',
    d7.ok && (d7.res as any).status === 'COMPLETED',
    d7.ok ? `status=${(d7.res as any).status}` : `code=${d7.code} message=${dMessage(d7).slice(0, 120)}`
  );
  // D8. Đơn số tức thì (chuyển khoản + đã thu + có ảnh) — đường sync offline — vẫn
  // chạy được không ca: nó chốt ngay, không giữ ATP, không kẹt.
  const d8 = await createAs({
    idempotencyKey: 'idem-adv-d8',
    confirmImmediately: true,
    moneyReceived: true,
    paymentProofId: 'proof-d8',
    paymentProofCapturedAt: new Date().toISOString(),
  });
  check(
    'D8 đơn chuyển khoản chốt ngay có proof vẫn tạo được không ca (đường sync offline)',
    d8.ok && (d8.res as any).status === 'COMPLETED',
    d8.ok ? `status=${(d8.res as any).status}` : `code=${d8.code} message=${dMessage(d8).slice(0, 160)}`
  );
  // D9. Web/social PENDING không cần ca (48h như cũ).
  const d9 = await createAs({
    idempotencyKey: 'idem-adv-d9',
    channel: 'RETAIL_ONLINE_WEB',
    confirmImmediately: false,
  });
  const d9b = await createAs({
    idempotencyKey: 'idem-adv-d9b',
    channel: 'RETAIL_ONLINE_SOCIAL',
    confirmImmediately: false,
  });
  check(
    'D9 đơn web/social PENDING không cần ca két vẫn tạo được',
    d9.ok && (d9.res as any).status === 'PENDING_CONFIRMATION' &&
      d9b.ok && (d9b.res as any).status === 'PENDING_CONFIRMATION',
    `web=${d9.ok} social=${d9b.ok}`
  );
  // D10. Owner/Manager giữ nguyên phạm vi: vẫn tạo được đơn quầy PENDING không ca,
  //      và vẫn hủy được đơn của người khác.
  const d10 = await createAs({ idempotencyKey: 'idem-adv-d10' }, MANAGER);
  check(
    'D10 Owner/Manager không bị rule ca két khi tạo (phạm vi quản lý giữ nguyên)',
    d10.ok && (d10.res as any).status === 'PENDING_CONFIRMATION',
    d10.ok ? `status=${(d10.res as any).status}` : `code=${d10.code}`
  );
  const d10c = await OrderService.cancelOrder(
    (d10.res as any).orderId,
    'ROLE_MANAGER',
    'dọn D10',
    MANAGER
  );
  check('D10b Owner/Manager vẫn hủy được đơn của người khác', d10c.status === 'CANCELLED');
  // D11. Từ chối lúc tạo phải sạch: không có dòng đơn, không giữ ATP.
  const d1Rows = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.idempotencyKey, 'idem-adv-d1'));
  check(
    'D11 đơn bị từ chối lúc tạo không để lại dòng đơn nào',
    d1Rows.length === 0
  );
  check(
    'D11b ATP của kho không bị giữ bởi đơn bị từ chối (đo ngay sau khi từ chối)',
    dAtpAfterD1 === dAtpBefore,
    `ATP ${dAtpBefore}→${dAtpAfterD1}`
  );
  // D12. Từ chối lúc tạo không tiêu hết trần giữ chỗ của người đó (không "chống spam").
  const noShiftHolds = await db
    .select()
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.status, 'PENDING_CONFIRMATION'),
        eq(schema.orders.cashierId, NO_SHIFT2.staffId),
        eq(schema.orders.channel, 'RETAIL_OFFICE')
      )
    );
  check(
    'D12 người bị từ chối không bị tính vào hàng đơn chờ (không mất trần vì lỗi)',
    noShiftHolds.length === 0
  );
  for (const r of [d3, d9, d9b]) {
    if (r.ok) {
      await OrderService.cancelOrder((r.res as any).orderId, 'ROLE_MANAGER', 'dọn D', MANAGER);
    }
  }

  raw.close();
  console.log(`\nTRANSFER PAYMENT ADVERSARIAL: ${passed}/${passed + failed} checks ${failed === 0 ? 'PASS' : 'FAIL'}`);
  if (failed > 0) process.exit(1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
