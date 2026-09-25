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

  raw.close();
  console.log('TRANSFER PAYMENT AUTHZ PASS');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
