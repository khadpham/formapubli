/**
 * Login chạm-chọn + quản trị tài khoản (DB cách ly).
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-login-accounts
 * 12 cases: list public không rò hash / tile-login đúng-sai PIN /
 * OWNER tạo user / MANAGER bị chặn tạo OWNER / reset PIN / khóa-mở /
 * CASHIER 403 staff API / chống leo thang / chống tự khóa / trùng mã 409.
 */
import { GET as getAccounts } from '../src/app/api/auth/accounts/route';
import { GET as listStaff, POST as createStaff } from '../src/app/api/staff/route';
import { PATCH as patchStaff } from '../src/app/api/staff/[staffId]/route';
import { POST as postLogin } from '../src/app/api/auth/login/route';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-login-accounts');

process.env.AUTH_SECRET = 'test-login-accounts-secret-32ch!!';
process.env.AUTH_STRICT = 'true';

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;
const J = (o: any) => JSON.stringify(o);

const get = (fn: any, headers: Record<string, string> = {}) =>
  fn(new Request('http://localhost/x', { headers }) as any).then(async (r: any) => ({
    status: r.status,
    body: await r.json(),
  }));

const post = (fn: any, body: any, headers: Record<string, string> = {}) =>
  fn(
    new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: J(body),
    }) as any
  ).then(async (r: any) => ({ status: r.status, body: await r.json(), headers: r.headers }));

const patch = (staffId: string, body: any, headers: Record<string, string> = {}) =>
  patchStaff(
    new Request('http://localhost/x', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: J(body),
    }) as any,
    { params: { staffId } }
  ).then(async (r: any) => ({ status: r.status, body: await r.json() }));

function sessionCookie(setCookie: string | null): string {
  const m = `${setCookie || ''}`.match(/formapubli_session=([^;]+)/);
  return m ? `formapubli_session=${m[1]}` : '';
}

async function loginAs(staffId: string, passcode: string) {
  const r: any = await post(postLogin, { staffId, passcode });
  return { status: r.status, body: r.body, cookie: sessionCookie(r.headers.get('set-cookie')) };
}

async function run() {
  console.log('👆 LOGIN CHẠM-CHỌN + QUẢN TRỊ TÀI KHOẢN (DB cách ly, AUTH_STRICT=true)');
  let passed = 0;
  const total = 12;
  const ok = (name: string, cond: boolean, extra = '') => {
    if (cond) {
      passed++;
      console.log(`✅ PASS: ${name}${extra ? ` (${extra})` : ''}`);
    } else {
      console.log(`❌ FAIL: ${name}${extra ? ` (${extra})` : ''}`);
    }
  };

  const owner = await loginAs('ADMIN-01', 'owner9999');
  const manager = await loginAs('QL-01', 'manager8888');
  const ownerCk = { Cookie: owner.cookie };
  const managerCk = { Cookie: manager.cookie };

  // 1. List public cho màn hình chạm-chọn: 200, có NV-01, KHÔNG rò hash/salt.
  const r1: any = await get(getAccounts);
  const leaked = J(r1.body).includes('passcodeHash') || J(r1.body).includes('salt');
  ok(
    '1. List public 200, có NV-01, không rò hash/salt',
    r1.status === 200 && r1.body?.data?.some((a: any) => a.staffId === 'NV-01') && !leaked
  );

  // 2. Tile-login: chọn NV-01 + PIN 1234 → 200 + cookie.
  const r2 = await loginAs('NV-01', '1234');
  ok('2. Chạm NV-01 + PIN đúng mở ca', r2.status === 200 && !!r2.cookie);

  // 3. PIN sai → 401 + còn lượt thử.
  const r3 = await loginAs('NV-01', '0000');
  ok('3. PIN sai 401 + đếm lượt', r3.status === 401 && r3.body?.remainingAttempts >= 0);

  // 4. MANAGER tạo OWNER → 403 chống leo thang.
  const r4: any = await post(
    createStaff,
    { staffId: uniq('EVIL'), fullName: 'Kẻ leo thang', role: 'ROLE_OWNER', passcode: 'evil12345' },
    managerCk
  );
  ok('4. MANAGER tạo OWNER bị 403', r4.status === 403);

  // 5. OWNER tạo NV mới → 200 + login được.
  const nvId = uniq('NV');
  const r5: any = await post(
    createStaff,
    { staffId: nvId, fullName: 'Thu Ngân Mới', role: 'ROLE_CASHIER', passcode: '4321' },
    ownerCk
  );
  const r5login = await loginAs(nvId, '4321');
  ok('5. OWNER tạo NV + login được', r5.status === 200 && r5login.status === 200, nvId);

  // 6. MANAGER tạo thu ngân → 200.
  const nvM = uniq('NVM');
  const r6: any = await post(
    createStaff,
    { staffId: nvM, fullName: 'Thu Ngân M', role: 'ROLE_CASHIER', passcode: '5678' },
    managerCk
  );
  ok('6. MANAGER tạo thu ngân 200', r6.status === 200, nvM);

  // 7. OWNER reset PIN → PIN mới vào được, PIN cũ chết.
  const r7: any = await patch(nvId, { passcode: '9999' }, ownerCk);
  const r7new = await loginAs(nvId, '9999');
  const r7old = await loginAs(nvId, '4321');
  ok('7. Reset PIN: mới 200 + cũ 401', r7.status === 200 && r7new.status === 200 && r7old.status === 401);

  // 8. MANAGER khóa NV → login 403; mở lại → 200.
  const r8a: any = await patch(nvM, { isActive: false }, managerCk);
  const r8locked = await loginAs(nvM, '5678');
  const r8b: any = await patch(nvM, { isActive: true }, managerCk);
  const r8open = await loginAs(nvM, '5678');
  ok(
    '8. Khóa 403 + mở lại 200',
    r8a.status === 200 && r8locked.status === 403 && r8b.status === 200 && r8open.status === 200
  );

  // 9. CASHIER gọi staff API → 403.
  const cashier = await loginAs('NV-01', '1234');
  const r9: any = await get(listStaff, { Cookie: cashier.cookie });
  ok('9. CASHIER xem staff 403', r9.status === 403);

  // 10. MANAGER phong OWNER / sờ ADMIN-01 → 403 cả hai.
  const r10a: any = await patch(nvM, { role: 'ROLE_OWNER' }, managerCk);
  const r10b: any = await patch('ADMIN-01', { isActive: false }, managerCk);
  ok('10. Chống leo thang + sờ Owner 403', r10a.status === 403 && r10b.status === 403);

  // 11. OWNER không tự khóa mình → 400.
  const r11: any = await patch('ADMIN-01', { isActive: false }, ownerCk);
  const r11login = await loginAs('ADMIN-01', 'owner9999');
  ok('11. Chống tự khóa 400 + vẫn login được', r11.status === 400 && r11login.status === 200);

  // 12. Trùng mã → 409.
  const r12: any = await post(
    createStaff,
    { staffId: 'NV-01', fullName: 'Trùng', role: 'ROLE_CASHIER', passcode: '1111' },
    ownerCk
  );
  ok('12. Trùng mã 409', r12.status === 409);

  console.log(`\n${passed === total ? '🎉' : '⚠️'} LOGIN-ACCOUNTS: ${passed}/${total} ${passed === total ? 'PASS' : 'CÓ FAIL'}`);
  if (passed !== total) process.exit(1);
}

run().catch((err) => {
  console.error('❌ test-login-accounts thất bại:', err);
  process.exit(1);
});
