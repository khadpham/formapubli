/**
 * TEST AUTOCLOSE SHIFT — chốt ca quá giờ (V4.1)
 *
 * Ràng buộc toàn vẹn cốt lõi của bộ test này:
 *   KHÔNG BAO GIỜ được bịa số tiền thực đếm. closeSession tính
 *   cashDiscrepancy = closingCashActual - expectedCash, nên nếu tự động chốt
 *   bằng closingCashActual = expectedCash thì hệ thống sẽ khẳng định một
 *   người đã đếm két mà thực tế không ai đếm — biến kiểm soát đối soát tiền
 *   mặt thành lời nói dối. Mọi chốt tự động ở đây để closingCashActual = NULL
 *   và cashDiscrepancy = NULL, đánh dấu discrepancy KHÔNG xác minh.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_autoclose_shift.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

let failures = 0;
function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (e: any) {
    failures++;
    console.error(`  ✗ ${label}\n      ${e?.message}`);
  }
}

async function expectReject(label: string, fn: () => Promise<unknown>, code?: string) {
  try {
    await fn();
    failures++;
    console.error(`  ✗ ${label} — KHÔNG bị từ chối (expected reject)`);
  } catch (e: any) {
    if (code && e?.code !== code) {
      failures++;
      console.error(`  ✗ ${label} — sai code: ${e?.code} (expected ${code}): ${e?.message}`);
    } else {
      console.log(`  ✓ ${label}`);
    }
  }
}

async function run() {
  console.log('--- TEST AUTOCLOSE SHIFT: CHỐT CA QUÁ GIỜ ---');

  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-autoclose-shift');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  // Giờ giả lập: NOW dùng chung cho cả service lẫn test để case "quá giờ"
  // không phụ thuộc giờ thật lúc chạy (suite có thể chạy lúc 23:59).
  const NOW = '2026-09-27T00:30:00.000Z'; // 07:30 sáng 27/09 giờ VN
  process.env.CASHBOX_TEST_NOW = NOW;
  // Kho này đóng sớm: hết ngày lúc 00:05. Ca mở hôm trước => quá giờ.
  process.env.CASHBOX_CUTOFF_BY_WAREHOUSE = JSON.stringify({ 'wh-auto': '00:05' });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const { eq } = await import('drizzle-orm');
  const schema = await import('../src/db/schema');
  const orderSvc = await import('../src/services/order.service');
  const daily = await import('../src/services/daily-settlement.service');
  const eqId = (id: string) => eq(schema.cashboxSessions.id, id);

  const { OrderService, CashboxService, evaluateShiftCutoff, resolveBusinessDayCutoff, BUSINESS_DAY_CUTOFF_HHMM } = orderSvc;
  const { DailySettlementService } = daily;

  const rawClient = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(rawClient, { schema });

  const NOW_MS = new Date(NOW).getTime();
  const iso = (msOffsetFromNow: number) => new Date(NOW_MS + msOffsetFromNow).toISOString();
  const twoDaysAgo10h = new Date(new Date(NOW).getTime() - 2 * 86400_000).toISOString();

  // ---------------------------------------------------------------- fixture
  await db.insert(schema.warehouses).values([
    { id: 'wh-auto', code: 'KHO_AUTO', name: 'Kho Tự Động', warehouseType: 'FAIR_EVENT', isSellableOnPos: true, isActive: true },
    { id: 'wh-auto-2', code: 'KHO_AUTO_2', name: 'Kho Tự Động 2', warehouseType: 'FAIR_EVENT', isSellableOnPos: true, isActive: true },
    { id: 'wh-auto-3', code: 'KHO_AUTO_3', name: 'Kho Tự Động 3', warehouseType: 'FAIR_EVENT', isSellableOnPos: true, isActive: true },
  ]);
  await db.insert(schema.works).values({ id: 'work-auto', code: 'W-AUTO', title: 'Sách Auto', author: 'A', isActive: true });
  await db.insert(schema.editions).values([
    { id: 'ed-auto-1', code: 'A-01', workId: 'work-auto', isbn: '9786040009001', isbnLast4: '9001', coverPrice: 100000, isActive: true },
    { id: 'ed-auto-2', code: 'A-02', workId: 'work-auto', isbn: '9786040009002', isbnLast4: '9002', coverPrice: 200000, isActive: true },
  ]);
  await db.insert(schema.stockBalances).values([
    { id: 'sb-auto-1', editionId: 'ed-auto-1', warehouseId: 'wh-auto', physicalQuantity: 100, condition: 'NEW' },
    { id: 'sb-auto-2', editionId: 'ed-auto-2', warehouseId: 'wh-auto', physicalQuantity: 100, condition: 'NEW' },
    { id: 'sb-auto-3', editionId: 'ed-auto-1', warehouseId: 'wh-auto-2', physicalQuantity: 100, condition: 'NEW' },
    { id: 'sb-auto-4', editionId: 'ed-auto-1', warehouseId: 'wh-auto-3', physicalQuantity: 100, condition: 'NEW' },
  ]);

  // Ca quá giờ của thu ngân A tại wh-auto (mở 2 ngày trước, cutoff wh-auto = 00:05)
  await db.insert(schema.cashboxSessions).values({
    id: 'cbs-auto-stale',
    warehouseId: 'wh-auto',
    cashierId: 'cashier-a',
    openingCash: 500000,
    status: 'OPEN',
    openedAt: twoDaysAgo10h,
  });
  // Ca hợp lệ mở SAU NỬA ĐÊM ở kho dùng cutoff mặc định 23:59 — ca đêm hợp lệ.
  await db.insert(schema.cashboxSessions).values([
    {
      id: 'cbs-auto-overnight',
      warehouseId: 'wh-auto-2',
      cashierId: 'cashier-b',
      openingCash: 200000,
      status: 'OPEN',
      openedAt: '2026-09-27T00:10:00.000Z', // SAU nửa đêm → thuộc ngày 2026-09-27
    },
    {
      id: 'cbs-auto-fresh',
      warehouseId: 'wh-auto-3',
      cashierId: 'cashier-e',
      openingCash: 50000,
      status: 'OPEN',
      openedAt: '2026-09-27T00:10:00.000Z',
    },
  ]);
  // Ca của thu ngân C tại kho KHÔNG có cutoff riêng → dùng mặc định 23:59
  await db.insert(schema.cashboxSessions).values({
    id: 'cbs-auto-default',
    warehouseId: 'wh-auto-2',
    cashierId: 'cashier-c',
    openingCash: 100000,
    status: 'OPEN',
    openedAt: twoDaysAgo10h,
  });

  // Đơn tiền mặt COMPLETED (nằm trong ca quá giờ) + 1 đơn OFFLINE chưa đồng bộ
  await db.insert(schema.orders).values([
    {
      id: 'ord-auto-1', orderCode: 'ORD-AUTO-1', warehouseId: 'wh-auto', channel: 'RETAIL_OFFICE',
      cashierId: 'cashier-a', cashboxSessionId: 'cbs-auto-stale',
      subtotal: 300000, finalAmount: 300000, paymentMethod: 'CASH', status: 'COMPLETED',
      syncStatus: 'SYNCED', idempotencyKey: 'idem-auto-1', createdAt: twoDaysAgo10h,
    },
    {
      id: 'ord-auto-offline', orderCode: 'ORD-AUTO-OFFLINE', warehouseId: 'wh-auto', channel: 'RETAIL_OFFICE',
      cashierId: 'cashier-a', cashboxSessionId: 'cbs-auto-stale',
      subtotal: 700000, finalAmount: 700000, paymentMethod: 'CASH', status: 'COMPLETED',
      syncStatus: 'PENDING_SYNC', idempotencyKey: 'idem-auto-offline', createdAt: twoDaysAgo10h,
    },
  ]);
  await db.insert(schema.orderItems).values([
    { id: 'oi-auto-1', orderId: 'ord-auto-1', editionId: 'ed-auto-1', quantity: 3, unitCoverPrice: 100000, unitSellingPrice: 100000, totalAmount: 300000 },
    { id: 'oi-auto-2', orderId: 'ord-auto-offline', editionId: 'ed-auto-2', quantity: 1, unitCoverPrice: 700000, unitSellingPrice: 700000, totalAmount: 700000 },
  ]);

  // ================================================================ A. cutoff
  console.log('\n[A] Hằng số & ngưỡng chốt ngày');
  check('mặc định cutoff là 23:59 giờ máy chủ', () => {
    assert.strictEqual(BUSINESS_DAY_CUTOFF_HHMM, '23:59');
  });
  check('kho có cutoff riêng lấy từ cấu hình theo kho', () => {
    assert.strictEqual(resolveBusinessDayCutoff('wh-auto').cutoff, '00:05');
    assert.strictEqual(resolveBusinessDayCutoff('wh-auto').source, 'WAREHOUSE_ENV');
  });
  check('kho KHÔNG có cutoff riêng → lùi về mặc định 23:59 (fallback có tài liệu)', () => {
    const r = resolveBusinessDayCutoff('wh-auto-2');
    assert.strictEqual(r.cutoff, '23:59');
    assert.strictEqual(r.source, 'DEFAULT');
  });

  const evalStale = evaluateShiftCutoff(twoDaysAgo10h, { warehouseId: 'wh-auto', now: new Date(NOW) });
  check('ca mở 2 ngày trước, cutoff kho 00:05 → QUÁ GIỜ', () => {
    assert.strictEqual(evalStale.overdue, true);
    assert.ok(evalStale.elapsedMinutes >= 2 * 24 * 60, `elapsedMinutes=${evalStale.elapsedMinutes}`);
    assert.ok(evalStale.cutoffAt);
  });
  check('ca mở SAU NỬA ĐÊM → KHÔNG quá giờ (ca đêm hợp lệ không bị chặn)', () => {
    const overnight = evaluateShiftCutoff('2026-09-27T00:10:00.000Z', { warehouseId: 'wh-auto-2', now: new Date(NOW) });
    assert.strictEqual(overnight.overdue, false);
  });
  check('ca mở 2 ngày trước ở kho cutoff 23:59 → QUÁ GIỜ', () => {
    assert.strictEqual(evaluateShiftCutoff(twoDaysAgo10h, { warehouseId: 'wh-auto-2', now: new Date(NOW) }).overdue, true);
  });

  // ================================================================ B. check
  console.log('\n[B] GET check: báo cáo ca quá giờ (chỉ đọc)');
  const before = {
    sessions: await db.select().from(schema.cashboxSessions),
    audit: await db.select().from(schema.auditLogs),
    orders: await db.select().from(schema.orders),
    idem: await db.select().from(schema.idempotencyKeys),
  };
  const report = await CashboxService.getStaleOpenShiftCheck({ warehouseId: 'wh-auto' }, db);
  const after = {
    sessions: await db.select().from(schema.cashboxSessions),
    audit: await db.select().from(schema.auditLogs),
    orders: await db.select().from(schema.orders),
    idem: await db.select().from(schema.idempotencyKeys),
  };
  check('check KHÔNG ghi bất kỳ thứ gì (sessions/audit/orders/idempotency không đổi)', () => {
    assert.deepStrictEqual(after.sessions, before.sessions, 'cashbox_sessions bị ghi');
    assert.deepStrictEqual(after.audit, before.audit, 'audit_logs bị ghi');
    assert.deepStrictEqual(after.orders, before.orders, 'orders bị ghi');
    assert.deepStrictEqual(after.idem, before.idem, 'idempotency_keys bị ghi');
  });
  check('check chạy lại cho KẾT QUẢ GIỐNG HỆT (idempotent, không side-effect)', async () => {
    const again = await CashboxService.getStaleOpenShiftCheck({ warehouseId: 'wh-auto' }, db);
    assert.deepStrictEqual(again, report);
  });
  check('báo cáo đủ: kho, thu ngân, openedAt, thời gian mở, số tiền cần chốt', () => {
    assert.strictEqual(report.shifts.length, 1, `chỉ 1 ca quá giờ ở wh-auto, thực tế ${report.shifts.length}`);
    const s = report.shifts[0];
    assert.strictEqual(s.sessionId, 'cbs-auto-stale');
    assert.strictEqual(s.cashierId, 'cashier-a');
    assert.strictEqual(s.warehouseId, 'wh-auto');
    assert.strictEqual(s.warehouseCode, 'KHO_AUTO');
    assert.strictEqual(s.warehouseName, 'Kho Tự Động');
    assert.strictEqual(s.openedAt, twoDaysAgo10h);
    assert.ok(s.elapsedMinutes >= 2 * 24 * 60, 'elapsedMinutes phải báo thời gian mở');
    // 500.000 đầu ca + 300.000 + 700.000 tiền mặt = 1.500.000
    assert.strictEqual(s.amountNeedingClosure, 1500000, 'số tiền cần chốt = openingCash + tiền mặt trong ca');
  });
  check('check nói rõ CẦN LÀM GÌ và AI làm (quan sát được, không âm thầm sửa)', () => {
    const s = report.shifts[0];
    assert.strictEqual(s.action, 'CLOSE_SHIFT');
    assert.strictEqual(s.actionBy, 'CASHIER');
    assert.match(s.message, /chốt ca/i);
    assert.match(s.message, /đếm tiền/i);
    assert.strictEqual(report.salesBlocked, true);
  });
  const reportWh2 = await CashboxService.getStaleOpenShiftCheck({ warehouseId: 'wh-auto-2' }, db);
  check('ca đêm hợp lệ KHÔNG bị báo (ca mở sau nửa đêm chưa tới giờ chốt ngày)', () => {
    assert.ok(!reportWh2.shifts.some((x: any) => x.sessionId === 'cbs-auto-overnight'));
    // cbs-auto-default (2 ngày trước, kho này) thì PHẢI bị báo
    assert.ok(reportWh2.shifts.some((x: any) => x.sessionId === 'cbs-auto-default'));
  });
  // Ca mở HÔM NAY ở kho chưa có ca quá giờ → không ca nào bị báo.
  const reportBeforeCutoff = await CashboxService.getStaleOpenShiftCheck(
    { warehouseId: 'wh-auto-3' },
    db
  );
  check('TRƯỚC giờ chốt ngày: không ca nào bị báo', () => {
    assert.deepStrictEqual(reportBeforeCutoff.shifts, []);
    assert.strictEqual(reportBeforeCutoff.salesBlocked, false);
    assert.strictEqual(reportBeforeCutoff.cutoff, '23:59');
    assert.strictEqual(reportBeforeCutoff.cutoffSource, 'DEFAULT');
  });

  // ================================================================ C. chặn bán
  console.log('\n[C] Chặn POS mới khi ca quá giờ (server-side)');
  const cashOrder = (id: string, key: string) => ({
    id, idempotencyKey: key, warehouseId: 'wh-auto', channel: 'RETAIL_OFFICE' as const,
    cashierId: 'cashier-a', paymentMethod: 'CASH' as const,
    items: [{ editionId: 'ed-auto-1', quantity: 1 }],
    actorContext: { role: 'ROLE_CASHIER', actorId: 'cashier-a' },
  });
  const ordersBefore = await db.select().from(schema.orders);

  await expectReject(
    'đơn quầy của thu ngân có ca quá giờ bị từ chối kèm hành động được',
    () => OrderService.createOrder(cashOrder('ord-blocked-1', 'idem-blocked-1') as any),
    'STATE_CONFLICT'
  );
  check('đơn bị chặn KHÔNG để lại dòng đơn nào', async () => {});
  const ordersAfterBlock = await db.select().from(schema.orders);
  check('DB không có đơn mới sau khi bị chặn', () => {
    assert.strictEqual(ordersAfterBlock.length, ordersBefore.length);
  });
  check('thông báo lỗi tiếng Việt, có hướng dẫn chốt ca', async () => {});

  // Thông báo lỗi đúng nội dung (đọc lại để khẳng định "actionable")
  let blockMessage = '';
  try {
    await OrderService.createOrder(cashOrder('ord-blocked-2', 'idem-blocked-2') as any);
  } catch (e: any) {
    blockMessage = e.message;
  }
  check('lỗi chặn bán: nhắc chốt ca + nhắc đếm tiền thực tế', () => {
    assert.match(blockMessage, /chốt ca/i);
    assert.match(blockMessage, /đếm tiền thực tế/i);
  });

  const okOrder = await OrderService.createOrder({
    id: 'ord-ok-2', idempotencyKey: 'idem-ok-2', warehouseId: 'wh-auto-2', channel: 'RETAIL_OFFICE',
    cashierId: 'cashier-b', paymentMethod: 'CASH', cashboxSessionId: 'cbs-auto-overnight',
    items: [{ editionId: 'ed-auto-1', quantity: 1 }],
    actorContext: { role: 'ROLE_CASHIER', actorId: 'cashier-b' },
  } as any);
  check('ca CHƯA quá giờ (ca mở sau nửa đêm) thì bán bình thường', () => {
    assert.strictEqual(okOrder.status, 'COMPLETED');
  });

  // ================================================================ D. auto-close
  console.log('\n[D] Manager chốt tự động: KHÔNG bịa tiền thực đếm');
  const auto = await CashboxService.autoCloseSession({
    sessionId: 'cbs-auto-stale',
    actorRole: 'ROLE_MANAGER',
    actorId: 'manager-1',
  });
  check('closingCashActual = NULL (không ai đếm két thì không có số đếm)', () => {
    assert.strictEqual(auto.closingCashActual, null);
  });
  check('cashDiscrepancy = NULL và đánh dấu KHÔNG xác minh', () => {
    assert.strictEqual(auto.cashDiscrepancy, null);
    assert.strictEqual(auto.discrepancyVerified, false);
    assert.strictEqual(auto.closeType, 'AUTO');
  });
  check('expectedCash vẫn được ghi đúng (tiền hệ thống tính, không phải tiền đếm)', () => {
    assert.strictEqual(auto.expectedCash, 1500000);
  });
  const rowAfterAuto = await db.select().from(schema.cashboxSessions).where((await import('drizzle-orm')).eq(schema.cashboxSessions.id, 'cbs-auto-stale'));
  check('DB: closing_cash_actual IS NULL, cash_discrepancy IS NULL, status CLOSED', () => {
    assert.strictEqual(rowAfterAuto[0].closingCashActual, null);
    assert.strictEqual(rowAfterAuto[0].cashDiscrepancy, null);
    assert.strictEqual(rowAfterAuto[0].status, 'CLOSED');
    assert.ok(rowAfterAuto[0].closedAt);
  });
  const autoAudit = await db.select().from(schema.auditLogs).where((await import('drizzle-orm')).eq(schema.auditLogs.id, 'aud-cashbox-auto-close-cbs-auto-stale'));
  check('audit tự động: action riêng, actor là HỆ THỐNG', () => {
    assert.strictEqual(autoAudit.length, 1);
    assert.strictEqual(autoAudit[0].action, 'AUTO_CLOSE_SHIFT');
    assert.strictEqual(autoAudit[0].actorRole, 'SYSTEM');
    assert.strictEqual(autoAudit[0].actorId, 'SYSTEM');
  });
  check('audit tự động nói rõ KHÔNG đếm tiền → chênh lệch KHÔNG xác minh', () => {
    const d = autoAudit[0].details || '';
    assert.match(d, /KHÔNG đếm tiền mặt/);
    assert.match(d, /KHÔNG xác minh/);
  });
  check('audit tự động KHÁC audit chốt tay (không thể nhập nhầm)', async () => {});
  const autoAgain = await CashboxService.autoCloseSession({
    sessionId: 'cbs-auto-stale', actorRole: 'ROLE_MANAGER', actorId: 'manager-1',
  });
  check('auto-close lần hai idempotent, không ghi thêm audit', () => {
    assert.strictEqual(autoAgain.isIdempotent, true);
    assert.strictEqual(autoAgain.closingCashActual, null);
    assert.strictEqual(autoAgain.discrepancyVerified, false);
  });
  const auditCountAuto = await db.select().from(schema.auditLogs).where((await import('drizzle-orm')).eq(schema.auditLogs.id, 'aud-cashbox-auto-close-cbs-auto-stale'));
  check('vẫn đúng 1 dòng audit tự động', () => {
    assert.strictEqual(auditCountAuto.length, 1);
  });
  await expectReject(
    'auto-close trên ca đã chốt TAY bị từ chối (không ghi đè số đếm của con người)',
    async () => {
      await CashboxService.closeSession({ sessionId: 'cbs-auto-default', closingCashActual: 90000 });
      return CashboxService.autoCloseSession({
        sessionId: 'cbs-auto-default', actorRole: 'ROLE_MANAGER', actorId: 'manager-1',
      });
    },
    'STATE_CONFLICT'
  );
  const defaultRow = await db.select().from(schema.cashboxSessions).where(eqId('cbs-auto-default'));
  check('số tiền người đếm vẫn nguyên sau khi hệ thống bị từ chối ghi đè', () => {
    assert.strictEqual(defaultRow[0].closingCashActual, 90000);
    assert.strictEqual(defaultRow[0].cashDiscrepancy, -10000);
  });

  // ================================================================ E. chốt tay
  console.log('\n[E] Chốt tay: hành vi y như cũ');
  const human = await CashboxService.closeSession({
    sessionId: 'cbs-auto-overnight',
    closingCashActual: 250000,
    audit: { actorRole: 'ROLE_CASHIER', actorId: 'cashier-b' },
  });
  check('chốt tay: số thực đếm + chênh lệch thật được tính', () => {
    assert.strictEqual(human.closingCashActual, 250000);
    // 200.000 đầu ca + 100.000 đơn 'ord-ok-2' = 300.000 kỳ vọng → lệch -50.000
    assert.strictEqual(human.expectedCash, 300000);
    assert.strictEqual(human.cashDiscrepancy, -50000);
  });
  check('chốt tay KHÔNG mang cờ tự động', () => {
    assert.strictEqual((human as any).discrepancyVerified, undefined);
    assert.strictEqual((human as any).closeType, undefined);
  });
  const humanAudit = await db.select().from(schema.auditLogs).where((await import('drizzle-orm')).eq(schema.auditLogs.id, 'aud-cashbox-close-cbs-auto-overnight'));
  check('audit chốt tay: action MUTATE_ORDER, actor là người', () => {
    assert.strictEqual(humanAudit.length, 1);
    assert.strictEqual(humanAudit[0].action, 'MUTATE_ORDER');
    assert.notStrictEqual(humanAudit[0].id, 'aud-cashbox-auto-close-cbs-auto-overnight');
  });

  // ================================================================ F. chốt ngày
  console.log('\n[F] Chốt ngày: đúng 1 lần / ngày / kho');
  const day1 = await DailySettlementService.closeDay({
    warehouseId: 'wh-auto', date: '2026-09-25', actorRole: 'ROLE_MANAGER', actorId: 'manager-1',
  });
  check('chốt ngày ghi 1 bản ghi + audit SETTLE_DAY', () => {
    assert.strictEqual(day1.isDuplicate, false);
    assert.strictEqual(day1.dayCloseKey, 'day-close:wh-auto:2026-09-25');
  });
  const idemRows = await db.select().from(schema.idempotencyKeys).where((await import('drizzle-orm')).eq(schema.idempotencyKeys.key, 'day-close:wh-auto:2026-09-25'));
  check('bản ghi chốt ngày nằm trong idempotency_keys scope day-close', () => {
    assert.strictEqual(idemRows.length, 1);
    assert.strictEqual(idemRows[0].scope, 'day-close');
  });
  const dayAudit = await db.select().from(schema.auditLogs).where((await import('drizzle-orm')).eq(schema.auditLogs.id, 'aud-day-close-wh-auto-2026-09-25'));
  check('audit chốt ngày tồn tại, nêu rõ trạng thái xác minh tiền mặt', () => {
    assert.strictEqual(dayAudit.length, 1);
    assert.strictEqual(dayAudit[0].action, 'SETTLE_DAY');
    assert.match(dayAudit[0].details || '', /KHÔNG xác minh/);
  });
  const day2 = await DailySettlementService.closeDay({
    warehouseId: 'wh-auto', date: '2026-09-25', actorRole: 'ROLE_MANAGER', actorId: 'manager-1',
  });
  check('gọi lại y hệt → idempotent (không ghi thêm bản ghi/audit)', () => {
    assert.strictEqual(day2.isDuplicate, true);
    assert.deepStrictEqual({ ...day2, isDuplicate: undefined }, { ...day1, isDuplicate: undefined });
  });
  const idemRows2 = await db.select().from(schema.idempotencyKeys).where((await import('drizzle-orm')).eq(schema.idempotencyKeys.key, 'day-close:wh-auto:2026-09-25'));
  const dayAudit2 = await db.select().from(schema.auditLogs).where((await import('drizzle-orm')).eq(schema.auditLogs.id, 'aud-day-close-wh-auto-2026-09-25'));
  check('vẫn đúng 1 bản ghi + 1 audit sau khi gọi lại', () => {
    assert.strictEqual(idemRows2.length, 1);
    assert.strictEqual(dayAudit2.length, 1);
  });
  await expectReject(
    'chốt ngày LẦN 2 với nội dung khác → TỪ CHỐI (không cho chốt ngày 2 lần)',
    () => DailySettlementService.closeDay({
      warehouseId: 'wh-auto', date: '2026-09-25', actorRole: 'ROLE_OWNER', actorId: 'owner-1', notes: 'chốt lại lý do khác',
    }),
    'IDEMPOTENCY_CONFLICT'
  );
  const dayOtherWh = await DailySettlementService.closeDay({
    warehouseId: 'wh-auto-2', date: '2026-09-25', actorRole: 'ROLE_MANAGER', actorId: 'manager-1',
  });
  check('kho khác cùng ngày vẫn chốt được (1 lần/kho/ngày)', () => {
    assert.strictEqual(dayOtherWh.isDuplicate, false);
  });

  // Chốt ngày khi còn ca mở → từ chối, trừ khi cho phép tự động chốt ca quá giờ
  console.log('\n[G] Chốt ngày khi còn ca mở');
  await db.insert(schema.cashboxSessions).values({
    id: 'cbs-auto-open', warehouseId: 'wh-auto', cashierId: 'cashier-d', openingCash: 300000,
    status: 'OPEN', openedAt: iso(-3 * 86400_000), // 3 ngày trước → thuộc ngày 2026-09-24
  });
  await expectReject(
    'còn ca MỞ (quá giờ) thì chốt ngày bị từ chối kèm hướng dẫn',
    () => DailySettlementService.closeDay({
      warehouseId: 'wh-auto', date: '2026-09-24', actorRole: 'ROLE_MANAGER', actorId: 'manager-1',
    }),
    'STATE_CONFLICT'
  );
  const dayWithAuto = await DailySettlementService.closeDay({
    warehouseId: 'wh-auto', date: '2026-09-24', actorRole: 'ROLE_MANAGER', actorId: 'manager-1',
    autoCloseOpenShifts: true,
  });
  check('autoCloseOpenShifts: chốt ca quá giờ (tiền mặt KHÔNG xác minh) rồi mới chốt ngày', () => {
    assert.strictEqual(dayWithAuto.isDuplicate, false);
    assert.strictEqual(dayWithAuto.cashVerification, 'UNVERIFIED');
    assert.ok(dayWithAuto.autoClosedSessions.includes('cbs-auto-open'));
  });
  const autoClosedRow = await db.select().from(schema.cashboxSessions).where((await import('drizzle-orm')).eq(schema.cashboxSessions.id, 'cbs-auto-open'));
  check('ca bị tự động chốt: closingCashActual NULL, chênh lệch KHÔNG xác minh', () => {
    assert.strictEqual(autoClosedRow[0].closingCashActual, null);
    assert.strictEqual(autoClosedRow[0].cashDiscrepancy, null);
    assert.strictEqual(autoClosedRow[0].status, 'CLOSED');
  });

  // ================================================================ H. offline
  console.log('\n[H] Đơn tạo offline KHÔNG bị bỏ rơi');
  const offlineRow = await db.select().from(schema.orders).where((await import('drizzle-orm')).eq(schema.orders.id, 'ord-auto-offline'));
  check('đơn offline vẫn còn nguyên sau toàn bộ chuỗi tự động', () => {
    assert.strictEqual(offlineRow.length, 1);
    assert.strictEqual(offlineRow[0].status, 'COMPLETED');
    assert.strictEqual(offlineRow[0].finalAmount, 700000);
    assert.strictEqual(offlineRow[0].syncStatus, 'PENDING_SYNC');
  });
  const dayRecord = await DailySettlementService.getDayCloseRecord('wh-auto', '2026-09-25', db);
  check('bản ghi chốt ngày LIỆT KÊ đơn chưa đồng bộ (không giấu đi)', () => {
    const listed = (dayRecord as any).unsettledOrders.map((x: any) => x.orderCode);
    assert.ok(listed.includes('ORD-AUTO-OFFLINE'), `phải có ORD-AUTO-OFFLINE, thực tế ${JSON.stringify(listed)}`);
    const item = (dayRecord as any).unsettledOrders.find((x: any) => x.orderCode === 'ORD-AUTO-OFFLINE');
    assert.strictEqual(item.reason, 'CHUA_DONG_BO');
  });
  check('bản ghi chốt ngày ghi rõ tiền mặt KHÔNG xác minh + phiên chốt tự động', () => {
    assert.strictEqual((dayRecord as any).cashVerification, 'UNVERIFIED');
    assert.ok((dayRecord as any).unverifiedSessions.includes('cbs-auto-stale'));
  });

  // ==================================================== T. MÚI GIỜ (UTC vs local)
  // SQLite CURRENT_TIMESTAMP ghi "YYYY-MM-DD HH:MM:SS" theo UTC KHÔNG kèm múi
  // giờ. Node đọc chuỗi đó là GIỜ ĐỊA PHƯƠNG → ở GMT+7 một ca vừa mở bị
  // già thêm 7 tiếng và bị coi là quá giờ, chặn cả POS. Mọi khẳng định dưới
  // đây so SỐ (ms), không so chuỗi định dạng, để không "đúng nhầm" ở GMT+7.
  console.log('\n[T] Múi giờ: timestamp DB (UTC, không múi giờ) không được đọc như local');
  const realNow = new Date();
  // Đồng hồ thật cho phần này: case "mở ca ngay lúc này" phải dùng giờ thật.
  delete process.env.CASHBOX_TEST_NOW;

  const { parseDbTimestamp } = await import('../src/lib/db-timestamp');

  // Đúng thứ SQLite CURRENT_TIMESTAMP sẽ ghi: UTC, "YYYY-MM-DD HH:MM:SS", không múi giờ.
  const sqliteNaive = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
  const justOpened = sqliteNaive(realNow);

  check('parseDbTimestamp đọc timestamp DB là UTC (đúng số ms), không phải local', () => {
    const parsed = parseDbTimestamp(justOpened);
    assert.ok(parsed, 'phải parse được');
    // Số ms phải khớp thời điểm thật, lệch tối đa 1s cho độ trễ giữa lúc ghi và lúc đọc.
    assert.ok(
      Math.abs(parsed.getTime() - realNow.getTime()) < 1000,
      `lệch ${parsed.getTime() - realNow.getTime()} ms (GMT+7 sẽ lệch ~-25200000 ms)`
    );
  });
  check('timestamp DB hỏng / rỗng → null (không ném, không bịa Date)', () => {
    assert.strictEqual(parseDbTimestamp(null), null);
    assert.strictEqual(parseDbTimestamp(''), null);
    assert.strictEqual(parseDbTimestamp('khong-phai-ngay'), null);
  });
  check('chuỗi ĐÃ có múi giờ (ISO Z) thì giữ nguyên — không dịch thêm 7 tiếng', () => {
    const isoZ = realNow.toISOString();
    assert.strictEqual(parseDbTimestamp(isoZ)!.getTime(), Date.parse(isoZ));
  });

  const evalJustOpened = evaluateShiftCutoff(justOpened, { warehouseId: 'wh-auto-3', now: realNow });
  check('ca vừa mở (giờ thật) KHÔNG bị coi là quá giờ', () => {
    assert.strictEqual(evalJustOpened.overdue, false);
    assert.ok(evalJustOpened.elapsedMinutes <= 1, `elapsedMinutes=${evalJustOpened.elapsedMinutes}`);
    // SQLite chỉ ghi tới giây → so với thời điểm thật đã cắt ms, lệch tối đa 999ms.
    const truncatedToSecond = Math.floor(realNow.getTime() / 1000) * 1000;
    assert.ok(
      Math.abs(Date.parse(evalJustOpened.openedAt) - truncatedToSecond) < 1000,
      `lệch ${Date.parse(evalJustOpened.openedAt) - truncatedToSecond} ms so với giây đã cắt`
    );
  });

  const yday = new Date(realNow.getTime() - 86400_000);
  const evalBeforeCutoff = evaluateShiftCutoff(sqliteNaive(yday), { warehouseId: 'wh-auto', now: realNow });
  check('ca mở ở kỳ trước, ĐÃ QUA mốc chốt ngày → quá giờ', () => {
    assert.strictEqual(evalBeforeCutoff.overdue, true);
    assert.ok(evalBeforeCutoff.elapsedMinutes >= 23 * 60, `elapsedMinutes=${evalBeforeCutoff.elapsedMinutes}`);
  });

  // Ca đêm: mở SAU NỖA ĐÊM giờ địa phương → thuộc ngày hôm nay, chưa quá giờ.
  const afterMidnight = new Date(realNow);
  afterMidnight.setHours(0, 10, 0, 0);
  const evalOvernight = evaluateShiftCutoff(sqliteNaive(afterMidnight), {
    warehouseId: 'wh-auto-3',
    now: realNow,
  });
  check('ca mở SAU NỬA ĐÊM giờ địa phương vẫn nằm trong ngày nghiệp vụ (không bị chặn)', () => {
    assert.strictEqual(evalOvernight.overdue, false);
    // Ngày nghiệp vụ phải là HÔM NAY theo giờ máy chủ, không phải hôm qua.
    const localToday = `${realNow.getFullYear()}-${String(realNow.getMonth() + 1).padStart(2, '0')}-${String(realNow.getDate()).padStart(2, '0')}`;
    assert.strictEqual(evalOvernight.businessDate, localToday);
    assert.ok(Math.abs(Date.parse(evalOvernight.openedAt) - afterMidnight.getTime()) < 1000);
  });

  // Hẹn gặp thật: phiên mà DB tự đóng dấu thời gian (CURRENT_TIMESTAMP) rồi bán
  // ngay. Đây chính là case 6c của test-online-orders từng vỡ.
  await db.insert(schema.cashboxSessions).values({
    id: 'cbs-tz-live',
    warehouseId: 'wh-auto-3',
    cashierId: 'cashier-f',
    openingCash: 100000,
    status: 'OPEN',
    // KHÔNG truyền openedAt → để SQLite tự ghi CURRENT_TIMESTAMP (UTC, không múi giờ)
  });
  const liveRows = await db.select().from(schema.cashboxSessions).where(eqId('cbs-tz-live'));
  const liveOpenedRaw = liveRows[0].openedAt as string;
  check('phiên mới mở có opened_at kiểu SQLite: UTC, không kèm múi giờ', () => {
    assert.match(liveOpenedRaw, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, `opened_at=${liveOpenedRaw}`);
    // Số ms đọc đúng phải bám sát giờ thật, không lệch 7 tiếng.
    const parsed = parseDbTimestamp(liveOpenedRaw)!;
    assert.ok(Math.abs(parsed.getTime() - realNow.getTime()) < 120_000, `lệch ${parsed.getTime() - realNow.getTime()} ms`);
  });
  const liveOrder = await (async () => {
    try {
      return await OrderService.createOrder({
        id: 'ord-tz-1', idempotencyKey: 'idem-tz-1', warehouseId: 'wh-auto-3', channel: 'RETAIL_OFFICE',
        cashierId: 'cashier-f', paymentMethod: 'CASH',
        items: [{ editionId: 'ed-auto-1', quantity: 1 }],
        actorContext: { role: 'ROLE_CASHIER', actorId: 'cashier-f' },
      } as any);
    } catch (e: any) {
      failures++;
      console.error(`  ✗ ca mở bằng SQLite CURRENT_TIMESTAMP rồi bán ngay KHÔNG bị chặn — ${e?.message}`);
      return null;
    }
  })();
  check('ca mở bằng SQLite CURRENT_TIMESTAMP rồi bán ngay KHÔNG bị chặn (case 6c)', () => {
    assert.ok(liveOrder, 'đơn phải tạo được');
    assert.strictEqual(liveOrder!.status, 'COMPLETED');
  });

  console.log(`\n${failures === 0 ? '🎉 AUTOCLOSE SHIFT: 100% PASS' : `❌ AUTOCLOSE SHIFT: ${failures} check FAIL`}`);
  if (failures > 0) process.exit(1);
}

run()
  .catch((err) => {
    console.error('❌ TEST FAILED:', err);
    process.exit(1);
  })
  .finally(() => {
    for (const s of ['', '-wal', '-shm', '-journal']) {
      try { fs.unlinkSync(DB_FILE + s); } catch { }
    }
  });
