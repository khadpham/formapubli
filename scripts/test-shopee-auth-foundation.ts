/**
 * scripts/test-shopee-auth-foundation.ts — nền móng xác thực Shopee (Task 1).
 *
 * VÌ SAO CẦN: mọi request Shopee đều ký HMAC-SHA256; sai thứ tự ghép chuỗi là
 * Shopee trả `error_sign` dù key đúng — lỗi này khó debug vì nhìn qua tưởng
 * đúng. Hai vector HMAC dưới được tính ĐỘC LẬP bằng .NET
 * (System.Security.Cryptography.HMACSHA256), không dùng code của repo, nên
 * test này khóa chặt thuật toán ký.
 *
 * Thứ hai: token CẤM nằm RAM/file trên Workers — phải tròn vòng qua bảng
 * `shopee_shop_tokens` (migration 0038).
 *
 * Chạy: DATABASE_URL=file:formapubli_test.db npx tsx scripts/test-shopee-auth-foundation.ts
 * (hoặc qua runner: npx tsx scripts/run-isolated.ts --only=test-shopee-auth-foundation)
 */
import { assertIsolatedTestDb } from './test-guard';
import { generateShopeeSign } from '../src/services/shopee/sign';
import { TursoTokenStorage } from '../src/services/shopee/token-store';

assertIsolatedTestDb('test-shopee-auth-foundation');

let pass = 0;
let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  if (Object.is(actual, expected)) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ FAIL: ${label} — nhận ${String(actual)}, cần ${String(expected)}`);
  }
}

console.log('=== TEST: SHOPEE AUTH FOUNDATION ===\n');

// --- 1. Vector HMAC không token (tính độc lập bằng .NET) ---
const v1 = generateShopeeSign({
  partnerId: 1000,
  partnerKey: 'test-partner-key',
  apiPath: '/api/v2/order/get_order_list',
  timestamp: 1700000000,
});
eq(
  'sign khớp vector .NET (không token)',
  v1.sign,
  '430b3d6ee8d5d63a34b9884e189949e3033ca492f6d10faeff94ae0c26f57779'
);
eq('timestamp giữ nguyên giá trị truyền vào', v1.timestamp, 1700000000);

// --- 2. Vector HMAC có token + shop (tính độc lập bằng .NET) ---
const v2 = generateShopeeSign({
  partnerId: 1000,
  partnerKey: 'test-partner-key',
  apiPath: '/api/v2/order/get_order_list',
  timestamp: 1700000000,
  accessToken: 'tok-abc',
  shopId: 42,
});
eq(
  'sign khớp vector .NET (có token+shop)',
  v2.sign,
  '8575c318a1f7cf867c67011e3634afa6e66567e01ba679a837aae80497eb36a1'
);

// --- 3. Token tròn vòng qua Turso, không qua RAM ---
async function main() {
  const store = new TursoTokenStorage(424242);
  await store.store({
    access_token: 'acc-test-1',
    refresh_token: 'ref-test-1',
    expired_at: Date.now() + 4 * 3600 * 1000,
    shop_id: 424242,
  });
  const back = await store.get();
  eq('đọc lại được access_token', back?.access_token, 'acc-test-1');
  eq('đọc lại được refresh_token', back?.refresh_token, 'ref-test-1');
  eq('đọc lại đúng shop_id', back?.shop_id, 424242);

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error('\n❌ test-shopee-auth-foundation thất bại.');
    process.exit(1);
  }
  console.log('\n✅ NỀN MÓNG AUTH SHOPEE ĐÚNG.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ test-shopee-auth-foundation crash:', err);
  process.exit(1);
});
