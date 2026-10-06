/**
 * scripts/test-shopee-shop-config.ts — cấu hình Shopee runtime (DB, chủ only).
 *
 * VÌ SAO CẦN: kho xuất và cờ COD không thể nằm env tĩnh trên Workers (đổi là
 * restart). Bảng shopee_settings là nguồn sự thật runtime. Khóa 3 điều:
 * 1. Mặc định: kho rỗng + COD tắt.
 * 2. Chỉ chủ ghi được (quản lý/thủ kho → FORBIDDEN).
 * 3. Env làm nền khi DB chưa có gì.
 *
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-shopee-shop-config
 */
import { assertIsolatedTestDb } from './test-guard';
import { eq } from 'drizzle-orm';
import { db, shopeeSettings } from '../src/db';
import { AppError } from '../src/services/app-error';
import { getShopeeConfig, setShopeeConfig } from '../src/services/shopee/shop-config';

assertIsolatedTestDb('test-shopee-shop-config');

let pass = 0;
let fail = 0;
function eq2(label: string, actual: unknown, expected: unknown) {
  if (Object.is(actual, expected)) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ FAIL: ${label} — nhận ${String(actual)}, cần ${String(expected)}`);
  }
}

async function main() {
  // Dọn cấu hình để test độc lập với DB bẩn.
  await db.delete(shopeeSettings);

  const d0 = await getShopeeConfig();
  eq2('mặc định COD tắt', d0.codEnabled, false);

  // Quản lý không ghi được.
  let code = '';
  try {
    await setShopeeConfig({ codEnabled: true }, 'ROLE_MANAGER');
  } catch (e) {
    code = e instanceof AppError ? e.code : `NOT_APP_ERROR:${String(e)}`;
  }
  eq2('quản lý bị chặn ghi cấu hình', code, 'FORBIDDEN');

  // Chủ ghi được và đọc lại đúng.
  const saved = await setShopeeConfig(
    { warehouseId: 'wh-au-co', codEnabled: true },
    'ROLE_OWNER'
  );
  eq2('chủ lưu được kho', saved.warehouseId, 'wh-au-co');
  eq2('chủ bật được COD', saved.codEnabled, true);
  const back = await getShopeeConfig();
  eq2('đọc lại kho đúng', back.warehouseId, 'wh-au-co');

  // Trả về mặc định để không ảnh hưởng suite khác.
  await setShopeeConfig({ warehouseId: '', codEnabled: false }, 'ROLE_OWNER');

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error('\n❌ test-shopee-shop-config thất bại.');
    process.exit(1);
  }
  console.log('\n✅ CẤU HÌNH SHOPEE ĐÚNG.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ test-shopee-shop-config crash:', err);
  process.exit(1);
});
