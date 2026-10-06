/**
 * scripts/test-owner-tab.ts — tab Chủ GĐ1: bảng chi phí + quyền + API + nav.
 *
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-owner-tab
 */
import { assertIsolatedTestDb } from './test-guard';
import fs from 'node:fs';
import path from 'node:path';
import { USER_ROLES, getDefaultTabForRole } from '../src/lib/roles';
import { AppError } from '../src/services/app-error';
import {
  EXPENSE_CATEGORIES,
  listExpenses,
  addExpense,
} from '../src/services/expense.service';
import { db, expenseEntries } from '../src/db';

assertIsolatedTestDb('test-owner-tab');

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
  // Quyền: chỉ Chủ ghi/đọc chi phí.
  let code = '';
  try {
    await addExpense({ category: 'SALARY', amount: 1000 }, 'ROLE_MANAGER', 'QL-01');
  } catch (e) {
    code = e instanceof AppError ? e.code : 'NOT_APP_ERROR';
  }
  eq2('quản lý bị chặn ghi chi phí', code, 'FORBIDDEN');

  code = '';
  try {
    await addExpense({ category: 'SALARY', amount: 0 }, 'ROLE_OWNER', 'ADMIN-01');
  } catch (e) {
    code = e instanceof AppError ? e.code : 'NOT_APP_ERROR';
  }
  eq2('tiền 0 bị chặn', code, 'INVALID_INPUT');

  code = '';
  try {
    await addExpense({ category: 'XYZ', amount: 1000 }, 'ROLE_OWNER', 'ADMIN-01');
  } catch (e) {
    code = e instanceof AppError ? e.code : 'NOT_APP_ERROR';
  }
  eq2('loại lạ bị chặn', code, 'INVALID_INPUT');

  await db.delete(expenseEntries);
  const a = await addExpense(
    { category: 'SALARY', amount: 5000000, note: 'lương tháng 10' },
    'ROLE_OWNER',
    'ADMIN-01'
  );
  const b = await addExpense({ category: 'OTHER', amount: 100000 }, 'ROLE_OWNER', 'ADMIN-01');
  eq2('chủ thêm được chi phí', a.category, 'SALARY');
  eq2('loại RENT được chấp nhận', EXPENSE_CATEGORIES.includes('RENT'), true);
  const all = await listExpenses();
  const total = all.reduce((s, e) => s + e.amount, 0);
  eq2('danh sách đủ 2 dòng', all.length, 2);
  eq2('tổng chi phí đúng', total, 5100000);
  eq2('người ghi được lưu', b.createdBy, 'ADMIN-01');

  // API route tồn tại + đúng nguồn dữ liệu.
  const routePath = path.resolve(process.cwd(), 'src/app/api/owner/finance/route.ts');
  const route = fs.existsSync(routePath) ? fs.readFileSync(routePath, 'utf8') : '';
  eq2('route finance tồn tại', route.length > 0, true);
  eq2('route đọc escrow từ bảng shopee_order_finance', route.includes('shopeeOrderFinance'), true);
  eq2('route ép quyền OWNER', route.includes('ROLE_OWNER'), true);

  // Nav: tab chu là mặc định của Chủ, role khác không thấy.
  eq2('tab mặc định của Chủ là chu', getDefaultTabForRole('ROLE_OWNER'), 'chu');
  eq2(
    'quản lý không thấy tab chu',
    USER_ROLES['ROLE_MANAGER'].allowedNavItems.includes('chu'),
    false
  );
  eq2(
    'thu ngân không thấy tab chu',
    USER_ROLES['ROLE_CASHIER'].allowedNavItems.includes('chu'),
    false
  );

  // UI: 3 khối theo spec.
  const tabPath = path.resolve(process.cwd(), 'src/components/owner/OwnerTab.tsx');
  const tab = fs.existsSync(tabPath) ? fs.readFileSync(tabPath, 'utf8') : '';
  eq2('tab gọi API finance', tab.includes('/api/owner/finance'), true);
  eq2('tab có khối Lãi ròng', tab.includes('Lãi ròng'), true);
  eq2('tab có nút Thêm chi phí', tab.includes('Thêm chi phí'), true);

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error('\n❌ test-owner-tab thất bại.');
    process.exit(1);
  }
  console.log('\n✅ TAB CHỦ GĐ1 ĐÚNG.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ test-owner-tab crash:', err);
  process.exit(1);
});
