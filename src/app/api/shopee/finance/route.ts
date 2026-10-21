import { NextRequest, NextResponse } from 'next/server';
import { and, desc, gte, lte, sql } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { db, shopeeOrderFinance } from '@/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/shopee/finance?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Tài chính Shopee từ dữ liệu đã đồng bộ (shopee_order_finance) - không gọi
 * API trực tiếp (chậm). Chỉ OWNER/MANAGER.
 * Trả về: tổng thực nhận escrow, tổng phí sàn, thuế khấu trừ, chi tiết từng đơn.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
    const sp = req.nextUrl.searchParams;
    const from = sp.get('from') || '2026-01-01';
    const to = sp.get('to') || new Date().toISOString().slice(0, 10);

    const rows = await db
      .select()
      .from(shopeeOrderFinance)
      .where(
        and(
          gte(sql`date(${shopeeOrderFinance.syncedAt})`, from),
          lte(sql`date(${shopeeOrderFinance.syncedAt})`, to)
        )
      )
      .orderBy(desc(shopeeOrderFinance.syncedAt))
      .limit(500);

    const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
    let totalEscrow = 0;
    let totalFee = 0;
    let totalWithholding = 0;
    let totalNet = 0;
    const details = rows.map((r) => {
      const fee = num(r.commissionFee) + num(r.transactionFee) + num(r.serviceFee);
      const wh = num(r.withholdingVatTax) + num(r.withholdingPitTax) + num(r.withholdingCitTax);
      totalEscrow += num(r.escrowAmount);
      totalFee += fee;
      totalWithholding += wh;
      totalNet += num(r.netProfit);
      return {
        orderSn: r.orderSn,
        buyerTotal: num(r.buyerTotal),
        escrowAmount: num(r.escrowAmount),
        commissionFee: num(r.commissionFee),
        transactionFee: num(r.transactionFee),
        serviceFee: num(r.serviceFee),
        totalFee: fee,
        withholdingVat: num(r.withholdingVatTax),
        withholdingPit: num(r.withholdingPitTax),
        withholdingCit: num(r.withholdingCitTax),
        totalWithholding: wh,
        cogs: r.cogs === null ? null : num(r.cogs),
        netProfit: r.netProfit === null ? null : num(r.netProfit),
        syncedAt: r.syncedAt,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalEscrow,
          totalFee,
          totalWithholding,
          totalNet,
          orderCount: rows.length,
        },
        details,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
