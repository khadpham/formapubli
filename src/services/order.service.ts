import { db, orders, orderItems, editions, warehouses, partners, customers } from '../db';
import { InventoryService } from './inventory.service';
import { eq, and, desc, sql, gte, lte, inArray } from 'drizzle-orm';

export interface OrderItemInput {
  editionId: string;
  quantity: number;
  unitCoverPrice?: number;
  unitDiscountRate?: number;
}

export interface CreateOrderParams {
  warehouseId: string;
  channel?: 'FAIR_EVENT' | 'RETAIL_OFFICE' | 'WHOLESALE_PARTNER' | 'ONLINE';
  partnerId?: string;
  customerId?: string;
  customerName?: string;
  discountRate?: number;
  paymentMethod?: 'CASH' | 'BANK_TRANSFER' | 'QR_CODE';
  fiscalScope?: 'OFFICIAL_TAX' | 'INTERNAL_MANAGEMENT';
  vatRate?: number;
  vatInvoiceRequired?: boolean;
  vatInvoiceCode?: string;
  cashierId?: string;
  idempotencyKey?: string;
  note?: string;
  items: OrderItemInput[];
}

export interface OrderFilterParams {
  startDate?: string;
  endDate?: string;
  fiscalScope?: 'OFFICIAL_TAX' | 'INTERNAL_MANAGEMENT' | 'ALL';
  warehouseId?: string;
  partnerId?: string;
}

export class OrderService {
  /**
   * Tạo đơn hàng bán sách, tự động trừ kho vật lý tức thì (Append-Only Ledger)
   * và ghi nhận sổ kép tài chính (Dual Projection).
   */
  static async createOrder(params: CreateOrderParams) {
    const {
      warehouseId,
      channel = 'FAIR_EVENT',
      partnerId,
      customerId,
      customerName = 'Khách lẻ vãng lai',
      discountRate = 0.0,
      paymentMethod = 'CASH',
      fiscalScope = 'INTERNAL_MANAGEMENT',
      vatRate = 0.0,
      vatInvoiceRequired = false,
      vatInvoiceCode,
      cashierId = 'staff-admin',
      note,
      items,
    } = params;

    if (!items || items.length === 0) {
      throw new Error('Đơn hàng phải có ít nhất 1 đầu sách.');
    }

    // 1. Kiểm tra tồn kho trước cho toàn bộ sản phẩm (Pre-flight Stock Check)
    for (const item of items) {
      if (item.quantity <= 0) {
        throw new Error(`Số lượng bán cho ấn bản ${item.editionId} phải lớn hơn 0.`);
      }

      const currentBalance = await InventoryService.getBalance(item.editionId, warehouseId, 'NEW');
      if (currentBalance < item.quantity) {
        throw new Error(
          `KHÔNG ĐỦ TỒN KHO: Ấn bản ${item.editionId} tại kho chỉ còn ${currentBalance} cuốn, không đủ để bán ${item.quantity} cuốn!`
        );
      }
    }

    // 2. Tra cứu giá bìa từ cơ sở dữ liệu nếu chưa có
    const editionIds = items.map((i) => i.editionId);
    const dbEditions = await db
      .select({
        id: editions.id,
        code: editions.code,
        title: editions.title,
        coverPrice: editions.coverPrice,
      })
      .from(editions)
      .where(inArray(editions.id, editionIds));

    const editionMap = new Map(dbEditions.map((e) => [e.id, e]));

    // 3. Tính toán dòng tiền và chi tiết đơn hàng
    let calculatedSubtotal = 0;
    let calculatedFinalAmount = 0;

    const preparedItems = items.map((item) => {
      const edition = editionMap.get(item.editionId);
      const coverPrice = item.unitCoverPrice ?? (edition?.coverPrice || 0);
      const itemDiscountRate = item.unitDiscountRate ?? discountRate;
      const unitSellingPrice = Math.round(coverPrice * (1 - itemDiscountRate));
      const lineTotal = item.quantity * unitSellingPrice;

      calculatedSubtotal += item.quantity * coverPrice;
      calculatedFinalAmount += lineTotal;

      return {
        id: `oi-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        editionId: item.editionId,
        quantity: item.quantity,
        unitCoverPrice: coverPrice,
        unitDiscountRate: itemDiscountRate,
        unitSellingPrice,
        totalAmount: lineTotal,
      };
    });

    const calculatedDiscountAmount = calculatedSubtotal - calculatedFinalAmount;

    // 4. Sinh mã đơn hàng và Idempotency Key
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const orderCode = `ORD-${dateStr}-${randomSuffix}`;
    const orderId = `ord-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const idempotencyKey = params.idempotencyKey || `idem-order-${orderId}`;

    // 5. Ghi nhận Đơn hàng vào CSDL
    await db.insert(orders).values({
      id: orderId,
      orderCode,
      warehouseId,
      channel,
      partnerId,
      customerId,
      customerName,
      subtotal: calculatedSubtotal,
      discountRate,
      discountAmount: calculatedDiscountAmount,
      finalAmount: calculatedFinalAmount,
      paymentMethod,
      fiscalScope,
      vatRate,
      vatInvoiceRequired,
      vatInvoiceCode,
      status: 'COMPLETED',
      syncStatus: 'SYNCED',
      cashierId,
      idempotencyKey,
      note,
    });

    // 6. Ghi nhận các dòng sản phẩm của đơn hàng
    for (const item of preparedItems) {
      await db.insert(orderItems).values({
        id: item.id,
        orderId,
        editionId: item.editionId,
        quantity: item.quantity,
        unitCoverPrice: item.unitCoverPrice,
        unitDiscountRate: item.unitDiscountRate,
        unitSellingPrice: item.unitSellingPrice,
        totalAmount: item.totalAmount,
      });

      // 7. Khấu trừ tồn kho vật lý tự động qua Thẻ kho bất biến (Append-Only Ledger)
      await InventoryService.recordMovement({
        editionId: item.editionId,
        warehouseId,
        eventType: 'DISPATCH_SALE',
        quantityDelta: -item.quantity,
        condition: 'NEW',
        documentRef: orderCode,
        note: `Bán đơn hàng ${orderCode} (${fiscalScope === 'OFFICIAL_TAX' ? 'Hóa đơn VAT' : 'Nội bộ'})`,
        actorId: cashierId,
        idempotencyKey: `idem-stock-${orderId}-${item.editionId}`,
      });
    }

    return {
      orderId,
      orderCode,
      warehouseId,
      customerName,
      subtotal: calculatedSubtotal,
      discountAmount: calculatedDiscountAmount,
      finalAmount: calculatedFinalAmount,
      fiscalScope,
      itemsCount: preparedItems.length,
      totalQuantity: items.reduce((sum, i) => sum + i.quantity, 0),
    };
  }

  /**
   * Truy vấn danh sách đơn hàng có lọc theo Sổ Kép (Thuế vs Toàn cảnh Nội bộ).
   */
  static async getOrders(filters: OrderFilterParams = {}) {
    const { fiscalScope = 'ALL', warehouseId, partnerId, startDate, endDate } = filters;

    let query = db.select().from(orders);
    const conditions = [];

    if (fiscalScope !== 'ALL') {
      conditions.push(eq(orders.fiscalScope, fiscalScope));
    }
    if (warehouseId) {
      conditions.push(eq(orders.warehouseId, warehouseId));
    }
    if (partnerId) {
      conditions.push(eq(orders.partnerId, partnerId));
    }
    if (startDate) {
      conditions.push(gte(orders.createdAt, startDate));
    }
    if (endDate) {
      conditions.push(lte(orders.createdAt, endDate));
    }

    if (conditions.length > 0) {
      return await db
        .select()
        .from(orders)
        .where(and(...conditions))
        .orderBy(desc(orders.createdAt));
    }

    return await db.select().from(orders).orderBy(desc(orders.createdAt));
  }

  /**
   * Tổng hợp báo cáo doanh số theo ngày/tháng/năm và phân tách Sổ Kép.
   */
  static async getSalesSummary(filters: OrderFilterParams = {}) {
    const list = await this.getOrders(filters);

    let totalOrders = list.length;
    let totalSubtotal = 0;
    let totalDiscount = 0;
    let totalRevenue = 0;

    let officialTaxOrders = 0;
    let officialTaxRevenue = 0;

    let internalOrders = 0;
    let internalRevenue = 0;

    for (const ord of list) {
      totalSubtotal += ord.subtotal;
      totalDiscount += ord.discountAmount || 0;
      totalRevenue += ord.finalAmount;

      if (ord.fiscalScope === 'OFFICIAL_TAX') {
        officialTaxOrders++;
        officialTaxRevenue += ord.finalAmount;
      } else {
        internalOrders++;
        internalRevenue += ord.finalAmount;
      }
    }

    return {
      totalOrders,
      totalSubtotal,
      totalDiscount,
      totalRevenue,
      officialTax: {
        ordersCount: officialTaxOrders,
        revenue: officialTaxRevenue,
      },
      internalManagement: {
        ordersCount: internalOrders,
        revenue: internalRevenue,
      },
    };
  }
}
