/**
 * scripts/test-shopee-tab-scope.ts — role + tab + phạm vi kho Shopee.
 *
 * Chạy: DATABASE_URL=file:formapubli_test.db npx tsx scripts/test-shopee-tab-scope.ts
 * hoặc: npx tsx scripts/run-isolated.ts --only=test-shopee-tab-scope
 */
import { assertIsolatedTestDb } from './test-guard';
import { USER_ROLES, getDefaultTabForRole } from '../src/lib/roles';

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
