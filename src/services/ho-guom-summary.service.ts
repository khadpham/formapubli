import { and, eq, sql } from 'drizzle-orm';
import { db, orders, orderItems, editions, products, works } from '../db';
import { DailySettlementService, aggregateSellerLines } from './daily-settlement.service';
import { GiftReportService } from './gift-report.service';

export interface HoGuomLine {
  code: string;
  title: string;
  coverPrice: number;
  soldQty: number;
  soldRevenue: number;
  giftQty: number;
  totalOut: number;
  stockNow: number | null;
  rankQty: number;
  rankRevenue: number;
  group: 'Bán chạy' | 'Bình thường' | 'Bán chậm' | 'Không bán';
}

/**
 * Bảng tổng hợp Hồ Gươm (yêu cầu chủ 06/10/2026): toàn bộ đầu sách đã bán
 * trong kỳ + quà + tồn HIỆN TẠI. Tái dùng `getSettlementRange` nên kế thừa
 * toàn bộ ngữ nghĩa đã duyệt: chỉ COMPLETED, ngày VN +7h, trần 92 ngày,
 * quà không vào doanh thu/top, tồn nhãn hiện tại.
 */
export const HoGuomSummaryService = {
  async summary(
    params: { warehouseId: string; startDate: string; endDate: string },
    txOrDb: any = db
  ) {
    const range: any = await DailySettlementService.getSettlementRange(params, txOrDb);
    const { createdAtBetween } = await import('./order.service');
    const idRows: any[] = await txOrDb
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.warehouseId, params.warehouseId),
          eq(orders.status, 'COMPLETED'),
          ...createdAtBetween(orders.createdAt, range.reportStartDate, range.reportEndDate)
        )
      );
    const ids = idRows.map((r: any) => r.id).filter(Boolean);
    const lineItems: any[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500);
      if (batch.length === 0) break;
      const rows: any[] = await txOrDb
        .select({
          productId: orderItems.productId,
          quantity: orderItems.quantity,
          totalAmount: orderItems.totalAmount,
          isGiftLine: orderItems.isGiftLine,
          unitSellingPrice: orderItems.unitSellingPrice,
          editionCode: editions.code,
          editionTitle: editions.title,
          workTitle: works.title,
          coverPrice: editions.coverPrice,
          productCode: products.code,
          productName: products.name,
          productPrice: products.sellingPrice,
        })
        .from(orderItems)
        .leftJoin(editions, eq(orderItems.editionId, editions.id))
        .leftJoin(products, eq(orderItems.productId, products.id))
        .leftJoin(works, eq(editions.workId, works.id))
        .where(sql`${orderItems.orderId} IN (${sql.join(batch.map((id: string) => sql`${id}`), sql`, `)})`);
      lineItems.push(...rows);
    }
    const agg = aggregateSellerLines(lineItems);
    const full = new Map<string, any>();
    const giftByKey = new Map<string, number>();
    for (const g of agg.giftSummary.items as any[]) giftByKey.set(g.productId, g.copies);
    for (const item of lineItems) {
      const isGift =
        Boolean(item.isGiftLine) ||
        Number(item.totalAmount || 0) <= 0 ||
        Number(item.unitSellingPrice || 0) <= 0;
      if (isGift) continue;
      const key = item.productId;
      const title = item.editionTitle || item.workTitle || item.productName || item.editionCode || item.productCode || 'Ấn phẩm';
      if (!full.has(key)) {
        full.set(key, {
          productId: key,
          code: item.editionCode || item.productCode || '',
          title,
          coverPrice: item.coverPrice ?? item.productPrice ?? 0,
          soldQty: 0,
          soldRevenue: 0,
        });
      }
      const r = full.get(key);
      r.soldQty += item.quantity;
      r.soldRevenue += item.totalAmount;
    }
    const all = Array.from(full.values()).sort(
      (a, b) => b.soldQty - a.soldQty || b.soldRevenue - a.soldRevenue
    );
    const revOrder = [...all]
      .sort((a, b) => b.soldRevenue - a.soldRevenue || b.soldQty - a.soldQty)
      .map((r) => r.productId);
    const n = all.length;
    const topCut = Math.max(1, Math.ceil(n * 0.2));
    const lowCut = Math.max(1, Math.floor(n * 0.2));
    const stockOf = (pid: string) =>
      (range.inventoryReconciliation as any[])?.find((x: any) => x.editionId === pid)?.theoreticalStock ?? null;
    const lines: HoGuomLine[] = all.map((r, i) => {
      const rankQty = i + 1;
      const rankRevenue = revOrder.indexOf(r.productId) + 1;
      const group: HoGuomLine['group'] =
        r.soldQty === 0 ? 'Không bán' : rankQty <= topCut ? 'Bán chạy' : rankQty > n - lowCut ? 'Bán chậm' : 'Bình thường';
      const giftQty = giftByKey.get(r.productId) || 0;
      return {
        code: r.code, title: r.title, coverPrice: r.coverPrice,
        soldQty: r.soldQty, soldRevenue: r.soldRevenue,
        giftQty, totalOut: r.soldQty + giftQty,
        stockNow: stockOf(r.productId),
        rankQty, rankRevenue, group,
      };
    });
    const gifts = await GiftReportService.summary(range.reportStartDate, range.reportEndDate);
    return {
      mode: 'ho-guom-summary' as const,
      warehouse: range.warehouse,
      range: { start: range.reportStartDate, end: range.reportEndDate, dayCount: range.days?.length || 0 },
      totals: {
        orders: range.financials.totalOrdersCount,
        gross: range.financials.grossSales,
        discount: range.financials.totalDiscount,
        net: range.financials.netSales,
        itemsSold: range.financials.totalItemsSold,
        avgOrder: range.financials.averageOrderValue,
      },
      payment: range.paymentBreakdown,
      days: range.days,
      peakDay: range.peakDay,
      lines,
      giftsInScope: { total: range.giftSummary.totalGiftCopies, items: range.giftSummary.items },
      giftsAllWarehouses: gifts,
      stockNote: range.stockNote,
    };
  },
};
