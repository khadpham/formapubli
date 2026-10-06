/**
 * scripts/test-shopee-tab-scope.ts — role + tab + phạm vi kho Shopee.
 *
 * Chạy: DATABASE_URL=file:formapubli_test.db npx tsx scripts/test-shopee-tab-scope.ts
 * hoặc: npx tsx scripts/run-isolated.ts --only=test-shopee-tab-scope
 */
import { assertIsolatedTestDb } from './test-guard';
import fs from 'node:fs';
import path from 'node:path';
import { USER_ROLES, getDefaultTabForRole } from '../src/lib/roles';
import { AppError } from '../src/services/app-error';
import {
  getShopeeConfig,
  setShopeeConfig,
  getShopeeOpsWarehouses,
  setShopeeOpsWarehouses,
} from '../src/services/shopee/shop-config';
import { db, shopeeSettings } from '../src/db';

assertIsolatedTestDb('test-shopee-tab-scope');

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
  const shopee = (USER_ROLES as Record<string, { allowedNavItems: string[] }>)['ROLE_SHOPEE_OPS'];
  eq2(
    'role Shopee nav đúng',
    JSON.stringify(shopee?.allowedNavItems),
    JSON.stringify(['shopee', 'settings'])
  );
  eq2('tab mặc định là shopee', getDefaultTabForRole('ROLE_SHOPEE_OPS' as never), 'shopee');
  eq2(
    'kho chung không thấy tab shopee',
    USER_ROLES['ROLE_WAREHOUSE'].allowedNavItems.includes('shopee'),
    false
  );
  eq2('chu thay tab shopee', USER_ROLES['ROLE_OWNER'].allowedNavItems.includes('shopee'), true);
  eq2(
    'quan ly thay tab shopee',
    USER_ROLES['ROLE_MANAGER'].allowedNavItems.includes('shopee'),
    true
  );
  eq2(
    'thu ngan khong thay tab shopee',
    USER_ROLES['ROLE_CASHIER'].allowedNavItems.includes('shopee'),
    false
  );
  eq2(
    'ke toan thue khong thay tab shopee',
    USER_ROLES['ROLE_TAX'].allowedNavItems.includes('shopee'),
    false
  );

  // Phạm vi kho đội Shopee: mặc định = kho xuất, quản lý cấp nhiều kho.
  await db.delete(shopeeSettings);
  await setShopeeConfig({ warehouseId: 'wh-au-co', codEnabled: false }, 'ROLE_OWNER');
  eq2(
    'mặc định phạm vi = kho xuất',
    JSON.stringify(await getShopeeOpsWarehouses()),
    JSON.stringify(['wh-au-co'])
  );
  let code = '';
  try {
    await setShopeeOpsWarehouses(['wh-a'], 'ROLE_CASHIER');
  } catch (e) {
    code = e instanceof AppError ? e.code : 'NOT_APP_ERROR';
  }
  eq2('thu ngan bị chặn cấp kho', code, 'FORBIDDEN');
  eq2(
    'quản lý cấp được nhiều kho',
    JSON.stringify(await setShopeeOpsWarehouses(['wh-a', 'wh-b'], 'ROLE_MANAGER')),
    JSON.stringify(['wh-a', 'wh-b'])
  );
  await setShopeeConfig({ warehouseId: '', codEnabled: false }, 'ROLE_OWNER');

  // View tab: nút Giao ẩn khi cờ tắt, đủ khối lỗi + link chờ tab Chủ.
  const tab = fs.readFileSync(path.resolve(process.cwd(), 'src/components/shopee/ShopeeTab.tsx'), 'utf8');
  eq2('tab đọc cờ server', tab.includes('/api/shopee/status'), true);
  eq2('nút giao có nhãn thao tác rõ', tab.includes('Giao đơn Shopee'), true);
  eq2('có khối đơn lỗi', tab.includes('Đơn Lỗi'), true);
  eq2('thẻ doanh thu link chờ tab Chủ', tab.includes('tab Chủ'), true);
  const awbPath = path.resolve(process.cwd(), 'src/app/api/shopee/awb/route.ts');
  eq2(
    'route in vận đơn dùng service có sẵn',
    fs.existsSync(awbPath) && fs.readFileSync(awbPath, 'utf8').includes('getAwbPdf'),
    true
  );

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error('\n❌ test-shopee-tab-scope thất bại.');
    process.exit(1);
  }
  console.log('\n✅ PHẠM VI TAB SHOPEE ĐÚNG.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ test-shopee-tab-scope crash:', err);
  process.exit(1);
});
