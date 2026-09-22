import { and, desc, eq, like, sql } from 'drizzle-orm';
import {
  db,
  orders,
  orderItems,
  cashboxSessions,
  discountApprovalRequests,
  inventoryLedger,
  stockBalances,
  editions,
  works,
  warehouses,
} from '../db';
import { AppError } from './app-error';

export interface DailySettlementFilter {
  date?: string; // YYYY-MM-DD
  warehouseId: string;
  sessionId?: string;
}

export class DailySettlementService {
  /**
   * Tạo báo cáo tổng hợp chốt ngày hội chợ & đối soát kiểm kê (Sprint 4).
   */
  static async getDailyFairSettlement(filter: DailySettlementFilter, txOrDb: any = db) {
    const { warehouseId, sessionId } = filter;
    const targetDate = filter.date || new Date().toISOString().slice(0, 10);

    // 1. Kiểm tra kho tồn tại
    const whRows = await txOrDb
      .select()
      .from(warehouses)
      .where(eq(warehouses.id, warehouseId))
      .limit(1);

    if (whRows.length === 0) {
      throw AppError.invalid(`Không tìm thấy kho ${warehouseId}`);
    }
    const warehouse = whRows[0];

    // 2. Tra cứu các đơn hàng hợp lệ trong ngày tại kho
    const orderConditions = [
      eq(orders.warehouseId, warehouseId),
      eq(orders.status, 'COMPLETED'),
      like(orders.createdAt, `${targetDate}%`),
    ];

    if (sessionId) {
      orderConditions.push(eq(orders.cashboxSessionId, sessionId));
    }

    const dayOrders = await txOrDb
      .select()
      .from(orders)
      .where(and(...orderConditions));

    // 3. Tính toán số liệu tài chính & cơ cấu thanh toán
    let grossSales = 0;
    let totalDiscount = 0;
    let netSales = 0;

    let cashSales = 0;
    let cashOrdersCount = 0;

    let qrTransferSales = 0;
    let qrTransferOrdersCount = 0;

    let cardSales = 0;
    let cardOrdersCount = 0;

    for (const ord of dayOrders) {
      grossSales += ord.subtotal || 0;
      totalDiscount += ord.discountAmount || 0;
      netSales += ord.finalAmount || 0;

      const method = (ord.paymentMethod || 'CASH').toUpperCase();
      if (method === 'CASH') {
        cashSales += ord.finalAmount || 0;
        cashOrdersCount++;
      } else if (method === 'BANK_TRANSFER' || method === 'QR_CODE' || method === 'TRANSFER') {
        qrTransferSales += ord.finalAmount || 0;
        qrTransferOrdersCount++;
      } else {
        cardSales += ord.finalAmount || 0;
        cardOrdersCount++;
      }
    }

    const averageDiscountRate = grossSales > 0 ? totalDiscount / grossSales : 0;
    const isDiscountRateWarning = averageDiscountRate > 0.12; // Cảnh báo nếu CK bình quân > 12%

    // 4. Tra cứu danh sách đơn duyệt chiết khấu đặc biệt (> 20%)
    const overCapOrders = dayOrders.filter((ord: any) => (ord.discountRate || 0) > 0.2);

    // Bổ sung thông tin phê duyệt từ discount_approval_requests nếu có
    const approvalRows = await txOrDb
      .select()
      .from(discountApprovalRequests)
      .where(
        and(
          eq(discountApprovalRequests.warehouseId, warehouseId),
          like(discountApprovalRequests.createdAt, `${targetDate}%`)
        )
      );

    const approvalMap = new Map<string, any>();
    for (const appr of approvalRows) {
      approvalMap.set(appr.orderCode, appr);
    }

    const enrichedOverCapOrders = overCapOrders.map((ord: any) => {
      const appr = approvalMap.get(ord.orderCode);
      return {
        id: ord.id,
        orderCode: ord.orderCode,
        cashierId: ord.cashierId,
        subtotal: ord.subtotal,
        discountRate: ord.discountRate,
        discountAmount: ord.discountAmount,
        finalAmount: ord.finalAmount,
        createdAt: ord.createdAt,
        approvalMethod: appr?.approvalMethod || 'DIRECT_OVERRIDE',
        approvedBy: appr?.approvedBy || 'Quản lý quầy',
      };
    });

    // 5. Đối soát ca két tiền (Cashbox Sessions)
    const sessionConditions = [
      eq(cashboxSessions.warehouseId, warehouseId),
      like(cashboxSessions.openedAt, `${targetDate}%`),
    ];
    if (sessionId) {
      sessionConditions.push(eq(cashboxSessions.id, sessionId));
    }

    const sessions = await txOrDb
      .select()
      .from(cashboxSessions)
      .where(and(...sessionConditions));

    let openingCashTotal = 0;
    let closingCashActualTotal = 0;
    let expectedCashTotal = 0;
    let hasOpenSession = false;

    for (const s of sessions) {
      openingCashTotal += s.openingCash || 0;
      if (s.status === 'OPEN') {
        hasOpenSession = true;
        expectedCashTotal += (s.openingCash || 0) + (s.totalCashSales || 0);
      } else {
        closingCashActualTotal += s.closingCashActual || 0;
        expectedCashTotal += s.expectedCash || 0;
      }
    }

    const cashVariance = sessions.length > 0 && !hasOpenSession
      ? closingCashActualTotal - expectedCashTotal
      : null;

    // 6. Top ấn phẩm bán chạy trong ngày tại kho
    const orderIds = dayOrders.map((o: any) => o.id);
    let topSellers: any[] = [];

    if (orderIds.length > 0) {
      const lineItems = await txOrDb
        .select({
          editionId: orderItems.editionId,
          quantity: orderItems.quantity,
          totalAmount: orderItems.totalAmount,
          editionCode: editions.code,
          editionTitle: editions.title,
          workTitle: works.title,
          coverPrice: editions.coverPrice,
        })
        .from(orderItems)
        .leftJoin(editions, eq(orderItems.editionId, editions.id))
        .leftJoin(works, eq(editions.workId, works.id))
        .where(sql`${orderItems.orderId} IN (${sql.join(orderIds.map((id: string) => sql`${id}`), sql`, `)})`);

      const sellerAgg = new Map<string, any>();
      for (const item of lineItems) {
        const edId = item.editionId;
        const title = item.editionTitle || item.workTitle || item.editionCode || 'Ấn phẩm';
        if (!sellerAgg.has(edId)) {
          sellerAgg.set(edId, {
            editionId: edId,
            code: item.editionCode,
            title,
            coverPrice: item.coverPrice,
            soldCopies: 0,
            soldRevenue: 0,
          });
        }
        const record = sellerAgg.get(edId);
        record.soldCopies += item.quantity;
        record.soldRevenue += item.totalAmount;
      }

      topSellers = Array.from(sellerAgg.values())
        .sort((a, b) => b.soldCopies - a.soldCopies)
        .slice(0, 10);
    }

    // 7. Đối soát tồn sách hội chợ (Stock Reconciliation)
    const balances = await txOrDb
      .select({
        editionId: stockBalances.editionId,
        physicalQuantity: stockBalances.physicalQuantity,
        code: editions.code,
        isbn: editions.isbn,
        title: editions.title,
        workTitle: works.title,
        coverPrice: editions.coverPrice,
      })
      .from(stockBalances)
      .leftJoin(editions, eq(stockBalances.editionId, editions.id))
      .leftJoin(works, eq(editions.workId, works.id))
      .where(
        and(
          eq(stockBalances.warehouseId, warehouseId),
          eq(stockBalances.condition, 'NEW')
        )
      );

    const soldMap = new Map<string, number>();
    for (const seller of topSellers) {
      soldMap.set(seller.editionId, seller.soldCopies);
    }

    const inventoryReconciliation = balances
      .filter((b: any) => b.physicalQuantity > 0 || soldMap.has(b.editionId))
      .map((b: any) => {
        const soldQty = soldMap.get(b.editionId) || 0;
        const currentStock = b.physicalQuantity;
        return {
          editionId: b.editionId,
          code: b.code,
          isbn: b.isbn,
          title: b.title || b.workTitle || b.code,
          coverPrice: b.coverPrice,
          soldToday: soldQty,
          theoreticalStock: currentStock,
        };
      })
      .sort((a: any, b: any) => b.soldToday - a.soldToday);

    return {
      reportDate: targetDate,
      warehouse: {
        id: warehouse.id,
        code: warehouse.code,
        name: warehouse.name,
        type: warehouse.warehouseType,
      },
      sessionsCount: sessions.length,
      hasOpenSession,
      financials: {
        totalOrdersCount: dayOrders.length,
        grossSales,
        totalDiscount,
        netSales,
        averageDiscountRate,
        isDiscountRateWarning,
      },
      paymentBreakdown: {
        cash: {
          sales: cashSales,
          ordersCount: cashOrdersCount,
          percentage: netSales > 0 ? Math.round((cashSales / netSales) * 100) : 0,
        },
        qrTransfer: {
          sales: qrTransferSales,
          ordersCount: qrTransferOrdersCount,
          percentage: netSales > 0 ? Math.round((qrTransferSales / netSales) * 100) : 0,
        },
        card: {
          sales: cardSales,
          ordersCount: cardOrdersCount,
          percentage: netSales > 0 ? Math.round((cardSales / netSales) * 100) : 0,
        },
      },
      cashboxReconciliation: {
        openingCashTotal,
        expectedCashTotal,
        closingCashActualTotal,
        cashVariance,
        sessions: sessions.map((s: any) => ({
          id: s.id,
          cashierId: s.cashierId,
          openingCash: s.openingCash,
          closingCashActual: s.closingCashActual,
          expectedCash: s.expectedCash,
          cashDiscrepancy: s.cashDiscrepancy,
          status: s.status,
          notes: s.notes,
          openedAt: s.openedAt,
          closedAt: s.closedAt,
        })),
      },
      discountSupervision: {
        overCapOrdersCount: enrichedOverCapOrders.length,
        orders: enrichedOverCapOrders,
      },
      topSellers,
      inventoryReconciliation,
    };
  }
}
