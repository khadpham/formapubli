import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { db, shopeeOrderFinance } from '@/db';
import { listExpenses, addExpense } from '@/services/expense.service';

import type { UserRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

/**
 * GET /api/owner/finance — tổng hợp cho tab Chủ (OWNER only).
 * Doanh thu Shopee đọc thẳng bảng shopee_order_finance: chỉ có dòng cho đơn
 * DELIVERED (syncEscrow từ chối đơn chưa giao) ⇒ không thể phồng số.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER'] as UserRole[]);
    const agg = await db
      .select({
        orders: sql<number>`count(*)`,
        escrowTotal: sql<number>`coalesce(sum(${shopeeOrderFinance.escrowAmount}), 0)`,
        feeTotal: sql<number>`coalesce(sum(${shopeeOrderFinance.commissionFee} + ${shopeeOrderFinance.transactionFee} + ${shopeeOrderFinance.serviceFee}), 0)`,
        netProfitTotal: sql<number>`coalesce(sum(${shopeeOrderFinance.netProfit}), 0)`,
      })
      .from(shopeeOrderFinance);
    const entries = await listExpenses();
    const expensesTotal = entries.reduce((s, e) => s + e.amount, 0);
    const shopee = agg[0] ?? { orders: 0, escrowTotal: 0, feeTotal: 0, netProfitTotal: 0 };
    return NextResponse.json({
      success: true,
      data: {
        shopee: {
          orders: Number(shopee.orders),
          escrowTotal: Number(shopee.escrowTotal),
          feeTotal: Number(shopee.feeTotal),
          netProfitTotal: Number(shopee.netProfitTotal),
        },
        expenses: { total: expensesTotal, entries },
        // Lãi ròng sau chi phí — GĐ1: lãi Shopee − chi phí đã ghi.
        profitAfterExpenses: Number(shopee.netProfitTotal) - expensesTotal,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/** POST { category, amount, note?, entryDate? } — ghi chi phí, chỉ Chủ. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER'] as UserRole[]);
    const body = (await req.json().catch(() => ({}))) as {
      category?: string;
      amount?: number;
      note?: string;
      entryDate?: string;
    };
    const entry = await addExpense(
      {
        category: `${body.category || ''}`,
        amount: Number(body.amount),
        note: body.note,
        entryDate: body.entryDate,
      },
      session.role,
      session.actorId
    );
    return NextResponse.json({ success: true, data: entry });
  } catch (error) {
    return handleApiError(error);
  }
}
