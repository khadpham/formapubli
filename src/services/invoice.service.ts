/**
 * InvoiceService - Chuẩn bị và quản lý hóa đơn điện tử
 * GĐ2: prepare từ đơn hàng OFFICIAL_TAX
 * GĐ4: consolidate gom đơn INTERNAL_MANAGEMENT cuối ngày
 */

import { db } from '@/db';
import { einvoices, orders, orderItems, products } from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export interface PrepareInvoiceInput {
  orderId: string;
  createdBy?: string;
}

export interface ConsolidateInput {
  date: string; // YYYY-MM-DD (giờ VN)
  createdBy?: string;
}

export class InvoiceService {
  /**
   * Chuẩn bị hóa đơn từ đơn hàng OFFICIAL_TAX.
   * - Đơn phải có fiscal_scope=OFFICIAL_TAX
   * - Đơn phải có đủ MST/tên/địa chỉ
   * - Chưa có einvoice PREPARED nào cho đơn này
   * Trả về einvoice đã tạo.
   */
  static async prepareFromOrder(input: PrepareInvoiceInput) {
    const { orderId, createdBy } = input;

    // Lấy đơn
    const ordRows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (ordRows.length === 0) throw new Error('Không tìm thấy đơn hàng');
    const ord: any = ordRows[0];

    if (ord.fiscalScope !== 'OFFICIAL_TAX') {
      throw new Error('Đơn không thuộc diện xuất hóa đơn VAT (fiscal_scope != OFFICIAL_TAX)');
    }
    if (!ord.invoiceTaxCode || !ord.invoiceCompanyName || !ord.invoiceAddress) {
      throw new Error('Thiếu thông tin xuất hóa đơn (MST/tên/địa chỉ)');
    }

    // Kiểm tra đã có hóa đơn chưa
    const existing = await db.select().from(einvoices).where(eq(einvoices.orderId, orderId)).limit(1);
    if (existing.length > 0) {
      return existing[0]; // idempotent
    }

    // Lấy items
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));

    // Tính toán: finalAmount đã GỒM VAT (giá bìa gồm thuế) nên phải TÁCH NGƯỢC VAT ra,
    // không cộng thêm. Tổng hóa đơn phải bằng số tiền đã thu.
    const totalAmount = Number(ord.finalAmount || ord.subtotal || 0);
    const vatRate = 0.05; // GTGT sách 5% (anh Kha chốt 2026-10-20); in ấn 8% chỉ áp cho dịch vụ in
    const subtotal = Math.round(totalAmount / (1 + vatRate));
    const vatAmount = totalAmount - subtotal;

    const id = randomUUID();
    const now = new Date().toISOString();

    await db.insert(einvoices).values({
      id,
      orderId,
      invoiceKind: 'SINGLE',
      buyerTaxCode: ord.invoiceTaxCode,
      buyerName: ord.invoiceCompanyName,
      buyerAddress: ord.invoiceAddress,
      subtotal,
      vatRate,
      vatAmount,
      totalAmount,
      status: 'PREPARED',
      createdBy: createdBy || 'system',
      createdAt: now,
      updatedAt: now,
    });

    // Cập nhật trạng thái đơn
    await db.update(orders).set({ invoiceStatus: 'PREPARED' } as any).where(eq(orders.id, orderId));

    const rows = await db.select().from(einvoices).where(eq(einvoices.id, id)).limit(1);
    return rows[0];
  }

  /**
   * Gom hóa đơn tổng hợp cuối ngày cho các đơn INTERNAL_MANAGEMENT.
   * - Lấy tất cả đơn INTERNAL_MANAGEMENT trong ngày (theo giờ VN), chưa được gom
   * - Tạo 1 einvoice CONSOLIDATED
   * - Đánh dấu các đơn đã gom
   */
  static async consolidateDay(input: ConsolidateInput) {
    const { date, createdBy } = input; // YYYY-MM-DD

    // Kiểm tra đã gom ngày này chưa
    const existing = await db.select().from(einvoices).where(
      and(eq(einvoices.invoiceKind, 'CONSOLIDATED'), eq(einvoices.consolidatedDate, date))
    ).limit(1);
    if (existing.length > 0) {
      return { invoice: existing[0], orderCount: 0, skipped: true };
    }

    // Lấy đơn INTERNAL_MANAGEMENT trong ngày, chưa gom, đã hoàn thành.
    // created_at là mốc UTC nhưng có 2 định dạng (ISO-Z và "YYYY-MM-DD
    // HH:MM:SS") nên KHÔNG so chuỗi thô và KHÔNG cắt substr theo ngày UTC
    // (đơn 0h-7h sáng giờ VN sẽ lọt sang ngày trước). Chuẩn hoá cả hai
    // dạng bằng datetime() của SQLite rồi so với cửa sổ ngày VN quy ra
    // UTC: ngày VN `date` = [date 00:00 +07, +24h) = [ hôm trước 17:00Z,
    // 17:00Z ).
    const vnStartUtc = new Date(`${date}T00:00:00+07:00`);
    const toUtcText = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
    const windowStart = toUtcText(vnStartUtc);
    const windowEnd = toUtcText(new Date(vnStartUtc.getTime() + 24 * 3600 * 1000));
    const dayOrders = await db.select().from(orders).where(
      and(
        eq(orders.fiscalScope, 'INTERNAL_MANAGEMENT'),
        eq(orders.status, 'COMPLETED'),
        sql`datetime(${orders.createdAt}) >= ${windowStart} AND datetime(${orders.createdAt}) < ${windowEnd}`
      )
    );

    // Lọc đơn chưa được gom (không có einvoice nào trỏ tới, và invoiceStatus != CONSOLIDATED)
    const unconsolidated = dayOrders.filter((o: any) =>
      o.invoiceStatus !== 'CONSOLIDATED' && o.invoiceStatus !== 'PREPARED'
    );

    if (unconsolidated.length === 0) {
      return { invoice: null, orderCount: 0, skipped: true, reason: 'Không có đơn cần gom' };
    }

    const totalAmount = unconsolidated.reduce((s: number, o: any) => s + Number(o.finalAmount || 0), 0);
    const vatRate = 0.05; // GTGT sách 5% (anh Kha chốt 2026-10-20); in ấn 8% chỉ áp cho dịch vụ in
    const subtotal = Math.round(totalAmount / (1 + vatRate));
    const vatAmount = totalAmount - subtotal;
    const orderIds = unconsolidated.map((o: any) => o.id);

    const id = randomUUID();
    const now = new Date().toISOString();

    await db.insert(einvoices).values({
      id,
      orderId: null,
      invoiceKind: 'CONSOLIDATED',
      consolidatedDate: date,
      sourceOrderIds: JSON.stringify(orderIds),
      buyerTaxCode: null,
      buyerName: 'Khách lẻ không lấy hóa đơn',
      buyerAddress: null,
      subtotal,
      vatRate,
      vatAmount,
      totalAmount,
      status: 'PREPARED',
      createdBy: createdBy || 'system-consolidate',
      createdAt: now,
      updatedAt: now,
    });

    // Đánh dấu các đơn đã gom
    for (const o of unconsolidated) {
      await db.update(orders).set({ invoiceStatus: 'CONSOLIDATED' } as any).where(eq(orders.id, (o as any).id));
    }

    const rows = await db.select().from(einvoices).where(eq(einvoices.id, id)).limit(1);
    return { invoice: rows[0], orderCount: unconsolidated.length, skipped: false };
  }

  /**
   * Danh sách hóa đơn chờ xử lý
   */
  static async listPending() {
    return db.select().from(einvoices).where(eq(einvoices.status, 'PREPARED'));
  }

  /**
   * Lấy chi tiết hóa đơn
   */
  static async getById(id: string) {
    const rows = await db.select().from(einvoices).where(eq(einvoices.id, id)).limit(1);
    return rows[0] || null;
  }
}
