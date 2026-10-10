import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { db, orders, orderItems, editions, cashboxSessions, staffAccounts, warehouses } from '@/db';
import { OrderService, evaluateShiftCutoff } from '@/services/order.service';
import { and, desc, eq, gte, inArray, or, isNotNull, sql } from 'drizzle-orm';
import type { UserRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

/**
 * Trạng thái quầy hội chợ - TẠI THỜI ĐIỂM NÀY, không phải báo cáo.
 *
 * Khác Báo Cáo Chốt Ngày ở 3 điểm, và đó là cả tính năng:
 *  1. Tự làm mới khi modal mở, không cần bấm (chốt ngày thì bấm tay một lần).
 *  2. Mặc định TẤT CẢ kho hội chợ; có thể chọn 1 kho và 1 ngày (02/10/2026).
 *  3. Có đơn CHƯA ĐÓNG (`PENDING_CONFIRMATION`) - báo cáo ngày chỉ tính
 *     `COMPLETED` nên không bao giờ thấy trạng thái "đang chờ".
 *
 * Ngày nghiệp vụ theo GIỜ VIỆT NAM, giống hệt `businessDateOf` mà báo cáo
 * chốt ngày dùng ⇒ hai nơi KHÔNG lệch nhau. (Trước đây comment ở đây nói
 * báo cáo ngày dùng ngày UTC; đã kiểm `daily-settlement.service.ts` dùng
 * `vnDayEquals` + `businessDateOf`, tức cũng là ngày VN. Comment cũ sai.)
 */

const VN_TZ = 'Asia/Ho_Chi_Minh';

/** Ngày nghiệp vụ hôm nay theo giờ VN (YYYY-MM-DD). */
function vnToday(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: VN_TZ });
}

/**
 * Điều kiện "đơn thuộc ngày nghiệp vụ `date`" - NGÀY VIỆT NAM, không phải ngày UTC.
 *
 * `created_at` luôn là UTC, còn `date` ở đây là ngày VN. So `created_at LIKE
 * 'YYYY-MM-DD%'` tức là so với NGÀY UTC, lệch 7 giờ với ngày đang hiển thị:
 *  · đơn 00:00–07:00 giờ VN rơi vào ngày UTC HÔM TRƯỚC ⇒ KPI của "hôm nay" thiếu
 *    gần hết ca đêm, và các đơn đó không hiện trong "đơn gần đây"
 *  · đơn sau 17:00 giờ VN lọt vào báo cáo của hôm nay dù đã sang ngày mới
 * Cùng lý do này đã được sửa ở daily-settlement và cron; ở đây còn sót vì dùng
 * `LIKE` thay vì đổi timezone trong SQL.
 *
 * `datetime()` của SQLite nhận cả hai họ timestamp đang cùng tồn tại
 * ('YYYY-MM-DD HH:MM:SS' của SQLite và ISO 'YYYY-MM-DDTHH:MM:SSZ' của app).
 * Việt Nam cố định UTC+7, không có DST.
 */
const vnDayEq = (col: any, date: string) =>
  sql`substr(datetime(${col}, '+7 hours'), 1, 10) = ${date}`;

/** YYYY-MM-DD và là ngày có thật (2026-02-30 là ngày không tồn tại). */
function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  // So ngược: Date.parse cuộn ngày 30/2 thành 2/3, nên phải so lại chuỗi.
  return d.toISOString().slice(0, 10) === s;
}

export async function GET(req: NextRequest) {
  try {
    // Chỉ quản lý: đây là số liệu doanh thu tức thời của từng gian hàng.
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);

    const sp = new URL(req.url).searchParams;
    const onlyWarehouse = (sp.get('warehouseId') || '').trim();
    const date = (sp.get('date') || '').trim() || vnToday();
    // Regex KHÔNG đủ: Date.parse('2026-02-30') trả Date hợp lệ vì ISO chỉ ràng
    // buộc ngày 01-31, nên 30/2 lặng lẽ cuộn thành 2/3. Phải so ngược Y-M-D sau khi
    // parse, nếu không ngày rác sẽ trả 200 với số liệu của hôm khác.
    if (!isRealDate(date)) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', error: `Ngày "${date}" không hợp lệ. Cần dạng YYYY-MM-DD và là ngày có thật.` },
        { status: 400 }
      );
    }

    // 1. Kho hội chợ đang hoạt động.
    const fairRows = await db
      .select({ id: warehouses.id, code: warehouses.code, name: warehouses.name })
      .from(warehouses)
      .where(and(eq(warehouses.warehouseType, 'FAIR_EVENT'), eq(warehouses.isActive, true)));
    const fairIds = fairRows.map((w) => w.id);
    // `?warehouseId=` trỏ tới kho không phải kho hội chợ, hoặc không tồn tại, là lỗi
    // cấu hình/đường dẫn. Trả 200 rỗng im lặng sẽ khiến người dùng tưởng kho hôm
    // nay không có phát sinh - nguy hiểm hơn là báo lỗi.
    if (onlyWarehouse && !fairIds.includes(onlyWarehouse)) {
      return NextResponse.json(
        {
          success: false,
          code: 'INVALID_INPUT',
          error: `Kho "${onlyWarehouse}" không phải kho hội chợ đang hoạt động.`,
        },
        { status: 400 }
      );
    }
    const scopeIds = onlyWarehouse ? [onlyWarehouse] : fairIds;
    const whName = (id: string) => fairRows.find((w) => w.id === id)?.name || id;

    if (scopeIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: emptyPayload(date),
      });
    }

    const now = Date.now();

    // 2. KPI hôm nay, gom theo hình thức thanh toán.
    //    `SUM(CASE WHEN discount_rate >= 0.2 ...)` đếm đơn vượt trần ngay ở
    //    chỗ, không cần query thứ hai.
    const payRows = await db
      .select({
        paymentMethod: orders.paymentMethod,
        cnt: sql<number>`COUNT(*)`,
        revenue: sql<number>`COALESCE(SUM(${orders.finalAmount}), 0)`,
        discount: sql<number>`COALESCE(SUM(${orders.discountAmount}), 0)`,
        overCap: sql<number>`COALESCE(SUM(CASE WHEN ${orders.discountRate} >= 0.2 THEN 1 ELSE 0 END), 0)`,
      })
      .from(orders)
      .where(
        and(
          inArray(orders.warehouseId, scopeIds),
          eq(orders.status, 'COMPLETED'),
          // Ngày VIỆT NAM, xem vnDayEq. Trước đây so 10 ký tự đầu của created_at,
          // tức ngày UTC ⇒ lệch 7 tiếng so với ngày đang hiển thị.
          vnDayEq(orders.createdAt, date)
        )
      )
      .groupBy(orders.paymentMethod);

    const CASH = 'CASH';
    const TRANSFER = ['BANK_TRANSFER', 'QR_CODE'];
    let revenue = 0;
    let cashRevenue = 0;
    let transferRevenue = 0;
    let otherRevenue = 0;
    let totalDiscount = 0;
    let overCapCount = 0;
    let orderCount = 0;
    for (const r of payRows) {
      const m = `${r.paymentMethod}`;
      const rev = Number(r.revenue || 0);
      revenue += rev;
      totalDiscount += Number(r.discount || 0);
      overCapCount += Number(r.overCap || 0);
      orderCount += Number(r.cnt || 0);
      if (m === CASH) cashRevenue += rev;
      else if (TRANSFER.includes(m)) transferRevenue += rev;
      else otherRevenue += rev;
    }

    // 3. Đơn CHƯA ĐÓNG. Không lọc theo ngày: đơn chờ chuyển khoản sống 30
    //    phút, ngày nào cũng có thể đang mở lúc bạn nhìn màn hình này.
    const pendRows = await db
      .select({
        id: orders.id,
        orderCode: orders.orderCode,
        warehouseId: orders.warehouseId,
        cashierId: orders.cashierId,
        finalAmount: orders.finalAmount,
        paymentMethod: orders.paymentMethod,
        createdAt: orders.createdAt,
        paymentExpiresAt: orders.paymentExpiresAt,
      })
      .from(orders)
      .where(and(inArray(orders.warehouseId, scopeIds), eq(orders.status, 'PENDING_CONFIRMATION')))
      .orderBy(desc(orders.createdAt))
      .limit(50);

    const staffIds = Array.from(new Set(pendRows.map((r) => r.cashierId).filter(Boolean))) as string[];
    const staffNames = await loadStaffNames(staffIds);

    const pending = pendRows.map((r) => {
      // Dùng CHÍNH quy tắc hạn của OrderService, không tự chế. Nếu lệch, màn
      // hình sẽ báo "quá hạn" ở nơi server thật ra còn chờ.
      const expired = OrderService.isPendingExpired(r);
      const expiry = OrderService.getPendingEffectiveExpiry(r);
      return {
        id: r.id,
        orderCode: r.orderCode,
        cashierId: r.cashierId,
        cashierName: staffNames.get(r.cashierId) || r.cashierId,
        warehouseId: r.warehouseId,
        warehouseName: whName(r.warehouseId),
        finalAmount: Number(r.finalAmount || 0),
        paymentMethod: r.paymentMethod,
        createdAt: r.createdAt,
        expiresAt: r.paymentExpiresAt,
        minutesLeft: expiry ? Math.max(0, Math.round((expiry.getTime() - now) / 60000)) : null,
        overdue: expired,
      };
    });

    // 4. Đơn vừa đóng (5 dòng) - câu trả lời "vừa xong gì". Lọc theo ngày làm
    // việc như KPI và top sản phẩm, nếu không sẽ lọt đơn của hôm qua vào.
    const recentClosedRows = await db
      .select({
        orderCode: orders.orderCode,
        warehouseId: orders.warehouseId,
        finalAmount: orders.finalAmount,
        paymentMethod: orders.paymentMethod,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(
        and(
          inArray(orders.warehouseId, scopeIds),
          eq(orders.status, 'COMPLETED'),
          vnDayEq(orders.createdAt, date)
        )
      )
      .orderBy(desc(orders.createdAt))
      .limit(5);

    // 5. Ca nào đang mở - ai đang ở gian hàng nào.
    const shiftRows = await db
      .select({
        id: cashboxSessions.id,
        warehouseId: cashboxSessions.warehouseId,
        cashierId: cashboxSessions.cashierId,
        openingCash: cashboxSessions.openingCash,
        openedAt: cashboxSessions.openedAt,
      })
      .from(cashboxSessions)
      .where(and(inArray(cashboxSessions.warehouseId, scopeIds), eq(cashboxSessions.status, 'OPEN')));
    const shiftStaffIds = Array.from(new Set(shiftRows.map((r) => r.cashierId).filter(Boolean))) as string[];
    const shiftStaffNames = await loadStaffNames(shiftStaffIds);

    // Tiền mặt thu trong TỪNG CA đang mở. Phải gom theo `cashboxSessionId`, KHÔNG
    // theo warehouseId+cashierId: một thu ngân mở hai ca cùng kho sẽ bị cộng chung
    // một số. Cũng KHÔNG lọc theo ngày - tiền thuộc về ca, nên ca qua nửa đêm vẫn
    // phải tính đủ cả hai mốc ngày. KHÔNG dùng cột `totalCashSales`: đó là bản chốt
    // lúc đóng ca nên LUÔN bằng 0 khi ca còn mở (báo cáo chốt ngày đang mắc lỗi này;
    // kế hoạch B sẽ sửa cho khớp).
    const openShiftIds = shiftRows.map((s) => s.id);
    const cashByShift = new Map<string, number>();
    if (openShiftIds.length > 0) {
      const cashRows = await db
        .select({
          sessionId: orders.cashboxSessionId,
          cash: sql<number>`COALESCE(SUM(${orders.finalAmount}), 0)`,
        })
        .from(orders)
        .where(
          and(
            inArray(orders.cashboxSessionId, openShiftIds),
            eq(orders.status, 'COMPLETED'),
            eq(orders.paymentMethod, CASH)
          )
        )
        .groupBy(orders.cashboxSessionId);
      for (const r of cashRows) {
        if (r.sessionId) cashByShift.set(r.sessionId, Number(r.cash || 0));
      }
    }

    const openShifts = shiftRows.map((s) => {
      // Dùng hàm sẵn có của CashboxService thay vì tự Date.parse: hàm này đi qua
      // parseDbTimestamp (SQLite CURRENT_TIMESTAMP ghi UTC không kèm múi giờ, đọc
      // bằng new Date() lệch +7h ở GMT+7 ⇒ elapsedMinutes sai), và cho sẵn cờ
      // `overdue` + giờ cắt chốt theo đúng quy tắc nghiệp vụ két. Thuần tuý, 0 truy vấn.
      const cut = evaluateShiftCutoff(s.openedAt, { warehouseId: s.warehouseId, now: new Date(now) });
      return {
        id: s.id,
        warehouseId: s.warehouseId,
        warehouseName: whName(s.warehouseId),
        cashierId: s.cashierId,
        cashierName: shiftStaffNames.get(s.cashierId) || s.cashierId,
        openedAt: s.openedAt,
        elapsedMinutes: cut.openedAtValid ? cut.elapsedMinutes : null,
        overdue: cut.overdue,
        cutoffAt: cut.cutoffAt,
        cutoff: cut.cutoff,
        expectedCashLive: Number(s.openingCash || 0) + (cashByShift.get(s.id) || 0),
      };
    });

    // 6. Top 5 sản phẩm bán chạy hôm nay (cùng logic với báo cáo chốt ngày).
    const topRows = await db
      .select({
        code: editions.code,
        title: editions.title,
        copies: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)`,
        revenue: sql<number>`COALESCE(SUM(${orderItems.totalAmount}), 0)`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(editions, eq(orderItems.editionId, editions.id))
      .where(
        and(
          inArray(orders.warehouseId, scopeIds),
          eq(orders.status, 'COMPLETED'),
          vnDayEq(orders.createdAt, date),
          eq(orderItems.isGiftLine, false),
          sql`${orderItems.totalAmount} > 0`
        )
      )
      .groupBy(orderItems.editionId, editions.code, editions.title)
      .orderBy(desc(sql`COALESCE(SUM(${orderItems.quantity}), 0)`))
      .limit(5);

    // Đơn giá trị cao nhất trong ngày đang xem. Chuyển từ Báo Cáo Chốt Ngày
    // sang đây vì nó thuộc loại "đang bán gì", không phải quyết toán tiền.
    // `recentClosed` KHÔNG thay được: đó là đơn vừa đóng gần đây, không
    // phải đơn lớn nhất.
    const largestRows = await db
      .select({
        orderCode: orders.orderCode,
        warehouseId: orders.warehouseId,
        finalAmount: orders.finalAmount,
        paymentMethod: orders.paymentMethod,
        createdAt: orders.createdAt,
        // PHẢI CỘNG `quantity`, không đếm số dòng: đơn POS có thể nhiều dòng
        // `order_items`. Đếm dòng là đơn 3 dòng × 5 cuốn ra "3 SP" thay vì 15.
        itemCount: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)`,
      })
      .from(orders)
      .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
      .where(
        and(
          inArray(orders.warehouseId, scopeIds),
          eq(orders.status, 'COMPLETED'),
          vnDayEq(orders.createdAt, date)
        )
      )
      .groupBy(orders.id)
      // Hoà tiền phải ra CÙNG một đơn mọi lần chạy. Ở hội chợ nhiều đơn tròn
      // trăm nghìn là chuyện thường; thiếu tie-break thì thẻ "Đơn lớn nhất" nhảy
      // qua lại giữa hai lần tải và người dùng tưởng dữ liệu sai.
      .orderBy(desc(orders.finalAmount), desc(orders.createdAt), desc(orders.id))
      .limit(1);

    return NextResponse.json({
      success: true,
      data: {
        businessDate: date,
        timezoneNote: 'Ngày làm việc Việt Nam (UTC+7) - cùng mốc ngày với Báo Cáo Chốt Ngày, hai nơi không lệch nhau.',
        actorRole: session.role,
        fairWarehouses: fairRows,
        today: {
          orderCount,
          revenue,
          cashRevenue,
          transferRevenue,
          otherRevenue,
          transferPct: revenue > 0 ? Math.round((transferRevenue / revenue) * 1000) / 10 : 0,
          avgOrderValue: orderCount > 0 ? Math.round(revenue / orderCount) : 0,
          totalDiscount,
          overCapCount,
        },
        openShifts,
        pending,
        recentClosed: recentClosedRows.map((r) => ({
          orderCode: r.orderCode,
          warehouseName: whName(r.warehouseId),
          finalAmount: Number(r.finalAmount || 0),
          paymentMethod: r.paymentMethod,
          createdAt: r.createdAt,
        })),
        topSellers: topRows.map((r) => ({
          code: r.code,
          title: r.title,
          copies: Number(r.copies || 0),
          revenue: Number(r.revenue || 0),
        })),
        largestOrder: largestRows.length
          ? {
              orderCode: largestRows[0].orderCode,
              warehouseName: whName(largestRows[0].warehouseId),
              finalAmount: Number(largestRows[0].finalAmount || 0),
              paymentMethod: largestRows[0].paymentMethod,
              itemCount: Number(largestRows[0].itemCount || 0),
              createdAt: largestRows[0].createdAt,
            }
          : null,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/** Tên hiển thị của nhân viên. Tách riêng để không nhân bản truy vấn ở 2 chỗ. */
async function loadStaffNames(staffIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (staffIds.length === 0) return out;
  const rows = await db
    .select({ staffId: staffAccounts.staffId, fullName: staffAccounts.fullName })
    .from(staffAccounts)
    .where(inArray(staffAccounts.staffId, staffIds));
  for (const r of rows) out.set(r.staffId, r.fullName || r.staffId);
  return out;
}

function emptyPayload(date: string) {
  return {
    businessDate: date,
    timezoneNote: 'Ngày làm việc Việt Nam (UTC+7).',
    fairWarehouses: [],
    today: {
      orderCount: 0, revenue: 0, cashRevenue: 0, transferRevenue: 0, otherRevenue: 0,
      transferPct: 0, avgOrderValue: 0, totalDiscount: 0, overCapCount: 0,
    },
    openShifts: [],
    pending: [],
    recentClosed: [],
    topSellers: [],
    largestOrder: null,
    generatedAt: new Date().toISOString(),
  };
}
