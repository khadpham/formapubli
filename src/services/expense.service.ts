import { desc, eq, like } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, expenseEntries, staffAccounts } from '@/db';
import { AppError } from './app-error';
import type { UserRole } from '@/lib/roles';
import { vnDayOf } from '@/lib/vn-time';
import { recordAuditLog } from '@/lib/rbac-guard';
import { PeriodLockService } from './period-lock.service';

/** Loại chi phí hợp lệ — nguồn sự thật cho test + UI. GĐ2 mở rộng ở ĐÂY. */
export const EXPENSE_CATEGORIES = [
  'SALARY',
  'BONUS',
  'RENT_LOCATION',
  'UTILITIES',
  'EQUIPMENT',
  'OPERATIONS',
  'OTHER',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** Tính chất chi phí: định kỳ hàng tháng (cố định) | phát sinh một lần. */
export const EXPENSE_RECURRENCES = ['MONTHLY', 'ONE_TIME'] as const;
export type ExpenseRecurrence = (typeof EXPENSE_RECURRENCES)[number];

const STAFF_REQUIRED_CATEGORIES: readonly string[] = ['SALARY', 'BONUS'];

export interface ExpenseEntry {
  id: string;
  category: string;
  amount: number;
  note: string | null;
  entryDate: string;
  createdBy: string;
  staffId: string | null;
  recurrence: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

/**
 * Tab Chủ: chi phí ghi tay, chỉ Chủ. GĐ2: sửa được + audit (mỗi lần sửa có
 * dòng EXPENSE_UPDATED); lương/thưởng gắn nhân viên; kỳ định kỳ/phát sinh.
 */
export async function listExpenses(limit = 100): Promise<ExpenseEntry[]> {
  const rows = await db
    .select()
    .from(expenseEntries)
    .orderBy(desc(expenseEntries.entryDate), desc(expenseEntries.createdAt))
    .limit(limit);
  return rows;
}

/** Lọc theo tháng VN từ `entry_date` — tiền tố 7 ký tự an toàn cho kỳ tháng. */
export async function listExpensesMonth(month: string): Promise<ExpenseEntry[]> {
  const clean = `${month || ''}`.trim();
  if (!/^\d{4}-\d{2}$/.test(clean)) {
    throw AppError.invalid('Kỳ phải dạng YYYY-MM.');
  }
  return await db
    .select()
    .from(expenseEntries)
    .where(like(expenseEntries.entryDate, `${clean}-%`))
    .orderBy(desc(expenseEntries.entryDate), desc(expenseEntries.createdAt));
}

async function validateAndShape(
  input: { category: string; amount: number; note?: string; entryDate?: string; staffId?: string; recurrence?: string },
  actorRole: UserRole,
  actorId: string
): Promise<{ row: typeof expenseEntries.$inferInsert; entry: ExpenseEntry }> {
  if (actorRole !== 'ROLE_OWNER') {
    throw AppError.forbidden('Chỉ chủ mới được ghi chi phí công ty.');
  }
  if (!actorId) throw AppError.forbidden('Thiếu định danh người ghi.');
  const category = `${input.category || ''}`.trim() as ExpenseCategory;
  if (!(EXPENSE_CATEGORIES as readonly string[]).includes(category)) {
    throw AppError.invalid(`Loại chi phí phải là một trong: ${EXPENSE_CATEGORIES.join(', ')}.`);
  }
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw AppError.invalid('Số tiền chi phí phải lớn hơn 0.');
  }
  // Lương/thưởng phải gắn người — lương không người là dòng mù, không đối soát được.
  const staffId = `${input.staffId || ''}`.trim() || null;
  if (STAFF_REQUIRED_CATEGORIES.includes(category) && !staffId) {
    throw AppError.invalid('Chi phí Lương/Thưởng phải chọn nhân viên.');
  }
  if (staffId) {
    const st = await db
      .select({ staffId: staffAccounts.staffId })
      .from(staffAccounts)
      .where(eq(staffAccounts.staffId, staffId))
      .limit(1);
    if (st.length === 0) throw AppError.invalid(`Nhân viên ${staffId} không tồn tại.`);
  }
  const recurrence = (`${input.recurrence || ''}`.trim() || 'ONE_TIME') as ExpenseRecurrence;
  if (!(EXPENSE_RECURRENCES as readonly string[]).includes(recurrence)) {
    throw AppError.invalid('Kỳ chi phí phải là Định kỳ hàng tháng hoặc Phát sinh một lần.');
  }
  const note = `${input.note || ''}`.trim() || null;
  const entryDate = `${input.entryDate || ''}`.trim() || vnDayOf(new Date()) || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
    throw AppError.invalid('Ngày chi phí phải dạng YYYY-MM-DD.');
  }
  // GĐ3-P4: kỳ đã khóa sổ thì không ghi/sửa chi phí nữa.
  if (await PeriodLockService.isLocked(entryDate.slice(0, 7))) {
    throw AppError.forbidden(`Kỳ ${entryDate.slice(0, 7)} đã khóa sổ. Chỉ chủ mở khóa mới được ghi tiếp.`);
  }
  const row: typeof expenseEntries.$inferInsert = {
    id: `exp-${randomUUID()}`,
    category,
    amount,
    note,
    entryDate,
    createdBy: actorId,
    staffId,
    recurrence,
  };
  const entry: ExpenseEntry = { ...row, createdAt: null, updatedBy: null, updatedAt: null } as ExpenseEntry;
  return { row, entry };
}

export async function addExpense(
  input: { category: string; amount: number; note?: string; entryDate?: string; staffId?: string; recurrence?: string },
  actorRole: UserRole,
  actorId: string
): Promise<ExpenseEntry> {
  const { row } = await validateAndShape(input, actorRole, actorId);
  await db.insert(expenseEntries).values(row);
  return row as ExpenseEntry;
}

export interface ExpensePatch {
  amount?: number;
  category?: string;
  note?: string | null;
  entryDate?: string;
  staffId?: string | null;
  recurrence?: string;
}

/** Sửa chi phí — CHỈ Chủ. Mỗi lần sửa ghi 1 dòng audit trước→sau. */
export async function updateExpense(
  id: string,
  patch: ExpensePatch,
  actorRole: UserRole,
  actorId: string
): Promise<ExpenseEntry> {
  if (actorRole !== 'ROLE_OWNER') {
    throw AppError.forbidden('Chỉ chủ mới được sửa chi phí công ty.');
  }
  const existing = await db.select().from(expenseEntries).where(eq(expenseEntries.id, id)).limit(1);
  if (existing.length === 0) throw AppError.notFound(`Không tìm thấy dòng chi phí ${id}.`);
  const before = existing[0];

  // Gộp patch lên dòng cũ rồi chạy lại toàn bộ validate (1 đường duy nhất,
  // không phân biệt "thêm" hay "sửa" — sửa sai kiểu nào cũng bị chặn).
  const merged = {
    category: patch.category !== undefined ? `${patch.category}` : before.category,
    amount: patch.amount !== undefined ? Number(patch.amount) : before.amount,
    note: patch.note !== undefined ? patch.note : before.note,
    entryDate: patch.entryDate !== undefined ? `${patch.entryDate}`.trim() : before.entryDate,
    staffId: patch.staffId !== undefined ? `${patch.staffId}`.trim() || null : before.staffId,
    recurrence: patch.recurrence !== undefined ? `${patch.recurrence}`.trim() : before.recurrence,
  };
  const { row } = await validateAndShape(
    { ...merged, amount: merged.amount, note: merged.note ?? undefined, staffId: merged.staffId ?? undefined },
    actorRole,
    actorId
  );
  const updated = await db
    .update(expenseEntries)
    .set({
      category: row.category,
      amount: row.amount,
      note: row.note,
      entryDate: row.entryDate,
      staffId: row.staffId,
      recurrence: row.recurrence,
      updatedBy: actorId,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(expenseEntries.id, id))
    .returning();

  await recordAuditLog({
    action: 'EXPENSE_UPDATED',
    actorRole,
    actorId,
    resource: '/api/owner/finance',
    details: `Sửa chi phí ${id}: ${before.category} ${before.amount.toLocaleString('vi-VN')}đ ${before.entryDate} → ${row.category} ${row.amount.toLocaleString('vi-VN')}đ ${row.entryDate}`,
  });

  return updated[0] as ExpenseEntry;
}



