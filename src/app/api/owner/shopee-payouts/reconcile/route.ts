import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { db, shopeeOrderFinance, shopeePayouts } from '@/db';

export const dynamic = 'force-dynamic';

function makeId(): string {
  return `payout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * POST /api/owner/shopee-payouts/reconcile { period: "YYYY-MM", bankStatementAmount: number }
 * Đối soát tầng 2+3: tổng hợp escrow theo kỳ, lưu số liệu sao kê ngân hàng nhập tay,
 * tính chênh lệch. CHỈ ROLE_OWNER.
 */
export async function POST(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER'] as UserRole[]);
    const body = (await req.json().catch(() => ({}))) as {
      period?: string;
      bankStatementAmount?: number;
    };
    const period = `${body.period || ''}`.trim();
    const bankStatementAmount = Number(body.bankStatementAmount);
    if (!/^\d{4}-\d{2}$/.test(period)) {
      return NextResponse.json(
        { success: false, error: 'Kỳ phải dạng YYYY-MM.' },
        { status: 400 }
      );
    }
    if (!Number.isFinite(bankStatementAmount) || bankStatementAmount < 0) {
      return NextResponse.json(
        { success: false, error: 'Số liệu sao kê phải là số không âm.' },
        { status: 400 }
      );
    }

    const rows = await db
      .select()
      .from(shopeeOrderFinance)
      .where(sql`substr(${shopeeOrderFinance.syncedAt}, 1, 7) = ${period}`);

    const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
    let totalRevenue = 0;
    let totalFees = 0;
    let totalMarketing = 0;
    let totalWithholding = 0;
    let totalCogs = 0;
    let cogsKnown = true;
    for (const r of rows) {
      totalRevenue += num(r.escrowAmount);
      totalFees += num(r.commissionFee) + num(r.transactionFee) + num(r.serviceFee);
      totalMarketing += num(r.sellerDiscount);
      totalWithholding += num(r.withholdingVatTax) + num(r.withholdingPitTax) + num(r.withholdingCitTax);
      if (r.cogs === null || r.cogs === undefined) {
        cogsKnown = false;
      } else {
        totalCogs += num(r.cogs);
      }
    }
    const netProfit = cogsKnown ? totalRevenue - totalFees - totalMarketing - totalCogs : null;
    const diff = totalRevenue - bankStatementAmount;
    const now = new Date().toISOString();

    await db
      .insert(shopeePayouts)
      .values({
        id: makeId(),
        period,
        totalRevenue,
        totalFees,
        totalMarketing,
        totalWithholding,
        totalCogs: cogsKnown ? totalCogs : null,
        netProfit,
        orderCount: rows.length,
        bankStatementAmount,
        diff,
        reconciledAt: now,
      })
      .onConflictDoUpdate({
        target: shopeePayouts.period,
        set: {
          totalRevenue,
          totalFees,
          totalMarketing,
          totalWithholding,
          totalCogs: cogsKnown ? totalCogs : null,
          netProfit,
          orderCount: rows.length,
          bankStatementAmount,
          diff,
          reconciledAt: now,
        },
      });

    return NextResponse.json({
      success: true,
      data: {
        period,
        orderCount: rows.length,
        totalRevenue,
        bankStatementAmount,
        diff,
        matched: Math.abs(diff) < 1000,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
