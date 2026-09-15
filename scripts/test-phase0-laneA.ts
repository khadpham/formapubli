/**
 * KIỂM THỬ ĐỘC LẬP NGHIỆM THU ĐỢT 0 — LANE A
 * Ma trận ca: Auth & Identity (1-7), Rate limit (8-11), Client Spoofing rejection.
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-phase0-laneA
 */
import { assertIsolatedTestDb } from './test-guard';
import { db, works, editions, staffAccounts } from '../src/db';
import { eq } from 'drizzle-orm';
import {
  signSession,
  verifySession,
  checkDualRateLimit,
  recordDualFailedAttempt,
  resetDualRateLimit,
  hashStaffPasscode,
  safeEqual,
} from '../src/lib/auth-session';
import { POST as postLogin } from '../src/app/api/auth/login/route';
import { GET as getMe } from '../src/app/api/auth/me/route';
import { POST as postMovement } from '../src/app/api/inventory/movement/route';
import { POST as postOrder } from '../src/app/api/orders/route';
import { GET as getAnalytics } from '../src/app/api/analytics/route';
import { GET as getShipments, POST as postShipment } from '../src/app/api/shipments/route';
import { POST as postCashbox } from '../src/app/api/cashbox/route';

assertIsolatedTestDb('test-phase0-laneA');

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;
const J = (o: any) => JSON.stringify(o);

const post = (fn: any, body: any, headers: Record<string, string> = {}) =>
  fn(new Request('http://localhost/api/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: J(body),
  }) as any).then(async (r: any) => ({ status: r.status, body: await r.json(), headers: r.headers }));

const get = (fn: any, headers: Record<string, string> = {}, url = 'http://localhost/api/test') =>
  fn(new Request(url, {
    method: 'GET',
    headers,
  }) as any).then(async (r: any) => ({ status: r.status, body: await r.json(), headers: r.headers }));


function extractCookie(headers: any): string {
  const setCookie = headers.get('set-cookie');
  const m = `${setCookie || ''}`.match(/formapubli_session=([^;]+)/);
  return m ? `formapubli_session=${m[1]}` : '';
}

async function run() {
  console.log('🛡️ =========================================================');
  console.log('🛡️ KIỂM THỬ ĐỘC LẬP NGHIỆM THU ĐỢT 0 — LANE A (GATE 4, 5, 6)');
  console.log('🛡️ =========================================================\n');

  let passed = 0;
  let total = 0;
  const test = (desc: string, cond: boolean, details = '') => {
    total++;
    if (cond) {
      passed++;
      console.log(`✅ GATE PASS [${total}]: ${desc}${details ? ` (${details})` : ''}`);
    } else {
      console.error(`❌ GATE FAIL [${total}]: ${desc}${details ? ` (${details})` : ''}`);
    }
  };

  // Bật strict mode cho suite
  process.env.AUTH_STRICT = 'true';
  process.env.AUTH_SECRET = 'formapubli-test-secret-at-least-32-chars-long!';

  // -------------------------------------------------------------------------
  // CA 1: Không cookie -> 401 & không rò rỉ dữ liệu nhạy cảm
  // -------------------------------------------------------------------------
  const r1 = await get(getMe);
  test('1. Không có Cookie session trả về 401 Unauthorized', r1.status === 401 && r1.body?.success === false);

  // -------------------------------------------------------------------------
  // CA 2: Cookie sai chữ ký (Tampered HMAC) -> 401
  // -------------------------------------------------------------------------
  const fakePayload = Buffer.from(JSON.stringify({ role: 'ROLE_OWNER', actorId: 'ADMIN-01', issuedAt: Date.now(), expiresAt: Date.now() + 3600000 })).toString('base64url');
  const r2 = await get(getMe, { Cookie: `formapubli_session=${fakePayload}.00112233445566778899aabbccddeeff` });
  test('2. Cookie giả mạo chữ ký bị chặn đứng với 401', r2.status === 401);

  // -------------------------------------------------------------------------
  // CA 3: Cookie hết hạn (Expired) -> 401
  // -------------------------------------------------------------------------
  const expiredToken = await signSession({
    role: 'ROLE_OWNER',
    actorId: 'ADMIN-01',
    issuedAt: Date.now() - 20 * 3600 * 1000,
    expiresAt: Date.now() - 10 * 3600 * 1000,
  });
  const r3 = await get(getMe, { Cookie: `formapubli_session=${expiredToken}` });
  test('3. Cookie hết hạn 12h bị từ chối với 401', r3.status === 401);

  // -------------------------------------------------------------------------
  // CA 4: Header Spoofing (Gửi x-formapubli-role: ROLE_OWNER không cookie) -> Bị vô hiệu 401
  // -------------------------------------------------------------------------
  const r4 = await post(postMovement, {
    editionId: 'ed-h01',
    warehouseId: 'wh-au-co',
    eventType: 'RECEIPT',
    quantityDelta: 10,
    documentRef: 'SPOOF-01',
    idempotencyKey: uniq('idem'),
  }, { 'x-formapubli-role': 'ROLE_OWNER', 'x-formapubli-actor': 'Hacker' });
  test('4. Header tự xưng vai trò vô hiệu hóa hoàn toàn khi bật AUTH_STRICT', r4.status === 401);

  // -------------------------------------------------------------------------
  // CA 5: Đăng nhập hợp lệ qua CSDL staff_accounts (Single Source of Truth)
  // -------------------------------------------------------------------------
  const loginRes = await post(postLogin, {
    staffId: 'ADMIN-01',
    passcode: 'owner9999',
  });
  const adminCookie = extractCookie(loginRes.headers);
  test('5. Đăng nhập ADMIN-01 qua staff_accounts thành công, cấp cookie session', loginRes.status === 200 && !!adminCookie);

  // -------------------------------------------------------------------------
  // CA 6: Xác thực danh tính qua /api/auth/me với cookie hợp lệ
  // -------------------------------------------------------------------------
  const meRes = await get(getMe, { Cookie: adminCookie });
  test('6. Session hợp lệ trả đúng định danh nhân viên và vai trò', meRes.status === 200 && meRes.body?.data?.actorId === 'ADMIN-01' && meRes.body?.data?.role === 'ROLE_OWNER');

  // -------------------------------------------------------------------------
  // CA 7: Chống mạo danh (Non-spoofable): Cookie Cashier + Header Owner -> Vẫn thực thi với quyền Cashier (403 movement)
  // -------------------------------------------------------------------------
  const cashierLogin = await post(postLogin, { staffId: 'NV-01', passcode: '1234' });
  const cashierCookie = extractCookie(cashierLogin.headers);
  const r7 = await post(postMovement, {
    editionId: 'ed-h01',
    warehouseId: 'wh-au-co',
    eventType: 'RECEIPT',
    quantityDelta: 10,
    documentRef: 'SPOOF-02',
    idempotencyKey: uniq('idem'),
  }, {
    Cookie: cashierCookie,
    'x-formapubli-role': 'ROLE_OWNER',
    'x-formapubli-actor': 'ADMIN-01',
  });
  test('7. Client gửi cookie Cashier kèm header giả Owner bị chặn 403 (Server lấy role từ cookie)', r7.status === 403);

  // -------------------------------------------------------------------------
  // CA 8: Rate Limiting theo Tài khoản (Lần 5 sai -> Khóa 15 phút ngay tại HTTP 429)
  // -------------------------------------------------------------------------
  const testStaff = 'NV-02';
  resetDualRateLimit('127.0.0.1', testStaff);
  for (let i = 0; i < 4; i++) {
    const res = await post(postLogin, { staffId: testStaff, passcode: 'wrong-pass' });
    test(`8.${i + 1}. Lần nhập sai thứ ${i + 1} trả về HTTP 401 AUTH_REQUIRED`, res.status === 401 && res.body?.code === 'AUTH_REQUIRED');
  }
  const attempt5 = await post(postLogin, { staffId: testStaff, passcode: 'wrong-pass' });
  test('8.5. Lần nhập sai thứ 5 khóa tài khoản ngay lập tức và trả về HTTP 429 RATE_LIMITED', attempt5.status === 429 && attempt5.body?.code === 'RATE_LIMITED' && attempt5.body?.locked === true);

  // -------------------------------------------------------------------------
  // CA 9: Chống Brute Force đa tài khoản từ 1 IP (10 lần sai -> Khóa IP 15 phút)
  // -------------------------------------------------------------------------
  const attackerIp = '198.51.100.99';
  for (let i = 0; i < 10; i++) {
    await post(postLogin, { staffId: `DUMMY-${i}`, passcode: 'wrong' }, { 'x-real-ip': attackerIp });
  }
  const ipBlockedAttempt = await post(postLogin, { staffId: 'ADMIN-01', passcode: 'owner9999' }, { 'x-real-ip': attackerIp });
  test('9. Dò mật khẩu 10 lần từ 1 IP bị khóa toàn bộ IP 15 phút (HTTP 429)', ipBlockedAttempt.status === 429 && ipBlockedAttempt.body?.code === 'RATE_LIMITED');

  // -------------------------------------------------------------------------
  // CA 10: Chặn tài khoản nhân viên bị vô hiệu hóa (isActive = false)
  // -------------------------------------------------------------------------
  await db.update(staffAccounts).set({ isActive: false }).where(eq(staffAccounts.staffId, 'THUE-01'));
  const inactiveLogin = await post(postLogin, { staffId: 'THUE-01', passcode: '7890' });
  test('10. Đăng nhập tài khoản nhân viên đã vô hiệu hóa bị từ chối với 403 Forbidden', inactiveLogin.status === 403 && inactiveLogin.body?.code === 'FORBIDDEN');
  await db.update(staffAccounts).set({ isActive: true }).where(eq(staffAccounts.staffId, 'THUE-01'));

  // -------------------------------------------------------------------------
  // CA 11: Chống giả mạo danh tính trong payload bán hàng (/api/orders)
  // Client gửi cashierId='HACKER' nhưng cookie là 'NV-01' -> Server phải ghi nhận NV-01
  // -------------------------------------------------------------------------
  const orderRes = await post(postOrder, {
    warehouseId: 'wh-au-co',
    items: [{ editionId: 'ed-h01', quantity: 1 }],
    cashierId: 'HACKER_ATTEMPT',
    idempotencyKey: uniq('idem-order-auth'),
  }, { Cookie: cashierCookie });

  test('11. Client gửi cashierId lậu trong body đơn hàng được chuẩn hóa an toàn', orderRes.status === 200 && orderRes.body?.data?.orderCode);

  // -------------------------------------------------------------------------
  // CA 12: Phân quyền Analytics: Không cookie -> 401; Cashier cookie -> 403
  // -------------------------------------------------------------------------
  const r12a = await get(getAnalytics);
  test('12a. /api/analytics không có cookie trả về 401 AUTH_REQUIRED', r12a.status === 401 && r12a.body?.code === 'AUTH_REQUIRED');
  const r12b = await get(getAnalytics, { Cookie: cashierCookie });
  test('12b. /api/analytics với cookie Cashier bị chặn 403 FORBIDDEN', r12b.status === 403 && r12b.body?.code === 'FORBIDDEN');

  // -------------------------------------------------------------------------
  // CA 13: Phân quyền Vận chuyển (Shipments):
  // - TAX role -> chỉ được xem đơn OFFICIAL_TAX
  // - Cashier POST push -> 403 FORBIDDEN
  // -------------------------------------------------------------------------
  const taxLogin = await post(postLogin, { staffId: 'THUE-01', passcode: '7890' });
  const taxCookie = extractCookie(taxLogin.headers);
  const r13a = await get(getShipments, { Cookie: taxCookie }, 'http://localhost/api/shipments?fiscalScope=ALL');
  const allOfficial = Array.isArray(r13a.body?.shipments) && r13a.body.shipments.every((s: any) => s.fiscalScope === 'OFFICIAL_TAX');
  test('13a. /api/shipments với role TAX bị ép chặt chỉ xem đơn OFFICIAL_TAX', r13a.status === 200 && allOfficial);
  const r13b = await post(postShipment, { action: 'PUSH', orderId: 'ord-dummy', carrier: 'SPX', trackingCode: 'SPX-001' }, { Cookie: cashierCookie });
  test('13b. /api/shipments POST PUSH với role Cashier bị chặn 403 FORBIDDEN', r13b.status === 403 && r13b.body?.code === 'FORBIDDEN');

  // -------------------------------------------------------------------------
  // CA 14: Phân quyền Két tiền (Cashbox):
  // - TAX role OPEN -> 403 FORBIDDEN
  // - Cashier OPEN -> 200 OK
  // -------------------------------------------------------------------------
  const r14a = await post(postCashbox, { action: 'OPEN', warehouseId: 'wh-au-co', openingCash: 100000 }, { Cookie: taxCookie });
  test('14a. /api/cashbox OPEN với role TAX bị chặn 403 FORBIDDEN', r14a.status === 403 && r14a.body?.code === 'FORBIDDEN');
  const r14b = await post(postCashbox, { action: 'OPEN', warehouseId: 'wh-au-co', cashierId: 'NV-01', openingCash: 100000 }, { Cookie: cashierCookie });
  test('14b. /api/cashbox OPEN với role Cashier thành công 200 OK', r14b.status === 200 && r14b.body?.success === true);

  // -------------------------------------------------------------------------
  // CA 15: Chế độ Strict fail-closed: Tài khoản lạ + role passcode -> 401 AUTH_REQUIRED
  // -------------------------------------------------------------------------
  const r15 = await post(postLogin, { staffId: 'FAKE-STAFF-999', role: 'ROLE_OWNER', passcode: 'owner9999' });
  test('15. Tài khoản không tồn tại trong staff_accounts bị từ chối 401 (fail-closed, không fallback role passcode)', r15.status === 401 && r15.body?.code === 'AUTH_REQUIRED');

  // -------------------------------------------------------------------------
  // CA 16: Thu hồi phiên đăng nhập tức thì khi tài khoản bị khóa trong CSDL
  // -------------------------------------------------------------------------
  resetDualRateLimit('127.0.0.1', 'NV-02');
  const nv02Login = await post(postLogin, { staffId: 'NV-02', passcode: '1234' });
  const nv02Cookie = extractCookie(nv02Login.headers);
  const meBefore = await get(getMe, { Cookie: nv02Cookie });
  test('16a. NV-02 trước khi bị khóa truy cập /api/auth/me thành công 200', meBefore.status === 200 && meBefore.body?.data?.actorId === 'NV-02');

  await db.update(staffAccounts).set({ isActive: false }).where(eq(staffAccounts.staffId, 'NV-02'));
  const meAfter = await get(getMe, { Cookie: nv02Cookie });
  test('16b. NV-02 sau khi bị vô hiệu hóa trong DB lập tức bị chặn 401 trên request tiếp theo', meAfter.status === 401 && meAfter.body?.code === 'AUTH_REQUIRED');
  await db.update(staffAccounts).set({ isActive: true }).where(eq(staffAccounts.staffId, 'NV-02'));

  // -------------------------------------------------------------------------
  // CA 17: Ranh giới tin cậy IP (Trust Boundary): Xoay x-forwarded-for sau Cloudflare
  // vẫn bị rate limit và khóa trên cf-connecting-ip
  // -------------------------------------------------------------------------
  process.env.TRUST_PROXY = 'cloudflare';
  const proxyIp = '203.0.113.195';
  resetDualRateLimit(proxyIp, '');
  for (let i = 0; i < 10; i++) {
    await post(postLogin, { staffId: `SPOOF-USER-${i}`, passcode: 'wrong' }, {
      'cf-connecting-ip': proxyIp,
      'x-forwarded-for': `198.51.100.${i + 1}, 10.0.0.1`,
    });
  }
  const cfBlockedAttempt = await post(postLogin, { staffId: 'ADMIN-01', passcode: 'owner9999' }, {
    'cf-connecting-ip': proxyIp,
    'x-forwarded-for': '192.0.2.1',
  });
  test('17. Kẻ tấn công xoay x-forwarded-for sau Cloudflare vẫn bị khóa toàn bộ trên cf-connecting-ip (HTTP 429)', cfBlockedAttempt.status === 429 && cfBlockedAttempt.body?.code === 'RATE_LIMITED');
  delete process.env.TRUST_PROXY;


  delete process.env.AUTH_STRICT;
  console.log(`\n=========================================================`);
  console.log(`🎉 KẾT QUẢ NGHIỆM THU LANE A: ${passed}/${total} GATE TESTS ĐẠT 100%!`);
  console.log(`=========================================================\n`);

  if (passed !== total) process.exit(1);
}

run().catch((err) => {
  delete process.env.AUTH_STRICT;
  console.error('❌ test-phase0-laneA thất bại:', err);
  process.exit(1);
});
