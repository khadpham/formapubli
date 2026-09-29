import { and, desc, eq, like, or, sql } from 'drizzle-orm';
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
  auditLogs,
  idempotencyKeys,
} from '../db';
import { AppError } from './app-error';
import { CashboxService, OrderService, businessDateOf, evaluateShiftCutoff, VN_UTC_OFFSET_MIN } from './order.service';
import { parseDbTimestamp } from '../lib/db-timestamp';
import { withDbRetry } from '../lib/db-retry';

/**
 * ─Éiß╗üu kiß╗çn "nß║▒m trong ng├áy nghiß╗çp vß╗Ñ Viß╗çt Nam" cho mß╗Öt cß╗Öt timestamp.
 *
 * `created_at`/`opened_at` lu├┤n l├á UTC: app ghi `new Date().toISOString()` v├á mß║╖c
 * ─æß╗ïnh cß╗Öt cß╗ºa SQLite l├á `CURRENT_TIMESTAMP` (c┼⌐ng UTC). C├▓n `targetDate` l├á ng├áy
 * nghiß╗çp vß╗Ñ VN. Ng├áy VN D = 17:00 UTC h├┤m tr╞░ß╗¢c ΓåÆ 17:00 UTC h├┤m D.
 *
 * KH├öNG d├╣ng `LIKE 'YYYY-MM-DD%'` cho viß╗çc n├áy: tiß╗ün tß╗æ 10 k├╜ tß╗▒ chß╗ë cho biß║┐t
 * NG├ÇY UTC, kh├┤ng cho biß║┐t giß╗¥. Lß╗ìc mß╗Öt mß╗æc th├¼ mß║Ñt 7 tiß║┐ng ─æß║ºu; lß╗ìc hai mß╗æc
 * (D-1 v├á D) th├¼ lß║Ñy THß╗¬A 7 tiß║┐ng cuß╗æi ΓÇö cß║ú hai ─æß╗üu sai tiß╗ün.
 *
 * C├ích ─æ├║ng: ─æß╗òi sang ng├áy VN ngay trong SQL rß╗ôi so bß║▒ng. `datetime()` cß╗ºa SQLite
 * nhß║¡n Cß║ó HAI hß╗ì timestamp ─æang c├╣ng tß╗ôn tß║íi trong DB ΓÇö 'YYYY-MM-DD HH:MM:SS'
 * (CURRENT_TIMESTAMP) v├á ISO 'YYYY-MM-DDTHH:MM:SSZ' (app) ΓÇö n├¬n mß╗Öt biß╗âu thß╗⌐c
 * n├áy phß╗º cß║ú hai. Viß╗çt Nam cß╗æ ─æß╗ïnh UTC+7, kh├┤ng DST n├¬n `+7 hours` l├á hß║▒ng sß╗æ.
 *
 * ─É├ính ─æß╗òi: kh├┤ng d├╣ng ─æ╞░ß╗úc index tr├¬n cß╗Öt timestamp. C├ích `LIKE` c┼⌐ng vß║¡y (tiß╗ün
 * tß╗æ c├│ `%` n├¬n index bß╗ï bß╗Å), n├¬n kh├┤ng mß║Ñt g├¼ so vß╗¢i tr╞░ß╗¢c.
 */
function vnDayEquals(col: any, vnDay: string) {
  return sql`substr(datetime(${col}, '+7 hours'), 1, 10) = ${vnDay}`;
}

export interface DailySettlementFilter {
  date?: string; // YYYY-MM-DD
  warehouseId: string;
  sessionId?: string;
}

export class DailySettlementService {
  /**
   * Tß║ío b├ío c├ío tß╗òng hß╗úp chß╗æt ng├áy hß╗Öi chß╗ú & ─æß╗æi so├ít kiß╗âm k├¬ (Sprint 4).
   */
  static async getDailyFairSettlement(filter: DailySettlementFilter, txOrDb: any = db) {
    const { warehouseId, sessionId } = filter;
    const targetDate = filter.date || businessDateOf(new Date());

    // 1. Kiß╗âm tra kho tß╗ôn tß║íi
    const whRows = await txOrDb
      .select()
      .from(warehouses)
      .where(eq(warehouses.id, warehouseId))
      .limit(1);

    if (whRows.length === 0) {
      throw AppError.invalid(`Kh├┤ng t├¼m thß║Ñy kho ${warehouseId}`);
    }
    const warehouse = whRows[0];

    // 2. Tra cß╗⌐u c├íc ─æ╞ín h├áng hß╗úp lß╗ç trong ng├áy tß║íi kho
    const orderConditions = [
      eq(orders.warehouseId, warehouseId),
      eq(orders.status, 'COMPLETED'),
      vnDayEquals(orders.createdAt, targetDate),
    ];

    if (sessionId) {
      orderConditions.push(eq(orders.cashboxSessionId, sessionId));
    }

    const dayOrders = await txOrDb
      .select()
      .from(orders)
      .where(and(...orderConditions));

    // 3. T├¡nh to├ín sß╗æ liß╗çu t├ái ch├¡nh & c╞í cß║Ñu thanh to├ín
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
    const isDiscountRateWarning = averageDiscountRate > 0.20; // Cß║únh b├ío nß║┐u CK b├¼nh qu├ón > 20%

    // 4. Tra cß╗⌐u danh s├ích ─æ╞ín duyß╗çt chiß║┐t khß║Ñu ─æß║╖c biß╗çt (>= 20%)
    const overCapOrders = dayOrders.filter((ord: any) => (ord.discountRate || 0) >= 0.2);

    // Bß╗ò sung th├┤ng tin ph├¬ duyß╗çt tß╗½ discount_approval_requests nß║┐u c├│
    const approvalRows = await txOrDb
      .select()
      .from(discountApprovalRequests)
      .where(
        and(
          eq(discountApprovalRequests.warehouseId, warehouseId),
          vnDayEquals(discountApprovalRequests.createdAt, targetDate)
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
        approvedBy: appr?.approvedBy || 'Quß║ún l├╜ quß║ºy',
      };
    });

    // 5. ─Éß╗æi so├ít ca k├⌐t tiß╗ün (Cashbox Sessions)
    //
    // PHß║áM VI CA = c├íc ca C├ô Mß║╢T trong ng├áy nghiß╗çp vß╗Ñ D, tß╗⌐c mß╗ƒ kh├┤ng sau D v├á
    // (c├▓n mß╗ƒ, hoß║╖c ─æ├│ng kh├┤ng tr╞░ß╗¢c D). Tr╞░ß╗¢c ─æ├óy lß╗ìc `opened_at Γêê D` ΓçÆ mß╗Öt ca
    // mß╗ƒ 23:30 h├┤m tr╞░ß╗¢c rß╗ôi b├ín xuy├¬n nß╗¡a ─æ├¬m v├áo D biß║┐n mß║Ñt khß╗Åi b├ío c├ío D:
    // doanh sß╗æ tiß╗ün mß║╖t trong ng├áy c├│ 400.000 nh╞░ng `expectedCashTotal` = 0, tß╗⌐c
    // b├ío c├ío tß╗▒ m├óu thuß║½n vß╗¢i ch├¡nh d├▓ng doanh sß╗æ ngay cß║ính n├│.
    const sessionConditions = [
      eq(cashboxSessions.warehouseId, warehouseId),
      sql`substr(datetime(${cashboxSessions.openedAt}, '+7 hours'), 1, 10) <= ${targetDate}`,
      sql`(${cashboxSessions.status} = 'OPEN' OR ${cashboxSessions.closedAt} IS NULL OR substr(datetime(${cashboxSessions.closedAt}, '+7 hours'), 1, 10) >= ${targetDate})`,
    ];
    if (sessionId) {
      sessionConditions.push(eq(cashboxSessions.id, sessionId));
    }

    const sessions = await txOrDb
      .select()
      .from(cashboxSessions)
      .where(and(...sessionConditions));

    // Tiß╗ün mß║╖t thu TRONG Tß╗¬NG CA, gom theo cashboxSessionId.
    //
    // KH├öNG d├╣ng cß╗Öt `totalCashSales`: ─æ├│ l├á bß║ún chß╗æt l├║c ─æ├│ng ca n├¬n LU├öN = 0
    // khi ca c├▓n mß╗ƒ ΓçÆ "tiß╗ün kß╗│ vß╗ìng" thß║Ñp h╞ín thß╗▒c tß║┐, ─æß╗æi chiß║┐u ngay vß╗¢i d├▓ng
    // "doanh sß╗æ tiß╗ün mß║╖t" b├¬n cß║ính th├¼ m├óu thuß║½n. C├╣ng ─æß╗ïnh ngh─⌐a ─æ├ú d├╣ng ß╗ƒ
    // GET /api/pos/live-monitor (2026-09-29).
    //
    // ─Éß╗ïnh ngh─⌐a Mß╗ÿT cho mß╗ìi ca (─æ├ú bß╗Å kiß╗âu cß╗Öng chung hai phß║ím vi ß╗ƒ bß║ún c┼⌐):
    //   kß╗│ vß╗ìng trong ng├áy D cß╗ºa mß╗Öt ca = tiß╗ün b├án giao ─æß║ºu ca + tiß╗ün mß║╖t b├ín
    //   TRONG NG├ÇY D cß╗ºa ch├¡nh ca ─æ├│.
    // Nhß╗¥ vß║¡y `expectedCashTotal` lu├┤n bß║▒ng Tß╗öNG c├íc d├▓ng `expectedCashLive` m├á
    // UI hiß╗çn, v├á ca n├áo k├⌐o sang ng├áy mai c┼⌐ng kh├┤ng l├ám ng├áy D d├¡nh tiß╗ün mai.
    const cashBySession = new Map<string, number>();
    for (const ord of dayOrders as any[]) {
      // So khß╗¢p case: d├▓ng 82 d├╣ng `(ord.paymentMethod || 'CASH').toUpperCase()`.
      // Lß╗çch case mß╗Öt chß╗» l├á mß║Ñt tiß╗ün mß║╖t khß╗Åi k├⌐t.
      if ((ord.paymentMethod || 'CASH').toUpperCase() !== 'CASH') continue;
      if (!ord.cashboxSessionId) continue;
      cashBySession.set(
        ord.cashboxSessionId,
        (cashBySession.get(ord.cashboxSessionId) || 0) + (ord.finalAmount || 0)
      );
    }

    let openingCashTotal = 0;
    let closingCashActualTotal = 0;
    let expectedCashTotal = 0;
    let hasOpenSession = false;
    let openSessionCount = 0;
    // Sß╗æ ca C├ô mß║╖t trong ng├áy m├á ta KH├öNG ─Éß╗ª C─éN Cß╗¿ ─æß╗â kß║┐t luß║¡n lß╗çch k├⌐t.
    let unreconcilableCount = 0;
    let canReconcile = sessions.length > 0;

    const sessionRows = sessions.map((s: any) => {
      const dayExpected = (s.openingCash || 0) + (cashBySession.get(s.id) || 0);
      openingCashTotal += s.openingCash || 0;
      expectedCashTotal += dayExpected;

      const counted = s.status !== 'OPEN' && s.closingCashActual !== null;
      if (counted) closingCashActualTotal += s.closingCashActual;

      // Sß╗æ tiß╗ün thß╗▒c ─æß║┐m (l├║c chß╗æt ca) v├á sß╗æ kß╗│ vß╗ìng trong ng├áy phß║úi C├ÖNG PHß║áM
      // VI th├¼ mß╗¢i d├ím kß║┐t luß║¡n lß╗çch. Kh├┤ng c├╣ng phß║ím vi xß║úy ra khi:
      //  ┬╖ ca ch╞░a ai ─æß║┐m (chß╗æt tß╗▒ ─æß╗Öng) ΓçÆ KH├öNG biß║┐t c├▓n bao nhi├¬u, tuyß╗çt ─æß╗æi
      //    kh├┤ng ─æ╞░ß╗úc bß╗ïa ra "Thiß║┐u k├⌐t: -X" (─æ├ú xß║úy ra: ca ─æ├│ng tß╗▒ ─æß╗Öng cho
      //    `closingCashActual = NULL` bß╗ï cß╗Öng th├ánh 0 ΓçÆ b├ío thiß║┐u nguy├¬n ca).
      //  ┬╖ ca c├│ ─æ╞ín v╞░ß╗út bi├¬n ng├áy D (─æß╗ông bß╗Ö offline / nhß║¡p lß║íi) ΓçÆ `expected_cash`
      //    ghi l├║c chß╗æt phß╗º cß║ú ─æ╞ín ngo├ái ng├áy D.
      const sameScope =
        counted &&
        Number.isFinite(Number(s.expectedCash)) &&
        Math.abs(Number(s.expectedCash) - dayExpected) <= 0.01;
      if (!sameScope) {
        unreconcilableCount += 1;
        canReconcile = false;
      }
      if (s.status === 'OPEN') {
        hasOpenSession = true;
        openSessionCount += 1;
      }
      return { s, dayExpected, reconcilable: sameScope };
    });

    // `cashVariance` giß╗» nguy├¬n contract (null khi ch╞░a ─æß╗º c─ân cß╗⌐) nh╞░ng KH├öNG
    // ─æ╞░ß╗úc ─æß╗â d├▓ng ─æß╗æi so├ít biß║┐n mß║Ñt ├óm thß║ºm. Hai tr╞░ß╗¥ng mß╗¢i cho UI biß║┐t cß║ºn
    // n├│i g├¼: sß╗æ ca c├▓n mß╗ƒ, v├á sß╗æ ca kh├┤ng thß╗â ─æß╗æi so├ít.
    const cashVariance = canReconcile ? closingCashActualTotal - expectedCashTotal : null;

    // 6. Top ß║Ñn phß║⌐m b├ín chß║íy trong ng├áy tß║íi kho
    const orderIds = dayOrders.map((o: any) => o.id);
    let topSellers: any[] = [];
    // L╞░ß╗úng b├ín theo ß║Ñn bß║ún TR├èN TO├ÇN Bß╗ÿ ─æ╞ín trong ng├áy ΓÇö KH├öNG phß║úi tr├¬n 10 d├▓ng
    // `topSellers`. Tr╞░ß╗¢c ─æ├óy `soldMap` dß╗▒ng lß║íi tß╗½ `topSellers` ─æ├ú `.slice(0,10)`
    // ΓçÆ mß╗ìi ß║Ñn bß║ún ngo├ái top 10 hiß╗çn `soldToday = 0` trong bß║úng ─æß╗æi so├ít tß╗ôn, d├╣
    // n├│ c├│ b├ín thß║¡t. ─É├óy l├á cß╗Öt "─É├ú b├ín POS" trong bi├¬n bß║ún kiß╗âm k├¬ b├án giao cho
    // kß║┐ to├ín ΓçÆ b├ío thiß║┐u h├áng, kh├┤ng phß║úi lß╗ùi l├ám tr├▓n.
    const soldQtyAll = new Map<string, number>();

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
        const title = item.editionTitle || item.workTitle || item.editionCode || 'ß║ñn phß║⌐m';
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
        soldQtyAll.set(edId, (soldQtyAll.get(edId) || 0) + item.quantity);
      }

      topSellers = Array.from(sellerAgg.values())
        .sort((a, b) => b.soldCopies - a.soldCopies)
        .slice(0, 10);
    }

    // 7. ─Éß╗æi so├ít tß╗ôn s├ích hß╗Öi chß╗ú (Stock Reconciliation)
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

    const soldMap = soldQtyAll;

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
        // Ca c├▓n mß╗ƒ, hoß║╖c ca ch╞░a ai ─æß║┐m k├⌐t ΓçÆ ch╞░a thß╗â ─æß╗æi so├ít tiß╗ün k├⌐t. UI d├╣ng
        // c├íc tr╞░ß╗¥ng n├áy ─æß╗â hiß╗çn "C├▓n N ca ch╞░a ─æ├│ng / M ca ch╞░a c├│ tiß╗ün thß╗▒c ─æß║┐m
        // ΓÇö ch╞░a thß╗â ─æß╗æi so├ít" thay v├¼ ß║⌐n d├▓ng ch├¬nh lß╗çch hoß║╖c bß╗ïa ra con sß╗æ.
        cashVariancePending: !canReconcile,
        openSessionCount,
        unreconcilableSessionCount: unreconcilableCount,
        sessions: sessionRows.map(({ s, dayExpected, reconcilable }: any) => ({
          id: s.id,
          cashierId: s.cashierId,
          openingCash: s.openingCash,
          closingCashActual: s.closingCashActual,
          expectedCash: s.expectedCash,
          cashDiscrepancy: s.cashDiscrepancy,
          // Ca c├▓n Mß╗₧ th├¼ `expectedCash` trong DB l├á NULL (chß╗ë ghi l├║c chß╗æt ca), n├¬n
          // kh├┤ng hiß╗ân thß╗ï ─æ╞░ß╗úc. `expectedCashLive` l├á con sß╗æ ─æ├║ng ngay l├║c n├áy v├á
          // theo ─æ├║ng Mß╗ÿT ─æß╗ïnh ngh─⌐a cho mß╗ìi ca (b├án giao ─æß║ºu ca + tiß╗ün mß║╖t b├ín
          // trong ng├áy) ΓÇö ─æ├óy c┼⌐ng l├á con sß╗æ m├á tß╗òng `expectedCashTotal` cß╗Öng l├¬n.
          expectedCashLive: dayExpected,
          // false = ch╞░a ─æß╗º c─ân cß╗⌐ ─æß╗æi chiß║┐u ca n├áy (ch╞░a ─æß║┐m tiß╗ün, hoß║╖c sß╗æ ─æß║┐m
          // v├á sß╗æ kß╗│ vß╗ìng kh├┤ng c├╣ng phß║ím vi ng├áy).
          reconcilable,
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

  /** Kho├í duy nhß║Ñt cß╗ºa bß║ún ghi chß╗æt ng├áy: ─æ├║ng 1 lß║ºn / ng├áy / kho. */
  static dayCloseKey(warehouseId: string, date: string): string {
    return `day-close:${warehouseId}:${date}`;
  }

  /** ─Éß╗ìc bß║ún ghi chß╗æt ng├áy ─æ├ú c├│ (null nß║┐u ng├áy ─æ├│ ch╞░a chß╗æt). */
  static async getDayCloseRecord(warehouseId: string, date: string, txOrDb: any = db) {
    return (await DailySettlementService.readDayClose(warehouseId, date, txOrDb))?.res ?? null;
  }

  private static async readDayClose(warehouseId: string, date: string, txOrDb: any) {
    const rows = await txOrDb
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, DailySettlementService.dayCloseKey(warehouseId, date)))
      .limit(1);
    if (rows.length === 0) return null;
    try {
      return JSON.parse(rows[0].responseJson || 'null');
    } catch {
      return null;
    }
  }

  /**
   * CHß╗ÉT NG├ÇY ΓÇö ─æ├ính dß║Ñu ng├áy nghiß╗çp vß╗Ñ ─æ├ú quyß║┐t to├ín, ─æ├║ng 1 lß║ºn / ng├áy / kho.
   *
   * - Idempotent: gß╗ìi lß║íi y hß╗çt trß║ú vß╗ü ─æ├║ng bß║ún ghi c┼⌐ (isDuplicate), kh├┤ng
   *   ghi th├¬m bß║ún ghi/audit. Gß╗ìi lß║íi vß╗¢i nß╗Öi dung kh├íc ΓåÆ tß╗½ chß╗æi, v├¼ mß╗Öt ng├áy
   *   kh├┤ng thß╗â c├│ hai bß║ún chß╗æt kh├íc nhau.
   * - Kh├┤ng bß╗ïa tiß╗ün: ca n├áo kh├┤ng ai ─æß║┐m th├¼ closingCashActual = NULL v├á bß║ún
   *   ghi ghi r├╡ cashVerification = 'UNVERIFIED'.
   * - Kh├┤ng bß╗Å r╞íi ─æ╞ín: ─æ╞ín chß╗¥ thanh to├ín chß║╖n chß╗æt ng├áy; ─æ╞ín tß║ío offline
   *   ch╞░a ─æß╗ông bß╗Ö ─æ╞░ß╗úc liß╗çt k├¬ trong unsettledOrders chß╗⌐ kh├┤ng bß╗ï giß║Ñu ─æi.
   */
  static async closeDay(
    params: {
      warehouseId: string;
      date?: string;
      actorRole: string;
      actorId: string;
      notes?: string;
      autoCloseOpenShifts?: boolean;
    },
    txOrDb: any = db
  ) {
    const warehouseId = params.warehouseId;
    if (!warehouseId) throw AppError.invalid('Thiß║┐u kho (warehouseId).');
    const date = params.date || businessDateOf(new Date());
    const key = DailySettlementService.dayCloseKey(warehouseId, date);
    const fingerprint = JSON.stringify({
      warehouseId,
      date,
      autoCloseOpenShifts: !!params.autoCloseOpenShifts,
      notes: params.notes || null,
    });

    const prior = await DailySettlementService.readDayClose(warehouseId, date, txOrDb);
    if (prior) {
      if (prior.fp === fingerprint) return { ...prior.res, isDuplicate: true as const };
      throw AppError.idempotency(
        `Ng├áy ${date} tß║íi kho ${warehouseId} ─æ├ú chß╗æt rß╗ôi (bß║ún ghi ${key}). Kh├┤ng thß╗â chß╗æt lß║íi vß╗¢i nß╗Öi dung kh├íc.`
      );
    }

    return withDbRetry(() =>
      db.transaction(async (tx) => {
        // ─Éß╗ìc lß║íi trong transaction: ─æua hai lß║ºn chß╗æt ng├áy th├¼ chß╗ë mß╗Öt lß║ºn thß║»ng.
        const raced = await tx.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key)).limit(1);
        if (raced.length > 0) {
          let env: any = null;
          try { env = JSON.parse(raced[0].responseJson || 'null'); } catch { env = null; }
          if (env?.fp === fingerprint && env?.res) return { ...env.res, isDuplicate: true as const };
          throw AppError.idempotency(
            `Ng├áy ${date} tß║íi kho ${warehouseId} ─æ├ú chß╗æt rß╗ôi (bß║ún ghi ${key}). Kh├┤ng thß╗â chß╗æt lß║íi vß╗¢i nß╗Öi dung kh├íc.`
          );
        }

        const openSessions = await tx
          .select()
          .from(cashboxSessions)
          .where(and(eq(cashboxSessions.warehouseId, warehouseId), eq(cashboxSessions.status, 'OPEN')));

        // Chß╗ë c├íc ca thuß╗Öc ng├áy nghiß╗çp vß╗Ñ <= ng├áy ─æang chß╗æt mß╗¢i li├¬n quan.
        // opened_at ─æß╗ìc qua parseDbTimestamp: SQLite CURRENT_TIMESTAMP l├á UTC
        // kh├┤ng m├║i giß╗¥, ─æß╗ìc bß║▒ng new Date() lß╗çch 7 tiß║┐ng ß╗ƒ GMT+7.
        //
        // KH├öNG d├╣ng `parseDbTimestamp(...)!`: h├ám trß║ú null khi timestamp hß╗Ång (dß╗»
        // liß╗çu c┼⌐ / sß╗¡a tay), v├á non-null assertion ß╗ƒ ─æ├óy biß║┐n null th├ánh TypeError
        // giß╗»a transaction ΓÇö lß╗ùi kh├│ hiß╗âu, c├│ thß╗â l├ám hß╗Ång cß║ú lß║ºn chß╗æt ng├áy. Ca c├│
        // opened_at hß╗Ång th├¼ bß╗Å qua, y nh╞░ c├íc guard kh├íc trong codebase.
        const relevant: any[] = openSessions.filter((s: any) => {
          if (!s.openedAt) return false;
          const opened = parseDbTimestamp(s.openedAt);
          return opened !== null && businessDateOf(opened) <= date;
        });
        const autoClosedSessions: string[] = [];
        for (const s of relevant) {
          if (!params.autoCloseOpenShifts) break;
          const evaluation = evaluateShiftCutoff(s.openedAt, { warehouseId: s.warehouseId });
          if (!evaluation.overdue) continue;
          await CashboxService.autoCloseSession(
            {
              sessionId: s.id,
              actorRole: params.actorRole,
              actorId: params.actorId,
              reason: `Chß╗æt ng├áy ${date} tß╗▒ ─æß╗Öng cho ca qu├í giß╗¥.`,
            },
            tx
          );
          autoClosedSessions.push(s.id);
        }

        const stillOpen = await tx
          .select({ id: cashboxSessions.id, openedAt: cashboxSessions.openedAt })
          .from(cashboxSessions)
          .where(and(eq(cashboxSessions.warehouseId, warehouseId), eq(cashboxSessions.status, 'OPEN')));
        // opened_at hß╗Ång ΓåÆ KH├öNG giß║Ñu: coi nh╞░ chß║╖n chß╗æt ng├áy ─æß╗â ng╞░ß╗¥i c├│ mß║╖t
        // xß╗¡ l├╜, thay v├¼ ─æ├│ng ng├áy khi ch╞░a biß║┐t ca ─æ├│ thuß╗Öc ng├áy n├áo.
        const blocking = stillOpen.filter((s: any) => {
          const opened = parseDbTimestamp(s.openedAt);
          if (opened === null) return true;
          return businessDateOf(opened) <= date;
        });
        if (blocking.length > 0) {
          throw AppError.conflict(
            `Ch╞░a thß╗â chß╗æt ng├áy ${date} tß║íi kho ${warehouseId}: c├▓n ${blocking.length} ca k├⌐t ch╞░a chß╗æt ` +
              `(${blocking.map((b: any) => b.id).join(', ')}). Vui l├▓ng chß╗æt ca tr╞░ß╗¢c khi chß╗æt ng├áy.`
          );
        }

        // P2 Sß╗¼A 2026-09-29: chß╗ë ─æ╞ín PENDING **C├ÆN Hß║áN** mß╗¢i chß║╖n chß╗æt ng├áy.
        // Tr╞░ß╗¢c ─æ├óy chß║╖n mß╗ìi d├▓ng PENDING kß╗â cß║ú ─æ├ú qu├í hß║ín 25 giß╗¥ ΓçÆ mß╗Öt ─æ╞ín
        // chuyß╗ân khoß║ún quß║ºy hß║┐t hß║ín 30 ph├║t chß║╖n v├┤ hß║ín, kh├┤ng tß╗▒ giß║úi ph├│ng
        // ─æ╞░ß╗úc. D├╣ng ─æ├║ng quy tß║»c hß║ín cß╗ºa OrderService (payment_expires_at nß║┐u
        // c├│, kh├┤ng th├¼ TTL 48h) thay v├¼ so trß║íng th├íi th├┤.
        const pendingRows = await tx
          .select({
            id: orders.id,
            orderCode: orders.orderCode,
            createdAt: orders.createdAt,
            paymentExpiresAt: orders.paymentExpiresAt,
          })
          .from(orders)
          .where(
            and(
            eq(orders.warehouseId, warehouseId),
            eq(orders.status, 'PENDING_CONFIRMATION'),
            // Ng├áy VIß╗åT NAM, d├╣ng ─æ├║ng helper cß╗ºa ch├¡nh file n├áy. Tr╞░ß╗¢c ─æ├óy l├á
            // `like(createdAt, date%)` ΓÇö tß╗⌐c so NG├ÇY UTC, lß╗çch 7 tiß║┐ng.
            // Hß║¡u quß║ú: ─æ╞ín chuyß╗ân khoß║ún 00:00ΓÇô07:00 giß╗¥ VN cß╗ºa ng├áy ─æang chß╗æt
            // r╞íi v├áo ng├áy UTC H├öM TR╞»ß╗ÜC n├¬n V├ö H├îNH ß╗ƒ ─æ├óy, v├á ca c├│ thß╗â bß╗ï
            // chß╗æt trong khi vß║½n c├▓n ─æ╞ín chß╗¥ thanh to├ín ch╞░a xong.
            vnDayEquals(orders.createdAt, date)
            )
          );
        const livePending = pendingRows.filter((o: any) => !OrderService.isPendingExpired(o));
        if (livePending.length > 0) {
          throw AppError.conflict(
            `Ch╞░a thß╗â chß╗æt ng├áy ${date}: c├▓n ${livePending.length} ─æ╞ín chß╗¥ thanh to├ín ` +
              `(${livePending.map((o: any) => o.orderCode).join(', ')}). H├úy x├íc nhß║¡n hoß║╖c hß╗ºy tr╞░ß╗¢c.`
          );
        }

        const report = await DailySettlementService.getDailyFairSettlement({ warehouseId, date }, tx);
        const unverifiedSessions = report.cashboxReconciliation.sessions
          .filter((s: any) => s.closingCashActual === null)
          .map((s: any) => s.id);
        const cashVerification = unverifiedSessions.length > 0 ? 'UNVERIFIED' : 'VERIFIED';

        const unsettledOrders = await tx
          .select({ id: orders.id, orderCode: orders.orderCode, status: orders.status, syncStatus: orders.syncStatus })
          .from(orders)
          .where(and(eq(orders.warehouseId, warehouseId), vnDayEquals(orders.createdAt, date)));

        const record = {
          dayCloseKey: key,
          reportDate: date,
          warehouseId,
          closedAt: new Date().toISOString(),
          closedBy: `${params.actorRole} ${params.actorId}`,
          netSales: report.financials.netSales,
          totalOrdersCount: report.financials.totalOrdersCount,
          cashVariance: report.cashboxReconciliation.cashVariance,
          cashVerification,
          unverifiedSessions,
          autoClosedSessions,
          notes: params.notes || null,
          unsettledOrders: unsettledOrders
            .filter((o: any) => o.status !== 'COMPLETED' || o.syncStatus === 'PENDING_SYNC')
            .map((o: any) => ({
              id: o.id,
              orderCode: o.orderCode,
              status: o.status,
              syncStatus: o.syncStatus,
              reason: o.status === 'PENDING_CONFIRMATION' ? 'CHO_THANH_TOAN' : 'CHUA_DONG_BO',
            })),
        };

        await tx
          .insert(idempotencyKeys)
          .values({
            key,
            scope: 'day-close',
            responseJson: JSON.stringify({ fp: fingerprint, res: record }),
          });

        await tx
          .insert(auditLogs)
          .values({
            id: `aud-day-close-${warehouseId}-${date}`,
            action: 'SETTLE_DAY',
            actorRole: params.actorRole,
            actorId: params.actorId,
            resource: '/api/pos/daily-settlement',
            details:
              `Chß╗æt ng├áy ${date} tß║íi kho ${warehouseId}: doanh thu thuß║ºn ${record.netSales} ─æ, ` +
              `${record.totalOrdersCount} ─æ╞ín. Kiß╗âm k├¬ tiß╗ün mß║╖t: ${cashVerification}` +
              (unverifiedSessions.length > 0
                ? ` ΓÇö c├íc ca ${unverifiedSessions.join(', ')} KH├öNG c├│ sß╗æ tiß╗ün thß╗▒c ─æß║┐m n├¬n ch├¬nh lß╗çch KH├öNG x├íc minh.`
                : '.') +
              (record.unsettledOrders.length > 0
                ? ` ─É╞ín ch╞░a quyß║┐t to├ín (kh├┤ng bß╗ï bß╗Å r╞íi): ${record.unsettledOrders.map((o: any) => o.orderCode).join(', ')}.`
                : '')
                .slice(0, 500),
            ipAddress: 'local',
          })
          .onConflictDoNothing({ target: auditLogs.id });

        return { ...record, isDuplicate: false as const };
      })
    );
  }
}
