/**
 * Runtime test cho GET /api/pos/live-monitor.
 *
 * scripts/test-live-monitor.ts chỉ kiểm MÃ NGUỒN. Nó không chứng minh được
 * expectedCashLive ra đúng số tiền — mà đó mới là thứ tiền thật. Suite này dựng
 * dữ liệu thật trong DB cách ly rồi gọi thẳng route handler.
 *
 * Ba lỗi tiền thật từng lên production và được bắt ở đây:
 *  1. Gom tiền mặt theo warehouseId+cashierId ⇒ một thu ngân mở HAI ca cùng kho
 *     thì cả hai ca cùng nhận một số tiền (đã sửa: gom theo cashboxSessionId).
 *  2. Lọc theo ngày ⇒ ca qua nửa đêm mất tiền trước nửa đêm, lấy cộng tiền của
 *     hôm qua (đã sửa: không lọc ngày, tiền thuộc về ca).
 *  3. recentClosed không lọc ngày ⇒ lọt đơn của hôm qua vào "đơn vừa đóng".
 *
 * DB riêng formapubli_test_live_monitor.db - KHÔNG chạm prod.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_live_monitor.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

// Ngày làm việc giờ VN. Dùng một ngày cố định để không phụ thuộc mốc 00:00-07:00.
const TODAY = '2026-03-10';
let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; assert.ok(cond, msg); };
const eq = (a: unknown, b: unknown, msg: string) => { checks++; assert.deepEqual(a, b, msg); };

async function run() {
  console.log('--- TEST RUNTIME: LIVE MONITOR ---');
  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-live-monitor-runtime');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../src/db/schema');
  const { signSession, SESSION_COOKIE_NAME } = await import('../src/lib/auth-session');
  const { GET } = await import('../src/app/api/pos/live-monitor/route');

  const db = drizzle(createClient({ url: process.env.DATABASE_URL! }));

  await db.insert(schema.warehouses).values([
    { id: 'wh-fair', code: 'KHO_HOI_CHO', name: 'Kho Hoi Cho', isActive: true, isSellableOnPos: true, warehouseType: 'FAIR_EVENT' },
    { id: 'wh-main', code: 'KHO_AU_CO', name: 'Kho Au Co', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
  ]);
  for (const s of [
    { staffId: 'OWN-1', fullName: 'Owner', role: 'ROLE_OWNER' },
    { staffId: 'MGR-1', fullName: 'Manager', role: 'ROLE_MANAGER' },
    { staffId: 'CASH-1', fullName: 'Cashier', role: 'ROLE_CASHIER' },
  ]) {
    await db.insert(schema.staffAccounts).values({
      staffId: s.staffId, fullName: s.fullName, role: s.role,
      passcodeHash: 'v2$100000$' + '0'.repeat(64), salt: 'salt-' + s.staffId,
      isActive: true, sessionVersion: 1,
    });
  }

  // Một thu ngân mở HAI ca cùng kho hội chợ. Đây là hình thế đã làm hỏng số tiền
  // khi gom theo warehouseId+cashierId: cả hai ca cùng nhận tổng của cả hai.
  await db.insert(schema.cashboxSessions).values([
    { id: 'sess-A', warehouseId: 'wh-fair', cashierId: 'CASH-1', openingCash: 500000, status: 'OPEN', openedAt: `${TODAY} 02:00:00` },
    { id: 'sess-B', warehouseId: 'wh-fair', cashierId: 'CASH-1', openingCash: 200000, status: 'OPEN', openedAt: `${TODAY} 02:00:00` },
  ]);

  // sess-A bán 100k tiền mặt HÔM NAY; sess-B bán 300k.
  await db.insert(schema.orders).values([
    { id: 'o-cash-A', orderCode: 'ORD-CASH-A', idempotencyKey: 'k-cash-A', warehouseId: 'wh-fair', cashierId: 'CASH-1', cashboxSessionId: 'sess-A', status: 'COMPLETED', paymentMethod: 'CASH', subtotal: 100000, totalAmount: 100000, finalAmount: 100000, discountAmount: 0, discountRate: 0, createdAt: `${TODAY} 09:00:00`, completedAt: `${TODAY} 09:00:00` },
    { id: 'o-cash-B', orderCode: 'ORD-CASH-B', idempotencyKey: 'k-cash-B', warehouseId: 'wh-fair', cashierId: 'CASH-1', cashboxSessionId: 'sess-B', status: 'COMPLETED', paymentMethod: 'CASH', subtotal: 300000, totalAmount: 300000, finalAmount: 300000, discountAmount: 0, discountRate: 0, createdAt: `${TODAY} 10:00:00`, completedAt: `${TODAY} 10:00:00` },
  ] as any);

  const cookie = async (staffId: string, role: string) => {
    const token = await signSession({ role: role as any, actorId: staffId, issuedAt: Date.now(), expiresAt: Date.now() + 3600000, sessionVersion: 1 });
    return `${SESSION_COOKIE_NAME}=${token}`;
  };
  const get = async (url: string, c?: string) => {
    const headers: any = {};
    if (c) headers.Cookie = c;
    const res = await GET(new Request(url, { headers }) as any);
    let body: any = null;
    try { body = await res.json(); } catch { /* empty */ }
    return { status: res.status, body };
  };

  const mgr = await cookie('MGR-1', 'ROLE_MANAGER');
  const own = await cookie('OWN-1', 'ROLE_OWNER');
  const url = `http://localhost/api/pos/live-monitor?date=${TODAY}`;

  console.log('\n[P1] Phân quyền');
  eq((await get(url, mgr)).status, 200, 'MANAGER phải 200');
  eq((await get(url, own)).status, 200, 'OWNER phải 200');
  eq((await get(url, await cookie('CASH-1', 'ROLE_CASHIER'))).status, 403, 'CASHIER phải 403');
  eq((await get(url)).status, 401, 'Không cookie phải 401');

  console.log('\n[P2] Chỉ kho hội chợ');
  const r2 = await get(url, mgr);
  eq(r2.status, 200, '200');
  eq(r2.body?.success, true, 'success=true');
  eq(r2.body?.data?.businessDate, TODAY, 'businessDate đúng');
  ok(typeof r2.body?.data?.timezoneNote === 'string' && r2.body.data.timezoneNote.length > 0, 'phải có timezoneNote');
  const shifts = r2.body?.data?.openShifts ?? [];
  eq(shifts.length, 2, 'phải thấy cả 2 ca đang mở');
  ok(!JSON.stringify(r2.body?.data?.today).includes('wh-main'), 'kho vật lý không được lọt vào KPI');
  for (const key of ['today', 'openShifts', 'pending', 'recentClosed', 'topSellers', 'timezoneNote']) {
    ok(key in (r2.body?.data ?? {}), `payload phải có khối "${key}"`);
  }

  console.log('\n[P3] expectedCashLive tính ĐÚNG TỪNG CA (lỗi tiền thật)');
  const byId = new Map<string, any>(shifts.map((s: any) => [s.id, s]));
  eq(byId.get('sess-A')?.expectedCashLive, 500000 + 100000, 'ca A = 500.000 + 100.000');
  eq(byId.get('sess-B')?.expectedCashLive, 200000 + 300000, 'ca B = 200.000 + 300.000');
  ok(
    byId.get('sess-A')?.expectedCashLive !== byId.get('sess-B')?.expectedCashLive,
    'HAI ca của cùng một thu ngân phải ra hai số KHÁC nhau — trùng là đã gom sai'
  );
  ok(
    !shifts.some((s: any) => s.expectedCashLive === 700000),
    'Không ca nào được gom chung 700.000 của cả hai ca'
  );

  console.log('\n[P4] Ca đang mở có cờ quá giờ');
  for (const s of shifts) {
    ok(typeof s.overdue === 'boolean', 'mỗi ca phải có cờ overdue');
    ok(typeof s.cutoff === 'string' && /^\d{2}:\d{2}$/.test(s.cutoff), 'mỗi ca phải có giờ cắt chốt HH:MM');
    ok(typeof s.elapsedMinutes === 'number' && s.elapsedMinutes >= 0, 'elapsedMinutes phải là số không âm');
  }

  console.log('\n[P5] recentClosed chỉ lấy đơn TRONG NGÀY');
  const closed = r2.body?.data?.recentClosed ?? [];
  eq(closed.length, 2, 'đúng 2 đơn đóng trong ngày');
  ok(
    closed.every((o: any) => String(o.createdAt).startsWith(TODAY)),
    'mọi dòng đều thuộc ngày đang xem — lọt đơn hôm qua là sai'
  );
  const stamps = closed.map((o: any) => String(o.createdAt));
  eq([...stamps].sort().reverse(), stamps, 'thứ tự createdAt giảm dần');

  console.log('\n[P6] Đơn CHỜ không lẫn đơn đã đóng; huỷ được');
  await db.insert(schema.orders).values([
    { id: 'o-pend', orderCode: 'ORD-PEND', idempotencyKey: 'k-pend', warehouseId: 'wh-fair', cashierId: 'CASH-1', cashboxSessionId: 'sess-A', status: 'PENDING_CONFIRMATION', paymentMethod: 'BANK_TRANSFER', subtotal: 250000, totalAmount: 250000, finalAmount: 250000, discountAmount: 0, discountRate: 0, createdAt: `${TODAY} 11:00:00`, paymentExpiresAt: '2099-01-01 00:00:00' },
  ] as any);
  const r6 = await get(url, mgr);
  const pend = r6.body?.data?.pending ?? [];
  eq(pend.length, 1, 'đúng 1 đơn đang chờ tiền');
  eq(pend[0]?.orderCode, 'ORD-PEND', 'đúng mã đơn chờ');
  ok(
    !pend.some((p: any) => p.orderCode === 'ORD-CASH-A'),
    'đơn COMPLETED không được lọt vào khối đang chờ tiền'
  );
  eq(r6.body?.data?.today?.orderCount, 2, 'KPI chỉ tính 2 đơn COMPLETED, không tính đơn chờ');

  console.log('\n[P7] Endpoint đọc-only: không ghi audit_logs');
  const before = (await db.select().from(schema.auditLogs)).length;
  await get(url, mgr);
  await get(url, own);
  const after = (await db.select().from(schema.auditLogs)).length;
  eq(after, before, 'số dòng audit_logs phải không đổi');

  console.log('\n[P8] Tham số rác phải báo lỗi, không trả 200 rỗng');
  eq((await get(`${url.replace(TODAY, '2026-02-30')}`, mgr)).status, 400, 'ngày 2026-02-30 không tồn tại phải 400');
  eq((await get(`${url}&warehouseId=wh-main`, mgr)).status, 400, 'kho vật lý không phải kho hội chợ phải 400');
  eq((await get(`${url}&warehouseId=khong-ton-tai`, mgr)).status, 400, 'kho không tồn tại phải 400');
  const scoped = await get(`${url}&warehouseId=wh-fair`, mgr);
  eq(scoped.status, 200, 'kho hội chợ hợp lệ phải 200');
  eq(scoped.body?.data?.openShifts?.length, 2, 'lọc theo kho hội chợ vẫn thấy 2 ca');

  console.log(`\n=== RUNTIME LIVE MONITOR: ${checks} assertions PASS ===`);
}

run()
  .then(() => process.exit(0))
  .catch((e) => { console.error('\n❌ THẤT BẠI:', e.message); process.exit(1); });
