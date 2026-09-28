import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { db, orders, orderItems, editions, cashboxSessions, staffAccounts, warehouses } from '@/db';
import { OrderService } from '@/services/order.service';
import { and, desc, eq, gte, inArray, or, isNotNull, sql } from 'drizzle-orm';
import type { UserRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

/**
 * Trạng thái quầy hội chợ — TẠI THỜI ĐIỂM NÀY, không phải báo cáo.
 *
 * Khác Báo Cáo Chốt Ngày ở 3 điểm, và đó là cả tính năng:
 *  1. Tự làm mới khi modal mở, không cần bấm (chốt ngày thì bấm tay một lần).
 *  2. Chỉ kho hội chợ, và TẤT CẢ kho hội chợ cùng lúc, không chọn 1 kho.
 *  3. Có đơn CHƯA ĐÓNG (`PENDING_CONFIRMATION`) — báo cáo ngày chỉ tính
 *     `COMPLETED` nên không bao giờ thấy trạng thái "đang chờ".
 *
 * Ngày nghiệp vụ theo GIỜ VIỆT NAM. Báo cáo chốt ngày dùng ngày UTC — hai nơi
 * có thể lệch nhau trong khung 00:00-07:00. Chọn giờ VN vì đây là màn hình
 * "lúc này ở hội chợ đang bán gì", và mốc ngày của kế toán là giờ VN. Sự lệch
 * được NÓI RÕ ngay trên modal chứ không giấu; Kế hoạch B sẽ thống nhất.
 */

const VN_TZ = 'Asia/Ho_Chi_Minh';

/** Ngày nghiệp vụ hôm nay theo giờ VN (YYYY-MM-DD). */
function vnToday(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: VN_TZ });
}

export async function GET(req: NextRequest) {
  try {
    // Chỉ quản lý: đây là số liệu doanh thu tức thời của từng gian hàng.
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);

    const sp = new URL(req.url).searchParams;
    const onlyWarehouse = (sp.get('warehouseId') || '').trim();
    const date = (sp.get('date') || '').trim() || vnToday();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', error: `Ngày "${date}" không hợp lệ. Cần dạng YYYY-MM-DD.` },
        { status: 400 }
      );
    }

    // 1. Kho hội chợ đang hoạt động.
    const fairRows = await db
      .select({ id: warehouses.id, code: warehouses.code, name: warehouses.name })
      .from(warehouses)
      .where(and(eq(warehouses.warehouseType, 'FAIR_EVENT'), eq(warehouses.isActive, true)));
    const fairIds = fairRows.map((w) => w.id);
    const scopeIds = onlyWarehouse ? fairIds.filter((id) => id === onlyWarehouse) : fairIds;
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
          // Tiền tố 10 ký tự: an toàn cho CẢ hai họ timestamp đang cùng tồn tại
          // trong bảng (SQLite CURRENT_TIMESTAMP và ISO của app). So chuỗi
          // timestamp đầy đủ giữa hai họ là vô nghĩa và âm thầm loại mất dữ liệu.
          sql`${orders.createdAt} LIKE ${`${date}%`}`
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

    // 4. Đơn vừa đóng (5 dòng) — câu trả lời "vừa xong gì".
    const recentClosedRows = await db
      .select({
        orderCode: orders.orderCode,
        warehouseId: orders.warehouseId,
        finalAmount: orders.finalAmount,
        paymentMethod: orders.paymentMethod,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(and(inArray(orders.warehouseId, scopeIds), eq(orders.status, 'COMPLETED')))
      .orderBy(desc(orders.createdAt))
      .limit(5);

    // 5. Ca nào đang mở — ai đang ở gian hàng nào.
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

    // Tiền mặt bán trong ca, tính cùng điều kiện "hôm nay" — dùng để báo
    // "dự kiến có trong két". KHÔNG dùng cột `totalCashSales`: đó là bản chốt
    // lúc đóng ca nên LUÔN bằng 0 khi ca còn mở (báo cáo chốt ngày đang mắc
    // lỗi này; kế hoạch B sẽ sửa cho khớp).
    const cashTodayRows = await db
      .select({
        warehouseId: orders.warehouseId,
        cashierId: orders.cashierId,
        cash: sql<number>`COALESCE(SUM(${orders.finalAmount}), 0)`,
      })
      .from(orders)
      .where(
        and(
          inArray(orders.warehouseId, scopeIds),
          eq(orders.status, 'COMPLETED'),
          eq(orders.paymentMethod, CASH),
          sql`${orders.createdAt} LIKE ${`${date}%`}`
        )
      )
      .groupBy(orders.warehouseId, orders.cashierId);

    const cashKey = (wh: string, cashier: string) => `${wh}::${cashier}`;
    const cashMap = new Map<string, number>();
    for (const r of cashTodayRows) {
      cashMap.set(cashKey(r.warehouseId, r.cashierId), Number(r.cash || 0));
    }

    const openShifts = shiftRows.map((s) => {
      const openedMs = s.openedAt ? Date.parse(s.openedAt) : NaN;
      return {
        id: s.id,
        warehouseId: s.warehouseId,
        warehouseName: whName(s.warehouseId),
        cashierId: s.cashierId,
        cashierName: shiftStaffNames.get(s.cashierId) || s.cashierId,
        openedAt: s.openedAt,
        elapsedMinutes: Number.isNaN(openedMs) ? null : Math.max(0, Math.round((now - openedMs) / 60000)),
        // Không cần "quá giờ": giờ cắt chốt là quy tắc riêng của nghiệp vụ két và
        // đã có nơi tính. Ở đây chỉ cần thấy ca còn mở và tồn đọng bao lâu.
        expectedCashLive: Number(s.openingCash || 0) + (cashMap.get(cashKey(s.warehouseId, s.cashierId)) || 0),
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
          sql`${orders.createdAt} LIKE ${`${date}%`}`
        )
      )
      .groupBy(orderItems.editionId, editions.code, editions.title)
      .orderBy(desc(sql`COALESCE(SUM(${orderItems.quantity}), 0)`))
      .limit(5);

    return NextResponse.json({
      success: true,
      data: {
        businessDate: date,
        timezoneNote: 'Ngày làm việc Việt Nam (UTC+7). Báo cáo chốt ngày dùng ngày UTC nên hai nơi có thể lệch nhau ở khung 00:00-07:00.',
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
    generatedAt: new Date().toISOString(),
  };
}
