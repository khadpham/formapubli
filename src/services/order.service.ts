import { db, orders, orderItems, editions, warehouses, partners, customers, cashboxSessions } from '../db';
import { InventoryService } from './inventory.service';
import { eq, and, desc, sql, gte, lte, inArray } from 'drizzle-orm';
import { withDbRetry } from '../lib/db-retry';

export interface OrderItemInput {
  editionId: string;
  quantity: number;
  unitCoverPrice?: number;
  unitDiscountRate?: number;
}

export interface CreateOrderParams {
  id?: string;
  orderCode?: string;
  createdAt?: string;
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
  cashboxSessionId?: string;
  idempotencyKey?: string;
  note?: string;
  isOfflineSync?: boolean; // Cờ báo hiệu đơn sync từ hàng đợi ngoại tuyến hội chợ
  allowOverdraft?: boolean; // Cho phép áp dụng pattern bù tồn kho chênh lệch hội chợ
  items: OrderItemInput[];
}

export interface OrderFilterParams {
  startDate?: string;
  endDate?: string;
  fiscalScope?: 'OFFICIAL_TAX' | 'INTERNAL_MANAGEMENT' | 'ALL';
  warehouseId?: string;
  partnerId?: string;
  cashierId?: string;
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

    // 0. Bảo vệ Idempotency (Tránh ghi trùng lặp khi Sync đơn Offline hoặc Retry)
    if (params.idempotencyKey) {
      const existing = await db
        .select()
        .from(orders)
        .where(eq(orders.idempotencyKey, params.idempotencyKey))
        .limit(1);
      if (existing.length > 0) {
        return {
          orderId: existing[0].id,
          orderCode: existing[0].orderCode,
          warehouseId: existing[0].warehouseId,
          customerName: existing[0].customerName,
          subtotal: existing[0].subtotal,
          discountAmount: existing[0].discountAmount,
          finalAmount: existing[0].finalAmount,
          fiscalScope: existing[0].fiscalScope,
          itemsCount: items.length,
          totalQuantity: items.reduce((sum, i) => sum + i.quantity, 0),
          isDuplicate: true,
        };
      }
    }

    // 1. Kiểm tra tồn kho trước cho toàn bộ sản phẩm (Pre-flight Stock Check)
    const isOfflineOrOverdraftAllowed = Boolean(params.isOfflineSync || params.allowOverdraft);
    const overdraftItems: Array<{ editionId: string; deficit: number }> = [];

    for (const item of items) {
      if (item.quantity <= 0) {
        throw new Error(`Số lượng bán cho ấn bản ${item.editionId} phải lớn hơn 0.`);
      }

      const currentBalance = await InventoryService.getBalance(item.editionId, warehouseId, 'NEW');
      if (currentBalance < item.quantity) {
        if (!isOfflineOrOverdraftAllowed) {
          throw new Error(
            `KHÔNG ĐỦ TỒN KHO: Ấn bản ${item.editionId} tại kho chỉ còn ${currentBalance} cuốn, không đủ để bán ${item.quantity} cuốn!`
          );
        } else {
          // Bán lẻ hội chợ / Sync ngoại tuyến: Ghi nhận lượng thiếu hụt để bù kiểm đếm
          overdraftItems.push({
            editionId: item.editionId,
            deficit: item.quantity - currentBalance,
          });
        }
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
    const orderCode = params.orderCode || `ORD-${dateStr}-${randomSuffix}`;
    const orderId = params.id || `ord-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const idempotencyKey = params.idempotencyKey || `idem-order-${orderId}`;
    const createdAt = params.createdAt || new Date().toISOString();
    const hasOverdraft = overdraftItems.length > 0;

    // 5. Ghi nhận Đơn hàng & Khấu trừ kho nguyên tử trong 1 Transaction (ACID + Retry)
    try {
      await withDbRetry(async () => {
        await db.transaction(async (tx) => {
          // B1: Nếu có sản phẩm bán lệch tồn kho hội chợ, tự động sinh bút toán bù kiểm đếm
          // Pattern: ADJUSTMENT (+K cuốn) trước -> CHECK (physical_quantity >= 0) luôn thỏa mãn!
          for (const over of overdraftItems) {
            await InventoryService.recordMovement({
              editionId: over.editionId,
              warehouseId,
              eventType: 'ADJUSTMENT',
              quantityDelta: over.deficit,
              condition: 'NEW',
              documentRef: orderCode,
              correlationId: orderId,
              note: `Bù lệch kiểm kê hội chợ (FAIR_VARIANCE) cho đơn ${orderCode}`,
              actorId: cashierId || 'Hội chợ',
              idempotencyKey: `idem-variance-${orderId}-${over.editionId}`,
              tx,
            });
          }

          // B2: Lưu đơn hàng
          await tx.insert(orders).values({
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
            syncStatus: hasOverdraft ? 'SYNCED_WITH_OVERDRAFT_WARNING' : 'SYNCED',
            cashierId,
            cashboxSessionId: params.cashboxSessionId,
            idempotencyKey,
            note: hasOverdraft
              ? `${note ? note + ' | ' : ''}[CẢNH BÁO: Bán lệch kiểm kê hội chợ +${overdraftItems.reduce((s, o) => s + o.deficit, 0)} cuốn]`
              : note,
            createdAt,
          });

          // B3: Ghi nhận các dòng sản phẩm của đơn hàng
          for (const item of preparedItems) {
            await tx.insert(orderItems).values({
              id: item.id,
              orderId,
              editionId: item.editionId,
              quantity: item.quantity,
              unitCoverPrice: item.unitCoverPrice,
              unitDiscountRate: item.unitDiscountRate,
              unitSellingPrice: item.unitSellingPrice,
              totalAmount: item.totalAmount,
            });

            // B4: Khấu trừ tồn kho vật lý tự động qua Thẻ kho bất biến (Append-Only Ledger)
            await InventoryService.recordMovement({
              editionId: item.editionId,
              warehouseId,
              eventType: 'DISPATCH_SALE',
              quantityDelta: -item.quantity,
              condition: 'NEW',
              documentRef: orderCode,
              note: `Bán đơn hàng ${orderCode} (${fiscalScope === 'OFFICIAL_TAX' ? 'Hóa đơn VAT' : 'Nội bộ'})`,
              actorId: cashierId,
              correlationId: orderId,
              idempotencyKey: `idem-stock-${orderId}-${item.editionId}`,
              tx,
            });
          }
        });
      });
    } catch (err: any) {
      // Bắt lỗi Race Condition nếu 2 luồng cùng mang 1 idempotencyKey ghi cùng lúc
      const errMsg = (err?.message || '').toLowerCase();
      if (errMsg.includes('unique') || errMsg.includes('sqlite_constraint')) {
        const existing = await db
          .select()
          .from(orders)
          .where(eq(orders.idempotencyKey, idempotencyKey))
          .limit(1);

        if (existing.length > 0) {
          return {
            orderId: existing[0].id,
            orderCode: existing[0].orderCode,
            warehouseId: existing[0].warehouseId,
            customerName: existing[0].customerName,
            subtotal: existing[0].subtotal,
            discountAmount: existing[0].discountAmount,
            finalAmount: existing[0].finalAmount,
            fiscalScope: existing[0].fiscalScope,
            itemsCount: preparedItems.length,
            totalQuantity: items.reduce((sum, i) => sum + i.quantity, 0),
            isDuplicate: true,
          };
        }
      }
      throw err;
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
    const { fiscalScope = 'ALL', warehouseId, partnerId, cashierId, startDate, endDate } = filters;

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
    if (cashierId) {
      conditions.push(eq(orders.cashierId, cashierId));
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

export interface OpenCashboxParams {
  warehouseId: string;
  cashierId: string;
  openingCash: number;
  notes?: string;
}

export interface CloseCashboxParams {
  sessionId: string;
  closingCashActual: number;
  notes?: string;
}

export class CashboxService {
  /**
   * Mở ca làm việc mới cho thu ngân (Open Shift / Cashbox Session).
   * Mỗi thu ngân tại một kho chỉ được có tối đa 1 phiên OPEN tại một thời điểm.
   */
  static async openSession(params: OpenCashboxParams) {
    const { warehouseId, cashierId, openingCash = 0, notes } = params;

    const existingOpen = await db
      .select()
      .from(cashboxSessions)
      .where(
        and(
          eq(cashboxSessions.cashierId, cashierId),
          eq(cashboxSessions.status, 'OPEN')
        )
      )
      .limit(1);

    if (existingOpen.length > 0) {
      return {
        session: existingOpen[0],
        isExisting: true,
      };
    }

    const sessionId = `cbs-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const newSession = {
      id: sessionId,
      warehouseId,
      cashierId,
      openingCash: Math.max(0, openingCash),
      status: 'OPEN' as const,
      notes: notes || null,
      openedAt: new Date().toISOString(),
      totalCashSales: 0,
      totalTransferSales: 0,
      totalOrdersCount: 0,
    };

    await withDbRetry(async () => {
      await db.insert(cashboxSessions).values(newSession);
    });

    return {
      session: newSession,
      isExisting: false,
    };
  }

  /**
   * Lấy phiên két tiền hiện tại đang hoạt động của thu ngân.
   */
  static async getActiveSession(cashierId: string) {
    const sessions = await db
      .select()
      .from(cashboxSessions)
      .where(
        and(
          eq(cashboxSessions.cashierId, cashierId),
          eq(cashboxSessions.status, 'OPEN')
        )
      )
      .limit(1);

    if (sessions.length === 0) return null;

    const session = sessions[0];
    const stats = await this.calculateSessionStats(session.id);

    return {
      ...session,
      ...stats,
      expectedCash: session.openingCash + stats.totalCashSales,
    };
  }

  /**
   * Tính toán doanh thu tiền mặt, chuyển khoản và số đơn hàng thuộc phiên làm việc.
   */
  static async calculateSessionStats(sessionId: string) {
    const sessionOrders = await db
      .select({
        finalAmount: orders.finalAmount,
        paymentMethod: orders.paymentMethod,
      })
      .from(orders)
      .where(eq(orders.cashboxSessionId, sessionId));

    let totalCashSales = 0;
    let totalTransferSales = 0;
    let totalOrdersCount = sessionOrders.length;

    for (const ord of sessionOrders) {
      if (ord.paymentMethod === 'CASH') {
        totalCashSales += ord.finalAmount;
      } else {
        totalTransferSales += ord.finalAmount;
      }
    }

    return {
      totalCashSales,
      totalTransferSales,
      totalOrdersCount,
    };
  }

  /**
   * Chốt ca thu ngân (Close Shift) & Đối soát chênh lệch tiền két (Reconciliation).
   */
  static async closeSession(params: CloseCashboxParams) {
    const { sessionId, closingCashActual, notes } = params;

    const existing = await db
      .select()
      .from(cashboxSessions)
      .where(eq(cashboxSessions.id, sessionId))
      .limit(1);

    if (existing.length === 0) {
      throw new Error(`Không tìm thấy phiên két tiền: ${sessionId}`);
    }

    const session = existing[0];
    if (session.status === 'CLOSED') {
      throw new Error(`Phiên két tiền ${sessionId} đã được đóng trước đó.`);
    }

    const stats = await this.calculateSessionStats(sessionId);
    const expectedCash = session.openingCash + stats.totalCashSales;
    const cashDiscrepancy = closingCashActual - expectedCash;

    const closedAt = new Date().toISOString();

    await withDbRetry(async () => {
      await db
        .update(cashboxSessions)
        .set({
          closingCashActual,
          expectedCash,
          cashDiscrepancy,
          totalCashSales: stats.totalCashSales,
          totalTransferSales: stats.totalTransferSales,
          totalOrdersCount: stats.totalOrdersCount,
          status: 'CLOSED',
          notes: notes ? `${session.notes ? session.notes + ' | ' : ''}${notes}` : session.notes,
          closedAt,
        })
        .where(eq(cashboxSessions.id, sessionId));
    });

    return {
      sessionId,
      cashierId: session.cashierId,
      warehouseId: session.warehouseId,
      openingCash: session.openingCash,
      closingCashActual,
      expectedCash,
      cashDiscrepancy,
      totalCashSales: stats.totalCashSales,
      totalTransferSales: stats.totalTransferSales,
      totalOrdersCount: stats.totalOrdersCount,
      openedAt: session.openedAt,
      closedAt,
      status: 'CLOSED',
    };
  }

  /**
   * Liệt kê lịch sử các phiên két tiền (cho Quản lý kiểm toán).
   */
  static async listSessions(filters: { cashierId?: string; warehouseId?: string; limit?: number } = {}) {
    const { cashierId, warehouseId, limit = 50 } = filters;
    const conditions = [];

    if (cashierId) conditions.push(eq(cashboxSessions.cashierId, cashierId));
    if (warehouseId) conditions.push(eq(cashboxSessions.warehouseId, warehouseId));

    if (conditions.length > 0) {
      return await db
        .select()
        .from(cashboxSessions)
        .where(and(...conditions))
        .orderBy(desc(cashboxSessions.openedAt))
        .limit(limit);
    }

    return await db
      .select()
      .from(cashboxSessions)
      .orderBy(desc(cashboxSessions.openedAt))
      .limit(limit);
  }
}

