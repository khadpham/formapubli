import { db, cashboxSessions, warehouses, editions, orders } from '@/db';
import { ForecastService, RunoutLevel } from './forecast.service';
import { OrderService } from './order.service';
import { InventoryService } from './inventory.service';
import { eq, desc, sql, and, gte, inArray } from 'drizzle-orm';

export interface QueryStockParams {
  editionId?: string;
  warehouseId?: string;
}

export interface StockLevelItem {
  editionId: string;
  code: string;
  title: string | null;
  availableStock: number;
  warehouseBreakdown?: Record<string, number>;
}

export interface QuerySalesParams {
  windowDays?: number;
  fiscalScope?: 'ALL' | 'OFFICIAL_TAX' | 'INTERNAL_MANAGEMENT';
}

export interface QueryForecastParams {
  level?: RunoutLevel;
  limit?: number;
  windowDays?: number;
}

export interface QueryCashboxParams {
  sessionId?: string;
  date?: string;
}

export class ExecutiveQueryService {
  /**
   * 1. query_stock_level: Tồn khả dụng NEW (tổng + theo kho)
   * Mặc định server-side khi thiếu param: toàn hệ thống trừ wh-in-transit.
   */
  static async queryStockLevel(params: QueryStockParams = {}): Promise<{
    warehouseScope: string;
    totalAvailable: number;
    itemsCount: number;
    items: StockLevelItem[];
  }> {
    const { editionId, warehouseId } = params;
    const allWh = await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses);
    const validWh = allWh.filter((w) => w.id !== 'wh-in-transit');
    const targetWhs = warehouseId ? validWh.filter((w) => w.id === warehouseId) : validWh;

    const editionsQuery = db
      .select({ id: editions.id, code: editions.code, title: editions.title })
      .from(editions);

    const editionList = editionId
      ? await editionsQuery.where(eq(editions.id, editionId))
      : await editionsQuery;

    let totalAvailable = 0;
    const items: StockLevelItem[] = [];

    for (const ed of editionList) {
      const breakdown: Record<string, number> = {};
      let itemTotal = 0;
      for (const wh of targetWhs) {
        const bal = await InventoryService.getBalance(ed.id, wh.id, 'NEW');
        breakdown[wh.name || wh.id] = bal;
        itemTotal += bal;
      }
      totalAvailable += itemTotal;
      items.push({
        editionId: ed.id,
        code: ed.code,
        title: ed.title,
        availableStock: itemTotal,
        warehouseBreakdown: breakdown,
      });
    }

    return {
      warehouseScope: warehouseId ? (targetWhs[0]?.name || warehouseId) : 'Toàn hệ thống (trừ In-Transit)',
      totalAvailable,
      itemsCount: items.length,
      items: items.slice(0, 100), // An toàn chống tràn token
    };
  }

  /**
   * 2. query_sales_summary: Doanh thu thực, thuế, số đơn, kênh bán.
   * Cả OWNER và MANAGER đều xem được cả 2 sổ (v1 read-only).
   */
  static async querySalesSummary(params: QuerySalesParams = {}): Promise<{
    windowDays: number;
    fiscalScope: 'ALL' | 'OFFICIAL_TAX' | 'INTERNAL_MANAGEMENT';
    totalOrders: number;
    totalRevenue: number;
    totalDiscount: number;
    officialTax: { ordersCount: number; revenue: number };
    internalManagement: { ordersCount: number; revenue: number };
    channelBreakdown: Record<string, { count: number; revenue: number }>;
  }> {
    const windowDays = Math.min(365, Math.max(1, params.windowDays ?? 30));
    const fiscalScope = params.fiscalScope ?? 'ALL';

    const cutoff = new Date(Date.now() - windowDays * 24 * 3600 * 1000).toISOString();
    const summary = await OrderService.getSalesSummary({
      startDate: cutoff,
    });

    // Lấy chi tiết kênh bán
    const orderRows = await db
      .select({
        channel: orders.channel,
        finalAmount: orders.finalAmount,
        fiscalScope: orders.fiscalScope,
      })
      .from(orders)
      .where(
        and(
          eq(orders.status, 'COMPLETED'),
          gte(orders.createdAt, cutoff)
        )
      );

    const channelBreakdown: Record<string, { count: number; revenue: number }> = {};
    for (const row of orderRows) {
      if (fiscalScope !== 'ALL' && row.fiscalScope !== fiscalScope) continue;
      const ch = row.channel || 'OTHER';
      if (!channelBreakdown[ch]) channelBreakdown[ch] = { count: 0, revenue: 0 };
      channelBreakdown[ch].count += 1;
      channelBreakdown[ch].revenue += row.finalAmount ?? 0;
    }

    let reportedRevenue = summary.totalRevenue;
    let reportedOrders = summary.totalOrders;

    if (fiscalScope === 'OFFICIAL_TAX') {
      reportedRevenue = summary.officialTax.revenue;
      reportedOrders = summary.officialTax.ordersCount;
    } else if (fiscalScope === 'INTERNAL_MANAGEMENT') {
      reportedRevenue = summary.internalManagement.revenue;
      reportedOrders = summary.internalManagement.ordersCount;
    }

    return {
      windowDays,
      fiscalScope,
      totalOrders: reportedOrders,
      totalRevenue: reportedRevenue,
      totalDiscount: summary.totalDiscount,
      officialTax: summary.officialTax,
      internalManagement: summary.internalManagement,
      channelBreakdown,
    };
  }

  /**
   * 3. query_reprint_forecast: Vsale, DoI, số lượng in đề xuất 105 ngày.
   */
  static async queryReprintForecast(params: QueryForecastParams = {}): Promise<{
    windowDays: number;
    summary: Record<RunoutLevel, number>;
    items: Array<{
      code: string;
      title: string | null;
      vSale: number;
      totalStock: number;
      doi: number | null;
      level: RunoutLevel;
      suggestedReprintQty: number;
      policyNote: string;
    }>;
  }> {
    const windowDays = Math.min(365, Math.max(1, params.windowDays ?? 30));
    const limit = Math.min(200, Math.max(1, params.limit ?? 50));

    const result = await ForecastService.forecastAll(windowDays, undefined, params.level, limit);

    return {
      windowDays,
      summary: result.summary,
      items: result.items.map((it) => ({
        code: it.code,
        title: it.title,
        vSale: Math.round(it.vSale * 100) / 100,
        totalStock: it.totalStock,
        doi: it.doi !== null ? Math.round(it.doi * 10) / 10 : null,
        level: it.level,
        suggestedReprintQty: it.suggestedReprintQty,
        policyNote: 'Số lượng in đề xuất theo chính sách bù tồn 105 ngày (Lead 30 + Buffer 15 + Safety 60).',
      })),
    };
  }

  /**
   * 4. query_cashbox_reconciliation: Đọc phiên mở, tiền kỳ vọng, thực đếm, số lệch.
   * TUYỆT ĐỐI READ-ONLY: Không mở, không đóng, không sửa số liệu két.
   */
  static async queryCashboxReconciliation(params: QueryCashboxParams = {}): Promise<{
    activeSession: {
      id: string;
      warehouseId: string;
      cashierId: string;
      openingCash: number;
      totalCashSales: number;
      totalTransferSales: number;
      totalOrdersCount: number;
      openedAt: string | null;
    } | null;
    recentSessions: Array<{
      id: string;
      warehouseId: string;
      cashierId: string;
      status: string;
      openingCash: number;
      expectedCash: number | null;
      closingCashActual: number | null;
      cashDiscrepancy: number | null;
      openedAt: string | null;
      closedAt: string | null;
      discrepancyStatus: 'BALANCED' | 'OVER' | 'SHORT' | 'OPEN';
    }>;
    reconciliationNotice: string;
  }> {
    const { sessionId, date } = params;

    let query = db.select().from(cashboxSessions);
    let rows = await query.orderBy(desc(cashboxSessions.openedAt)).limit(20);

    if (sessionId) {
      rows = rows.filter((r) => r.id === sessionId);
    } else if (date) {
      rows = rows.filter((r) => r.openedAt?.startsWith(date));
    }

    const openRow = rows.find((r) => r.status === 'OPEN');
    const activeSession = openRow
      ? {
          id: openRow.id,
          warehouseId: openRow.warehouseId,
          cashierId: openRow.cashierId,
          openingCash: openRow.openingCash,
          totalCashSales: openRow.totalCashSales ?? 0,
          totalTransferSales: openRow.totalTransferSales ?? 0,
          totalOrdersCount: openRow.totalOrdersCount ?? 0,
          openedAt: openRow.openedAt,
        }
      : null;

    const recentSessions = rows.map((r) => {
      const disc = r.cashDiscrepancy ?? 0;
      let discrepancyStatus: 'BALANCED' | 'OVER' | 'SHORT' | 'OPEN' = 'BALANCED';
      if (r.status === 'OPEN') {
        discrepancyStatus = 'OPEN';
      } else if (disc > 0) {
        discrepancyStatus = 'OVER';
      } else if (disc < 0) {
        discrepancyStatus = 'SHORT';
      }

      return {
        id: r.id,
        warehouseId: r.warehouseId,
        cashierId: r.cashierId,
        status: r.status,
        openingCash: r.openingCash,
        expectedCash: r.expectedCash,
        closingCashActual: r.closingCashActual,
        cashDiscrepancy: r.cashDiscrepancy,
        openedAt: r.openedAt,
        closedAt: r.closedAt,
        discrepancyStatus,
      };
    });

    return {
      activeSession,
      recentSessions,
      reconciliationNotice:
        'Số liệu đối soát thuần túy từ sổ két. Hệ thống không đưa ra suy diễn hay kết luận pháp lý về chênh lệch két.',
    };
  }
}
