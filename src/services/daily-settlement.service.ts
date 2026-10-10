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
  products,
  works,
  warehouses,
  auditLogs,
  idempotencyKeys,
} from '../db';
import { AppError } from './app-error';
import { shopeeDeliveredOnly } from './shopee/revenue-guard';
import { CashboxService, OrderService, businessDateOf, createdAtBetween, evaluateShiftCutoff, VN_UTC_OFFSET_MIN } from './order.service';
import { isForbiddenWarehouseFamily } from './direct-transfer-policy';
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
 * (D-1 và D) thì lấy THỪA 7 tiếng cuối - cả hai đều sai tiền.
 *
 * Cách đúng: đổi sang ngày VN ngay trong SQL rồi so bằng. `datetime()` của SQLite
 * nhận CẢ HAI họ timestamp đang cùng tồn tại trong DB - 'YYYY-MM-DD HH:MM:SS'
 * (CURRENT_TIMESTAMP) và ISO 'YYYY-MM-DDTHH:MM:SSZ' (app) - nên một biểu thức
 * này phủ cả hai. Việt Nam cố định UTC+7, không DST nên `+7 hours` là hằng số.
 *
 * Đánh đổi: không dùng được index trên cột timestamp. Cách `LIKE` cũng vậy (tiền
 * tố có `%` nên index bị bỏ), nên không mất gì so với trước.
 */
function vnDayEquals(col: any, vnDay: string) {
  return sql`substr(datetime(${col}, '+7 hours'), 1, 10) = ${vnDay}`;
}

/** Ngày VN 'YYYY-MM-DD' của một timestamp DB (cả hai họ cũ/mới). */
function vnDayOf(value: string | Date | null | undefined): string | null {
  const d = parseDbTimestamp(value);
  if (!d) return null;
  return businessDateOf(d);
}

/** Ngày VN 'YYYY-MM-DD' có thật (Date.parse cuộn 30/2 thành 2/3 nên so ngược chuỗi). */
const BARE_DAY = /^\d{4}-\d{2}-\d{2}$/;
function assertVnDay(s: string, label: string): void {
  const d = new Date(`${s}T00:00:00Z`);
  if (!BARE_DAY.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw AppError.invalid(`Ngày ${label} "${s}" không hợp lệ. Cần YYYY-MM-DD có thật.`);
  }
}

/** Mốc +N ngày từ 'YYYY-MM-DD' (UTC thuần, không DST). */
function shiftDay(key: string, delta: number): string {
  const t = Date.parse(`${key}T00:00:00Z`);
  return new Date(t + delta * 86_400_000).toISOString().slice(0, 10);
}

export interface RangeDayBucket {
  date: string;
  orders: number;
  sales: number;
}

export interface RangeMoney {
  gross: number;
  discount: number;
  net: number;
  cash: { sales: number; ordersCount: number };
  qr: { sales: number; ordersCount: number };
  card: { sales: number; ordersCount: number };
}

/**
 * Cộng tiền theo đúng MỘT định nghĩa cho báo cáo ngày lẫn kỳ (SSOT).
 * Phân loại method y hệt khối §3 báo cáo ngày - sửa ở đây là cả hai cùng đổi.
 */
export function sumMoneyOrders(ords: Array<any>): RangeMoney {
  const out: RangeMoney = {
    gross: 0, discount: 0, net: 0,
    cash: { sales: 0, ordersCount: 0 },
    qr: { sales: 0, ordersCount: 0 },
    card: { sales: 0, ordersCount: 0 },
  };
  for (const ord of ords) {
    out.gross += ord.subtotal || 0;
    out.discount += ord.discountAmount || 0;
    out.net += ord.finalAmount || 0;
    const method = (ord.paymentMethod || 'CASH').toUpperCase();
    if (method === 'CASH') {
      out.cash.sales += ord.finalAmount || 0;
      out.cash.ordersCount++;
    } else if (method === 'BANK_TRANSFER' || method === 'QR_CODE' || method === 'TRANSFER') {
      out.qr.sales += ord.finalAmount || 0;
      out.qr.ordersCount++;
    } else {
      out.card.sales += ord.finalAmount || 0;
      out.card.ordersCount++;
    }
  }
  return out;
}

/**
 * Gom đơn COMPLETED theo ngày VN trong [startDate, endDate] - lõi thuần túy
 * của báo cáo kỳ (test được không cần DB).
 */
export function aggregateRangeOrders(
  ords: Array<any>,
  startDate: string,
  endDate: string
): { days: RangeDayBucket[]; totals: { orders: number; gross: number; discount: number; net: number }; cash: RangeMoney['cash']; qr: RangeMoney['qr']; card: RangeMoney['card'] } {
  const days: RangeDayBucket[] = [];
  const byDay = new Map<string, RangeDayBucket>();
  for (let d = startDate; ; d = shiftDay(d, 1)) {
    const b = { date: d, orders: 0, sales: 0 };
    days.push(b);
    byDay.set(d, b);
    if (d >= endDate) break;
  }
  for (const ord of ords) {
    const day = vnDayOf(ord?.createdAt);
    const b = day ? byDay.get(day) : undefined;
    if (!b) continue;
    b.orders += 1;
    b.sales += ord.finalAmount || 0;
  }
  const money = sumMoneyOrders(ords);
  return {
    days,
    totals: { orders: ords.length, gross: money.gross, discount: money.discount, net: money.net },
    cash: money.cash,
    qr: money.qr,
    card: money.card,
  };
}

/**
 * Cộng tiền chờ chuyển khoản (MỘT định nghĩa cho ngày lẫn kỳ): đúng method
 * chuyển khoản + chưa hết hạn giữ chỗ. Hết hạn vẫn nằm DB dạng PENDING nên
 * phải loại, nếu không thổi phồng tiền chờ.
 */
export function sumPendingQr(pendingRows: Array<any>): { total: number; ordersCount: number } {
  let total = 0;
  let ordersCount = 0;
  for (const r of pendingRows) {
    const method = (r.paymentMethod || '').toUpperCase();
    // DANH SÁCH METHOD PHẢI KHỚP với `sumMoneyOrders` (dòng ~143).
    // Lần đầu viết sai (`QR_TRANSFER`/`COUNTER_TRANSFER` - không hề tồn tại
    // trong hệ thống) làm `pendingQr` LUÔN = 0 mà test vẫn xanh vì test
    // dùng cùng giá trị sai. Giá trị thật: CASH | BANK_TRANSFER | QR_CODE.
    if (method !== 'BANK_TRANSFER' && method !== 'QR_CODE' && method !== 'TRANSFER') continue;
    if (OrderService.isPendingExpired(r)) continue;
    total += r.finalAmount || 0;
    ordersCount++;
  }
  return { total, ordersCount: ordersCount };
}

/**
 * Gom dòng hàng thành top bán chạy + quà + tồn đã bán (MỘT định nghĩa cho ngày
 * lẫn kỳ). Khóa theo `product_id` (NOT NULL) - `edition_id` NULL với hàng hóa,
 * gom nhầm mọi món hàng hóa thành một dòng.
 */
export function aggregateSellerLines(lineItems: Array<any>): {
  topSellers: Array<any>;
  giftSummary: { totalGiftCopies: number; items: Array<{ productId: string; code: string; title: string; copies: number }> };
  soldQtyAll: Map<string, number>;
} {
  const sellerAgg = new Map<string, any>();
  const giftAgg = new Map<string, any>();
  const soldQtyAll = new Map<string, number>();
  let totalGiftCopies = 0;

  for (const item of lineItems) {
    const key = item.productId;
    const title = item.editionTitle || item.workTitle || item.productName || item.editionCode || item.productCode || 'Ấn phẩm';

    // 1. Luồng đối soát tồn kho (theoreticalStock): tính toàn bộ số lượng xuất/tặng
    // để tồn kho thực tế trong thùng giảm chính xác.
    soldQtyAll.set(key, (soldQtyAll.get(key) || 0) + item.quantity);

    // 2. Phân loại quà tặng kèm: dòng có cờ isGiftLine, hoặc đơn giá/thành tiền = 0
    const isGift = Boolean(item.isGiftLine) || Number(item.totalAmount || 0) <= 0 || Number(item.unitSellingPrice || 0) <= 0;
    if (isGift) {
      totalGiftCopies += item.quantity;
      if (!giftAgg.has(key)) {
        giftAgg.set(key, {
          productId: key,
          code: item.editionCode || item.productCode || '',
          title,
          copies: 0,
        });
      }
      giftAgg.get(key).copies += item.quantity;
      continue; // Quà tặng TUYỆT ĐỐI KHÔNG được tính vào Top bán chạy!
    }

    // 3. Luồng Top ấn phẩm/hàng hóa bán chạy thực tế:
    if (!sellerAgg.has(key)) {
      sellerAgg.set(key, {
        editionId: key,
        code: item.editionCode || item.productCode,
        title,
        coverPrice: item.coverPrice ?? item.productPrice,
        productKind: item.productKind,
        soldCopies: 0,
        soldRevenue: 0,
      });
    }
    const record = sellerAgg.get(key);
    record.soldCopies += item.quantity;
    record.soldRevenue += item.totalAmount;
  }

  // Lượng bán theo ấn bản TRÊN TOÀN BỘ đơn - KHÔNG slice ở đây: caller tự slice
  // khi hiển thị. Trước đây `soldMap` dựng lại từ `topSellers` đã `.slice(0,10)`
  // ⇒ mọi ấn bản ngoài top 10 hiện `soldToday = 0` trong bảng đối soát tồn.
  return {
    topSellers: Array.from(sellerAgg.values())
      .sort((a, b) => b.soldCopies - a.soldCopies || b.soldRevenue - a.soldRevenue)
      .slice(0, 10),
    giftSummary: {
      totalGiftCopies,
      items: Array.from(giftAgg.values()).sort((a, b) => b.copies - a.copies),
    },
    soldQtyAll,
  };
}

/**
 * Đối chiếu đơn vượt trần CK với yêu cầu phê duyệt (MỘT định nghĩa cho ngày
 * lẫn kỳ). Đường nối chân lý là `discount_approval_id`; fallback `order_code`
 * cho dữ liệu cũ. `dateCond` là điều kiện ngày của yêu cầu (ngày D hoặc kỳ).
 */
export async function enrichOverCapOrders(
  txOrDb: any,
  warehouseId: string,
  ords: Array<any>,
  dateCond: any
): Promise<Array<any>> {
  const overCapOrders = ords.filter((ord: any) => (ord.discountRate || 0) >= 0.2);
  const linkedApprovalIds: string[] = Array.from(
    new Set<string>(
      (ords as any[])
        .map((o: any) => o?.discountApprovalId)
        .filter((v: any): v is string => typeof v === 'string' && v.length > 0)
    )
  );

  const approvalRows = await txOrDb
    .select()
    .from(discountApprovalRequests)
    .where(
      and(
        eq(discountApprovalRequests.warehouseId, warehouseId),
        linkedApprovalIds.length > 0
          ? or(
              dateCond,
              sql`${discountApprovalRequests.id} IN (${sql.join(
                linkedApprovalIds.map((id: string) => sql`${id}`),
                sql`, `
              )})`
            )
          : dateCond
      )
    );

  const approvalById = new Map<string, any>();
  const approvalByOrderCode = new Map<string, any>();
  for (const appr of approvalRows as any[]) {
    approvalById.set(appr.id, appr);
    if (!approvalByOrderCode.has(appr.orderCode)) approvalByOrderCode.set(appr.orderCode, appr);
  }

  const isUsableApproval = (a: any) =>
    !!a && (a.status === 'APPROVED' || a.status === 'CONSUMED');

  return overCapOrders.map((ord: any) => {
    const byId = ord?.discountApprovalId ? approvalById.get(ord.discountApprovalId) : undefined;
    const matched = isUsableApproval(byId)
      ? byId
      : (() => {
          const fb = approvalByOrderCode.get(ord.orderCode);
          return isUsableApproval(fb) ? fb : undefined;
        })();
    return {
      id: ord.id,
      orderCode: ord.orderCode,
      cashierId: ord.cashierId,
      subtotal: ord.subtotal,
      discountRate: ord.discountRate,
      discountAmount: ord.discountAmount,
      finalAmount: ord.finalAmount,
      createdAt: ord.createdAt,
      approvalMethod: matched?.approvalMethod || 'DIRECT_OVERRIDE',
      approvedBy: matched?.approvedBy || 'Quản lý quầy',
    };
  });
}

/**
 * Đối soát tồn hiện tại của kho + số đã bán (MỘT định nghĩa cho ngày lẫn kỳ).
 * Khóa theo `product_id` (`edition_id` NULL với hàng hóa).
 */
export async function readInventoryReconciliation(
  txOrDb: any,
  warehouseId: string,
  soldQtyAll: Map<string, number>
): Promise<Array<any>> {
  const balances = await txOrDb
    .select({
      editionId: stockBalances.editionId,
      productId: stockBalances.productId,
      physicalQuantity: stockBalances.physicalQuantity,
      code: editions.code,
      isbn: editions.isbn,
      title: editions.title,
      workTitle: works.title,
      coverPrice: editions.coverPrice,
      productCode: products.code,
      productName: products.name,
      productPrice: products.sellingPrice,
      productKind: products.productKind,
    })
    .from(stockBalances)
    .leftJoin(editions, eq(stockBalances.editionId, editions.id))
    .leftJoin(products, eq(stockBalances.productId, products.id))
    .leftJoin(works, eq(editions.workId, works.id))
    .where(
      and(
        eq(stockBalances.warehouseId, warehouseId),
        eq(stockBalances.condition, 'NEW')
      )
    );

  return balances
    .filter((b: any) => b.physicalQuantity > 0 || soldQtyAll.has(b.productId))
    .map((b: any) => {
      const soldQty = soldQtyAll.get(b.productId) || 0;
      const currentStock = b.physicalQuantity;
      return {
        editionId: b.productId,
        code: b.code || b.productCode,
        isbn: b.isbn,
        title: b.title || b.workTitle || b.productName || b.code || b.productCode,
        coverPrice: b.coverPrice ?? b.productPrice,
        productKind: b.productKind,
        soldToday: soldQty,
        theoreticalStock: currentStock,
      };
    })
    .sort((a: any, b: any) => b.soldToday - a.soldToday);
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

    // 2. Tra cứu các đơn sách hợp lệ trong ngày tại kho
    const orderConditions = [
      eq(orders.warehouseId, warehouseId),
      eq(orders.status, 'COMPLETED'),
      shopeeDeliveredOnly(),
      vnDayEquals(orders.createdAt, targetDate),
    ];

    if (sessionId) {
      orderConditions.push(eq(orders.cashboxSessionId, sessionId));
    }

    const dayOrders = await txOrDb
      .select()
      .from(orders)
      .where(and(...orderConditions));

    // 2b. Đơn CHUYỂN KHOẢN đang chờ xác nhận trong ngày.
    //
    // BÁO CÁO KHÔNG ĐƯỢC CỘNG khoản này vào Thực thu - nó chưa ghi nhận.
    // Bắt buộc loại đơn quá hạn: TTL là 48h (`order.service.ts` PENDING_TTL_HOURS)
    // và đơn hết hạn VẪN CÒN trong DB với status PENDING_CONFIRMATION (chỉ đổi
    // sang CANCELLED khi ai đó bấm xác nhận), trong khi ATP đã nhả giữ chỗ từ
    // lâu. Tính bằng SUM thuần sẽ thổi phồng số tiền chờ.
    const pendingConditions = [
      eq(orders.warehouseId, warehouseId),
      eq(orders.status, 'PENDING_CONFIRMATION'),
      vnDayEquals(orders.createdAt, targetDate),
    ];
    // Phải lọc `sessionId` GIỐNG `dayOrders` (trên). Báo cáo theo 1 ca thì đơn
    // chờ của ca khác không được lọt vào, nếu không tiền chờ của ca bên cạnh
    // sẽ lẫn vào báo cáo của ca này.
    if (sessionId) pendingConditions.push(eq(orders.cashboxSessionId, sessionId));

    const pendingRows = await txOrDb
      .select({
        finalAmount: orders.finalAmount,
        paymentMethod: orders.paymentMethod,
        createdAt: orders.createdAt,
        paymentExpiresAt: orders.paymentExpiresAt,
      })
      .from(orders)
      .where(and(...pendingConditions));

    const { total: pendingQrTotal, ordersCount: pendingQrCount } = sumPendingQr(pendingRows);

    // 3. Tính toán số liệu tài chính & cơ cấu thanh toán - qua `sumMoneyOrders`
    // (MỘT định nghĩa cho cả báo cáo ngày lẫn kỳ).
    const money = sumMoneyOrders(dayOrders as any[]);
    let grossSales = money.gross;
    let totalDiscount = money.discount;
    let netSales = money.net;

    let cashSales = money.cash.sales;
    let cashOrdersCount = money.cash.ordersCount;

    let qrTransferSales = money.qr.sales;
    let qrTransferOrdersCount = money.qr.ordersCount;

    let cardSales = money.card.sales;
    let cardOrdersCount = money.card.ordersCount;

    const averageDiscountRate = grossSales > 0 ? totalDiscount / grossSales : 0;
    const isDiscountRateWarning = averageDiscountRate > 0.20; // Cảnh báo nếu CK bình quân > 20%

    // 4. Tra cứu danh sách đơn duyệt chiết khấu đặc biệt (>= 20%) - qua helper
    // dùng chung với báo cáo kỳ.
    const enrichedOverCapOrders = await enrichOverCapOrders(
      txOrDb,
      warehouseId,
      dayOrders as any[],
      vnDayEquals(discountApprovalRequests.createdAt, targetDate)
    );

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
    // Lượng bán theo ấn bản TRÊN TOÀN BỘ đơn trong ngày - KHÔNG phải trên 10 dòng
    // `topSellers`. Trước đây `soldMap` dựng lại từ `topSellers` đã `.slice(0,10)`
    // ⇒ mọi ấn bản ngoài top 10 hiện `soldToday = 0` trong bảng đối soát tồn, dù
    // nó có bán thật. Đây là cột "Đã bán POS" trong biên bản kiểm kê bàn giao cho
    // kế toán ⇒ báo thiếu hàng, không phải lỗi làm tròn.
    const soldQtyAll = new Map<string, number>();

    let giftSummary = { totalGiftCopies: 0, items: [] as Array<{ productId: string; code: string; title: string; copies: number }> };

    if (orderIds.length > 0) {
      const lineItems = await txOrDb
        .select({
          editionId: orderItems.editionId,
          productId: orderItems.productId,
          quantity: orderItems.quantity,
          totalAmount: orderItems.totalAmount,
          isGiftLine: orderItems.isGiftLine,
          unitSellingPrice: orderItems.unitSellingPrice,
          editionCode: editions.code,
          editionTitle: editions.title,
          workTitle: works.title,
          coverPrice: editions.coverPrice,
          // Hàng hóa không có dòng `editions` (edition_id NULL) - đọc hiển
          // thị từ `products` (tầng gốc). Sách ưu tiên `editions` để giữ
          // nguyên hiển thị cũ.
          productCode: products.code,
          productName: products.name,
          productPrice: products.sellingPrice,
          productKind: products.productKind,
        })
        .from(orderItems)
        .leftJoin(editions, eq(orderItems.editionId, editions.id))
        .leftJoin(products, eq(orderItems.productId, products.id))
        .leftJoin(works, eq(editions.workId, works.id))
        .where(sql`${orderItems.orderId} IN (${sql.join(orderIds.map((id: string) => sql`${id}`), sql`, `)})`);

      const agg = aggregateSellerLines(lineItems as any[]);
      topSellers = agg.topSellers;
      giftSummary = agg.giftSummary;
      agg.soldQtyAll.forEach((v, k) => soldQtyAll.set(k, v));
    }

    // 6b. Đơn giá trị cao nhất trong ngày - thẻ "Đơn Giá Trị Cao Nhất" trên màn
    // hình + mục I-bis của bản in. Số sản phẩm gom MỘT query cho cả ngày (không
    // N+1): đơn POS có nhiều dòng `order_items`, phải CỘNG `quantity` chứ không
    // đếm số dòng.
    const countByOrder = new Map<string, number>();
    if (orderIds.length > 0) {
      const rows = await txOrDb
        .select({
          orderId: orderItems.orderId,
          qty: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)`,
        })
        .from(orderItems)
        .where(
          sql`${orderItems.orderId} IN (${sql.join(orderIds.map((id: string) => sql`${id}`), sql`, `)})`
        )
        .groupBy(orderItems.orderId);
      for (const r of rows) countByOrder.set(r.orderId, Number(r.qty || 0));
    }

    // Hoà tiền phải ỔN ĐỊNH: hai đơn cùng `final_amount` phải ra cùng một đơn mọi
    // lần chạy, không phụ thuộc thứ tự hàng SQLite trả về. Phụ theo giờ tạo (đơn
    // ra trước thắng), rồi theo id cho tuyệt đối.
    //
    // KHÔNG so `created_at` bằng chuỗi: DB đang có HAI họ timestamp -
    // 'YYYY-MM-DDTHH:MM:SSZ' (app ghi `toISOString()`) và 'YYYY-MM-DD HH:MM:SS'
    // (`CURRENT_TIMESTAMP` của SQLite, cũng UTC). Dấu cách < chữ 'T' nên so
    // chuỗi coi đơn họ SQLite là LUÔN sớm hơn ⇒ chọn nhầm đơn. `createdMs`
    // chuẩn hoá cả hai về UTC trước khi so.
    const createdMs = (o: any) => parseDbTimestamp(o.createdAt)?.getTime() ?? 0;
    const top1 = [...(dayOrders as any[])].sort(
      (a, b) =>
        (b.finalAmount || 0) - (a.finalAmount || 0) ||
        createdMs(a) - createdMs(b) ||
        String(a.id).localeCompare(String(b.id))
    )[0];
    const highlight = top1
      ? {
          orderCode: top1.orderCode,
          finalAmount: top1.finalAmount,
          subtotal: top1.subtotal,
          discountAmount: top1.discountAmount,
          paymentMethod: top1.paymentMethod,
          itemCount: countByOrder.get(top1.id) || 0,
          createdAt: top1.createdAt,
        }
      : null;

    // 6c. Dải 24 giờ bán hàng trong ngày, theo GIỜ VIỆT NAM - dải cột cao điểm
    // trên bản in. Gom từ `dayOrders` đã có sẵn, KHÔNG thêm query nào.
    //
    // KHÔNG cắt chuỗi `created_at` (`slice(11,13)`) và KHÔNG so chuỗi timestamp:
    // DB đang có HAI họ - 'YYYY-MM-DDTHH:MM:SSZ' (app ghi `toISOString()`) và
    // 'YYYY-MM-DD HH:MM:SS' (`CURRENT_TIMESTAMP` của SQLite, cũng UTC). Cắt
    // chuỗi ra giờ UTC ⇒ dải cao điểm lệch 7 tiếng so với giờ người đọc thấy
    // trên mọi mốc giờ khác của biên bản. `parseDbTimestamp` chuẩn hoá cả hai
    // họ về UTC, rồi cộng đúng hằng số UTC+7 (Việt Nam không DST).
    //
    // Luôn trả đủ 24 mốc, giờ không bán = 0: dải cột trên bản in phải đều 24 cột,
    // thiếu mốc là hụt cột.
    const ordersByHour = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, sales: 0 }));
    for (const ord of dayOrders as any[]) {
      const created = parseDbTimestamp(ord.createdAt);
      if (!created || Number.isNaN(created.getTime())) continue;
      const vnHour = Math.floor((created.getTime() + VN_UTC_OFFSET_MIN * 60_000) / 3_600_000) % 24;
      const bucket = ordersByHour[vnHour];
      bucket.orders += 1;
      bucket.sales += ord.finalAmount || 0;
    }

    const totalItemsSold = Array.from(soldQtyAll.values()).reduce((sum, q) => sum + q, 0);
    const averageOrderValue = dayOrders.length > 0 ? Math.round(netSales / dayOrders.length) : 0;
    const averageItemsPerOrder = dayOrders.length > 0 ? Number((totalItemsSold / dayOrders.length).toFixed(1)) : 0;
    const peakHour = ordersByHour.reduce(
      (best, h) => (h.orders > best.orders ? h : best),
      { hour: 0, orders: 0, sales: 0 }
    );

    // 7. Đối soát tồn sách hội chợ (Stock Reconciliation) - qua helper dùng
    // chung với báo cáo kỳ (tồn HIỆN TẠI + số đã bán trong kỳ).
    const soldMap = soldQtyAll;

    const inventoryReconciliation = await readInventoryReconciliation(txOrDb, warehouseId, soldMap);

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
        totalItemsSold,
        averageOrderValue,
        averageItemsPerOrder,
        peakHour: peakHour.orders > 0 ? peakHour : null,
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
        // CHƯA GHI NHẬN - tách riêng, không cộng vào `netSales`. Là ảnh chụp lúc
        // mở báo cáo: đơn này sau này thành COMPLETED sẽ nằm trong Thực thu của
        // lần mở sau (đó là đúng), nên UI phải ghi rõ "chưa ghi nhận".
        pendingQr: {
          total: pendingQrTotal,
          ordersCount: pendingQrCount,
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
        // - chưa thể đối soát" thay vì ẩn dòng chênh lệch hoặc bịa ra con số.
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
          // trong ngày) - đây cũng là con số mà tổng `expectedCashTotal` cộng lên.
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
      giftSummary,
      highlight,
      ordersByHour,
      inventoryReconciliation,
    };
  }

  /** Khoá duy nhất của bản ghi chốt ngày: đúng 1 lần / ngày / kho. */
  static dayCloseKey(warehouseId: string, date: string): string {
    return `day-close:${warehouseId}:${date}`;
  }

  /**
   * Kỳ dài nhất cho phép (ngày VN): ~3 tháng. Gom kỳ là vài query GROUP BY nên
   * rẻ, nhưng trần này chặn kỳ vô hạn làm treo Worker và tràn bản in.
   */
  static readonly RANGE_MAX_DAYS = 92;

  /**
   * Suy kỳ chiến dịch của kho hội chợ: ngày VN của đơn COMPLETED đầu→cuối.
   * Không lưu kỳ ở DB (không migration) - suy từ dữ liệu thật mỗi lần mở.
   * null khi kho chưa có đơn nào.
   */
  static async inferCampaignRange(
    warehouseId: string,
    txOrDb: any = db
  ): Promise<{ startDate: string; endDate: string } | null> {
    const rows: any[] = await txOrDb
      .select({
        minDay: sql<string>`MIN(substr(datetime(${orders.createdAt}, '+7 hours'), 1, 10))`,
        maxDay: sql<string>`MAX(substr(datetime(${orders.createdAt}, '+7 hours'), 1, 10))`,
      })
      .from(orders)
      .where(and(eq(orders.warehouseId, warehouseId), eq(orders.status, 'COMPLETED')));
    const r = rows[0];
    if (!r?.minDay || !r?.maxDay) return null;
    return { startDate: String(r.minDay), endDate: String(r.maxDay) };
  }

  /**
   * Báo cáo kỳ (preset N ngày, kỳ tùy nhập, cả chiến dịch): MỘT request gom
   * ở server, không fetch N ngày ở client.
   *
   * Ngữ nghĩa (đã duyệt spec 2026-10-05):
   * - Tiền/kênh/top/quà/chờ: quét đơn trong kỳ, cùng helper với báo cáo ngày.
   * - Tồn: HIỆN TẠI + nhãn rõ (không bịa tồn cuối kỳ quá khứ).
   * - Két: mở đầu kỳ → đóng cuối kỳ; còn ca mở hoặc thiếu tiền đếm ⇒ pending.
   * - Đơn PENDING chốt sau tính vào kỳ chứa ngày chốt (chỉ đếm COMPLETED).
   */
  static async getSettlementRange(
    params: { warehouseId: string; startDate: string; endDate: string },
    txOrDb: any = db
  ) {
    const warehouseId = `${params.warehouseId || ''}`.trim();
    const startDate = `${params.startDate || ''}`.trim();
    const endDate = `${params.endDate || ''}`.trim();
    if (!warehouseId) throw AppError.invalid('Thiếu kho cần lập báo cáo kỳ.');
    assertVnDay(startDate, 'bắt đầu kỳ');
    assertVnDay(endDate, 'kết thúc kỳ');
    if (startDate > endDate) throw AppError.invalid('Ngày bắt đầu kỳ phải trước ngày kết thúc.');
    const spanDays = Math.round(
      (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000
    ) + 1;
    if (spanDays > DailySettlementService.RANGE_MAX_DAYS) {
      throw AppError.invalid(`Kỳ tối đa ${DailySettlementService.RANGE_MAX_DAYS} ngày (~3 tháng). Tách thành nhiều kỳ nhỏ.`);
    }
    if (isForbiddenWarehouseFamily(warehouseId)) {
      throw AppError.forbidden(`Kho ${warehouseId} thuộc họ kho ảo/ký gửi/cách ly, không lập báo cáo bán.`);
    }

    const whRows = await txOrDb.select().from(warehouses).where(eq(warehouses.id, warehouseId)).limit(1);
    if (whRows.length === 0) throw AppError.invalid(`Không tìm thấy kho ${warehouseId}`);
    const warehouse = whRows[0];
    if ((warehouse as any).isActive !== true) throw AppError.invalid(`Kho ${warehouseId} đã ngưng hoạt động.`);

    // 1. Đơn COMPLETED trong kỳ (1 query).
    const rangeOrders: any[] = await txOrDb
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.warehouseId, warehouseId),
          eq(orders.status, 'COMPLETED'),
          ...createdAtBetween(orders.createdAt, startDate, endDate)
        )
      );

    const agg = aggregateRangeOrders(rangeOrders, startDate, endDate);
    const grossSales = agg.totals.gross;
    const totalDiscount = agg.totals.discount;
    const netSales = agg.totals.net;
    const averageDiscountRate = grossSales > 0 ? totalDiscount / grossSales : 0;

    // 2. Đơn chờ trong kỳ (ảnh cuối kỳ - không cộng dồn qua ngày).
    const pendingRows = await txOrDb
      .select({
        finalAmount: orders.finalAmount,
        paymentMethod: orders.paymentMethod,
        createdAt: orders.createdAt,
        paymentExpiresAt: orders.paymentExpiresAt,
      })
      .from(orders)
      .where(
        and(
          eq(orders.warehouseId, warehouseId),
          eq(orders.status, 'PENDING_CONFIRMATION'),
          ...createdAtBetween(orders.createdAt, startDate, endDate)
        )
      );
    const pending = sumPendingQr(pendingRows);

    // 3. Ca két giao kỳ: mở không sau cuối kỳ và (còn mở hoặc đóng không trước đầu kỳ).
    const sessions: any[] = await txOrDb
      .select()
      .from(cashboxSessions)
      .where(
        and(
          eq(cashboxSessions.warehouseId, warehouseId),
          sql`substr(datetime(${cashboxSessions.openedAt}, '+7 hours'), 1, 10) <= ${endDate}`,
          sql`(${cashboxSessions.status} = 'OPEN' OR ${cashboxSessions.closedAt} IS NULL OR substr(datetime(${cashboxSessions.closedAt}, '+7 hours'), 1, 10) >= ${startDate})`
        )
      );

    const cashInRange = new Map<string, number>();
    for (const ord of rangeOrders) {
      if ((ord.paymentMethod || 'CASH').toUpperCase() !== 'CASH') continue;
      if (!ord.cashboxSessionId) continue;
      cashInRange.set(ord.cashboxSessionId, (cashInRange.get(ord.cashboxSessionId) || 0) + (ord.finalAmount || 0));
    }
    let openingCashTotal = 0;
    let expectedCashTotal = 0;
    let closingCashActualTotal = 0;
    let openSessionCount = 0;
    let countedCount = 0;
    // Cùng luật báo cáo ngày: tiền đếm và tiền kỳ vọng phải CÙNG PHẠM VI mới dám
    // kết luận lệch (so với `expected_cash` ghi lúc chốt ca). Ca vắt qua biên kỳ
    // có phạm vi khác kỳ ⇒ chưa đủ căn cứ, kỳ 1 ngày và kỳ dài nói một câu.
    let unreconcilableCount = 0;
    let canReconcile = sessions.length > 0;
    for (const s of sessions) {
      const rangeExpected = (s.openingCash || 0) + (cashInRange.get(s.id) || 0);
      openingCashTotal += s.openingCash || 0;
      expectedCashTotal += rangeExpected;
      if (s.status === 'OPEN') {
        openSessionCount += 1;
      } else if (s.closingCashActual !== null) {
        closingCashActualTotal += s.closingCashActual;
        countedCount += 1;
      }
      const counted = s.status !== 'OPEN' && s.closingCashActual !== null;
      const sameScope =
        counted &&
        Number.isFinite(Number(s.expectedCash)) &&
        Math.abs(Number(s.expectedCash) - rangeExpected) <= 0.01;
      if (!sameScope) {
        unreconcilableCount += 1;
        canReconcile = false;
      }
    }
    // Lệch két kỳ chỉ dám kết luận khi không còn ca mở, mọi ca đã đếm, VÀ mọi
    // ca cùng phạm vi với kỳ (luật y hệt báo cáo ngày).
    const cashVariancePending = !(canReconcile && openSessionCount === 0 && countedCount === sessions.length);
    const cashVariance = cashVariancePending ? null : closingCashActualTotal - expectedCashTotal;

    // 4. Top + quà + tồn đã bán trong kỳ (items gom lô 500 id/lô - trần biến SQLite).
    const rangeOrderIds = rangeOrders.map((o: any) => o.id).filter(Boolean);
    let topSellers: any[] = [];
    let giftSummary = { totalGiftCopies: 0, items: [] as Array<{ productId: string; code: string; title: string; copies: number }> };
    const soldQtyAll = new Map<string, number>();
    for (let i = 0; i < rangeOrderIds.length; i += 500) {
      const batch = rangeOrderIds.slice(i, i + 500);
      const lineItems = await txOrDb
        .select({
          editionId: orderItems.editionId,
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
          productKind: products.productKind,
        })
        .from(orderItems)
        .leftJoin(editions, eq(orderItems.editionId, editions.id))
        .leftJoin(products, eq(orderItems.productId, products.id))
        .leftJoin(works, eq(editions.workId, works.id))
        .where(sql`${orderItems.orderId} IN (${sql.join(batch.map((id: string) => sql`${id}`), sql`, `)})`);
      const part = aggregateSellerLines(lineItems as any[]);
      if (topSellers.length === 0) topSellers = part.topSellers;
      else {
        // Gộp nhiều lô: cộng dồn rồi xếp lại (topSellers helper đã slice 10/lô
        // nên gộp thô sẽ thiếu - gom lại từ map gốc của từng lô thì phức tạp;
        // kỳ 500+ đơn là hiếm, gộp đơn giản: hợp nhất rồi xếp lại top 10).
        const merged = new Map<string, any>();
        for (const r of [...topSellers, ...part.topSellers]) {
          const prev = merged.get(r.editionId);
          if (prev) {
            prev.soldCopies += r.soldCopies;
            prev.soldRevenue += r.soldRevenue;
          } else merged.set(r.editionId, { ...r });
        }
        const all: any[] = [];
        merged.forEach((r) => all.push(r));
        all.sort((a, b) => b.soldCopies - a.soldCopies || b.soldRevenue - a.soldRevenue);
        topSellers = all.slice(0, 10);
      }
      if (giftSummary.totalGiftCopies === 0 && part.giftSummary.totalGiftCopies > 0) {
        giftSummary = part.giftSummary;
      } else if (part.giftSummary.totalGiftCopies > 0) {
        const gmap = new Map<string, any>();
        for (const g of [...giftSummary.items, ...part.giftSummary.items]) {
          const prev = gmap.get(g.productId);
          if (prev) prev.copies += g.copies;
          else gmap.set(g.productId, { ...g });
        }
        const gitems: any[] = [];
        gmap.forEach((g) => gitems.push(g));
        gitems.sort((a, b) => b.copies - a.copies);
        giftSummary = {
          totalGiftCopies: giftSummary.totalGiftCopies + part.giftSummary.totalGiftCopies,
          items: gitems,
        };
      }
      part.soldQtyAll.forEach((v, k) => soldQtyAll.set(k, (soldQtyAll.get(k) || 0) + v));
    }
    let totalItemsSold = 0;
    soldQtyAll.forEach((v) => { totalItemsSold += v; });

    // 5. Đơn giá trị cao nhất kỳ (luật hòa của báo cáo ngày: tiền → giờ tạo → id).
    // Số cuốn gom 1 query cho cả kỳ (không N+1).
    const createdMs = (o: any) => parseDbTimestamp(o.createdAt)?.getTime() ?? 0;
    let highlightCountByOrder = new Map<string, number>();
    if (rangeOrderIds.length > 0) {
      for (let i = 0; i < rangeOrderIds.length; i += 500) {
        const batch = rangeOrderIds.slice(i, i + 500);
        const rows: any[] = await txOrDb
          .select({
            orderId: orderItems.orderId,
            qty: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)`,
          })
          .from(orderItems)
          .where(sql`${orderItems.orderId} IN (${sql.join(batch.map((id: string) => sql`${id}`), sql`, `)})`)
          .groupBy(orderItems.orderId);
        for (const r of rows) highlightCountByOrder.set(r.orderId, Number(r.qty || 0));
      }
    }
    const highlight = [...rangeOrders].sort(
      (a: any, b: any) =>
        (b.finalAmount || 0) - (a.finalAmount || 0) ||
        createdMs(a) - createdMs(b) ||
        String(a.id).localeCompare(String(b.id))
    )[0] || null;

    // 6. Đơn vượt trần trong kỳ + phê duyệt liên quan.
    const enrichedOverCapOrders = await enrichOverCapOrders(
      txOrDb,
      warehouseId,
      rangeOrders,
      sql`substr(datetime(${discountApprovalRequests.createdAt}, '+7 hours'), 1, 10) BETWEEN ${startDate} AND ${endDate}`
    );

    // 7. Tồn HIỆN TẠI (không bịa tồn cuối kỳ quá khứ) + số đã bán trong kỳ.
    const inventoryReconciliation = await readInventoryReconciliation(txOrDb, warehouseId, soldQtyAll);

    // Ngày đỉnh kỳ (theo đơn; hòa theo tiền).
    let peakDay = agg.days[0] || null;
    for (const d of agg.days) {
      if (!peakDay || d.orders > peakDay.orders || (d.orders === peakDay.orders && d.sales > peakDay.sales)) peakDay = d;
    }

    return {
      mode: 'range' as const,
      reportStartDate: startDate,
      reportEndDate: endDate,
      warehouse: { id: warehouse.id, code: warehouse.code, name: warehouse.name, type: warehouse.warehouseType },
      sessionsCount: sessions.length,
      hasOpenSession: openSessionCount > 0,
      days: agg.days,
      peakDay,
      financials: {
        totalOrdersCount: agg.totals.orders,
        grossSales,
        totalDiscount,
        netSales,
        averageDiscountRate,
        isDiscountRateWarning: averageDiscountRate > 0.2,
        totalItemsSold,
        averageOrderValue: agg.totals.orders > 0 ? Math.round(netSales / agg.totals.orders) : 0,
        averageItemsPerOrder: agg.totals.orders > 0 ? Number((totalItemsSold / agg.totals.orders).toFixed(1)) : 0,
        peakHour: null,
      },
      paymentBreakdown: {
        cash: { sales: agg.cash.sales, ordersCount: agg.cash.ordersCount, percentage: netSales > 0 ? Math.round((agg.cash.sales / netSales) * 100) : 0 },
        qrTransfer: { sales: agg.qr.sales, ordersCount: agg.qr.ordersCount, percentage: netSales > 0 ? Math.round((agg.qr.sales / netSales) * 100) : 0 },
        pendingQr: { total: pending.total, ordersCount: pending.ordersCount },
        card: { sales: agg.card.sales, ordersCount: agg.card.ordersCount, percentage: netSales > 0 ? Math.round((agg.card.sales / netSales) * 100) : 0 },
      },
      cashboxReconciliation: {
        openingCashTotal,
        expectedCashTotal,
        closingCashActualTotal,
        cashVariance,
        cashVariancePending,
        openSessionCount,
        unreconcilableSessionCount: unreconcilableCount,
        sessions: sessions.map((s: any) => ({
          id: s.id,
          cashierId: s.cashierId,
          openingCash: s.openingCash,
          closingCashActual: s.closingCashActual,
          expectedCash: s.expectedCash,
          cashDiscrepancy: s.cashDiscrepancy,
          expectedCashLive: (s.openingCash || 0) + (cashInRange.get(s.id) || 0),
          reconcilable: !cashVariancePending,
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
      giftSummary,
      highlight: highlight
        ? {
            orderCode: highlight.orderCode,
            finalAmount: highlight.finalAmount,
            subtotal: highlight.subtotal,
            discountAmount: highlight.discountAmount,
            paymentMethod: highlight.paymentMethod,
            itemCount: highlightCountByOrder.get(highlight.id) || 0,
            createdAt: highlight.createdAt,
          }
        : null,
      inventoryReconciliation,
      // Nhãn bắt buộc: tồn đọc lúc mở báo cáo, KHÔNG phải tồn cuối kỳ quá khứ.
      stockNote: 'Tồn kho hiện tại lúc mở báo cáo (không phải tồn cuối kỳ quá khứ). Kỳ đang diễn ra thì hai con số bằng nhau.',
    };
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
   * CHỐT NGÀY - đánh dấu ngày nghiệp vụ đã quyết toán, đúng 1 lần / ngày / kho.
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
        // giữa transaction - lỗi khó hiểu, có thể làm hỏng cả lần chốt ngày. Ca có
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
            // `like(createdAt, date%)` - tức so NGÀY UTC, lệch 7 tiếng.
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
                ? ` - các ca ${unverifiedSessions.join(', ')} KHÔNG có số tiền thực đếm nên chênh lệch KHÔNG xác minh.`
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
