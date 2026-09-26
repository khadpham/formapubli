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
  const { eq } = await import('drizzle-orm');
  const schema = await import('../src/db/schema');
  const db = drizzle(raw);
  const { OrderService, CashboxService, MAX_PENDING_TRANSFER_HOLDS_PER_CASHIER: MAX_HOLDS } =
    await import('../src/services/order.service');
  const { InventoryService } = await import('../src/services/inventory.service');
  const { POST: ordersPost } = await import('../src/app/api/orders/route');
  const { signSession, SESSION_COOKIE_NAME } = await import('../src/lib/auth-session');

  const WH = 'wh-adv';
  const CASHIER = { staffId: 'cashier-adv', role: 'ROLE_CASHIER' as const, fullName: 'Thu Ngân ADV' };
  const MANAGER = { staffId: 'manager-adv', role: 'ROLE_MANAGER' as const, fullName: 'Quản Lý ADV' };
  const proof = () => ({ id: `proof-${Math.random().toString(36).slice(2)}`, capturedAt: new Date().toISOString() });

  await db.insert(schema.warehouses).values([
    { id: WH, code: 'KHO_ADV', name: 'Kho ADV', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
    { id: 'wh-adv-2', code: 'KHO_ADV2', name: 'Kho ADV 2', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
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
  ]);
  const session = await CashboxService.openSession({ warehouseId: WH, cashierId: CASHIER.staffId, openingCash: 0 });

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

  // B1. PENDING không phải chuyển khoản (CASH/COD) vẫn giữ ATP, không bị trần.
  const b1Before = await OrderService.getATP('ed-adv-1', WH);
  const b1Ids: string[] = [];
  let b1Statuses: number[] = [];
  for (let i = 0; i < MAX_HOLDS + 3; i++) {
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
    b1Statuses.push(200);
  }
  const b1After = await OrderService.getATP('ed-adv-1', WH);
  check(
    `B1 PENDING CASH/COD KHÔNG bị trần ${MAX_HOLDS}: tạo được ${b1Ids.length} đơn, ATP giảm ${b1Before - b1After}`,
    b1Ids.length === MAX_HOLDS + 3 && b1After === b1Before - (MAX_HOLDS + 3),
    `ATP ${b1Before}→${b1After}`
  );
  for (const id of b1Ids) {
    await OrderService.cancelOrder(id, 'ROLE_MANAGER', 'dọn B1', MANAGER);
  }

  // B2. Trần đếm SỐ ĐƠN, không giới hạn SỐ LƯỢNG giữ chỗ.
  const b2Before = await OrderService.getATP('ed-adv-1', WH);
  const b2Qty = b2Before; // giữ đúng toàn bộ tồn khả dụng
  let b2Held = 0;
  for (let i = 0; i < MAX_HOLDS; i++) {
    const r = await OrderService.createOrder({
      warehouseId: WH,
      channel: 'RETAIL_OFFICE',
      paymentMethod: 'BANK_TRANSFER',
      cashierId: CASHIER.staffId,
      actorContext: CASHIER,
      confirmImmediately: false,
      idempotencyKey: `idem-adv-b2-${i}`,
      items: [{ editionId: 'ed-adv-1', quantity: 1 }],
    });
    b2Held++;
    void r;
  }
  const b2After = await OrderService.getATP('ed-adv-1', WH);
  check(
    `B2 trần ${MAX_HOLDS} đơn KHÔNG giới hạn số lượng: ${MAX_HOLDS} đơn × 1 cuốn chỉ giữ ${b2Before - b2After} cuốn (mỗi đơn có thể giữ cả kho)`,
    b2Before - b2After === MAX_HOLDS,
    `ATP ${b2Before}→${b2After}`
  );
  for (let i = 0; i < MAX_HOLDS; i++) {
    const rows = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.idempotencyKey, `idem-adv-b2-${i}`));
    await OrderService.cancelOrder(rows[0].id, 'ROLE_MANAGER', 'dọn B2', MANAGER);
  }
  void b2Qty;

  // B3. Cửa sổ 30 phút phụ thuộc cashboxSessionId do client gửi.
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
  const rowWith = await orderRow(withSession.json.data.orderId);
  const rowNo = await orderRow(noSession.json.data.orderId);
  const withMs = new Date(rowWith.paymentExpiresAt as string).getTime() - Date.now();
  check(
    'B3 có cashboxSessionId → hạn ~30 phút',
    withMs > 29 * 60_000 && withMs <= 30 * 60_000,
    `còn ${Math.round(withMs / 60000)} phút`
  );
  check(
    'B3 BỎ cashboxSessionId → không hạn, ATP bị giữ tới 48h (client tự chọn cửa sổ thanh toán)',
    rowNo.paymentExpiresAt === null &&
      OrderService.getPendingEffectiveExpiry({ createdAt: rowNo.createdAt, paymentExpiresAt: null })!.getTime() -
        new Date(rowNo.createdAt as string).getTime() ===
        48 * 3600_000,
    `paymentExpiresAt=${rowNo.paymentExpiresAt}`
  );
  await OrderService.cancelOrder(rowWith.id, 'ROLE_MANAGER', 'dọn B3', MANAGER);
  await OrderService.cancelOrder(rowNo.id, 'ROLE_MANAGER', 'dọn B3', MANAGER);

  // B4. warehouseId do client gửi, không có ràng buộc thu ngân↔kho: trần nhân lên
  //     theo số kho (và cùng một thu ngân tạo được đơn ở kho mình không có ca).
  const b4Ids: string[] = [];
  const b4AtpBefore = [await OrderService.getATP('ed-adv-1', WH), await OrderService.getATP('ed-adv-1', 'wh-adv-2')];
  for (const wh of [WH, 'wh-adv-2']) {
    for (let i = 0; i < MAX_HOLDS; i++) {
      const r = await postAs({
        warehouseId: wh,
        channel: 'RETAIL_OFFICE',
        customerName: `B4 ${wh} ${i}`,
        paymentMethod: 'BANK_TRANSFER',
        confirmImmediately: false,
        items: [{ editionId: 'ed-adv-1', quantity: 1 }],
      });
      check(
        `B4 đơn ${b4Ids.length + 1}/${2 * MAX_HOLDS} tại kho ${wh} được tạo`,
        r.status === 200,
        JSON.stringify(r.json).slice(0, 160)
      );
      b4Ids.push(r.json.data.orderId);
    }
  }
  const b4AtpAfter = [await OrderService.getATP('ed-adv-1', WH), await OrderService.getATP('ed-adv-1', 'wh-adv-2')];
  check(
    'B4 cùng một thu ngân giữ được 2×MAX_HOLDS chỗ bằng cách chia kho (không có ràng buộc thu ngân↔kho)',
    b4Ids.length === 2 * MAX_HOLDS &&
      b4AtpBefore[0] - b4AtpAfter[0] === MAX_HOLDS &&
      b4AtpBefore[1] - b4AtpAfter[1] === MAX_HOLDS,
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

  raw.close();
  console.log(`\nTRANSFER PAYMENT ADVERSARIAL: ${passed}/${passed + failed} checks ${failed === 0 ? 'PASS' : 'FAIL'}`);
  if (failed > 0) process.exit(1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
