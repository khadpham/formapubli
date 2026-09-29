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
 * Điều kiện "nằm trong ngày nghiệp vụ Việt Nam" cho một cột timestamp.
 *
 * `created_at`/`opened_at` luôn là UTC: app ghi `new Date().toISOString()` và mặc
 * định cột của SQLite là `CURRENT_TIMESTAMP` (cũng UTC). Còn `targetDate` là ngày
 * nghiệp vụ VN. Ngày VN D = 17:00 UTC hôm trước → 17:00 UTC hôm D.
 *
 * KHÔNG dùng `LIKE 'YYYY-MM-DD%'` cho việc này: tiền tố 10 ký tự chỉ cho biết
 * NGÀY UTC, không cho biết giờ. Lọc một mốc thì mất 7 tiếng đầu; lọc hai mốc
 * (D-1 và D) thì lấy THỪA 7 tiếng cuối — cả hai đều sai tiền.
 *
 * Cách đúng: đổi sang ngày VN ngay trong SQL rồi so bằng. `datetime()` của SQLite
 * nhận CẢ HAI họ timestamp đang cùng tồn tại trong DB — 'YYYY-MM-DD HH:MM:SS'
 * (CURRENT_TIMESTAMP) và ISO 'YYYY-MM-DDTHH:MM:SSZ' (app) — nên một biểu thức
 * này phủ cả hai. Việt Nam cố định UTC+7, không DST nên `+7 hours` là hằng số.
 *
 * Đánh đổi: không dùng được index trên cột timestamp. Cách `LIKE` cũng vậy (tiền
 * tố có `%` nên index bị bỏ), nên không mất gì so với trước.
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
   * Tạo báo cáo tổng hợp chốt ngày hội chợ & đối soát kiểm kê (Sprint 4).
   */
  static async getDailyFairSettlement(filter: DailySettlementFilter, txOrDb: any = db) {
    const { warehouseId, sessionId } = filter;
    const targetDate = filter.date || businessDateOf(new Date());

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
      vnDayEquals(orders.createdAt, targetDate),
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
    const isDiscountRateWarning = averageDiscountRate > 0.20; // Cảnh báo nếu CK bình quân > 20%

    // 4. Tra cứu danh sách đơn duyệt chiết khấu đặc biệt (>= 20%)
    const overCapOrders = dayOrders.filter((ord: any) => (ord.discountRate || 0) >= 0.2);

    // Bổ sung thông tin phê duyệt từ discount_approval_requests nếu có
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
        approvedBy: appr?.approvedBy || 'Quản lý quầy',
      };
    });

    // 5. Đối soát ca két tiền (Cashbox Sessions)
    //
    // PHẠM VI CA = các ca CÓ MẶT trong ngày nghiệp vụ D, tức mở không sau D và
    // (còn mở, hoặc đóng không trước D). Trước đây lọc `opened_at ∈ D` ⇒ một ca
    // mở 23:30 hôm trước rồi bán xuyên nửa đêm vào D biến mất khỏi báo cáo D:
    // doanh số tiền mặt trong ngày có 400.000 nhưng `expectedCashTotal` = 0, tức
    // báo cáo tự mâu thuẫn với chính dòng doanh số ngay cạnh nó.
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

    // Tiền mặt thu TRONG TỪNG CA, gom theo cashboxSessionId.
    //
    // KHÔNG dùng cột `totalCashSales`: đó là bản chốt lúc đóng ca nên LUÔN = 0
    // khi ca còn mở ⇒ "tiền kỳ vọng" thấp hơn thực tế, đối chiếu ngay với dòng
    // "doanh số tiền mặt" bên cạnh thì mâu thuẫn. Cùng định nghĩa đã dùng ở
    // GET /api/pos/live-monitor (2026-09-29).
    //
    // Định nghĩa MỘT cho mọi ca (đã bỏ kiểu cộng chung hai phạm vi ở bản cũ):
    //   kỳ vọng trong ngày D của một ca = tiền bàn giao đầu ca + tiền mặt bán
    //   TRONG NGÀY D của chính ca đó.
    // Nhờ vậy `expectedCashTotal` luôn bằng TỔNG các dòng `expectedCashLive` mà
    // UI hiện, và ca nào kéo sang ngày mai cũng không làm ngày D dính tiền mai.
    const cashBySession = new Map<string, number>();
    for (const ord of dayOrders as any[]) {
      // So khớp case: dòng 82 dùng `(ord.paymentMethod || 'CASH').toUpperCase()`.
      // Lệch case một chữ là mất tiền mặt khỏi két.
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
    // Số ca CÓ mặt trong ngày mà ta KHÔNG ĐỦ CĂN CỨ để kết luận lệch két.
    let unreconcilableCount = 0;
    let canReconcile = sessions.length > 0;

    const sessionRows = sessions.map((s: any) => {
      const dayExpected = (s.openingCash || 0) + (cashBySession.get(s.id) || 0);
      openingCashTotal += s.openingCash || 0;
      expectedCashTotal += dayExpected;

      const counted = s.status !== 'OPEN' && s.closingCashActual !== null;
      if (counted) closingCashActualTotal += s.closingCashActual;

      // Số tiền thực đếm (lúc chốt ca) và số kỳ vọng trong ngày phải CÙNG PHẠM
      // VI thì mới dám kết luận lệch. Không cùng phạm vi xảy ra khi:
      //  · ca chưa ai đếm (chốt tự động) ⇒ KHÔNG biết còn bao nhiêu, tuyệt đối
      //    không được bịa ra "Thiếu két: -X" (đã xảy ra: ca đóng tự động cho
      //    `closingCashActual = NULL` bị cộng thành 0 ⇒ báo thiếu nguyên ca).
      //  · ca có đơn vượt biên ngày D (đồng bộ offline / nhập lại) ⇒ `expected_cash`
      //    ghi lúc chốt phủ cả đơn ngoài ngày D.
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

    // `cashVariance` giữ nguyên contract (null khi chưa đủ căn cứ) nhưng KHÔNG
    // được để dòng đối soát biến mất âm thầm. Hai trường mới cho UI biết cần
    // nói gì: số ca còn mở, và số ca không thể đối soát.
    const cashVariance = canReconcile ? closingCashActualTotal - expectedCashTotal : null;

    // 6. Top ấn phẩm bán chạy trong ngày tại kho
    const orderIds = dayOrders.map((o: any) => o.id);
    let topSellers: any[] = [];
    // Lượng bán theo ấn bản TRÊN TOÀN BỘ đơn trong ngày — KHÔNG phải trên 10 dòng
    // `topSellers`. Trước đây `soldMap` dựng lại từ `topSellers` đã `.slice(0,10)`
    // ⇒ mọi ấn bản ngoài top 10 hiện `soldToday = 0` trong bảng đối soát tồn, dù
    // nó có bán thật. Đây là cột "Đã bán POS" trong biên bản kiểm kê bàn giao cho
    // kế toán ⇒ báo thiếu hàng, không phải lỗi làm tròn.
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
        soldQtyAll.set(edId, (soldQtyAll.get(edId) || 0) + item.quantity);
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
        // Ca còn mở, hoặc ca chưa ai đếm két ⇒ chưa thể đối soát tiền két. UI dùng
        // các trường này để hiện "Còn N ca chưa đóng / M ca chưa có tiền thực đếm
        // — chưa thể đối soát" thay vì ẩn dòng chênh lệch hoặc bịa ra con số.
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
          // Ca còn MỞ thì `expectedCash` trong DB là NULL (chỉ ghi lúc chốt ca), nên
          // không hiển thị được. `expectedCashLive` là con số đúng ngay lúc này và
          // theo đúng MỘT định nghĩa cho mọi ca (bàn giao đầu ca + tiền mặt bán
          // trong ngày) — đây cũng là con số mà tổng `expectedCashTotal` cộng lên.
          expectedCashLive: dayExpected,
          // false = chưa đủ căn cứ đối chiếu ca này (chưa đếm tiền, hoặc số đếm
          // và số kỳ vọng không cùng phạm vi ngày).
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

  /** Khoá duy nhất của bản ghi chốt ngày: đúng 1 lần / ngày / kho. */
  static dayCloseKey(warehouseId: string, date: string): string {
    return `day-close:${warehouseId}:${date}`;
  }

  /** Đọc bản ghi chốt ngày đã có (null nếu ngày đó chưa chốt). */
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
   * CHỐT NGÀY — đánh dấu ngày nghiệp vụ đã quyết toán, đúng 1 lần / ngày / kho.
   *
   * - Idempotent: gọi lại y hệt trả về đúng bản ghi cũ (isDuplicate), không
   *   ghi thêm bản ghi/audit. Gọi lại với nội dung khác → từ chối, vì một ngày
   *   không thể có hai bản chốt khác nhau.
   * - Không bịa tiền: ca nào không ai đếm thì closingCashActual = NULL và bản
   *   ghi ghi rõ cashVerification = 'UNVERIFIED'.
   * - Không bỏ rơi đơn: đơn chờ thanh toán chặn chốt ngày; đơn tạo offline
   *   chưa đồng bộ được liệt kê trong unsettledOrders chứ không bị giấu đi.
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
    if (!warehouseId) throw AppError.invalid('Thiếu kho (warehouseId).');
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
        `Ngày ${date} tại kho ${warehouseId} đã chốt rồi (bản ghi ${key}). Không thể chốt lại với nội dung khác.`
      );
    }

    return withDbRetry(() =>
      db.transaction(async (tx) => {
        // Đọc lại trong transaction: đua hai lần chốt ngày thì chỉ một lần thắng.
        const raced = await tx.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key)).limit(1);
        if (raced.length > 0) {
          let env: any = null;
          try { env = JSON.parse(raced[0].responseJson || 'null'); } catch { env = null; }
          if (env?.fp === fingerprint && env?.res) return { ...env.res, isDuplicate: true as const };
          throw AppError.idempotency(
            `Ngày ${date} tại kho ${warehouseId} đã chốt rồi (bản ghi ${key}). Không thể chốt lại với nội dung khác.`
          );
        }

        const openSessions = await tx
          .select()
          .from(cashboxSessions)
          .where(and(eq(cashboxSessions.warehouseId, warehouseId), eq(cashboxSessions.status, 'OPEN')));

        // Chỉ các ca thuộc ngày nghiệp vụ <= ngày đang chốt mới liên quan.
        // opened_at đọc qua parseDbTimestamp: SQLite CURRENT_TIMESTAMP là UTC
        // không múi giờ, đọc bằng new Date() lệch 7 tiếng ở GMT+7.
        //
        // KHÔNG dùng `parseDbTimestamp(...)!`: hàm trả null khi timestamp hỏng (dữ
        // liệu cũ / sửa tay), và non-null assertion ở đây biến null thành TypeError
        // giữa transaction — lỗi khó hiểu, có thể làm hỏng cả lần chốt ngày. Ca có
        // opened_at hỏng thì bỏ qua, y như các guard khác trong codebase.
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
              reason: `Chốt ngày ${date} tự động cho ca quá giờ.`,
            },
            tx
          );
          autoClosedSessions.push(s.id);
        }

        const stillOpen = await tx
          .select({ id: cashboxSessions.id, openedAt: cashboxSessions.openedAt })
          .from(cashboxSessions)
          .where(and(eq(cashboxSessions.warehouseId, warehouseId), eq(cashboxSessions.status, 'OPEN')));
        // opened_at hỏng → KHÔNG giấu: coi như chặn chốt ngày để người có mặt
        // xử lý, thay vì đóng ngày khi chưa biết ca đó thuộc ngày nào.
        const blocking = stillOpen.filter((s: any) => {
          const opened = parseDbTimestamp(s.openedAt);
          if (opened === null) return true;
          return businessDateOf(opened) <= date;
        });
        if (blocking.length > 0) {
          throw AppError.conflict(
            `Chưa thể chốt ngày ${date} tại kho ${warehouseId}: còn ${blocking.length} ca két chưa chốt ` +
              `(${blocking.map((b: any) => b.id).join(', ')}). Vui lòng chốt ca trước khi chốt ngày.`
          );
        }

        // P2 SỬA 2026-09-29: chỉ đơn PENDING **CÒN HẠN** mới chặn chốt ngày.
        // Trước đây chặn mọi dòng PENDING kể cả đã quá hạn 25 giờ ⇒ một đơn
        // chuyển khoản quầy hết hạn 30 phút chặn vô hạn, không tự giải phóng
        // được. Dùng đúng quy tắc hạn của OrderService (payment_expires_at nếu
        // có, không thì TTL 48h) thay vì so trạng thái thô.
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
            // Ngày VIỆT NAM, dùng đúng helper của chính file này. Trước đây là
            // `like(createdAt, date%)` — tức so NGÀY UTC, lệch 7 tiếng.
            // Hậu quả: đơn chuyển khoản 00:00–07:00 giờ VN của ngày đang chốt
            // rơi vào ngày UTC HÔM TRƯỚC nên VÔ HÌNH ở đây, và ca có thể bị
            // chốt trong khi vẫn còn đơn chờ thanh toán chưa xong.
            vnDayEquals(orders.createdAt, date)
            )
          );
        const livePending = pendingRows.filter((o: any) => !OrderService.isPendingExpired(o));
        if (livePending.length > 0) {
          throw AppError.conflict(
            `Chưa thể chốt ngày ${date}: còn ${livePending.length} đơn chờ thanh toán ` +
              `(${livePending.map((o: any) => o.orderCode).join(', ')}). Hãy xác nhận hoặc hủy trước.`
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
              `Chốt ngày ${date} tại kho ${warehouseId}: doanh thu thuần ${record.netSales} đ, ` +
              `${record.totalOrdersCount} đơn. Kiểm kê tiền mặt: ${cashVerification}` +
              (unverifiedSessions.length > 0
                ? ` — các ca ${unverifiedSessions.join(', ')} KHÔNG có số tiền thực đếm nên chênh lệch KHÔNG xác minh.`
                : '.') +
              (record.unsettledOrders.length > 0
                ? ` Đơn chưa quyết toán (không bị bỏ rơi): ${record.unsettledOrders.map((o: any) => o.orderCode).join(', ')}.`
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
