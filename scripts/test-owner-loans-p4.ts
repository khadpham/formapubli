/**
 * scripts/test-owner-loans-p4.ts — tab Chủ GĐ3-P4: nợ vay + khóa sổ + quét rò rỉ.
 *
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-owner-loans-p4
 */
import { assertIsolatedTestDb } from './test-guard';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../src/db';
import { sql } from 'drizzle-orm';
import { AppError } from '../src/services/app-error';
import { LoanService } from '../src/services/loan.service';
import { PeriodLockService } from '../src/services/period-lock.service';
import { addExpense } from '../src/services/expense.service';

assertIsolatedTestDb('test-owner-loans-p4');

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
async function expectCode(label: string, fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
    fail++;
    console.log(`  ❌ FAIL: ${label} — không ném lỗi`);
  } catch (e) {
    eq2(label, e instanceof AppError ? e.code : 'NOT_APP_ERROR', code);
  }
}

async function main() {
  const OWNER = 'ROLE_OWNER' as any;
  // 1. Migration 0049.
  for (const t of ['loans', 'loan_payments', 'period_locks']) {
    const r: any[] = await db.all(sql`SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name=${t}`);
    eq2(`bảng ${t} tồn tại`, Number(r[0]?.c), 1);
  }

  // 2. RBAC nợ vay + khóa sổ.
  await expectCode('quản lý không tạo được khoản vay', () =>
    LoanService.create({ lender: 'X', principal: 1, borrowedAt: '2026-10-01', actorRole: 'ROLE_MANAGER' as any, actorId: 'QL-01' }), 'FORBIDDEN');
  await expectCode('thủ kho không xem được nợ vay', () => LoanService.overview('ROLE_WAREHOUSE' as any), 'FORBIDDEN');
  await expectCode('kế toán không khóa được sổ', () =>
    PeriodLockService.lock('2026-09', 'ROLE_TAX' as any, 'KT-01'), 'FORBIDDEN');

  // 3. Vòng đời khoản vay.
  const loan = await LoanService.create({
    lender: 'Anh Ba', principal: 100000000, interestRate: 8,
    borrowedAt: '2026-10-01', dueAt: '2027-10-01', actorRole: OWNER, actorId: 'ADMIN-01',
  });
  eq2('mã khoản vay', loan.code.startsWith('VAY-'), true);
  let ov = await LoanService.overview(OWNER);
  eq2('dư nợ 100tr', ov.totalOutstanding, 100000000);

  // Trả 30tr (gốc 25tr + lãi 5tr).
  await LoanService.recordPayment({
    loanId: loan.id, amount: 30000000, principalAmount: 25000000, interestAmount: 5000000,
    paidAt: '2026-11-01', actorRole: OWNER, actorId: 'ADMIN-01',
  });
  ov = await LoanService.overview(OWNER);
  eq2('dư nợ còn 75tr', ov.totalOutstanding, 75000000);
  const l1 = ov.loans.find((l) => l.id === loan.id);
  eq2('đã trả lãi 5tr', l1?.paidInterest, 5000000);

  // Gốc + lãi không khớp số tiền → chặn.
  await expectCode('gốc+lãi lệch bị chặn', () =>
    LoanService.recordPayment({
      loanId: loan.id, amount: 10000000, principalAmount: 9000000, interestAmount: 500000,
      paidAt: '2026-12-01', actorRole: OWNER, actorId: 'ADMIN-01',
    }), 'INVALID_INPUT');

  // Trả hết gốc → tự động PAID.
  await LoanService.recordPayment({
    loanId: loan.id, amount: 75000000, paidAt: '2026-12-15', actorRole: OWNER, actorId: 'ADMIN-01',
  });
  ov = await LoanService.overview(OWNER);
  eq2('hết dư nợ', ov.totalOutstanding, 0);
  eq2('trạng thái PAID', ov.loans.find((l) => l.id === loan.id)?.status, 'PAID');

  // 4. Khoản sắp đến hạn.
  const soon = new Date(Date.now() + 10 * 86400000);
  const dueStr = soon.toISOString().slice(0, 10);
  await LoanService.create({
    lender: 'Chị Tư', principal: 50000000, borrowedAt: '2026-09-01', dueAt: dueStr,
    actorRole: OWNER, actorId: 'ADMIN-01',
  });
  ov = await LoanService.overview(OWNER);
  eq2('cảnh báo 1 khoản sắp đến hạn', ov.dueSoon.length, 1);
  eq2('đúng chủ nợ Chị Tư', ov.dueSoon[0]?.lender, 'Chị Tư');

  // 5. Khóa sổ: khóa kỳ 2026-09 → ghi chi phí kỳ đó bị chặn.
  await PeriodLockService.lock('2026-09', OWNER, 'ADMIN-01', 'Quyết toán xong');
  eq2('kỳ 2026-09 đã khóa', await PeriodLockService.isLocked('2026-09'), true);
  eq2('kỳ 2026-10 chưa khóa', await PeriodLockService.isLocked('2026-10'), false);
  await expectCode('ghi chi phí kỳ đã khóa bị chặn', () =>
    addExpense({ category: 'OPERATIONS', amount: 100000, entryDate: '2026-09-15' }, OWNER, 'ADMIN-01'), 'FORBIDDEN');
  // Kỳ chưa khóa vẫn ghi được.
  const exp = await addExpense({ category: 'OPERATIONS', amount: 100000, entryDate: '2026-10-15' }, OWNER, 'ADMIN-01');
  eq2('ghi chi phí kỳ mở ok', exp.amount, 100000);
  // Mở khóa → ghi lại được.
  await PeriodLockService.unlock('2026-09', OWNER, 'ADMIN-01');
  eq2('đã mở khóa', await PeriodLockService.isLocked('2026-09'), false);
  const exp2 = await addExpense({ category: 'OPERATIONS', amount: 50000, entryDate: '2026-09-20' }, OWNER, 'ADMIN-01');
  eq2('ghi sau mở khóa ok', exp2.amount, 50000);

  // 6. Quét rò rỉ mở rộng: không API non-owner nào chạm dữ liệu nhạy cảm mới.
  const apiDir = path.join(process.cwd(), 'src', 'app', 'api');
  const allowed = new Set([path.join(apiDir, 'owner')]);
  const leaks: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!p.endsWith('.ts')) continue;
      const src = fs.readFileSync(p, 'utf8');
      if (!/unitCostSnapshot|unitCostAgreed|from\(loans\)|from\(loanPayments\)|from\(periodLocks\)|LoanService|PeriodLockService/.test(src)) continue;
      const isAllowed = [...allowed].some((a) => p === a || p.startsWith(a + path.sep));
      // Ngoại lệ duy nhất: route movement gắn giá vốn server-side (không trả về).
      const isMovement = p === path.join(apiDir, 'inventory', 'movement', 'route.ts');
      if (!isAllowed && !isMovement) leaks.push(path.relative(process.cwd(), p));
    }
  };
  walk(apiDir);
  eq2('không rò rỉ dữ liệu nhạy cảm ra API non-owner', leaks.length, 0);
  if (leaks.length) console.log('   rò rỉ tại:', leaks.join(', '));

  console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'}: ${pass} đạt, ${fail} hỏng`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('❌ EXCEPTION:', e);
  process.exit(1);
});
