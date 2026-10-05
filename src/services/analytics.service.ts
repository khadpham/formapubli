import { db, orders, orderItems, editions, products, stockBalances, warehouses, inventoryLedger, sponsorshipDrawdowns, returnOrders } from '../db';
import { eq, and, gte, lte, sql, like, inArray } from 'drizzle-orm';
import { businessDateOf, createdAtBetween, VN_UTC_OFFSET_MIN } from './order.service';
import { parseDbTimestamp } from '../lib/db-timestamp';

/** Ngày VN 'YYYY-MM-DD' của timestamp DB (cả hai họ cũ/mới), không phụ thuộc múi giờ máy. */
function vnDayKey(value: unknown): string | null {
  const d = parseDbTimestamp(value as any);
  if (!d) return null;
  return new Date(d.getTime() + VN_UTC_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

// Bước 5 — OLAP read-only: mọi số liệu băm trực tiếp từ single source of truth
// (orders/order_items/ledger). Không copy ngày→tuần→tháng, không bảng mới.

export interface DateRange {
  startDate?: string;
  endDate?: string;
}

/**
 * Bộ lọc phạm vi của tab Doanh Số: kho + sổ kế toán.
 *
 * VÌ SAO CẦN: `byChannel`/`cashflow` trước đây chỉ lọc ngày ⇒ số liệu trộn
 * MỌI kho và CẢ HAI sổ (thuế + nội bộ), nên tổng trên bảng không khớp tổng
 * sổ kế mà người dùng đang mở. `opts` là tham số CỘNG THÊM: không truyền thì
 * y hệt cũ (toàn hệ thống), truyền thì chỉ tính đúng kho + đúng sổ.
 */
export interface AnalyticsScope {
  warehouseId?: string;
  fiscalScope?: 'OFFICIAL_TAX' | 'INTERNAL_MANAGEMENT';
}

/**
/**
 * So khớp ngày nghiệp vụ VIỆT NAM cho mọi truy vấn báo cáo ở đây.
 *
 * Nguyên nhân gốc (3 agent review độc lập đều tìm ra ở các file khác nhau):
 * cột thời gian trong CSDL là `text` và đang chứa SONG SONG hai họ timestamp —
 * SQLite `CURRENT_TIMESTAMP` sinh `'YYYY-MM-DD HH:mm:ss'`, còn app ghi ISO
 * `'YYYY-MM-DDTHH:mm:ss.sssZ'`. So CHUỖI THÔ giữa hai họ là vô nghĩa, vì
 * byte 0x54 ('T') > 0x20 (' '):
 *   - `lte(created_at, '2026-11-10')` loại mất MỌI đơn sau 00:00 ngày đó,
 *   - `gte(created_at, '2026-11-10')` loại mất 7 tiếng đầu ngày.
 * Đo thật trên một ngày có dữ liệu: báo cáo trả 0 đơn / 0 đ trong khi sổ doanh
 * số cùng ngày trả đúng — hai báo cáo, một dữ liệu, hai con số.
 *
 * Dùng lại `createdAtBetween` của `order.service` (helper ĐÃ CÓ sẵn) thay vì
 * viết lần thứ ba. Nó tự phân biệt ngày trần (so ngày nghiệp vụ +7 giờ) với mốc
 * ISO đầy đủ (so mốc UTC).
 *
 * Trả về MẢNG điều kiện (không phải `and(...)`) vì `cashflow` dùng đúng bộ
 * điều kiện này cho truy vấn COD — một chỗ, không hai bản sao.
 */
function rangeConds(table: typeof orders, range: DateRange, scope: AnalyticsScope = {}) {
  const conds = [eq(table.status, 'COMPLETED')];
  if (scope.warehouseId) conds.push(eq(table.warehouseId, scope.warehouseId));
  if (scope.fiscalScope) conds.push(eq(table.fiscalScope, scope.fiscalScope));
  conds.push(...createdAtBetween(table.createdAt, range.startDate, range.endDate));
  return conds;
}

/**
 * Thứ 2 đầu tuần hiện tại (giờ VIỆT NAM), ISO string để so sánh `created_at`.
 *
 * Trước đây dùng `getDay`/`setHours`/`setDate` — tức GIỜ CỦA MÁY CHỦ. Máy chủ
 * dev chạy GMT+7 còn Cloudflare Workers chạy UTC, nên cùng một ngày mà "tuần
 * này" lệch nhau 7 tiếng giữa dev và production: cùng dữ liệu, hai kết quả khác
 * nhau, và không ai hiểu vì sao. Dựng thẳng từ ngày nghiệp vụ VN rồi trừ 7 giờ.
 */
function mondayOf(offsetWeeks = 0): Date {
  const now = new Date();
  // Ngày nghiệp vụ VN hôm nay.
  const vnDay = businessDateOf(now);
  const [y, mo, d] = vnDay.split('-').map(Number);
  // getUTCDay trên mốc đã dịch +7h là đúng ngày VN ⇒ Thứ 2 = 0.
  const dow = (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7;
  return new Date(Date.UTC(y, mo - 1, d - dow + offsetWeeks * 7) - VN_UTC_OFFSET_MIN * 60_000);
}

export class AnalyticsService {
  /**
   * Tổng quan tồn kho vật lý — thẻ "Tồn Kho" trên bảng quản trị tổng quan.
   *
   * VÌ SAO CÓ HÀM NÀY (30/09): thẻ đó trước đây hiển thị CHỮ VIẾT CỨNG
   * `81 Đầu Sách`, kèm `(3 Kho)` và tên kho viết thẳng — trong khi production có
   * 5 kho. Tức bảng quản trị **nói dối người dùng**, và không bao giờ tự cập nhật.
   *
   * Chỉ tính ấn bản `is_active` (ấn bản bị khoá như H85 không hiện ở POS thì cũng
   * không nên được báo là hàng đang bán được), và chỉ kho `is_active`.
   *
   * `warehouseId` là tham số CỘNG THÊM (Task 2 — dropdown kho trên dashboard):
   * không truyền thì y hệt cũ (toàn hệ thống), truyền thì chỉ tính kho đó và
   * `warehouseCount=1`, `warehouseNames=[tên kho đó]`. Không có tham số ⇒ mọi
   * lời gọi cũ (route `/api/analytics?view=stock-summary`) không đổi hành vi.
   *
   * `totalSkus` là quy mô CATALOG (bản quản trị "còn bao nhiêu mã đang bán") nên
   * CỐ Ý không lọc theo kho — lọc nó sẽ làm KPI "Tổng SKU" nhảy theo dropdown,
   * đúng nghĩa nhưng khác hành vi cũ và gây nhầm lẫn khi so 2 con số.
   */
  static async stockSummary(warehouseId?: string) {
    const rowConds = [
      sql`${stockBalances.physicalQuantity} > 0`,
      sql`${editions.isActive} = 1`,
      sql`${warehouses.isActive} = 1`,
    ];
    if (warehouseId) rowConds.push(eq(stockBalances.warehouseId, warehouseId));

    const rows = await db
      .select({
        titlesWithStock: sql<number>`COUNT(DISTINCT ${stockBalances.editionId})`,
        totalUnits: sql<number>`COALESCE(SUM(${stockBalances.physicalQuantity}), 0)`,
      })
      .from(stockBalances)
      .innerJoin(editions, eq(stockBalances.editionId, editions.id))
      .innerJoin(warehouses, eq(stockBalances.warehouseId, warehouses.id))
      .where(and(...rowConds));

    const [skus] = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(editions)
      .where(sql`${editions.isActive} = 1`);

    const whs = await db
      .select({ id: warehouses.id, name: warehouses.name })
      .from(warehouses)
      .where(
        warehouseId
          ? and(sql`${warehouses.isActive} = 1`, eq(warehouses.id, warehouseId))
          : sql`${warehouses.isActive} = 1`
      )
      .orderBy(warehouses.name);

    return {
      titlesWithStock: Number(rows[0]?.titlesWithStock || 0),
      totalUnits: Number(rows[0]?.totalUnits || 0),
      totalSkus: Number(skus?.n || 0),
      warehouseCount: whs.length,
      warehouseNames: whs.map((w) => w.name),
    };
  }

  /** Doanh thu + số đơn theo kênh (COMPLETED). SPONSORSHIP hiện 0đ nhưng vẫn liệt kê minh bạch.
   *  `opts` lọc thêm kho + sổ kế toán (xem `AnalyticsScope`); không truyền thì y hệt cũ. */
  static async byChannel(range: DateRange = {}, opts: AnalyticsScope = {}) {
    const rows = await db
      .select({
        channel: orders.channel,
        orders: sql<number>`COUNT(*)`,
        revenue: sql<number>`COALESCE(SUM(${orders.finalAmount}), 0)`,
        subtotal: sql<number>`COALESCE(SUM(${orders.subtotal}), 0)`,
      })
      .from(orders)
      .where(and(...rangeConds(orders, range, opts)))
      .groupBy(orders.channel);
    const totalRevenue = rows.reduce((s, r) => s + Number(r.revenue || 0), 0);
    return rows.map((r) => ({
      channel: r.channel,
      orders: Number(r.orders || 0),
      revenue: Number(r.revenue || 0),
      subtotal: Number(r.subtotal || 0),
      share: totalRevenue > 0 ? Number(r.revenue || 0) / totalRevenue : 0,
    })).sort((a, b) => b.revenue - a.revenue);
  }

  /** Top sách tuần này (T2–CN) + tăng trưởng WoW so với tuần trước. */
  static async trending(topN = 20) {
    const thisMon = mondayOf(0).toISOString();
    const lastMon = mondayOf(-1).toISOString();
    const agg = async (from: string, to: string) => {
      const rows = await db
        .select({
          editionId: orderItems.editionId,
          qty: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)`,
          revenue: sql<number>`COALESCE(SUM(${orderItems.totalAmount}), 0)`,
        })
        .from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        // Cửa sổ tuần là MỐC UTC (`mondayOf().toISOString()`) nên `createdAtBetween`
        // tự dùng nhánh so mốc UTC. Không được so chuỗi thô: cột này có cả dòng
        // SQLite (' ') lẫn dòng ISO ('T'), mà 'T' > ' ' nên so thô là sai.
        .where(and(eq(orders.status, 'COMPLETED'), ...createdAtBetween(orders.createdAt, from, to)))
        .groupBy(orderItems.editionId);
      const map = new Map<string, { qty: number; revenue: number }>();
      for (const r of rows) {
        // 0032: dòng hàng hóa có `edition_id` NULL ⇒ bỏ, báo cáo này chỉ dành cho sách.
        if (r.editionId === null) continue;
        map.set(r.editionId, { qty: Number(r.qty || 0), revenue: Number(r.revenue || 0) });
      }
      return map;
    };
    const cur = await agg(thisMon, new Date().toISOString());
    const prev = await agg(lastMon, thisMon);
    const ids = Array.from(new Set([...Array.from(cur.keys()), ...Array.from(prev.keys())]));
    const meta = ids.length > 0
      ? await db.select({ id: editions.id, code: editions.code, title: editions.title }).from(editions).where(
          // drizzle inArray import cycle-safe: dùng sql IN
          sql`${editions.id} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`
        )
      : [];
    const metaMap = new Map(meta.map((m) => [m.id, m]));
    const rows = ids.map((id) => {
      const c = cur.get(id) || { qty: 0, revenue: 0 };
      const p = prev.get(id) || { qty: 0, revenue: 0 };
      const wow = p.qty > 0 ? (c.qty - p.qty) / p.qty : c.qty > 0 ? 1 : 0;
      return {
        editionId: id,
        code: metaMap.get(id)?.code || '?',
        title: metaMap.get(id)?.title || '?',
        qtyThisWeek: c.qty,
        qtyLastWeek: p.qty,
        revenueThisWeek: c.revenue,
        wow: Math.round(wow * 1000) / 1000,
      };
    });
    rows.sort((a, b) => b.qtyThisWeek - a.qtyThisWeek || b.revenueThisWeek - a.revenueThisWeek);
    return rows.slice(0, Math.max(1, Math.min(100, topN)));
  }

  /** Ký gửi đa điểm: mỗi kho wh-consign-* đang giữ bao nhiêu + đã bán kỳ này. */
  static async consignment(range: DateRange = {}) {
    const whs = await db.select().from(warehouses).where(like(warehouses.id, 'wh-consign-%'));
    if (whs.length === 0) return [];
    // Số truy vấn cố định (3) bất kể bao nhiêu kho ký gửi và bao nhiêu SKU.
    // Trước đây: mỗi kho × mỗi dòng tồn lại một SELECT editions ⇒ 3 kho × 60 SKU
    // là 127 truy vấn cho một bảng điều khiển read-only.
    const bals = await db
      .select({
        warehouseId: stockBalances.warehouseId,
        editionId: stockBalances.editionId,
        qty: stockBalances.physicalQuantity,
        coverPrice: editions.coverPrice,
      })
      .from(stockBalances)
      .leftJoin(editions, eq(stockBalances.editionId, editions.id))
      .where(inArray(stockBalances.warehouseId, whs.map((w) => w.id)));

    const soldConds = [inArray(inventoryLedger.warehouseId, whs.map((w) => w.id)), eq(inventoryLedger.eventType, 'CONSIGNMENT_SOLD')];
    soldConds.push(...createdAtBetween(inventoryLedger.recordedAt, range.startDate, range.endDate));
    const soldRows = await db
      .select({
        warehouseId: inventoryLedger.warehouseId,
        qty: sql<number>`COALESCE(SUM(${inventoryLedger.quantityDelta}), 0)`,
      })
      .from(inventoryLedger)
      .where(and(...soldConds))
      .groupBy(inventoryLedger.warehouseId);
    const soldByWh = new Map(soldRows.map((r) => [r.warehouseId, Math.abs(Number(r.qty || 0))]));

    const agg = new Map<string, { heldQty: number; heldValue: number; skuCount: number }>();
    for (const wh of whs) agg.set(wh.id, { heldQty: 0, heldValue: 0, skuCount: 0 });
    for (const b of bals) {
      const slot = agg.get(b.warehouseId);
      if (!slot) continue;
      const qty = Number(b.qty || 0);
      slot.heldQty += qty;
      // Giá trị tồn theo giá bìa (ước tính quản trị)
      slot.heldValue += qty * Number(b.coverPrice || 0);
      if (qty > 0) slot.skuCount++;
    }

    const out = whs.map((wh) => {
      const slot = agg.get(wh.id)!;
      return {
        warehouseId: wh.id,
        warehouseName: wh.name,
        heldQty: slot.heldQty,
        heldValue: slot.heldValue,
        soldQty: soldByWh.get(wh.id) ?? 0,
        skuCount: slot.skuCount,
      };
    });
    return out.sort((a, b) => b.heldValue - a.heldValue);
  }

  /** Sách bán chạy theo kỳ tùy chọn: group order_items của đơn COMPLETED trong range.
   * Trả lời "cuốn nào bán chạy nhất hôm nay / tuần này / tháng này" cho Owner/Manager.
   * - JOIN truc tiep editions (khong IN-list → khong vuot 999 bien SQLite).
   * - Loai tang/tai tro/0d nhu salesByEdition. Loc kho qua orders.warehouseId.
   *
   * `excludeGifts` (tham số 4, MẶC ĐỊNH true): true ⇒ bảng chỉ còn hàng khách
   * thực mua, quà đã phát nằm ở `totalGiftQty`; false ⇒ giữ cả dòng quà trong
   * bảng (dành cho muốn xem tổng cả quà). Mặc định này đã khóa bằng test
   * `scripts/test-top-gifts-locked.ts` — đổi nó là làm đỏ suite đó.
   */
  /**
   * Nhịp Bán 1 sản phẩm trong kỳ: buckets theo ngày VN + sự kiện bán + tổng.
   * Chỉ đơn COMPLETED (PENDING chưa phải bán). Không cắt top — món nào có bán
   * trong kỳ đều gom được (danh sách toàn kỳ lấy từ top-editions top=100).
   */
  static async productTimeline(
    productId: string,
    range: DateRange = {},
    warehouseId?: string
  ) {
    const pid = `${productId || ''}`.trim();
    if (!pid) return null;
    const conds = [
      eq(orders.status, 'COMPLETED'),
      eq(orderItems.productId, pid),
      ...createdAtBetween(orders.createdAt, range.startDate, range.endDate),
    ];
    if (warehouseId) conds.push(eq(orders.warehouseId, warehouseId));
    const lines: any[] = await db
      .select({
        qty: orderItems.quantity,
        revenue: orderItems.totalAmount,
        createdAt: orders.createdAt,
        orderId: orders.id,
        orderCode: orders.orderCode,
        warehouseId: orders.warehouseId,
        channel: orders.channel,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(and(...conds))
      .orderBy(sql`${orders.createdAt} DESC`)
      .limit(200);
    const meta: any[] = await db
      .select({ id: products.id, code: products.code, name: products.name })
      .from(products)
      .where(eq(products.id, pid))
      .limit(1);
    const start = range.startDate || '0000-00-00';
    const end = range.endDate || '9999-99-99';
    const byDay = new Map<string, { date: string; qty: number; revenue: number; orders: Set<string> }>();
    for (const l of lines) {
      const day = vnDayKey(l.createdAt);
      if (!day || day < start || day > end) continue;
      let b = byDay.get(day);
      if (!b) {
        b = { date: day, qty: 0, revenue: 0, orders: new Set<string>() };
        byDay.set(day, b);
      }
      b.qty += Number(l.qty || 0);
      b.revenue += Number(l.revenue || 0);
      if (l.orderId) b.orders.add(String(l.orderId));
    }
    const buckets: Array<{ date: string; qty: number; revenue: number; orders: number }> = [];
    byDay.forEach((b) => buckets.push({ date: b.date, qty: b.qty, revenue: b.revenue, orders: b.orders.size }));
    buckets.sort((a, b) => (a.date < b.date ? -1 : 1));
    const totals = {
      qty: buckets.reduce((s, b) => s + b.qty, 0),
      revenue: buckets.reduce((s, b) => s + b.revenue, 0),
      orders: buckets.reduce((s, b) => s + b.orders, 0),
      activeDays: buckets.length,
    };
    return {
      product: { id: pid, code: meta[0]?.code || null, name: meta[0]?.name || null },
      buckets,
      events: lines.map((l) => ({
        createdAt: l.createdAt,
        qty: Number(l.qty || 0),
        orderId: String(l.orderId || ''),
        orderCode: String(l.orderCode || ''),
        warehouseId: String(l.warehouseId || ''),
        channel: l.channel || null,
      })),
      totals,
    };
  }

  static async topEditions(range: DateRange = {}, topN = 20, warehouseId?: string, excludeGifts = true, fiscalScope?: 'OFFICIAL_TAX' | 'INTERNAL_MANAGEMENT') {
    const conds = [
      eq(orders.status, 'COMPLETED'),
      sql`${orders.discountRate} < 1`,
      sql`${orders.channel} != 'SPONSORSHIP'`,
      sql`${orders.finalAmount} > 0`,
    ];
    if (warehouseId) conds.push(eq(orders.warehouseId, warehouseId));
    // Task 7b: Top đi theo sổ của tab (Sổ Thuế chỉ thấy sách của đơn VAT).
    if (fiscalScope) conds.push(eq(orders.fiscalScope, fiscalScope));
    conds.push(...createdAtBetween(orders.createdAt, range.startDate, range.endDate));
    // VÌ SAO LỌC QUÀ Ở ĐÂY: bảng "Top bán chạy" trả lời "khách MUA gì", mà dòng
    // quà (`is_gift_line = 1`) không phải do khách chọn — nó do chương trình
    // khuyến mại chèn vào. Tính chung, cuốn quà leo lên top 5 và thành "bán
    // chạy nhất" dù không đem về đồng nào. Nhưng CẦN biết quà đã phát bao
    // nhiêu ⇒ `totalGiftQty` ở dưới, cùng bộ lọc (kho + ngày + COMPLETED) để
    // hai con số cùng nói về MỘT tập đơn, không lệch nhau.
    if (excludeGifts) {
      conds.push(sql`${orderItems.isGiftLine} = 0`);
      conds.push(sql`${orderItems.totalAmount} > 0`);
    }
    const rows = await db
      .select({
        editionId: orderItems.editionId,
        productId: orderItems.productId,
        // Tên/mã rơi về `products` cho dòng hàng hóa — sửa "mọi món gộp thành
        // một nhóm tên '?'" do group theo `edition_id` NULL.
        code: sql<string | null>`COALESCE(${editions.code}, ${products.code})`,
        title: sql<string | null>`COALESCE(${editions.title}, ${products.name})`,
        qty: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)`,
        revenue: sql<number>`COALESCE(SUM(${orderItems.totalAmount}), 0)`,
        orders: sql<number>`COUNT(DISTINCT ${orderItems.orderId})`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .leftJoin(editions, eq(orderItems.editionId, editions.id))
      .leftJoin(products, eq(orderItems.productId, products.id))
      .where(and(...conds))
      .groupBy(sql`COALESCE(${orderItems.editionId}, ${orderItems.productId})`);
    const totalQty = rows.reduce((s, r) => s + Number(r.qty || 0), 0);
    const totalRevenue = rows.reduce((s, r) => s + Number(r.revenue || 0), 0);
    const out = rows.map((r) => ({
      editionId: r.editionId,
      productId: (r as any).productId || r.editionId,
      code: r.code || '?',
      // '—' chứ không '?': '?' đọc như mã hỏng, '—' đọc như "chưa có tên".
      title: r.title || '—',
      qty: Number(r.qty || 0),
      orders: Number(r.orders || 0),
      revenue: Number(r.revenue || 0),
      qtyShare: totalQty > 0 ? Number(r.qty || 0) / totalQty : 0,
      revenueShare: totalRevenue > 0 ? Number(r.revenue || 0) / totalRevenue : 0,
    }));
    out.sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);
    // Truy vấn thứ hai, chỉ chạy khi `excludeGifts` (mặc định true) — tức là
    // MẶC ĐỊNH LUÔN tốn 2 query, không phải 1. Cần nó vì hai con số phải cùng
    // nói về MỘT tập đơn (bảng đã loại quà thì không ai biết quà đã phát bao
    // nhiêu). Khi false ⇒ `totalGiftQty = 0`, shape ổn định cho UI đọc một
    // đường duy nhất, và bảng đã chứa cả quà nên không cần đếm lần hai.
    let totalGiftQty = 0;
    if (excludeGifts) {
      const giftConds = [
        eq(orders.status, 'COMPLETED'),
        sql`${orderItems.isGiftLine} = 1`,
      ];
      if (warehouseId) giftConds.push(eq(orders.warehouseId, warehouseId));
      if (fiscalScope) giftConds.push(eq(orders.fiscalScope, fiscalScope));
      giftConds.push(...createdAtBetween(orders.createdAt, range.startDate, range.endDate));
      const giftRows = await db
        .select({ q: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)` })
        .from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .where(and(...giftConds));
      totalGiftQty = Number(giftRows[0]?.q || 0);
    }
    return { items: out.slice(0, Math.max(1, Math.min(100, topN))), totalQty, totalRevenue, totalGiftQty };
  }

  /**
   * Ma trận dòng tiền: doanh thu theo kênh + COD phải thu/đã về + tài trợ đã rút.
   *
   * MỖI CHÂN CỦA MA TRẬN PHẢI NÓI VỀ CÙNG MỘT TẬP ĐƠN. Trước đây `salesRevenue`
   * đã lọc kho + sổ còn `completedRefunds` chỉ lọc ngày ⇒ `netRevenue` cộng doanh
   * thu của kho A với tiền hoàn của kho B (mà trên màn hình lại đang lọc kho A).
   * Người dùng thấy "lãi âm"/"lãi quá lớn" mà không có dòng nào giải thích.
   * Nay cả hai chân lọc theo CÙNG một `opts`.
   *
   * - COD (`codPending`/`codReceived`): trên bảng `orders` ⇒ theo cả kho + sổ.
   * - Hoàn tiền (`completedRefunds` → `netRevenue`): `return_orders` KHÔNG có
   *   cột kho/sổ, nên join qua `order_id` sang `orders` để lọc theo cùng bộ điều
   *   kiện. Inner join an toàn: `return_orders.order_id` là FK NOT NULL.
   * - Tài trợ (`sponsorshipDrawnValue/Qty`): lọc theo `sponsorship_drawdowns.warehouse_id`
   *   nhưng CỐ Ý KHÔNG lọc theo `fiscalScope` — quỹ tài trợ nằm ở TẦNG TRƯỚC sổ
   *   kế toán (tiền vào quỹ không mang nhãn thuế/nội bộ), nên lọc sổ ở đây sẽ
   *   làm số tiền đã rút biến mất khỏi ma trận. Ghi rõ ở đây để người sau không
   *   "sửa cho khớp" rồi làm sai nghiệp vụ.
   */
  static async cashflow(range: DateRange = {}, opts: AnalyticsScope = {}) {
    const channels = await this.byChannel(range, opts);
    // COD phải theo CÙNG bộ lọc kho + sổ như doanh thu, nếu không tổng dòng tiền
    // trộn COD của kho khác/sổ khác với doanh thu đang xem.
    const codConds = rangeConds(orders, range, opts);
    const codRows = await db
      .select({ codStatus: orders.codStatus, total: sql<number>`COALESCE(SUM(${orders.codAmount}), 0)` })
      .from(orders)
      .where(and(...codConds))
      .groupBy(orders.codStatus);
    let codPending = 0;
    let codReceived = 0;
    for (const r of codRows) {
      if (r.codStatus === 'PENDING') codPending = Number(r.total || 0);
      if (r.codStatus === 'RECEIVED') codReceived = Number(r.total || 0);
    }
    // Quỹ tài trợ: lọc kho (rút từ kho nào) + ngày, KHÔNG lọc sổ — xem JSDoc hàm.
    const spfConds = [];
    if (opts.warehouseId) spfConds.push(eq(sponsorshipDrawdowns.warehouseId, opts.warehouseId));
    spfConds.push(...createdAtBetween(sponsorshipDrawdowns.createdAt, range.startDate, range.endDate));
    const spfRows = await db
      .select({
        value: sql<number>`COALESCE(SUM(${sponsorshipDrawdowns.drawnValue}), 0)`,
        qty: sql<number>`COALESCE(SUM(${sponsorshipDrawdowns.quantity}), 0)`,
      })
      .from(sponsorshipDrawdowns)
      .where(spfConds.length > 0 ? and(...spfConds) : undefined);
    const sponsorshipDrawnValue = Number(spfRows[0]?.value || 0);
    const sponsorshipDrawnQty = Number(spfRows[0]?.qty || 0);
    // Hoàn tiền: lọc phiếu hoàn theo ngày + trạng thái, rồi join sang `orders`
    // để lọc kho + sổ — cùng bộ điều kiện với doanh thu, nếu không `netRevenue`
    // trộn chân tiền của tập đơn khác với doanh thu đang xem.
    const refundConds = [eq(returnOrders.status, 'COMPLETED')];
    refundConds.push(...createdAtBetween(returnOrders.createdAt, range.startDate, range.endDate));
    if (opts.warehouseId) refundConds.push(eq(orders.warehouseId, opts.warehouseId));
    if (opts.fiscalScope) refundConds.push(eq(orders.fiscalScope, opts.fiscalScope));
    const refundRows = await db
      .select({ total: sql<number>`COALESCE(SUM(${returnOrders.refundAmount}), 0)` })
      .from(returnOrders)
      .innerJoin(orders, eq(returnOrders.orderId, orders.id))
      .where(and(...refundConds));
    const completedRefunds = Number(refundRows[0]?.total || 0);

    const salesRevenue = channels.filter((c) => c.channel !== 'SPONSORSHIP').reduce((s, c) => s + c.revenue, 0);
    const netRevenue = salesRevenue - completedRefunds;
    return { channels, salesRevenue, netRevenue, codPending, codReceived, sponsorshipDrawnValue, sponsorshipDrawnQty };
  }
}
