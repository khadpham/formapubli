/**
 * scripts/test-bank-list-inactive.ts — TK ngân hàng tạm ngưng phải VẪN HIỆN
 * trong list quản lý (Cài Đặt → Tài khoản ngân hàng), chỉ đổi trạng thái.
 *
 * VÌ SAO CẦN: Chủ bấm "Bấm để tạm ngưng" → TK biến mất khỏi list (GET lọc
 * isActive=true) ⇒ tưởng đã xóa mất. POS thì ĐÚNG phải chỉ thấy TK active.
 *
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-bank-list-inactive
 */
import { assertIsolatedTestDb } from './test-guard';
import fs from 'node:fs';
import path from 'node:path';
import { db, bankAccounts } from '../src/db';
import { WarehouseService } from '../src/services/warehouse.service';

assertIsolatedTestDb('test-bank-list-inactive');

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
  // Seed: 1 TK active + 1 TK ngưng (giống PATCH setIsActive=false — KHÔNG xóa).
  await db.delete(bankAccounts);
  await db.insert(bankAccounts).values([
    { id: 'bank-active-01', label: 'TK chính', bankBin: '970436', accountNo: '0123456789', isActive: true },
    { id: 'bank-paused-01', label: 'TK cũ', bankBin: '970422', accountNo: '9876543210', isActive: false },
  ]);

  // POS/service: chỉ thấy TK active (đúng, giữ nguyên).
  const activeList: Array<{ id: string }> = await WarehouseService.listBankAccounts();
  eq2('POS chỉ thấy TK active', activeList.some((b) => b.id === 'bank-paused-01'), false);
  eq2('POS thấy TK chính', activeList.some((b) => b.id === 'bank-active-01'), true);

  // Route quản lý: phải có nhánh includeInactive trả đủ cả TK ngưng.
  const routePath = path.resolve(process.cwd(), 'src/app/api/bank-accounts/route.ts');
  const route = fs.readFileSync(routePath, 'utf8');
  eq2('route có nhánh includeInactive', route.includes('includeInactive'), true);
  eq2(
    'nhánh includeInactive chỉ cho OWNER/MANAGER',
    /includeInactive[\s\S]{0,400}ROLE_OWNER[\s\S]{0,80}ROLE_MANAGER|ROLE_OWNER[\s\S]{0,400}includeInactive/.test(route),
    true
  );

  // UI quản lý phải fetch includeInactive (không phải fetch thường).
  const uiPath = path.resolve(process.cwd(), 'src/components/settings/BankAccountsManager.tsx');
  const ui = fs.readFileSync(uiPath, 'utf8');
  eq2('UI quản lý fetch kèm includeInactive', ui.includes('includeInactive=1'), true);
  eq2('UI giữ nhãn trạng thái Tạm ngưng', ui.includes('Tạm ngưng'), true);

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error('\n❌ test-bank-list-inactive thất bại.');
    process.exit(1);
  }
  console.log('\n✅ TK NGƯNG VẪN HIỆN TRONG QUẢN LÝ.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ test-bank-list-inactive crash:', err);
  process.exit(1);
});
