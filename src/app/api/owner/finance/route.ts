import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { db, shopeeOrderFinance } from '@/db';
import { listExpensesMonth, addExpense } from '@/services/expense.service';

export const dynamic = 'force-dynamic';

function vnMonthNow(): string {
  // Tháng VN 'YYYY-MM' — không lấy toISOString trực tiếp (đó là UTC).
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return d.toISOString().slice(0, 7);
}

/**
 * GET ?month=YYYY-MM — tổng theo kỳ cho tab Chủ (OWNER only).
 * Doanh thu Shopee đọc thẳng bảng shopee_order_finance (chỉ có dòng cho đơn
 * DELIVERED ⇒ không thể phồng số), lọc theo synced_at; chi phí theo entry_date.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER'] as UserRole[]);
    const { searchParams } = new URL(req.url);
    const month = `${searchParams.get('month') || ''}`.trim() || vnMonthNow();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ success: false, error: 'Kỳ phải dạng YYYY-MM.' }, { status: 400 });
    }
    const agg = await db
      .select({
        orders: sql<number>`count(*)`,
        escrowTotal: sql<number>`coalesce(sum(${shopeeOrderFinance.escrowAmount}), 0)`,
        feeTotal: sql<number>`coalesce(sum(${shopeeOrderFinance.commissionFee} + ${shopeeOrderFinance.transactionFee} + ${shopeeOrderFinance.serviceFee}), 0)`,
        netProfitTotal: sql<number>`coalesce(sum(${shopeeOrderFinance.netProfit}), 0)`,
      })
      .from(shopeeOrderFinance)
      .where(sql`${shopeeOrderFinance.syncedAt} LIKE ${month + '%'}`);
    const entries = await listExpensesMonth(month);
    const expensesTotal = entries.reduce((s, e) => s + e.amount, 0);
    const monthly = entries.filter((e) => e.recurrence === 'MONTHLY').reduce((s, e) => s + e.amount, 0);
    const oneTime = entries.filter((e) => e.recurrence === 'ONE_TIME').reduce((s, e) => s + e.amount, 0);
    const shopee = agg[0] ?? { orders: 0, escrowTotal: 0, feeTotal: 0, netProfitTotal: 0 };
    return NextResponse.json({
      success: true,
      data: {
        month,
        shopee: {
          orders: Number(shopee.orders),
          escrowTotal: Number(shopee.escrowTotal),
          feeTotal: Number(shopee.feeTotal),
          netProfitTotal: Number(shopee.netProfitTotal),
        },
        expenses: {
          total: expensesTotal,
          byRecurrence: { MONTHLY: monthly, ONE_TIME: oneTime },
          entries,
        },
        // Lãi ròng sau chi phí theo kỳ đã chọn.
        profitAfterExpenses: Number(shopee.netProfitTotal) - expensesTotal,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/** POST { category, amount, note?, entryDate?, staffId?, recurrence? } — ghi chi phí, chỉ Chủ. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER'] as UserRole[]);
    const body = (await req.json().catch(() => ({}))) as {
      category?: string;
      amount?: number;
      note?: string;
      entryDate?: string;
      staffId?: string;
      recurrence?: string;
    };
    const entry = await addExpense(
      {
        category: `${body.category || ''}`,
        amount: Number(body.amount),
        note: body.note,
        entryDate: body.entryDate,
        staffId: body.staffId,
        recurrence: body.recurrence,
      },
      session.role,
      session.actorId
    );
    return NextResponse.json({ success: true, data: entry });
  } catch (error) {
    return handleApiError(error);
  }
}
