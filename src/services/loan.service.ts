import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db, loans, loanPayments } from '@/db';
import { AppError } from './app-error';
import { withDbRetry } from '../lib/db-retry';
import { recordAuditLog } from '../lib/rbac-guard';
import type { UserRole } from '../lib/roles';

const STATUSES = ['ACTIVE', 'PAID', 'CANCELLED'] as const;

function assertOwner(role: UserRole) {
  if (role !== 'ROLE_OWNER') throw AppError.forbidden('Chỉ chủ mới được quản lý nợ vay.');
}

const num = (v: unknown) => Number(v ?? 0);
const isMonth = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const isDate = (s: string) => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s);

export interface LoanSummary {
  id: string;
  code: string;
  lender: string;
  principal: number;
  paidPrincipal: number;
  paidInterest: number;
  outstanding: number;
  dueAt: string | null;
  status: string;
  daysToDue: number | null;
}

/**
 * Nợ vay/vốn huy động (GĐ3-P4). Toàn bộ owner-only, double-guard ở route.
 */
export class LoanService {
  static async create(params: {
    lender: string;
    principal: number;
    interestRate?: number;
    borrowedAt: string;
    dueAt?: string;
    note?: string;
    actorRole: UserRole;
    actorId: string;
  }) {
    assertOwner(params.actorRole);
    const lender = `${params.lender || ''}`.trim();
    if (!lender) throw AppError.invalid('Thiếu tên chủ nợ.');
    const principal = Number(params.principal);
    if (!Number.isFinite(principal) || principal <= 0) throw AppError.invalid('Số tiền vay phải > 0.');
    if (!isDate(`${params.borrowedAt || ''}`)) throw AppError.invalid('Ngày vay phải dạng YYYY-MM-DD.');
    if (params.dueAt && !isDate(`${params.dueAt}`)) throw AppError.invalid('Kỳ hạn phải dạng YYYY-MM-DD.');
    const rate = params.interestRate === undefined ? null : Number(params.interestRate);
    if (rate !== null && (!Number.isFinite(rate) || rate < 0)) throw AppError.invalid('Lãi suất phải là số không âm.');
    const id = `loan-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const code = `VAY-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    const [row] = await withDbRetry(async () =>
      db.insert(loans).values({
        id, code, lender, principal,
        interestRate: rate,
        borrowedAt: `${params.borrowedAt}`.trim(),
        dueAt: params.dueAt ? `${params.dueAt}`.trim() : null,
        status: 'ACTIVE',
        note: `${params.note || ''}`.trim() || null,
        createdBy: params.actorId,
      }).returning()
    );
    await recordAuditLog({
      action: 'LOAN' as any,
      actorRole: params.actorRole,
      actorId: params.actorId,
      resource: '/api/owner/loans',
      details: `Ghi nhận khoản vay ${code}: ${lender} ${principal}.`,
    });
    return row;
  }

  static async list(actorRole: UserRole): Promise<LoanSummary[]> {
    assertOwner(actorRole);
    const rows = await db.select().from(loans).orderBy(desc(loans.borrowedAt));
    const out: LoanSummary[] = [];
    for (const l of rows) {
      const pays = await db.select({
        p: sql<number>`coalesce(sum(${loanPayments.principalAmount}), 0)`,
        i: sql<number>`coalesce(sum(${loanPayments.interestAmount}), 0)`,
      }).from(loanPayments).where(eq(loanPayments.loanId, l.id));
      const paidPrincipal = num(pays[0]?.p);
      const paidInterest = num(pays[0]?.i);
      const outstanding = Math.max(0, num(l.principal) - paidPrincipal);
      let daysToDue: number | null = null;
      if (l.dueAt && l.status === 'ACTIVE') {
        daysToDue = Math.floor((new Date(`${l.dueAt}T00:00:00`).getTime() - Date.now()) / 86400000);
      }
      out.push({
        id: l.id, code: l.code, lender: l.lender,
        principal: num(l.principal), paidPrincipal, paidInterest, outstanding,
        dueAt: l.dueAt, status: l.status, daysToDue,
      });
    }
    return out;
  }

  /** Tổng dư nợ + khoản sắp đến hạn (≤ 30 ngày). */
  static async overview(actorRole: UserRole) {
    assertOwner(actorRole);
    const all = await this.list(actorRole);
    const active = all.filter((l) => l.status === 'ACTIVE');
    return {
      totalOutstanding: active.reduce((s, l) => s + l.outstanding, 0),
      activeCount: active.length,
      dueSoon: active
        .filter((l) => l.daysToDue !== null && l.daysToDue <= 30)
        .sort((a, b) => (a.daysToDue as number) - (b.daysToDue as number)),
      loans: all,
    };
  }

  /** Ghi nhận trả nợ một lần: tách gốc/lãi. */
  static async recordPayment(params: {
    loanId: string;
    amount: number;
    principalAmount?: number;
    interestAmount?: number;
    paidAt: string;
    note?: string;
    actorRole: UserRole;
    actorId: string;
  }) {
    assertOwner(params.actorRole);
    const [loan] = await db.select().from(loans).where(eq(loans.id, params.loanId)).limit(1);
    if (!loan) throw AppError.invalid('Không tìm thấy khoản vay.');
    if (loan.status !== 'ACTIVE') throw AppError.invalid('Khoản vay không còn hiệu lực.');
    const amount = Number(params.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw AppError.invalid('Số tiền trả phải > 0.');
    const p = Number(params.principalAmount || 0);
    const i = Number(params.interestAmount || 0);
    if (p < 0 || i < 0) throw AppError.invalid('Gốc/lãi không được âm.');
    if (Math.abs(p + i - amount) > 0.01 && (params.principalAmount !== undefined || params.interestAmount !== undefined)) {
      throw AppError.invalid('Tổng gốc + lãi phải bằng số tiền trả.');
    }
    if (!isDate(`${params.paidAt || ''}`)) throw AppError.invalid('Ngày trả phải dạng YYYY-MM-DD.');
    const id = `lp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    await withDbRetry(async () =>
      db.insert(loanPayments).values({
        id,
        loanId: loan.id,
        amount,
        principalAmount: params.principalAmount !== undefined ? p : amount,
        interestAmount: params.interestAmount !== undefined ? i : 0,
        paidAt: `${params.paidAt}`.trim(),
        note: `${params.note || ''}`.trim() || null,
        createdBy: params.actorId,
      })
    );
    // Tự động đánh dấu đã trả hết khi gốc đã đủ.
    const pays = await db.select({
      p: sql<number>`coalesce(sum(${loanPayments.principalAmount}), 0)`,
    }).from(loanPayments).where(eq(loanPayments.loanId, loan.id));
    if (num(pays[0]?.p) >= num(loan.principal)) {
      await db.update(loans).set({ status: 'PAID', updatedAt: new Date().toISOString() }).where(eq(loans.id, loan.id));
    }
    await recordAuditLog({
      action: 'LOAN' as any,
      actorRole: params.actorRole,
      actorId: params.actorId,
      resource: '/api/owner/loans',
      details: `Trả nợ ${loan.code}: ${amount} (gốc ${p}, lãi ${i}).`,
    });
    return { id, loanId: loan.id, amount };
  }
}
