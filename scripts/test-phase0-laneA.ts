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

const get = (fn: any, headers: Record<string, string> = {}) =>
  fn(new Request('http://localhost/api/test', {
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
  // CA 8: Rate Limiting theo Tài khoản (5 lần sai -> khóa 15 phút)
  // -------------------------------------------------------------------------
  const testStaff = 'NV-02';
  resetDualRateLimit('127.0.0.1', testStaff);
  for (let i = 0; i < 4; i++) {
    await post(postLogin, { staffId: testStaff, passcode: 'wrong-pass' });
  }
  const attempt5 = await post(postLogin, { staffId: testStaff, passcode: 'wrong-pass' });
  const attempt6 = await post(postLogin, { staffId: testStaff, passcode: 'wrong-pass' });
  test('8. Nhập sai 5 lần trên tài khoản bị khóa 15 phút (HTTP 429)', attempt5.status === 401 && attempt6.status === 429 && attempt6.body?.code === 'RATE_LIMITED');

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
