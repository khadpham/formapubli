/**
 * TEST CASHBOX AUDIT COUNT — Quản lý cập nhật tiền thực đếm sau khi chốt ca tự động
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_audit_count.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

async function run() {
  console.log('--- TEST CASHBOX AUDIT COUNT: QUẢN LÝ CẬP NHẬT TIỀN THỰC ĐẾM ---');

  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-cashbox-audit-count');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const { eq } = await import('drizzle-orm');
  const schema = await import('../src/db/schema');
  const { CashboxService, businessDateOf } = await import('../src/services/order.service');
  const { DailySettlementService } = await import('../src/services/daily-settlement.service');

  const rawClient = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(rawClient, { schema });

  const WH_ID = 'wh-audit-test';
  const DATE = businessDateOf(new Date());

  // Seed warehouse
  await db.insert(schema.warehouses).values({
    id: WH_ID,
    code: 'WH_AUDIT',
    name: 'Kho Hội Chợ Test Audit',
    warehouseType: 'FAIR_EVENT',
    isSellableOnPos: true,
    isActive: true,
  });

  // 1. Mở ca và tự động chốt (auto-close) như kịch bản thu ngân quên chốt
  const openResult = await CashboxService.openSession({
    warehouseId: WH_ID,
    cashierId: 'NV-TEST-01',
    openingCash: 500_000,
  });
  const sessionId = openResult.session.id;

  await CashboxService.autoCloseSession({
    sessionId,
    actorRole: 'SYSTEM',
    actorId: 'CRON_SAFEGUARD',
    reason: 'Quá giờ',
  });

  // Kiểm tra trước khi audit: closingCashActual phải là null
  const sBefore = await db.select().from(schema.cashboxSessions).where(eq(schema.cashboxSessions.id, sessionId));
  assert.equal(sBefore[0].status, 'CLOSED');
  assert.equal(sBefore[0].closingCashActual, null);

  // Báo cáo chốt ngày trước khi audit: unreconcilableSessionCount = 1, cashVariance = null
  const reportBefore = await DailySettlementService.getDailyFairSettlement({ warehouseId: WH_ID, date: DATE }, db);
  assert.equal(reportBefore.cashboxReconciliation.unreconcilableSessionCount, 1);
  assert.equal(reportBefore.cashboxReconciliation.cashVariancePending, true);
  assert.equal(reportBefore.cashboxReconciliation.cashVariance, null);
  console.log('  ✓ Trước audit: Báo cáo nhận diện chính xác ca chưa có tiền thực đếm (chưa thể đối soát)');

  // 2. Chặn CASHIER gọi audit
  let cashierBlocked = false;
  try {
    await CashboxService.auditClosingCash({
      sessionId,
      closingCashActual: 500_000,
      actorRole: 'ROLE_CASHIER',
      actorId: 'NV-TEST-01',
    });
  } catch (err: any) {
    cashierBlocked = true;
    assert.equal(err.code, 'FORBIDDEN');
  }
  assert.ok(cashierBlocked, 'Thu ngân không được phép audit số tiền thực đếm');
  console.log('  ✓ Phân quyền: ROLE_CASHIER bị chặn 403');

  // 3. Quản lý audit với số tiền khớp kỳ vọng (500.000 đ)
  const auditResult = await CashboxService.auditClosingCash({
    sessionId,
    closingCashActual: 500_000,
    notes: 'Đếm lại vào sáng hôm sau',
    actorRole: 'ROLE_MANAGER',
    actorId: 'QL-01',
  });

  assert.equal(auditResult.closingCashActual, 500_000);
  assert.equal(auditResult.cashDiscrepancy, 0);

  // 4. Kiểm tra trong DB
  const sAfter = await db.select().from(schema.cashboxSessions).where(eq(schema.cashboxSessions.id, sessionId));
  assert.equal(sAfter[0].closingCashActual, 500_000);
  assert.equal(sAfter[0].cashDiscrepancy, 0);
  assert.ok(sAfter[0].notes?.includes('AUDIT_COUNT'));

  // 5. Kiểm tra audit log
  const logs = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'AUDIT_CASHBOX_COUNT'));
  assert.ok(logs.length >= 1);
  assert.equal(logs[0].actorRole, 'ROLE_MANAGER');
  assert.equal(logs[0].actorId, 'QL-01');
  console.log('  ✓ Đã ghi nhận audit_logs đầy đủ');

  // 6. Báo cáo chốt ngày sau khi audit: Khớp 100%, cashVariance = 0, unreconcilable = 0!
  const reportAfter = await DailySettlementService.getDailyFairSettlement({ warehouseId: WH_ID, date: DATE }, db);
  assert.equal(reportAfter.cashboxReconciliation.unreconcilableSessionCount, 0);
  assert.equal(reportAfter.cashboxReconciliation.cashVariancePending, false);
  assert.equal(reportAfter.cashboxReconciliation.cashVariance, 0);
  assert.equal(reportAfter.cashboxReconciliation.closingCashActualTotal, 500_000);
  assert.equal(reportAfter.cashboxReconciliation.sessions[0].closingCashActual, 500_000);
  console.log('  ✓ Sau audit: Báo cáo đối soát chuyển ngay thành Khớp tuyệt đối (0 đ chênh lệch)');

  // Dọn dẹp
  for (const s of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(DB_FILE + s); } catch {}
  }

  console.log('\n=== TẤT CẢ ASSERTIONS PASS ===');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
