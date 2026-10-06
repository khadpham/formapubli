import { desc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, expenseEntries } from '@/db';
import { AppError } from './app-error';
import type { UserRole } from '@/lib/roles';
import { vnDayOf } from '@/lib/vn-time';

/** Loại chi phí hợp lệ — nguồn sự thật cho test + UI. GĐ2 mở rộng ở ĐÂY. */
export const EXPENSE_CATEGORIES = ['SALARY', 'RENT', 'OTHER'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface ExpenseEntry {
  id: string;
  category: string;
  amount: number;
  note: string | null;
  entryDate: string;
  createdBy: string;
}

/**
 * Tab Chủ GĐ1: chi phí ghi tay, chỉ Chủ. Sổ ghi — không sửa/xoá (GĐ2 xem lại
 * thẩm quyền khi cần đính chính; hiện chủ tự chịu trách nhiệm dòng mình ghi).
 */
export async function listExpenses(limit = 100): Promise<ExpenseEntry[]> {
  const rows = await db
    .select()
    .from(expenseEntries)
    .orderBy(desc(expenseEntries.entryDate), desc(expenseEntries.createdAt))
    .limit(limit);
  return rows;
}

export async function addExpense(
  input: { category: string; amount: number; note?: string; entryDate?: string },
  actorRole: UserRole,
  actorId: string
): Promise<ExpenseEntry> {
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
  const note = `${input.note || ''}`.trim() || null;
  // Ngày phát sinh theo giờ VN; thiếu thì lấy hôm nay. vnDayOf trả null khi
  // đầu vào rác ⇒ ném INVALID, không ghi ngày giả (cột NOT NULL phải thật).
  const entryDate = `${input.entryDate || ''}`.trim() || vnDayOf(new Date()) || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
    throw AppError.invalid('Ngày chi phí phải dạng YYYY-MM-DD.');
  }
  const row = {
    id: `exp-${randomUUID()}`,
    category,
    amount,
    note,
    entryDate,
    createdBy: actorId,
  };
  await db.insert(expenseEntries).values(row);
  return row;
}


