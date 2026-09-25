import { db, orders, orderItems, editions, warehouses, partners, customers, cashboxSessions, returnOrders, inventoryLedger, auditLogs } from '../db';
import { InventoryService } from './inventory.service';
import { WarehouseService } from './warehouse.service';
import { BundleService } from './bundle.service';
import { eq, and, or, isNotNull, desc, sql, gte, lte, inArray } from 'drizzle-orm';
import { withDbRetry } from '../lib/db-retry';
import { AppError } from './app-error';
import { ActorContext } from './actor-context';
import { DiscountApprovalService } from './discount-approval.service';
import { generateUUIDv7 } from '../lib/uuidv7';
import { priceLine } from '../lib/pricing';

export interface OrderItemInput {
  editionId: string;
  quantity: number;
  unitCoverPrice?: number;
  unitDiscountRate?: number;
}

export type OrderChannel =
  | 'FAIR_EVENT' | 'RETAIL_OFFICE' | 'WHOLESALE_PARTNER' | 'ONLINE'
  | 'RETAIL_ONLINE_WEB' | 'RETAIL_ONLINE_SOCIAL' | 'SPONSORSHIP';
export type OrderPaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'QR_CODE' | 'COD';

const VALID_CHANNELS: OrderChannel[] = [
  'FAIR_EVENT', 'RETAIL_OFFICE', 'WHOLESALE_PARTNER', 'ONLINE',
  'RETAIL_ONLINE_WEB', 'RETAIL_ONLINE_SOCIAL', 'SPONSORSHIP',
];
const VALID_PAYMENTS: OrderPaymentMethod[] = ['CASH', 'BANK_TRANSFER', 'QR_CODE', 'COD'];

// V4.1 S1.2: SELLABLE_WAREHOUSE_IDS hardcode đã XÓA — quy tắc kho bán đọc từ
// DB qua WarehouseService.assertSellable(). (Giữ comment để ai grep cũng thấy.)


// Bước 1: TTL giữ chỗ ATP cho đơn PENDING (giờ). Quá hạn coi như nhả chỗ.
export const PENDING_TTL_HOURS = 48;

// Trần số đơn chuyển khoản CHƯA THU TIỀN mà một thu ngân được giữ ATP tại một kho.
// Lý do: mỗi đơn PENDING chuyển khoản giữ ATP 30' (quầy) hoặc 48h (web) mà không
// thu được đồng nào; không có trần thì một thu ngân hoặc một client lỗi mở vô hạn
// đơn là giữ chỗ hết kho. Trần đi theo (thu ngân, kho) — mức độ thiệt hại bị chặn
// đúng ở giỏ hàng, và 409 buộc thu ngân phải thu tiền hoặc hủy đơn cũ.
export const MAX_PENDING_TRANSFER_HOLDS_PER_CASHIER = 5;

// P2-10: đơn gõ bù tối đa 7 ngày tuổi; tương lai quá 5 phút dung sai đồng hồ là từ chối.
export const BACKDATE_LIMIT_DAYS = 7;
export const FUTURE_SKEW_MINUTES = 5;

export interface CreateOrderParams {
  id?: string;
  orderCode?: string;
  createdAt?: string;
  warehouseId: string;
  channel?: OrderChannel;
  partnerId?: string;
  customerId?: string;
  customerName?: string;
  discountRate?: number;
  paymentMethod?: OrderPaymentMethod;
  fiscalScope?: 'OFFICIAL_TAX' | 'INTERNAL_MANAGEMENT';
  vatRate?: number;
  vatInvoiceRequired?: boolean;
  vatInvoiceCode?: string;
  cashierId?: string;
  cashboxSessionId?: string;
  discountApprovalId?: string;
  idempotencyKey?: string;
  note?: string;
  // Bước 1: confirmImmediately=false → đơn PENDING (giữ chỗ ATP, chưa trừ kho).
  // POS/hội chợ giữ mặc định true (COMPLETED như cũ). Web/social truyền false.
  confirmImmediately?: boolean;
  // P2-10: true khi đã có PIN quản lý / quyền override cho đơn gõ bù > 7 ngày
  backdateApproved?: boolean;
  // ĐÃ LOẠI BỎ (chỉ đạo Phase 0): isOfflineSync / allowOverdraft KHÔNG còn hiệu lực.
  // Mọi đơn đều validate ATP nghiêm. Giữ 2 field để tương thích API/POS cũ (Lane A dọn route sau).
  // Điều chỉnh tồn / thanh lý / variance hội chợ phải đi chứng từ riêng, cấm đường bán hàng bypass.
  isOfflineSync?: boolean;
  allowOverdraft?: boolean;
  isGift?: boolean; // BV-03: đơn tặng 100% (doanh thu 0đ, vẫn trừ kho)
  giftReason?: string; // BV-03: lý do tặng (bắt buộc khi isGift)
  items?: OrderItemInput[];
  bundles?: Array<{ bundleId: string; quantity: number }>; // Combo/boxset (giá do management định, không cộng CK đơn)
  // M1 (contract §1): danh tính Lane A truyền tách khỏi payload client — thắng mọi cashierId client gửi
  actorContext?: ActorContext;
  requiredAudit?: Array<{
    id: string;
    action: string;
    actorRole: string;
    actorId: string;
    resource: string;
    details: string | ((orderCode: string) => string);
    ipAddress?: string;
  }>;
}

/** Ảnh xác nhận chuyển khoản do client gửi (chốt quy trình, server không kiểm chứng ảnh). */
export interface TransferPaymentProof {
  id: string;
  capturedAt: string;
}

const TRANSFER_PAYMENT_METHODS: OrderPaymentMethod[] = ['BANK_TRANSFER', 'QR_CODE'];

function requiresPaymentProof(paymentMethod: string | null | undefined): boolean {
  return TRANSFER_PAYMENT_METHODS.includes(paymentMethod as OrderPaymentMethod);
}

export interface OrderFingerprint {
  orderCode?: string;
  warehouseId: string;
  channel: string;
  paymentMethod: string;
  fiscalScope: string;
  discountRate: number;
  cashboxSessionId?: string | null;
  effCashierId?: string | null;
  customerId?: string | null;
  partnerId?: string | null;
  customerName?: string | null;
  isGift?: boolean;
  giftReason?: string | null;
  items?: OrderItemInput[];
  bundles?: Array<{ bundleId: string; quantity: number }>;
}

export interface OrderFilterParams {
  startDate?: string;
  endDate?: string;
  fiscalScope?: 'OFFICIAL_TAX' | 'INTERNAL_MANAGEMENT' | 'ALL';
  warehouseId?: string;
  partnerId?: string;
  cashierId?: string;
  // Bước 1: lọc trạng thái/kênh (mặc định summary chỉ tính COMPLETED)
  status?: 'PENDING_CONFIRMATION' | 'COMPLETED' | 'CANCELLED' | 'ALL';
  channel?: string;
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
      confirmImmediately = true,
    } = params;

    // M1 (contract §1): actorContext thắng cashierId client gửi (chống mạo danh người bán)
    const effCashierId = params.actorContext?.staffId || cashierId;

    // Bước 1: validate channel + payment (text tự do ở DB, chặn ở service)
    if (!VALID_CHANNELS.includes(channel)) {
      throw AppError.invalid(`Kênh bán không hợp lệ: ${channel}.`);
    }
    if (!VALID_PAYMENTS.includes(paymentMethod)) {
      throw AppError.invalid(`Phương thức thanh toán không hợp lệ: ${paymentMethod}.`);
    }
    if (params.idempotencyKey) {
      const existingPre = await withDbRetry(async () => {
        return await db
          .select()
          .from(orders)
          .where(eq(orders.idempotencyKey, params.idempotencyKey!))
          .limit(1);
      });
      if (existingPre.length > 0) {
        await this.assertSameOrderContent(
          existingPre[0].id,
           {
             orderCode: params.orderCode,
             warehouseId,
             channel,
             paymentMethod,
             fiscalScope,
             discountRate,
             cashboxSessionId: params.cashboxSessionId,
             effCashierId,
             customerId: params.customerId,
             partnerId,
             customerName,
             isGift: Boolean((params as any).isGift),
             giftReason: (params as any).giftReason,
             items: items || [],
             bundles: params.bundles || [],
           },
           db
         );
         if (params.discountApprovalId) {
          const approval = await DiscountApprovalService.getRequest(params.discountApprovalId);
          if (
            approval.status !== 'CONSUMED' ||
            approval.orderCode !== existingPre[0].orderCode ||
            approval.warehouseId !== existingPre[0].warehouseId ||
            approval.cashierId !== effCashierId
          ) {
            throw AppError.idempotency('Approval không khớp với order đã commit.');
          }
        }
        const existingLines = await db
          .select()
          .from(orderItems)
          .where(eq(orderItems.orderId, existingPre[0].id));
        return {
          orderId: existingPre[0].id,
          orderCode: existingPre[0].orderCode,
          warehouseId: existingPre[0].warehouseId,
          customerName: existingPre[0].customerName,
          subtotal: existingPre[0].subtotal,
          discountAmount: existingPre[0].discountAmount,
          finalAmount: existingPre[0].finalAmount,
          fiscalScope: existingPre[0].fiscalScope,
          itemsCount: existingLines.length,
          totalQuantity: existingLines.reduce((sum, i) => sum + i.quantity, 0),
          status: existingPre[0].status,
          isDuplicate: true,
        };
      }
    }

    // V4.1 S1.2: chặn bán từ kho ảo/ký gửi/ngưng bán ngay từ cổng vào (đọc DB, không hardcode).
    const sellRow = await WarehouseService.assertSellable(warehouseId);
    // V4.1 S1.2 (lock Q5): đơn giữ chỗ online (PENDING) chỉ được giữ ở kho chính —
    // sách đã ra gian hàng hội chợ chỉ bán trực tiếp tại quầy.
    if (params.confirmImmediately === false && sellRow.warehouseType === 'FAIR_EVENT') {
      throw AppError.invalid('Đơn online không được giữ chỗ tại kho hội chợ (chỉ giữ tại kho chính).');
    }
    // P2-08/09: két ca gắn vào đơn phải OPEN + đúng kho + đúng thu ngân (chống bán ké két)
    if (params.cashboxSessionId) {
      const sessRows = await withDbRetry(async () => {
        return await db.select().from(cashboxSessions).where(eq(cashboxSessions.id, params.cashboxSessionId!)).limit(1);
      });
      if (sessRows.length === 0) throw AppError.invalid('Phiên két ca không tồn tại.');
      const sess = sessRows[0];
      if (sess.status !== 'OPEN') throw AppError.invalid(`Phiên két ca đã ${sess.status}, không ghi đơn vào két đóng.`);
      if (sess.warehouseId !== warehouseId) {
        throw AppError.invalid(`Két ca thuộc kho ${sess.warehouseId}, không khớp kho xuất ${warehouseId}.`);
      }
      if (sess.cashierId !== effCashierId) {
        throw AppError.invalid(`Két ca của thu ngân ${sess.cashierId}, không khớp người bán ${effCashierId}.`);
      }
    }
    // P2-10: kẹp ngày lập đơn — chặn tương lai, gõ bù > 7 ngày cần duyệt quản lý
    if (params.createdAt) {
      const ts = new Date(params.createdAt).getTime();
      if (Number.isNaN(ts)) throw AppError.invalid('createdAt không phải ngày hợp lệ.');
      if (ts > Date.now() + FUTURE_SKEW_MINUTES * 60000) {
        throw AppError.invalid('Không được lập đơn ngày tương lai.');
      }
      const ageDays = (Date.now() - ts) / 86400000;
      if (ageDays > BACKDATE_LIMIT_DAYS && !params.backdateApproved) {
        throw AppError.forbidden(`Đơn gõ bù quá ${BACKDATE_LIMIT_DAYS} ngày cần mã PIN Quản lý.`);
      }
    }

    const looseItems = items || [];
    // Gộp bundleOrders theo bundleId trước khi validate availability, pricing và tạo fingerprint
    const rawBundleOrders = params.bundles || [];
    const mergedBundleMap = new Map<string, number>();
    for (const b of rawBundleOrders) {
      if (!Number.isInteger(b.quantity) || b.quantity <= 0) {
        throw AppError.invalid(`Số lượng combo ${b.bundleId} phải là số nguyên > 0.`);
      }
      mergedBundleMap.set(b.bundleId, (mergedBundleMap.get(b.bundleId) || 0) + b.quantity);
    }
    const bundleOrders = Array.from(mergedBundleMap.entries()).map(([bundleId, quantity]) => ({
      bundleId,
      quantity,
    }));

    // FIX-02: số lượng phải nguyên (chặn tồn kho phân số 1.5 cuốn)
    for (const it of looseItems) {
      if (!Number.isInteger(it.quantity) || it.quantity <= 0) {
        throw AppError.invalid(`Số lượng bán cho ấn bản ${it.editionId} phải là số nguyên > 0.`);
      }
    }
    // FIX-03: trần chiết khấu tầng service (API route có thể bị bypass khi gọi trực tiếp).
    // Ngoại lệ duy nhất: discount == 1 kèm cờ isGift (đơn tặng, validate riêng bên dưới).
    if (!Number.isFinite(discountRate) || discountRate < 0 || discountRate > 1) {
      throw AppError.invalid('Chiết khấu đơn hàng phải nằm trong khoảng 0 - 100%.');
    }
    for (const it of looseItems) {
      const r = it.unitDiscountRate ?? discountRate;
      if (!Number.isFinite(r) || r < 0 || r > 1) {
        throw AppError.invalid(`Chiết khấu dòng ${it.editionId} phải nằm trong khoảng 0 - 100%.`);
      }
    }
    // BV-03: chuan hoa co tang — discount 1.0 bat buoc di kem isGift tuong minh
    const rawGift = Boolean((params as any).isGift);
    if (discountRate === 1 && !rawGift) {
      throw AppError.invalid('Chiết khấu 100% chỉ áp dụng cho đơn Tặng sách (thiếu cờ isGift).');
    }
    const isGift = rawGift;
    const giftReason = `${(params as any).giftReason ?? ''}`.trim();
    if (discountRate > 1 || discountRate < 0) {
      throw AppError.invalid('Chiết khấu đơn hàng phải nằm trong khoảng 0 - 100%.');
    }
    if (isGift) {
      if (discountRate !== 1) {
        throw AppError.invalid('Đơn Tặng sách phải có chiết khấu đúng 100% (discountRate = 1).');
      }
      if (!giftReason && !(note || '').trim()) {
        throw AppError.invalid('Đơn Tặng sách bắt buộc ghi lý do (giftReason/note).');
      }
      if (fiscalScope === 'OFFICIAL_TAX') {
        throw AppError.invalid('Quà tặng chỉ ghi Sổ Quản trị Nội bộ, không xuất Hóa đơn VAT.');
      }
      if (bundleOrders.length > 0) {
        throw AppError.invalid('Đơn Tặng sách chưa hỗ trợ combo đóng hộp (chỉ tặng sách lẻ).');
      }
      for (const it of looseItems) {
        if (it.unitDiscountRate !== undefined && it.unitDiscountRate !== 1) {
          throw AppError.invalid('Đơn Tặng sách: mọi dòng phải có chiết khấu 100%.');
        }
      }
    }
    const approxItemsCount = looseItems.length + bundleOrders.length;
    const approxTotalQty =
      looseItems.reduce((sum, i) => sum + i.quantity, 0) +
      bundleOrders.reduce((sum, b) => sum + b.quantity, 0);

    if ((!items || items.length === 0) && (!params.bundles || params.bundles.length === 0)) {
      throw AppError.invalid('Đơn hàng phải có ít nhất 1 đầu sách hoặc 1 combo.');
    }

    // Với đơn combo (bundles > 0): nếu caller truyền idempotencyKey và đơn đã tồn tại trong DB:
    // Kiểm tra fingerprint ngay; nếu khớp, trả về đơn cũ mà không fail do validateAvailability khi tồn linh kiện đã cạn.
    // Đối với đơn hàng thông thường (không combo), kiểm tra idempotency diễn ra hoàn toàn bên trong write transaction.
    if (params.idempotencyKey && bundleOrders.length > 0) {
      const existingPre = await withDbRetry(async () => {
        return await db
          .select()
          .from(orders)
          .where(eq(orders.idempotencyKey, params.idempotencyKey!))
          .limit(1);
      });

      if (existingPre.length > 0) {
        await this.assertSameOrderContent(
          existingPre[0].id,
           {
             orderCode: params.orderCode,
             warehouseId,
             channel,
             paymentMethod,
             fiscalScope,
             discountRate,
             cashboxSessionId: params.cashboxSessionId,
             effCashierId,
             customerId: params.customerId,
             partnerId,
             customerName,
             isGift,
            giftReason: params.giftReason,
            items: looseItems,
            bundles: bundleOrders,
          },
          db
        );

        const existingLines = await db
          .select()
          .from(orderItems)
          .where(eq(orderItems.orderId, existingPre[0].id));

        return {
          orderId: existingPre[0].id,
          orderCode: existingPre[0].orderCode,
          warehouseId: existingPre[0].warehouseId,
          customerName: existingPre[0].customerName,
          subtotal: existingPre[0].subtotal,
          discountAmount: existingPre[0].discountAmount,
          finalAmount: existingPre[0].finalAmount,
          fiscalScope: existingPre[0].fiscalScope,
          itemsCount: existingLines.length,
          totalQuantity: existingLines.reduce((sum, i) => sum + i.quantity, 0),
          status: existingPre[0].status,
          isDuplicate: true,
        };
      }
    }

    // Mở rộng combo thành dòng linh kiện (bottleneck validate + tỉ trọng giá).
    // Combo do management định giá sẵn nên KHÔNG cộng chiết khấu đơn (unitDiscountRate = 0).
    const bundleLines: Array<{
      editionId: string;
      quantity: number;
      unitCoverPrice: number;
      unitDiscountRate: number;
      unitSellingPrice: number;
      totalAmount: number;
      bundleId: string;
      bundleQty: number;
    }> = [];
    for (const b of bundleOrders) {
      if (b.quantity <= 0) {
        throw AppError.invalid(`Số lượng combo ${b.bundleId} phải lớn hơn 0.`);
      }
      await BundleService.validateAvailability(b.bundleId, warehouseId, b.quantity);
      const priced = await BundleService.priceLines(b.bundleId, b.quantity);
      for (const p of priced) {
        bundleLines.push({ ...p, unitDiscountRate: 0 });
      }
    }

    const isPending = confirmImmediately === false;
    // POS counter transfer: PENDING hạn 30 phút (đơn PENDING khác giữ TTL 48h).
    // Hạn do server đặt, không nhận từ client.
    const isCounterTransfer = isPending && requiresPaymentProof(paymentMethod) && Boolean(params.cashboxSessionId);
    const paymentExpiresAt = isCounterTransfer
      ? new Date(Date.now() + 30 * 60_000).toISOString()
      : null;
    if (isPending && params.discountApprovalId) {
      throw AppError.invalid('Đơn chờ xác nhận không được dùng approval chiết khấu.');
    }
    if (params.discountApprovalId && bundleOrders.length > 0) {
      throw AppError.invalid('Approval chiết khấu chỉ áp dụng cho đơn sách lẻ, không dùng với combo.');
    }

    // 1. Chuẩn bị danh sách kiểm tra nhu cầu theo edition (lẻ + linh kiện combo)
    const stockCheckItems = [...looseItems, ...bundleLines];
    const needTotal = new Map<string, number>();
    for (const item of stockCheckItems) {
      if (item.quantity <= 0) {
        throw AppError.invalid(`Số lượng bán cho ấn bản ${item.editionId} phải lớn hơn 0.`);
      }
      needTotal.set(item.editionId, (needTotal.get(item.editionId) || 0) + item.quantity);
    }

    // 2. Tra cứu giá bìa từ cơ sở dữ liệu nếu chưa có (master data)
    const editionIds = stockCheckItems.map((i) => i.editionId);
    const dbEditions = await withDbRetry(async () => {
      return await db
        .select({
          id: editions.id,
          code: editions.code,
          title: editions.title,
          coverPrice: editions.coverPrice,
        })
        .from(editions)
        .where(inArray(editions.id, editionIds));
    });

    const editionMap = new Map(dbEditions.map((e) => [e.id, e]));

    // 3. Tính toán dòng tiền và chi tiết đơn hàng ngoài transaction
    let calculatedSubtotal = 0;
    let calculatedFinalAmount = 0;

    const preparedItems = [
      ...looseItems.map((item) => {
        const edition = editionMap.get(item.editionId);
        // FIX-01: giá bìa LUÔN lấy từ DB, tuyệt đối không tin unitCoverPrice client gửi.
        if (!edition) throw AppError.invalid(`Ấn bản ${item.editionId} không tồn tại trong danh mục.`);
        const coverPrice = edition.coverPrice || 0;
        const itemDiscountRate = item.unitDiscountRate ?? discountRate;
        const priced = priceLine(coverPrice, itemDiscountRate, item.quantity);

        calculatedSubtotal += priced.subtotal;
        calculatedFinalAmount += priced.finalAmount;

        return {
          id: `oi-${generateUUIDv7()}`,
          editionId: item.editionId,
          quantity: item.quantity,
          unitCoverPrice: priced.coverPrice,
          unitDiscountRate: itemDiscountRate,
          unitSellingPrice: priced.unitSellingPrice,
          totalAmount: priced.finalAmount,
          bundleId: undefined as string | undefined,
          bundleQty: undefined as number | undefined,
        };
      }),
      // Dòng linh kiện combo: giá tỉ trọng đã chốt, không cộng CK đơn.
      ...bundleLines.map((line) => {
        calculatedSubtotal += line.quantity * line.unitCoverPrice;
        calculatedFinalAmount += line.totalAmount;

        return {
           id: `oi-${generateUUIDv7()}`,
          editionId: line.editionId,
          quantity: line.quantity,
          unitCoverPrice: line.unitCoverPrice,
          unitDiscountRate: line.unitDiscountRate,
          unitSellingPrice: line.unitSellingPrice,
          totalAmount: line.totalAmount,
          bundleId: line.bundleId as string | undefined,
          bundleQty: line.bundleQty as number | undefined,
        };
      }),
    ];

    const calculatedDiscountAmount = calculatedSubtotal - calculatedFinalAmount;

    // 4. Sinh mã đơn hàng và Idempotency Key cố định (giữ nguyên khi retry)
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const orderCode = params.orderCode || `ORD-${dateStr}-${generateUUIDv7().replace(/-/g, '').slice(-16).toUpperCase()}`;
    const orderId = params.id || `ord-${generateUUIDv7()}`;
    const idempotencyKey = params.idempotencyKey || `idem-order-${orderId}`;
    const createdAt = params.createdAt || new Date().toISOString();
    const giftTag = isGift ? `[QUÀ TẶNG: ${giftReason || (note || '').trim() || 'Tặng sách / Quà tặng sự kiện'}]` : '';
    const mergedNote = [giftTag, note].filter((s) => s && `${s}`.trim()).join(' | ') || undefined;

    // 5. Ghi nhận Đơn hàng & Khấu trừ kho nguyên tử trong 1 Transaction (ACID + Retry)
    // Toàn bộ kiểm tra idempotency, phiên két, tính ATP và ghi chép nằm trong write transaction.
    return await withDbRetry(async () => {
      return await db.transaction(async (tx) => {
        // B0. Kiểm tra Idempotency bên trong Transaction với idempotencyKey đã chuẩn hóa
        const existing = await tx
          .select()
          .from(orders)
          .where(eq(orders.idempotencyKey, idempotencyKey))
          .limit(1);

        if (existing.length > 0) {
          await this.assertSameOrderContent(
            existing[0].id,
             {
               orderCode: params.orderCode,
               warehouseId,
               channel,
               paymentMethod,
              fiscalScope,
              discountRate,
              cashboxSessionId: params.cashboxSessionId,
              effCashierId,
              customerId: params.customerId,
              partnerId,
              customerName,
              isGift,
              giftReason: params.giftReason,
              items: looseItems,
              bundles: bundleOrders,
            },
             tx
           );
           if (params.discountApprovalId) {
             const approval = await DiscountApprovalService.getRequest(params.discountApprovalId, tx);
             if (
               approval.status !== 'CONSUMED' ||
               approval.orderCode !== existing[0].orderCode ||
               approval.warehouseId !== existing[0].warehouseId ||
               approval.cashierId !== effCashierId
             ) {
               throw AppError.idempotency('Approval không khớp với order đã commit.');
             }
           }

           const existingLines = await tx
            .select()
            .from(orderItems)
            .where(eq(orderItems.orderId, existing[0].id));

          return {
            orderId: existing[0].id,
            orderCode: existing[0].orderCode,
            warehouseId: existing[0].warehouseId,
            customerName: existing[0].customerName,
            subtotal: existing[0].subtotal,
            discountAmount: existing[0].discountAmount,
            finalAmount: existing[0].finalAmount,
            fiscalScope: existing[0].fiscalScope,
            itemsCount: existingLines.length,
            totalQuantity: existingLines.reduce((sum, i) => sum + i.quantity, 0),
            status: existing[0].status,
            isDuplicate: true,
          };
        }

        // B1. Xác thực phiên két bên trong Transaction
        if (params.cashboxSessionId) {
          const sessRows = await tx
            .select()
            .from(cashboxSessions)
            .where(eq(cashboxSessions.id, params.cashboxSessionId))
            .limit(1);

          if (sessRows.length === 0) throw AppError.invalid('Phiên két ca không tồn tại.');
          const sess = sessRows[0];
          if (sess.status !== 'OPEN') throw AppError.invalid(`Phiên két ca đã ${sess.status}, không ghi đơn vào két đóng.`);
          if (sess.warehouseId !== warehouseId) {
            throw AppError.invalid(`Két ca thuộc kho ${sess.warehouseId}, không khớp kho xuất ${warehouseId}.`);
          }
          if (sess.cashierId !== effCashierId) {
            throw AppError.invalid(`Két ca của thu ngân ${sess.cashierId}, không khớp người bán ${effCashierId}.`);
          }
        }

        // B2. Tính toán & Kiểm tra ATP nguyên tử bên trong Transaction
        for (const [editionId, qty] of Array.from(needTotal.entries())) {
          const atp = await this.getATP(editionId, warehouseId, tx);
          if (atp < qty) {
            throw AppError.atp(
              `HẾT HÀNG KHẢ DỤNG (ATP): Ấn bản ${editionId} chỉ còn ${atp} cuốn có thể bán (đã trừ phần khách online giữ chỗ), không đủ ${qty} cuốn!`
            );
          }
        }

        // B2b. Trần giữ ATP (xem MAX_PENDING_TRANSFER_HOLDS_PER_CASHIER): chỉ đơn
        // chuyển khoản/QR chờ thanh toán mới giữ chỗ, Manager/Owner được miễn.
        // Đếm ngay trong transaction để hai lần tạo song song không cùng lọt qua trần.
        const creatorRole = params.actorContext?.role;
        const creatorIsPrivileged = creatorRole === 'ROLE_OWNER' || creatorRole === 'ROLE_MANAGER';
        if (isPending && requiresPaymentProof(paymentMethod) && !creatorIsPrivileged) {
          const openHolds = (
            await tx
              .select({ createdAt: orders.createdAt, paymentExpiresAt: orders.paymentExpiresAt })
              .from(orders)
              .where(
                and(
                  eq(orders.status, 'PENDING_CONFIRMATION'),
                  eq(orders.cashierId, effCashierId),
                  eq(orders.warehouseId, warehouseId),
                  inArray(orders.paymentMethod, TRANSFER_PAYMENT_METHODS)
                )
              )
          ).filter((o) => !this.isPendingExpired(o));
          if (openHolds.length >= MAX_PENDING_TRANSFER_HOLDS_PER_CASHIER) {
            throw AppError.conflict(
              `Thu ngân đã có ${openHolds.length} đơn chuyển khoản chờ thanh toán tại kho này ` +
                `(tối đa ${MAX_PENDING_TRANSFER_HOLDS_PER_CASHIER}). ` +
                `Vui lòng xác nhận hoặc hủy các đơn cũ trước khi tạo đơn mới.`
            );
          }
        }

        // B3: Tạo bản ghi Master đơn hàng bên trong Transaction
        if (params.discountApprovalId) {
          const hasUnexpectedLineDiscount = preparedItems.some(
            (item) => Math.abs((item.unitDiscountRate ?? discountRate) - discountRate) > 0.0001
          );
          if (hasUnexpectedLineDiscount) {
            throw AppError.conflict('Mức chiết khấu từng dòng không khớp yêu cầu đã được duyệt.');
          }
          await DiscountApprovalService.consumeApproval({
            requestId: params.discountApprovalId,
            currentItems: preparedItems
              .filter((item) => !item.bundleId)
              .map((item) => ({
                editionId: item.editionId,
                quantity: item.quantity,
                unitPrice: item.unitCoverPrice,
              })),
            discountRate,
            warehouseId,
            orderCode,
            cashierId: effCashierId,
            originalAmount: calculatedSubtotal,
            discountAmount: calculatedDiscountAmount,
            finalAmount: calculatedFinalAmount,
            txOrDb: tx,
          });
        }
        await tx.insert(orders).values({
          id: orderId,
          orderCode,
          warehouseId,
          channel,
          partnerId,
          customerId: params.customerId,
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
          status: isPending ? 'PENDING_CONFIRMATION' : 'COMPLETED',
          paymentExpiresAt,
          syncStatus: 'SYNCED',
          cashierId: effCashierId,
          cashboxSessionId: params.cashboxSessionId,
          idempotencyKey,
          note: mergedNote,
          createdAt,
        });

        // B4: Ghi nhận các dòng sản phẩm của đơn hàng
        let lineIdx = 0;
        for (const item of preparedItems) {
          const lineValues: Record<string, unknown> = {
            id: item.id,
            orderId,
            editionId: item.editionId,
            quantity: item.quantity,
            unitCoverPrice: item.unitCoverPrice,
            unitDiscountRate: item.unitDiscountRate,
            unitSellingPrice: item.unitSellingPrice,
            totalAmount: item.totalAmount,
          };
          if (item.bundleId != null) lineValues.bundleId = item.bundleId;
          if (item.bundleQty != null) lineValues.bundleQty = item.bundleQty;
          await tx.insert(orderItems).values(lineValues as any);

          // Đơn PENDING chỉ giữ chỗ ATP — KHÔNG sinh bút toán kho
          if (isPending) {
            lineIdx++;
            continue;
          }

          // B5: Khấu trừ tồn kho vật lý tự động qua Thẻ kho bất biến (Append-Only Ledger)
          await InventoryService.recordMovement({
            editionId: item.editionId,
            warehouseId,
            eventType: 'DISPATCH_SALE',
            quantityDelta: -item.quantity,
            condition: 'NEW',
            documentRef: orderCode,
            note: item.bundleId
              ? `Bán combo ${item.bundleId} x${item.bundleQty} trong đơn ${orderCode}`
              : isGift
              ? `Tặng sách (QUÀ TẶNG) đơn ${orderCode} (${giftReason || 'Quà tặng sự kiện'})`
              : `Bán đơn hàng ${orderCode} (${fiscalScope === 'OFFICIAL_TAX' ? 'Hóa đơn VAT' : 'Nội bộ'})`,
            actorId: effCashierId,
            correlationId: orderId,
            idempotencyKey: `idem-stock-${orderId}-${lineIdx}-${item.editionId}`,
            tx,
          });
           lineIdx++;
         }

         if (params.requiredAudit?.length) {
           await tx.insert(auditLogs).values(
             params.requiredAudit.map((audit) => ({
               id: `aud-order-${orderId}-${audit.id}`,
               action: audit.action,
               actorRole: audit.actorRole,
               actorId: audit.actorId,
               resource: audit.resource,
               details: typeof audit.details === 'function' ? audit.details(orderCode) : audit.details,
               ipAddress: audit.ipAddress,
             }))
           );
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
          status: isPending ? 'PENDING_CONFIRMATION' : 'COMPLETED',
          paymentExpiresAt,
          itemsCount: preparedItems.length,
          totalQuantity: preparedItems.reduce((sum, i) => sum + i.quantity, 0),
          isDuplicate: false,
        };
      });
    });
  }

  /**
   * So nội dung vật chất toàn diện (kho, kênh, thanh toán, thuế, chiết khấu, két,
   * thu ngân, khách hàng/đối tác, quà tặng, dòng lẻ & combo) của đơn đã tồn tại với
   * request gửi lại cùng idempotencyKey. Khác bất kỳ trường nào → IDEMPOTENCY_CONFLICT.
   */
  static async assertSameOrderContent(
    orderId: string,
    want: OrderFingerprint,
    txOrDb: any = db
  ): Promise<void> {
    const ord = (await txOrDb.select().from(orders).where(eq(orders.id, orderId)).limit(1))[0];
    if (!ord) return;

    if (want.orderCode && ord.orderCode !== want.orderCode) {
      throw AppError.idempotency(
        `Idempotency-Key đã gắn với đơn ${ord.orderCode} có mã đơn khác (${want.orderCode} vs ${ord.orderCode}).`
      );
    }

    if (ord.warehouseId !== want.warehouseId) {
      throw AppError.idempotency(
        `Idempotency-Key đã gắn với đơn ${ord.orderCode} có kho xuất khác (${ord.warehouseId} vs ${want.warehouseId}).`
      );
    }

    if (ord.channel !== want.channel) {
      throw AppError.idempotency(
        `Idempotency-Key đã gắn với đơn ${ord.orderCode} có kênh bán khác (${ord.channel} vs ${want.channel}).`
      );
    }

    if (ord.paymentMethod !== want.paymentMethod) {
      throw AppError.idempotency(
        `Idempotency-Key đã gắn với đơn ${ord.orderCode} có phương thức thanh toán khác (${ord.paymentMethod} vs ${want.paymentMethod}).`
      );
    }

    if (ord.fiscalScope !== want.fiscalScope) {
      throw AppError.idempotency(
        `Idempotency-Key đã gắn với đơn ${ord.orderCode} có phạm vi tài chính khác (${ord.fiscalScope} vs ${want.fiscalScope}).`
      );
    }

    if (Math.abs(Number(ord.discountRate || 0) - Number(want.discountRate || 0)) > 0.0001) {
      throw AppError.idempotency(
        `Idempotency-Key đã gắn với đơn ${ord.orderCode} có tỷ lệ chiết khấu khác (${ord.discountRate} vs ${want.discountRate}).`
      );
    }

    const dbCashbox = ord.cashboxSessionId || null;
    const wantCashbox = want.cashboxSessionId || null;
    if (dbCashbox !== wantCashbox) {
      throw AppError.idempotency(
        `Idempotency-Key đã gắn với đơn ${ord.orderCode} có phiên két khác (${dbCashbox} vs ${wantCashbox}).`
      );
    }

    const dbCashier = ord.cashierId || null;
    const wantCashier = want.effCashierId || null;
    if (wantCashier && dbCashier !== wantCashier) {
      throw AppError.idempotency(
        `Idempotency-Key đã gắn với đơn ${ord.orderCode} có thu ngân/actor khác (${dbCashier} vs ${wantCashier}).`
      );
    }

    const dbCustId = ord.customerId || null;
    const wantCustId = want.customerId || null;
    if (dbCustId !== wantCustId) {
      throw AppError.idempotency(
        `Idempotency-Key đã gắn với đơn ${ord.orderCode} có mã độc giả khác (${dbCustId} vs ${wantCustId}).`
      );
    }

    const dbPartnerId = ord.partnerId || null;
    const wantPartnerId = want.partnerId || null;
    if (dbPartnerId !== wantPartnerId) {
      throw AppError.idempotency(
        `Idempotency-Key đã gắn với đơn ${ord.orderCode} có đối tác khác (${dbPartnerId} vs ${wantPartnerId}).`
      );
    }

    const dbCustName = (ord.customerName || '').trim() || 'Khách lẻ vãng lai';
    const wantCustName = (want.customerName || '').trim() || 'Khách lẻ vãng lai';
    if (dbCustName !== wantCustName) {
      throw AppError.idempotency(
        `Idempotency-Key đã gắn với đơn ${ord.orderCode} có tên khách hàng khác (${dbCustName} vs ${wantCustName}).`
      );
    }

    const dbIsGift = Boolean(ord.note && ord.note.includes('[QUÀ TẶNG:'));
    const wantIsGift = Boolean(want.isGift);
    if (dbIsGift !== wantIsGift) {
      throw AppError.idempotency(
        `Idempotency-Key đã gắn với đơn ${ord.orderCode} có trạng thái quà tặng khác (${dbIsGift} vs ${wantIsGift}).`
      );
    }
    if (wantIsGift) {
      // Chuẩn hóa lý do từ payload mới: giftReason hoặc default
      const wantReason = (want.giftReason || '').trim() || 'Tặng sách / Quà tặng sự kiện';
      // Trích xuất lý do đã lưu trong note: [QUÀ TẶNG: ...]
      const match = ord.note ? ord.note.match(/\[QUÀ TẶNG:\s*(.*?)\]/) : null;
      const dbReason = match ? match[1].trim() : '';
      if (dbReason !== wantReason) {
        throw AppError.idempotency(
          `Idempotency-Key đã gắn với đơn ${ord.orderCode} có lý do quà tặng khác ("${dbReason}" vs "${wantReason}").`
        );
      }
    }

    const lines = await txOrDb.select().from(orderItems).where(eq(orderItems.orderId, orderId));

    // Chuẩn hóa và gộp dòng lẻ (group by editionId + unitDiscountRate, sum quantity, sort)
    const wantLooseMap = new Map<string, number>();
    for (const it of want.items || []) {
      const rate = Number(it.unitDiscountRate ?? want.discountRate ?? 0).toFixed(4);
      const key = `${it.editionId}__${rate}`;
      wantLooseMap.set(key, (wantLooseMap.get(key) || 0) + it.quantity);
    }
    const normWantLoose = Array.from(wantLooseMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, q]) => `${k}:${q}`)
      .join('|');

    const dbLooseLines = (lines as any[]).filter((l: any) => !l.bundleId);
    const dbLooseMap = new Map<string, number>();
    for (const it of dbLooseLines) {
      const rate = Number(it.unitDiscountRate ?? ord.discountRate ?? 0).toFixed(4);
      const key = `${it.editionId}__${rate}`;
      dbLooseMap.set(key, (dbLooseMap.get(key) || 0) + it.quantity);
    }
    const normDbLoose = Array.from(dbLooseMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, q]) => `${k}:${q}`)
      .join('|');

    if (normWantLoose !== normDbLoose) {
      throw AppError.idempotency(
        `Idempotency-Key đã gắn với đơn ${ord.orderCode} có chi tiết sản phẩm lẻ khác nhau.`
      );
    }

    // Chuẩn hóa và gộp combo (group by bundleId, sum quantity, sort)
    const wantBundleMap = new Map<string, number>();
    for (const b of want.bundles || []) {
      wantBundleMap.set(b.bundleId, (wantBundleMap.get(b.bundleId) || 0) + b.quantity);
    }
    const normWantBundles = Array.from(wantBundleMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bId, qty]) => `${bId}:${qty}`)
      .join('|');

    const dbBundleLines = (lines as any[]).filter((l: any) => l.bundleId);
    const dbBundleMap = new Map<string, number>();
    for (const it of dbBundleLines) {
      if (!dbBundleMap.has(it.bundleId)) {
        dbBundleMap.set(it.bundleId, Number(it.bundleQty || 0));
      }
    }
    const normDbBundles = Array.from(dbBundleMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bId, qty]) => `${bId}:${qty}`)
      .join('|');

    if (normWantBundles !== normDbBundles) {
      throw AppError.idempotency(
        `Idempotency-Key đã gắn với đơn ${ord.orderCode} có chi tiết combo khác nhau.`
      );
    }
  }

  /**
   * V4.1 S1.2 (lock Q5) — Tồn khả dụng ATP chia theo loại kho:
   * - Kho hội chợ (FAIR_EVENT): ATP = physical (sách ra gian hàng chỉ bán tại quầy;
   *   API giữ chỗ online từ chối kho hội chợ bằng 422 nên không cần trừ).
   * - Kho còn lại: ATP = physical NEW trừ phần đơn PENDING còn hạn giữ chỗ.
   * Đơn PENDING không có bút toán ledger nên phải tính động từ order_items.
   * Hỗ trợ nhận `txOrDb` để thực thi đồng nhất trong cùng write transaction.
   */
  static async getATP(editionId: string, warehouseId: string, txOrDb: any = db): Promise<number> {
    const physical = await InventoryService.getBalance(editionId, warehouseId, 'NEW', txOrDb);
    const wh = await WarehouseService.getWarehouse(warehouseId, txOrDb);
    // ponytail: đọc thêm 1 row warehouses mỗi lần tính ATP; cache lại khi thành điểm nghẽn đo được.
    if (wh?.warehouseType === 'FAIR_EVENT') return physical;
    const cutoff = new Date(Date.now() - PENDING_TTL_HOURS * 3600000).toISOString();
    // Prefilter rộng (siêu tập) trong SQL; quyết định giữ chỗ cuối cùng do
    // getPendingEffectiveExpiry (một quy tắc hạn duy nhất của hệ thống).
    const held = await txOrDb
      .select({
        quantity: orderItems.quantity,
        createdAt: orders.createdAt,
        paymentExpiresAt: orders.paymentExpiresAt,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(
        and(
          eq(orderItems.editionId, editionId),
          eq(orders.warehouseId, warehouseId),
          eq(orders.status, 'PENDING_CONFIRMATION'),
          or(isNotNull(orders.paymentExpiresAt), gte(orders.createdAt, cutoff))
        )
      );
    const now = Date.now();
    let heldQty = 0;
    for (const row of held) {
      const expiry = this.getPendingEffectiveExpiry(row);
      if (!expiry || expiry.getTime() <= now) continue;
      heldQty += Number(row.quantity || 0);
    }
    return physical - heldQty;
  }

  /**
   * Quy tắc hạn duy nhất cho đơn PENDING (contract §7.1):
   * - có payment_expires_at (POS counter transfer 30 phút) → dùng giá trị đó;
   * - đơn PENDING cũ không có → TTL PENDING_TTL_HOURS kể từ createdAt.
   */
  static getPendingEffectiveExpiry(order: {
    createdAt: string | null;
    paymentExpiresAt?: string | null;
  }): Date | null {
    if (!order.createdAt) return null;
    if (order.paymentExpiresAt) {
      const explicit = new Date(order.paymentExpiresAt);
      // payment_expires_at hỏng (dữ liệu cũ/sửa tay) → rơi về TTL 48h, không để đơn
      // PENDING treo vĩnh viễn và không nhả ATP.
      if (!Number.isNaN(explicit.getTime())) return explicit;
    }
    return new Date(new Date(order.createdAt).getTime() + PENDING_TTL_HOURS * 3600_000);
  }

  static isPendingExpired(order: { createdAt: string | null; paymentExpiresAt?: string | null }): boolean {
    const expiry = this.getPendingEffectiveExpiry(order);
    if (!expiry) return false;
    return Date.now() > expiry.getTime();
  }

  /** Duyệt đơn PENDING → COMPLETED + trừ kho thật (nguyên tử toàn phần).
   *  Cashier chỉ duyệt được đơn của chính mình; Owner/Manager duyệt mọi đơn.
   *  Đơn BANK_TRANSFER/QR_CODE bắt buộc có paymentProof (chốt quy trình, server
   *  không kiểm chứng ảnh). */
  static async confirmOrder(
    orderId: string,
    actorRole: string,
    actorId = 'staff-admin',
    actorContext?: ActorContext,
    paymentProof?: TransferPaymentProof
  ) {
    if (actorContext) {
      actorRole = actorContext.role;
      actorId = actorContext.staffId;
    }

    return await withDbRetry(async () => {
      let expiredError: Error | null = null;

      const result = await db.transaction(async (tx) => {
        // 1. Đọc lại order trong transaction
        const rows = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
        if (rows.length === 0) throw AppError.invalid('Không tìm thấy đơn hàng.');
        const ord = rows[0];

        // 1b. Phân quyền ngay trong transaction (route không phải lớp bảo vệ duy nhất)
        this.assertOrderActor(ord, actorRole, actorId, 'xác nhận');

        // 2. Nếu đã completed: kiểm tra xem có phải idempotent retry hợp lệ không
        if (ord.status === 'COMPLETED') {
          const ledgerPrefix = `idem-confirm-${orderId}-%`;
          const confirmLedger = await tx
            .select({ id: inventoryLedger.id })
            .from(inventoryLedger)
            .where(
              and(
                eq(inventoryLedger.correlationId, orderId),
                sql`${inventoryLedger.idempotencyKey} LIKE ${ledgerPrefix}`
              )
            )
            .limit(1);

          if (confirmLedger.length > 0) {
            return { orderId, orderCode: ord.orderCode, status: 'COMPLETED', isIdempotent: true };
          }
          throw AppError.conflict(`Đơn ${ord.orderCode} đã ở trạng thái COMPLETED nhưng không có bút toán duyệt hợp lệ.`);
        }

        // 3. Nếu trạng thái không phải pending: conflict
        if (ord.status !== 'PENDING_CONFIRMATION') {
          throw AppError.conflict(`Đơn đang ở trạng thái ${ord.status}, không thể duyệt.`);
        }

        // 3b. Quá hạn trước, proof sau: đơn hết hạn phải báo quá hạn và tự hủy
        // ngay, không bị chặn bởi lỗi "thiếu ảnh" và không chờ cleanup job.
        if (this.isPendingExpired(ord)) {
          await tx
            .update(orders)
            .set({
              status: 'CANCELLED',
              note: `${ord.note ? ord.note + ' | ' : ''}[TỰ ĐỘNG HỦY: quá hạn giữ chỗ]`,
            })
            .where(eq(orders.id, orderId));
          expiredError = AppError.conflict('Đơn đã quá hạn giữ chỗ và tự động hủy.');
          return null;
        }

        // 3c. Đơn chuyển khoản/QR bắt buộc có ảnh xác nhận đã lưu
        if (requiresPaymentProof(ord.paymentMethod) && (!paymentProof?.id || !paymentProof?.capturedAt)) {
          throw AppError.invalid('Phải lưu ảnh xác nhận trước khi xác nhận đơn chuyển khoản/QR.');
        }

         if (ord.cashboxSessionId) {
           const sessionRows = await tx
             .select()
             .from(cashboxSessions)
             .where(eq(cashboxSessions.id, ord.cashboxSessionId))
             .limit(1);
           const cashbox = sessionRows[0];
           if (!cashbox || cashbox.status !== 'OPEN' || cashbox.warehouseId !== ord.warehouseId) {
             throw AppError.conflict('Két ca đã đóng, không thể duyệt đơn chờ.');
           }
         }

         // 5. Đọc order items trong transaction
        const lines = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));

        // 6. Gộp nhu cầu theo edition & kiểm tra tồn trong transaction
        const ownNeed = new Map<string, number>();
        for (const ln of lines) {
          ownNeed.set(ln.editionId, (ownNeed.get(ln.editionId) || 0) + ln.quantity);
        }
        for (const [editionId, qty] of Array.from(ownNeed.entries())) {
          const bal = await InventoryService.getBalance(editionId, ord.warehouseId, 'NEW', tx);
          if (bal < qty) {
            throw AppError.atp(`KHÔNG ĐỦ TỒN để duyệt: ${editionId} còn ${bal}, cần ${qty}.`);
          }
          const atp = await this.getATP(editionId, ord.warehouseId, tx);
          if (atp + qty < qty) {
            throw AppError.atp(
              `Hết hàng khả dụng để duyệt (ATP ${atp} đã bị đơn khác giữ): ${editionId} cần ${qty}.`
            );
          }
        }

        // 7. Ghi sổ kho (DISPATCH_SALE) với idempotency key gắn correlationId
        let idx = 0;
        for (const ln of lines) {
          await InventoryService.recordMovement({
            editionId: ln.editionId,
            warehouseId: ord.warehouseId,
            eventType: 'DISPATCH_SALE',
            quantityDelta: -ln.quantity,
            condition: 'NEW',
            documentRef: ord.orderCode,
            note: `Duyệt đơn online ${ord.orderCode} (${ord.channel})`,
            actorId,
            correlationId: orderId,
            idempotencyKey: `idem-confirm-${orderId}-${idx}-${ln.editionId}`,
            tx,
          });
          idx++;
        }

        // 8. Chuyển trạng thái có điều kiện: PENDING_CONFIRMATION → COMPLETED
        const updateRes: any = await tx.run(sql`
          UPDATE orders
          SET status = 'COMPLETED'
          WHERE id = ${orderId} AND status = 'PENDING_CONFIRMATION'
        `);

        if (updateRes.rowsAffected !== 1) {
          throw new Error('SQLITE_BUSY: Trạng thái đơn hàng đã thay đổi bởi tiến trình khác.');
        }

        // 9. Audit nguyên tử cùng transaction (id xác định → retry không nhân bản)
        await tx
          .insert(auditLogs)
          .values({
            id: `aud-order-confirm-${orderId}`,
            action: 'ORDER_CONFIRMED',
            actorRole,
            actorId,
            resource: '/api/orders',
            details: `Xác nhận ${ord.orderCode}; proof=${paymentProof?.id || 'N/A'}; capturedAt=${paymentProof?.capturedAt || 'N/A'}`,
          })
          .onConflictDoNothing({ target: auditLogs.id });

        return { orderId, orderCode: ord.orderCode, status: 'COMPLETED' };
      });

      if (expiredError) {
        throw expiredError;
      }
      return result!;
    });
  }

  /** Hủy đơn PENDING → CANCELLED (có điều kiện, chống race với confirm).
   *  Cashier chỉ hủy được đơn của chính mình; Owner/Manager hủy mọi đơn.
   *  `actorId` tường minh (nếu không dùng actorContext) để audit không bao giờ
   *  ghi SYSTEM cho một quyết định của con người. */
  static async cancelOrder(
    orderId: string,
    actorRole: string,
    reason?: string,
    actorContext?: ActorContext,
    actorId?: string
  ) {
    if (actorContext) { actorRole = actorContext.role; }
    const resolvedActorId = actorContext?.staffId ?? actorId;

    return await withDbRetry(async () => {
      return await db.transaction(async (tx) => {
        const rows = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
        if (rows.length === 0) throw AppError.invalid('Không tìm thấy đơn hàng.');
        const ord = rows[0];

        this.assertOrderActor(ord, actorRole, resolvedActorId, 'hủy');

        if (ord.status === 'CANCELLED') {
          return { orderId, status: 'CANCELLED', isIdempotent: true };
        }
        if (ord.status !== 'PENDING_CONFIRMATION') {
          throw AppError.conflict(`Đơn đang ở trạng thái ${ord.status}, không thể hủy.`);
        }

        // Đóng ca = không được xử lý đơn chờ thuộc két (đồng bộ với confirmOrder).
        if (ord.cashboxSessionId) {
          const sessionRows = await tx
            .select()
            .from(cashboxSessions)
            .where(eq(cashboxSessions.id, ord.cashboxSessionId))
            .limit(1);
          const cashbox = sessionRows[0];
          if (!cashbox || cashbox.status !== 'OPEN' || cashbox.warehouseId !== ord.warehouseId) {
            throw AppError.conflict('Két ca đã đóng, không thể hủy đơn chờ.');
          }
        }

        const noteUpdate = reason ? `${ord.note ? ord.note + ' | ' : ''}[HỦY: ${reason}]` : ord.note;
        const updateRes: any = await tx.run(sql`
          UPDATE orders
          SET status = 'CANCELLED',
              note = ${noteUpdate}
          WHERE id = ${orderId} AND status = 'PENDING_CONFIRMATION'
        `);

        if (updateRes.rowsAffected !== 1) {
          throw new Error('SQLITE_BUSY: Trạng thái đơn hàng đã thay đổi trong khi đang hủy.');
        }

        await tx
          .insert(auditLogs)
          .values({
            id: `aud-order-cancel-${orderId}`,
            action: 'ORDER_CANCELLED',
            actorRole,
            // Mọi hủy đơn ở đây đều do con người quyết định (đã qua assertOrderActor).
            // Không có mã nhân viên thì ghi đúng vai trò đã khai, TUYỆT ĐỐI không ghi
            // SYSTEM — SYSTEM chỉ dành cho các đường hủy tự động (cleanup/quá hạn),
            // vốn không đi qua hàm này.
            actorId: resolvedActorId || `unattributed:${actorRole}`,
            resource: '/api/orders',
            details: `Hủy ${ord.orderCode}${reason ? ` (lý do: ${reason})` : ''}`,
          })
          .onConflictDoNothing({ target: auditLogs.id });

        return { orderId, status: 'CANCELLED' };
      });
    });
  }

  /** Owner/Manager xử lý mọi đơn; Cashier chỉ xử lý đơn có cashierId của chính mình. */
  private static assertOrderActor(
    ord: { cashierId: string | null },
    actorRole: string,
    actorId: string | undefined,
    verb: string
  ): void {
    const isPrivileged = actorRole === 'ROLE_OWNER' || actorRole === 'ROLE_MANAGER';
    const isOwnCashierOrder = actorRole === 'ROLE_CASHIER' && !!actorId && ord.cashierId === actorId;
    if (!isPrivileged && !isOwnCashierOrder) {
      throw AppError.forbidden(`Cashier chỉ được ${verb} đơn của chính mình.`);
    }
  }

  /** Job dọn đơn PENDING quá hạn (payment_expires_at, fallback TTL 48h) → CANCELLED. */
  static async cleanupExpiredPending(): Promise<number> {
    const stale = (
      await db
        .select({
          id: orders.id,
          note: orders.note,
          createdAt: orders.createdAt,
          paymentExpiresAt: orders.paymentExpiresAt,
        })
        .from(orders)
        .where(eq(orders.status, 'PENDING_CONFIRMATION'))
    ).filter((ord) => this.isPendingExpired(ord));
    let cleaned = 0;
    for (const ord of stale) {
      // SELECT nằm ngoài transaction: phải khoá có điều kiện status, nếu không một
      // confirmOrder chạy xen giữa sẽ bị ghi đè CANCELLED sau khi kho đã xuất.
      const note = `${ord.note ? ord.note + ' | ' : ''}[TỰ ĐỘNG HỦY: quá hạn giữ chỗ]`;
      const res: any = await db.run(sql`
        UPDATE orders
        SET status = 'CANCELLED', note = ${note}
        WHERE id = ${ord.id} AND status = 'PENDING_CONFIRMATION'
      `);
      if (res.rowsAffected === 1) cleaned++;
    }
    return cleaned;
  }

  /**
   * Truy vấn danh sách đơn hàng có lọc theo Sổ Kép (Thuế vs Toàn cảnh Nội bộ).
   */
  static async getOrders(filters: OrderFilterParams = {}) {
    const { fiscalScope = 'ALL', warehouseId, partnerId, cashierId, startDate, endDate, status, channel } = filters;

    let query = db.select().from(orders);
    const conditions = [];

    if (fiscalScope !== 'ALL') {
      conditions.push(eq(orders.fiscalScope, fiscalScope));
    }
    if (status && status !== 'ALL') {
      conditions.push(eq(orders.status, status));
    }
    if (channel) {
      conditions.push(eq(orders.channel, channel));
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
    // Bước 1: báo cáo doanh thu mặc định loại đơn PENDING/CANCELLED (chưa thu tiền thật)
    const list = await this.getOrders({ ...filters, status: filters.status || 'COMPLETED' });
    // Bước 4: đơn SPONSORSHIP (final 0đ, rút từ quỹ) không phải doanh số bán —
    // loại khỏi tổng hợp trừ khi caller lọc channel tường minh.
    const sales = filters.channel ? list : list.filter((o) => o.channel !== 'SPONSORSHIP');

    let totalOrders = sales.length;
    let totalSubtotal = 0;
    let totalDiscount = 0;
    let totalRevenue = 0;

    let officialTaxOrders = 0;
    let officialTaxRevenue = 0;

    let internalOrders = 0;
    let internalRevenue = 0;

    for (const ord of sales) {
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
  audit?: {
    actorRole: string;
    actorId: string;
    details: string;
  };
}

export interface CloseCashboxParams {
  sessionId: string;
  closingCashActual: number;
  notes?: string;
  audit?: {
    actorRole: string;
    actorId: string;
  };
}

export class CashboxService {
  /**
   * Mở ca làm việc mới cho thu ngân (Open Shift / Cashbox Session).
   * Mỗi thu ngân tại một kho chỉ được có tối đa 1 phiên OPEN tại một thời điểm.
   */
  static async openSession(params: OpenCashboxParams) {
    const { warehouseId, cashierId, openingCash = 0, notes } = params;
    if (!Number.isFinite(openingCash) || openingCash < 0) throw AppError.invalid('Tiền đầu ca không hợp lệ.');

    return withDbRetry(() => db.transaction(async (tx) => {
      const existingOpen = await tx
        .select()
        .from(cashboxSessions)
        .where(
          and(
            eq(cashboxSessions.cashierId, cashierId),
            eq(cashboxSessions.warehouseId, warehouseId),
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

       await tx.insert(cashboxSessions).values(newSession);
       if (params.audit) {
         await tx
           .insert(auditLogs)
           .values({
             id: `aud-cashbox-open-${sessionId}`,
             action: 'MUTATE_ORDER',
             actorRole: params.audit.actorRole,
             actorId: params.audit.actorId,
             resource: '/api/cashbox',
             details: params.audit.details.slice(0, 500),
             ipAddress: 'local',
           })
           .onConflictDoNothing({ target: auditLogs.id });
       }
       return {
         session: newSession,
         isExisting: false,
       };
     }));
  }

  /**
   * Lấy phiên két tiền hiện tại đang hoạt động của thu ngân.
   */
  static async getActiveSession(cashierId: string, warehouseId?: string) {
    const conditions = [
      eq(cashboxSessions.cashierId, cashierId),
      eq(cashboxSessions.status, 'OPEN'),
    ];
    if (warehouseId) conditions.push(eq(cashboxSessions.warehouseId, warehouseId));
    const sessions = await db
      .select()
      .from(cashboxSessions)
      .where(and(...conditions))
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
  static async calculateSessionStats(sessionId: string, txOrDb: any = db) {
    const sessionOrders = await txOrDb
      .select({
        finalAmount: orders.finalAmount,
        paymentMethod: orders.paymentMethod,
      })
      .from(orders)
      .where(
        and(
          eq(orders.cashboxSessionId, sessionId),
          eq(orders.status, 'COMPLETED')
        )
      );

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

    // FIX-09: trừ tiền hoàn (phiếu COMPLETED cùng ca) khỏi két — chốt ca khỏi lệch.
    // Chỉ tính hoàn tiền mặt: hoàn chuyển khoản đối soát ngân hàng riêng (SETTLE_COD pattern).
    const refunds = await txOrDb
      .select({ refundAmount: returnOrders.refundAmount })
      .from(returnOrders)
      .where(and(eq(returnOrders.cashboxSessionId, sessionId), eq(returnOrders.status, 'COMPLETED')));
    let totalRefunds = 0;
    for (const r of refunds) totalRefunds += r.refundAmount || 0;
    totalCashSales -= totalRefunds;

    return {
      totalCashSales,
      totalTransferSales,
      totalOrdersCount,
      totalRefunds,
    };
  }

  /**
   * Chốt ca thu ngân (Close Shift) & Đối soát chênh lệch tiền két (Reconciliation).
   */
  static async closeSession(params: CloseCashboxParams) {
    const { sessionId, closingCashActual, notes } = params;
    if (!Number.isFinite(closingCashActual) || closingCashActual < 0) throw AppError.invalid('Tiền thực đếm không hợp lệ.');

    return withDbRetry(() => db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(cashboxSessions)
        .where(eq(cashboxSessions.id, sessionId))
        .limit(1);

      if (existing.length === 0) {
        throw AppError.invalid(`Không tìm thấy phiên két tiền: ${sessionId}`);
      }

       const session = existing[0];
       if (session.status === 'CLOSED') {
         if (session.closingCashActual !== closingCashActual) {
           throw AppError.idempotency('Phiên két tiền đã đóng với số tiền thực đếm khác.');
         }
         return {
           sessionId,
           cashierId: session.cashierId,
           warehouseId: session.warehouseId,
           openingCash: session.openingCash,
           closingCashActual: session.closingCashActual ?? 0,
           expectedCash: session.expectedCash ?? 0,
           cashDiscrepancy: session.cashDiscrepancy ?? 0,
           totalCashSales: session.totalCashSales ?? 0,
           totalTransferSales: session.totalTransferSales ?? 0,
           totalOrdersCount: session.totalOrdersCount ?? 0,
           openedAt: session.openedAt,
           closedAt: session.closedAt,
           status: 'CLOSED' as const,
           isIdempotent: true,
         };
       }

      // Còn đơn chuyển khoản/QR chờ xác nhận → chặn chốt ca (spec §10.3)
      const pending = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            eq(orders.cashboxSessionId, sessionId),
            eq(orders.status, 'PENDING_CONFIRMATION')
          )
        )
        .limit(1);
      if (pending.length > 0) {
        throw AppError.conflict('Còn đơn chuyển khoản/QR đang chờ. Hãy xác nhận hoặc hủy trước khi chốt ca.');
      }

      const stats = await this.calculateSessionStats(sessionId, tx);
      const expectedCash = session.openingCash + stats.totalCashSales;
      const cashDiscrepancy = closingCashActual - expectedCash;
      const closedAt = new Date().toISOString();
      const updateResult = await tx
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
        .where(
          and(
            eq(cashboxSessions.id, sessionId),
            eq(cashboxSessions.status, 'OPEN')
          )
        );
      if (updateResult.rowsAffected !== 1) {
        throw AppError.conflict('Phiên két tiền đã được đóng bởi thao tác khác.');
      }
      if (params.audit) {
        await tx
          .insert(auditLogs)
          .values({
            id: `aud-cashbox-close-${sessionId}`,
            action: 'MUTATE_ORDER',
            actorRole: params.audit.actorRole,
            actorId: params.audit.actorId,
            resource: '/api/cashbox',
            details: `Chốt ca két tiền ${sessionId}: Thực đếm ${closingCashActual} đ, Kỳ vọng ${expectedCash} đ, Lệch: ${cashDiscrepancy} đ`.slice(0, 500),
            ipAddress: 'local',
          })
          .onConflictDoNothing({ target: auditLogs.id });
      }

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
     }));
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

