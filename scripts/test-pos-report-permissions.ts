/**
 * B1 (bug #3): ma trận quyền báo cáo ca/ngày (bug #3).
 * - daily-settlement: OWNER/MANAGER pass guard; CASHIER/WAREHOUSE/TAX 403.
 * - cashbox: cashier bị ép về chính mình (xem + chốt két người khác 403).
 * - Không cookie: 401.
 *
 * DB riêng formapubli_test_report_perms.db — KHÔNG chạm prod.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_report_perms.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

async function run() {
  console.log('--- TEST B1: POS REPORT PERMISSIONS (bug #3) ---');
  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-pos-report-permissions');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../src/db/schema');
  const { signSession, SESSION_COOKIE_NAME } = await import('../src/lib/auth-session');
  const { GET: dailyGET } = await import('../src/app/api/pos/daily-settlement/route');
  const { GET: cashboxGET, POST: cashboxPOST } = await import('../src/app/api/cashbox/route');

  const rawClient = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(rawClient);

  await db.insert(schema.warehouses).values([
    { id: 'wh-au-co', code: 'KHO_AU_CO', name: 'Kho Au Co', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
  ]);
  const staff = [
    { staffId: 'OWN-1', fullName: 'Owner', role: 'ROLE_OWNER' },
    { staffId: 'MGR-1', fullName: 'Manager', role: 'ROLE_MANAGER' },
    { staffId: 'CASH-1', fullName: 'Cashier 1', role: 'ROLE_CASHIER' },
    { staffId: 'CASH-2', fullName: 'Cashier 2', role: 'ROLE_CASHIER' },
    { staffId: 'KHO-1', fullName: 'Keeper', role: 'ROLE_WAREHOUSE' },
    { staffId: 'TAX-1', fullName: 'Tax', role: 'ROLE_TAX' },
  ];
  for (const s of staff) {
    await db.insert(schema.staffAccounts).values({
      staffId: s.staffId, fullName: s.fullName, role: s.role,
      passcodeHash: 'v2$100000$' + '0'.repeat(64), salt: 'salt-' + s.staffId,
      isActive: true, sessionVersion: 1,
    });
  }

  const cookieFor = async (staffId: string, role: string) => {
    const token = await signSession({
      role: role as any, actorId: staffId, issuedAt: Date.now(),
      expiresAt: Date.now() + 3600000, sessionVersion: 1,
    });
    return `${SESSION_COOKIE_NAME}=${token}`;
  };
  const get = async (fn: any, url: string, cookie?: string) => {
    const headers: any = {};
    if (cookie) headers.Cookie = cookie;
    const res = await fn(new Request(url, { headers }) as any);
    let body: any = null;
    try { body = await res.json(); } catch { /* empty */ }
    return { status: res.status, body };
  };

  // 1. daily-settlement: manager/owner qua guard (không 403).
  console.log('\n[P1] Manager/Owner pass guard daily-settlement');
  for (const [id, role] of [['MGR-1', 'ROLE_MANAGER'], ['OWN-1', 'ROLE_OWNER']]) {
    const r = await get(dailyGET, 'http://localhost/api/pos/daily-settlement?warehouseId=wh-au-co', await cookieFor(id as string, role as string));
    assert.equal(r.status, 200, `${id} phải 200, thực tế ${r.status}`);
    assert.equal(r.body?.success, true, `${id} success=true`);
    assert.equal(r.body?.data?.warehouse?.id, 'wh-au-co', `${id} payload warehouse khớp`);
    assert.ok(r.body?.data?.financials && typeof r.body.data.financials === 'object', `${id} payload có financials`);
    console.log(`✓ ${id}: 200 + payload hợp lệ`);
  }

  // 2. daily-settlement: cashier/warehouse/tax 403 kể cả gọi trực tiếp.
  console.log('\n[P2] Cashier/Warehouse/Tax bị 403 kể cả gọi trực tiếp API');
  for (const [id, role] of [['CASH-1', 'ROLE_CASHIER'], ['KHO-1', 'ROLE_WAREHOUSE'], ['TAX-1', 'ROLE_TAX']]) {
    const r = await get(
      dailyGET,
      'http://localhost/api/pos/daily-settlement?warehouseId=wh-au-co&date=2026-09-24',
      await cookieFor(id as string, role as string)
    );
    assert.equal(r.status, 403, `${id} phải 403, thực tế ${r.status}`);
  }
  console.log('✓ CASH-1/KHO-1/TAX-1 đều 403');

  // 3. Không cookie: 401.
  console.log('\n[P3] Thiếu cookie: 401');
  {
    const r = await get(dailyGET, 'http://localhost/api/pos/daily-settlement?warehouseId=wh-au-co');
    assert.equal(r.status, 401);
    console.log('✓ 401');
  }

  // 4. Cashier xem két người khác -> bị ép về mình (không rò rỉ).
  console.log('\n[P4] Cashier xem két bị ép về chính mình');
  {
    const { CashboxService } = await import('../src/services/order.service');
    await CashboxService.openSession({ warehouseId: 'wh-au-co', cashierId: 'CASH-1', openingCash: 100000 } as any);
    await CashboxService.openSession({ warehouseId: 'wh-au-co', cashierId: 'CASH-2', openingCash: 500000 } as any);
    const r = await get(
      cashboxGET,
      'http://localhost/api/cashbox?cashierId=CASH-2',
      await cookieFor('CASH-1', 'ROLE_CASHIER')
    );
    assert.equal(r.status, 200);
    // Giả danh CASH-2 nhưng phải trả đúng phiên của CASH-1 (người gọi).
    assert.equal(r.body?.data?.cashierId, 'CASH-1', 'Phải trả đúng phiên của người gọi');
    const leaked = JSON.stringify(r.body || {});
    assert.ok(!leaked.includes('CASH-2'), 'Không được rò phiên két CASH-2 cho CASH-1');
    console.log('✓ Trả đúng phiên người gọi, không rò rỉ');
  }

  // 5. Cashier chốt két người khác -> 403.
  console.log('\n[P5] Cashier chốt két người khác -> 403');
  {
    const { CashboxService } = await import('../src/services/order.service');
    const other = await CashboxService.getActiveSession('CASH-2');
    assert.ok(other, 'CASH-2 phải có phiên OPEN');
    const res = await cashboxPOST(
      new Request('http://localhost/api/cashbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: await cookieFor('CASH-1', 'ROLE_CASHIER') },
        body: JSON.stringify({ action: 'CLOSE', sessionId: other.id, closingCashActual: 500000 }),
      }) as any
    );
    assert.equal(res.status, 403, `Phải 403, thực tế ${res.status}`);
    // Trạng thái phiên CASH-2 không đổi sau thao tác bị cấm.
    const stillOpen = await CashboxService.getActiveSession('CASH-2');
    assert.ok(stillOpen && stillOpen.status === 'OPEN', 'Phiên CASH-2 vẫn OPEN sau CLOSE bị từ chối');
    console.log('✓ 403 + phiên nạn nhân nguyên vẹn');
  }

  // 6. Ma trận list cashbox: manager thấy tất cả, cashier chỉ thấy mình.
  console.log('\n[P6] Cashbox list theo role');
  {
    const mgr = await get(
      cashboxGET,
      'http://localhost/api/cashbox',
      await cookieFor('MGR-1', 'ROLE_MANAGER')
    );
    assert.equal(mgr.status, 200);
    const mgrIds = ((mgr.body?.data as any[]) || []).map((s: any) => s.cashierId);
    assert.ok(mgrIds.includes('CASH-1') && mgrIds.includes('CASH-2'), 'Manager thấy cả hai phiên');
    const cash = await get(
      cashboxGET,
      'http://localhost/api/cashbox',
      await cookieFor('CASH-1', 'ROLE_CASHIER')
    );
    assert.equal(cash.status, 200);
    // Cashier không query cashierId vẫn bị ép về phiên của mình (object, không phải list).
    assert.equal(cash.body?.data?.cashierId, 'CASH-1', 'Cashier chỉ thấy phiên của mình');
    console.log('✓ Manager thấy tất cả, cashier chỉ thấy mình');
  }

  rawClient.close();
  console.log('\n🎉 B1 REPORT PERMISSIONS: P1-P6 PASS!');
}

run().catch((err) => {
  console.error('❌ Test thất bại:', err);
  process.exit(1);
});
