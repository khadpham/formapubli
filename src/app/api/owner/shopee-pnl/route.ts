import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { db, shopeeOrderFinance } from '@/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/owner/shopee-pnl?period=YYYY-MM
 * P&L Shopee theo kỳ từ dữ liệu escrow đã đồng bộ (shopee_order_finance).
 * CHỈ ROLE_OWNER - dữ liệu tài chính nhạy cảm, không hiện ở tab Shopee.
 *
 * Trả về: doanh thu (escrow), chi tiết phí (cố định/DV/giao dịch),
 * marketing đã chi (seller_discount), thuế khấu trừ, COGS, lãi ròng.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER'] as UserRole[]);
    const period = `${req.nextUrl.searchParams.get('period') || ''}`.trim();
    if (!/^\d{4}-\d{2}$/.test(period)) {
      return NextResponse.json(
        { success: false, error: 'Kỳ phải dạng YYYY-MM.' },
        { status: 400 }
      );
    }

    const rows = await db
      .select()
      .from(shopeeOrderFinance)
      .where(sql`substr(${shopeeOrderFinance.syncedAt}, 1, 7) = ${period}`);

    const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
    let revenue = 0;
    let commissionFee = 0;
    let transactionFee = 0;
    let serviceFee = 0;
    let marketing = 0;
    let withholding = 0;
    let cogs = 0;
    let cogsKnown = true;
    let orderCount = 0;

    for (const r of rows) {
      orderCount += 1;
      revenue += num(r.escrowAmount);
      commissionFee += num(r.commissionFee);
      transactionFee += num(r.transactionFee);
      serviceFee += num(r.serviceFee);
      marketing += num(r.sellerDiscount);
      withholding += num(r.withholdingVatTax) + num(r.withholdingPitTax) + num(r.withholdingCitTax);
      if (r.cogs === null || r.cogs === undefined) {
        cogsKnown = false;
      } else {
        cogs += num(r.cogs);
      }
    }

    const totalFees = commissionFee + transactionFee + serviceFee;
    const netProfit = cogsKnown ? revenue - totalFees - marketing - cogs : null;

    return NextResponse.json({
      success: true,
      data: {
        period,
        orderCount,
        revenue,
        fees: { commissionFee, transactionFee, serviceFee, totalFees },
        marketing,
        withholding,
        cogs: cogsKnown ? cogs : null,
        netProfit,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
