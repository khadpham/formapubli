/**
 * scripts/test-shopee-oauth-refresh.ts — OAuth callback + tự refresh (Task 2).
 *
 * VÌ SAO CẦN: `access_token` sống 4 giờ. Hai cái bẫy:
 * 1. Shopee xoay `refresh_token` mỗi lần refresh — không lưu refresh mới là
 *    đứt chuỗi ủy quyền sau 4 giờ tiếp theo.
 * 2. Refresh chết mà code retry trong vòng lặp = treo worker vô tận. Quy tắc:
 *    đúng 1 lần thử lại, thất bại ném SHOPEE_AUTH_EXPIRED để tab Chủ báo Anh
 *    bấm ủy quyền lại.
 *
 * Mạng Shopee được MOCK hoàn toàn — suite này không gọi internet.
 *
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-shopee-oauth-refresh
 */
import { assertIsolatedTestDb } from './test-guard';
import { AppError } from '../src/services/app-error';
import { TursoTokenStorage } from '../src/services/shopee/token-store';
import {
  exchangeCodeForToken,
  refreshShopeeTokenOnce,
} from '../src/services/shopee/auth';

assertIsolatedTestDb('test-shopee-oauth-refresh');

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

const SHOP = 777001;
const CFG = {
  shopId: SHOP,
  partnerId: 1000,
  partnerKey: 'test-partner-key',
  baseUrl: 'https://partner.test-stable.shopeemobile.com',
};

function mockFetch(responder: (url: string, body: any) => any) {
  let calls = 0;
  const fn = (async (url: any, init: any) => {
    calls++;
    const payload = responder(String(url), JSON.parse(String(init?.body ?? '{}')));
    return { ok: true, json: async () => payload };
  }) as typeof fetch;
  return { fn, callCount: () => calls };
}

async function main() {
  // --- 1. Đổi code lấy token, lưu cả 2 token ---
  const ex = mockFetch(() => ({
    error: '',
    message: '',
    response: {
      access_token: 'acc-1',
      refresh_token: 'ref-1',
      expire_in: 14400,
      shop_id: SHOP,
    },
  }));
  const tok = await exchangeCodeForToken({ ...CFG, code: 'code-xyz', fetchFn: ex.fn });
  eq('đổi code trả access_token', tok.access_token, 'acc-1');
  const stored = await new TursoTokenStorage(SHOP).get();
  eq('access_token đã lưu DB', stored?.access_token, 'acc-1');
  eq('refresh_token đã lưu DB (xoay vòng)', stored?.refresh_token, 'ref-1');

  // --- 2. Refresh thành công PHẢI cập nhật cả refresh mới ---
  const rf = mockFetch(() => ({
    error: '',
    message: '',
    response: {
      access_token: 'acc-2',
      refresh_token: 'ref-2',
      expire_in: 14400,
      shop_id: SHOP,
    },
  }));
  const tok2 = await refreshShopeeTokenOnce({ ...CFG, fetchFn: rf.fn });
  eq('refresh trả token mới', tok2.access_token, 'acc-2');
  const stored2 = await new TursoTokenStorage(SHOP).get();
  eq('DB cập nhật access mới', stored2?.access_token, 'acc-2');
  eq('DB cập nhật refresh mới (không giữ ref-1)', stored2?.refresh_token, 'ref-2');

  // --- 3. Refresh chết: đúng 1 lần gọi, ném SHOPEE_AUTH_EXPIRED ---
  const dead = mockFetch(() => ({ error: 'error_auth', message: 'invalid refresh' }));
  let code = '';
  try {
    await refreshShopeeTokenOnce({ ...CFG, fetchFn: dead.fn });
  } catch (e) {
    code = e instanceof AppError ? e.code : `NOT_APP_ERROR:${String(e)}`;
  }
  eq('refresh chết ném SHOPEE_AUTH_EXPIRED', code, 'SHOPEE_AUTH_EXPIRED');
  eq('không vòng lặp (đúng 1 request)', dead.callCount(), 1);

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error('\n❌ test-shopee-oauth-refresh thất bại.');
    process.exit(1);
  }
  console.log('\n✅ OAUTH + REFRESH SHOPEE ĐÚNG.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ test-shopee-oauth-refresh crash:', err);
  process.exit(1);
});
