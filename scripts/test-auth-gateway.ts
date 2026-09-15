/**
 * KIỂM THỬ BẢO MẬT AUTH GATEWAY & SIGNED SESSION COOKIE
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-auth-gateway
 */
import { assertIsolatedTestDb } from './test-guard';
import {
  signSession,
  verifySession,
  verifyRolePasscode,
  checkRateLimit,
  recordFailedAttempt,
  resetRateLimit,
} from '../src/lib/auth-session';

assertIsolatedTestDb('test-auth-gateway');

async function run() {
  console.log('🔒 KIỂM THỬ BẢO MẬT AUTH GATEWAY & SIGNED SESSION');
  let passed = 0;
  const total = 8;

  const ok = (name: string, cond: boolean, extra = '') => {
    if (cond) {
      passed++;
      console.log(`✅ PASS: ${name}${extra ? ` (${extra})` : ''}`);
    } else {
      console.log(`❌ FAIL: ${name}${extra ? ` (${extra})` : ''}`);
    }
  };

  // 1. Ký và Verify Session hợp lệ
  const now = Date.now();
  const token = await signSession({
    role: 'ROLE_CASHIER',
    actorId: 'Cashier-01',
    issuedAt: now,
    expiresAt: now + 3600 * 1000,
  });

  const verified = await verifySession(token);
  ok('1. Ký & xác thực Session HMAC-SHA256 chuẩn xác', verified?.role === 'ROLE_CASHIER' && verified?.actorId === 'Cashier-01');

  // 2. Chặn đứng Token bị giả mạo Payload (sửa role từ CASHIER thành OWNER)
  const parts = token.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({
    role: 'ROLE_OWNER',
    actorId: 'Hacker',
    issuedAt: now,
    expiresAt: now + 3600 * 1000,
  })).toString('base64url');
  const forgedToken = `${forgedPayload}.${parts[1]}`;

  const forgedRes = await verifySession(forgedToken);
  ok('2. Chặn token giả mạo payload (HMAC mismatch)', forgedRes === null);

  // 3. Chặn đứng Token bị giả mạo Signature
  const badSigToken = `${parts[0]}.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`;
  const badSigRes = await verifySession(badSigToken);
  ok('3. Chặn token có chữ ký giả mạo', badSigRes === null);

  // 4. Chặn đứng Token quá hạn (Expired Session)
  const expiredToken = await signSession({
    role: 'ROLE_CASHIER',
    actorId: 'Cashier-Old',
    issuedAt: now - 15 * 3600 * 1000,
    expiresAt: now - 1000, // Quá hạn 1 giây
  });
  const expiredRes = await verifySession(expiredToken);
  ok('4. Chặn token đã hết hạn 12h (Expired)', expiredRes === null);

  // 5. Xác thực Passcode theo từng Role
  ok('5. Xác thực đúng Passcode từng vai trò',
    verifyRolePasscode('ROLE_CASHIER', '1234') === true &&
    verifyRolePasscode('ROLE_OWNER', 'owner9999') === true &&
    verifyRolePasscode('ROLE_MANAGER', 'manager8888') === true &&
    verifyRolePasscode('ROLE_CASHIER', '9999_wrong') === false
  );

  // 6. Rate Limiting: Ghi nhận lần sai & đếm lùi
  const testKey = '127.0.0.1:tester-brute';
  resetRateLimit(testKey);

  const a1 = recordFailedAttempt(testKey);
  const a2 = recordFailedAttempt(testKey);
  ok('6. Đếm số lần sai lùi dần', a1.remainingAttempts === 4 && a2.remainingAttempts === 3 && !a2.locked);

  // 7. Rate Limiting: Khóa sau 5 lần sai liên tiếp
  recordFailedAttempt(testKey); // 3
  recordFailedAttempt(testKey); // 4
  const a5 = recordFailedAttempt(testKey); // 5 -> Khóa
  const checkLock = checkRateLimit(testKey);
  ok('7. Khóa 15 phút sau 5 lần đoán sai liên tiếp', a5.locked === true && checkLock.allowed === false && (checkLock.waitMinutes ?? 0) >= 14);

  // 8. Reset Rate Limiting khi đăng nhập thành công
  resetRateLimit(testKey);
  const afterReset = checkRateLimit(testKey);
  ok('8. Mở khóa khi Reset Rate Limit thành công', afterReset.allowed === true);

  console.log(`\n${passed === total ? '🎉' : '⚠️'} AUTH GATEWAY: ${passed}/${total} cases ${passed === total ? 'PASS 100%' : 'CÓ FAIL'}`);
  if (passed !== total) process.exit(1);
}

run().catch((err) => {
  console.error('❌ test-auth-gateway thất bại:', err);
  process.exit(1);
});
