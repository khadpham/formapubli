import { db, orders, orderItems, editions, products, promotions, promotionGifts, warehouses, partners, customers, cashboxSessions, returnOrders, inventoryLedger, discountApprovalRequests, activeSessions, stockBalances, auditLogs, dailyOrderCounters } from '../db';
import { computeGifts, type PromotionCampaign } from '../lib/promotion-engine';
import { InventoryService } from './inventory.service';
import { WarehouseService } from './warehouse.service';
import { BundleService } from './bundle.service';
import { eq, and, or, isNotNull, desc, sql, gte, lte, inArray } from 'drizzle-orm';
import { withDbRetry } from '../lib/db-retry';
import { isLeaseEnforcedRole, isLeaseEnforcementEnabled } from '../lib/auth-session';
import { AppError } from './app-error';
import { ActorContext } from './actor-context';
import { DiscountApprovalService } from './discount-approval.service';
import { allocateOrderCode, isPosOrderCode, toBase36 } from './order-code';
// `toBase36` nằm ở `./order-code` nhưng vẫn export lại từ đây: `scripts/test-order-code-13.ts`
// import nó từ đây, và đổi đường dẫn import của test không phải việc của bản sửa này.
export { toBase36 };
import { generateUUIDv7 } from '../lib/uuidv7';
import { parseDbTimestamp } from '../lib/db-timestamp';
import { priceLine } from '../lib/pricing';

export interface OrderItemInput {
  editionId: string;
  quantity: number;
  unitCoverPrice?: number;
  unitDiscountRate?: number;
  // 0031: dòng QUÀ của chương trình "đơn đạt mốc tiền". Giá 0đ (unitDiscountRate = 1)
  // là quyền lợi ĐÃ CẤU HÌNH, không phải thu ngân tự chiết khấu ⇒ dòng này bị miễn
  // trần chiết khấu và KHÔNG tính vào subtotal/discountAmount của đơn.
  isGiftLine?: boolean;
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

// Trần SỐ LƯỢNG sách một thu ngân được giữ chỗ ATP bằng đơn PENDING_CONFIRMATION
// chưa thu tiền, tính theo (thu ngân, kho) — mọi phương thức thanh toán.
// Lý do: đơn PENDING giữ ATP mà không thu được đồng nào; nếu trần đo SỐ DÒNG
// đơn thì một client độc hại chỉ cần vài đơn (mỗi đơn số lượng tùy ý, khai
// paymentMethod CASH/COD để né trần chuyển khoản) là giữ hết kho. Đo số lượng
// thì trần trúng đúng tài nguyên bị giữ. Manager/Owner miễn trần.
export const MAX_PENDING_HOLD_UNITS_PER_CASHIER = 20;

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
  idempotencyKey?: string;
  note?: string;
  // Bước 1: confirmImmediately=false → đơn PENDING (giữ chỗ ATP, chưa trừ kho).
  // POS/hội chợ giữ mặc định true (COMPLETED như cũ). Web/social truyền false.
  confirmImmediately?: boolean;
  // P2-10: quyền ghi ngày quá khứ. Route đã chặn theo VAI TRÒ trước khi gọi tới
  // đây (thu ngân 403, Quản lý/Owner đi tiếp), nên lớp guard này chỉ là lưới an
  // toàn thứ hai với cùng một quy tắc. Không còn PIN quản lý (đã gỡ 2026-09-29).
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
  // A1-H: ID phê duyệt chiết khấu đã được route verify khớp (giỏ/mức/kho/người).
  // Service tiêu thụ NGUYÊN TỬ trong cùng transaction tạo đơn (conditional
  // APPROVED→CONSUMED, đòi đúng 1 row) — chống reuse/race. Bỏ qua trên đường
  // replay idempotency (trả đơn cũ, không consume lại).
  discountApprovalId?: string;
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

/**
 * Số lượng MUA (không tính dòng quà khuyến mại) — vào {SL} nội dung QR.
 * Quà tặng đi kèm đơn nhưng khách không trả tiền cho nó; ghi nó vào {SL} làm
 * nội dung chuyển khoản sai (mua 1 + tặng 1 ⇒ QR ghi 2). Server tự xác minh
 * cờ quà (không tin client) nên đây là nơi duy nhất định nghĩa đúng.
 */
function pricedQuantityOf(lines: Array<{ quantity: number; isGiftLine?: boolean | null }>): number {
  return lines.reduce((sum, i) => sum + (!i.isGiftLine ? Number(i.quantity || 0) : 0), 0);
}

/**
 * Số CUỐN SÁCH thật trong đơn — dòng có `edition_id` (0032 cho phép hàng hóa như
 * bookmark, móc khoá nằm ở `order_items` với `edition_id = NULL`).
 *
 * VÌ SAO cần riêng `totalQuantity`: phiếu in và màn "Bán Hàng Thành Công" ghi
 * "Tổng số sách", mà `totalQuantity` cộng MỌI dòng. Ở hội chợ mỗi đơn đều kèm
 * 1 quà hàng hóa, nên thu ngân bán 1 cuốn mà phiếu báo "2 cuốn" — đúng bằng cái
 * báo động giống hệt việc hệ thống tự thêm sách vào đơn. Đã đo trên production:
 * ORD261002000V bán 1 cuốn + tặng 1 bookmark mà `totalQuantity = 2`.
 *
 * `pricedQuantityOf` không thay được: nó loại dòng quà, còn dòng quà SÁCH vẫn
 * phải được tính vào "tổng số sách" (khách có thật sự nhận cuốn đó).
 */
function bookQuantityOf(lines: Array<{ quantity: number; editionId?: string | null }>): number {
  return lines.reduce((sum, i) => sum + (i.editionId ? Number(i.quantity || 0) : 0), 0);
}

/**
 * Quy tắc nghiệp vụ: đơn bán tại quầy = kênh RETAIL_OFFICE (kho chính) HOẶC
 * FAIR_EVENT (gian hàng hội chợ). Gian hàng hội chợ CŨNG là bán trực tiếp tại
 * quầy: POS chọn kênh theo warehouseType (PosCheckoutTerminal), nên thu ngân
 * hội chợ gửi channel='FAIR_EVENT'. Trước đây chỉ nhận RETAIL_OFFICE khiến
 * chuyển khoản tại hội chợ rơi vào ngõ cụt: chặn đơn chờ, mất cửa sổ 30 phút,
 * và lách được yêu cầu mở ca két. Giá trị 'FAIR_EVENT' trong orders.channel là
 * hợp lệ và độc lập với quy tắc này (isFairOfflineSync, analytics) — KHÔNG
 * chuẩn hoá channel, chỉ mở rộng tập "kênh quầy".
 *
 * Cửa sổ thanh toán 30 phút và yêu cầu có ca két phải bám vào KÊNH, không bám
 * vào cashboxSessionId — vì cashboxSessionId do client gửi: bỏ đi là rơi về
 * TTL 48h và lách được cửa sổ ngắn.
 */
function isCounterChannel(channel: string | null | undefined): boolean {
  return channel === 'RETAIL_OFFICE' || channel === 'FAIR_EVENT';
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
  /** Ngữ nghĩa hoàn tất của request: false = tạo đơn PENDING giữ chỗ, true = chốt. */
  confirmImmediately?: boolean;
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
      customerName = 'Khách lẻ',
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
    // Kênh SPONSORSHIP là kênh RÚT QUỸ, không phải kênh bán hàng: chỉ
    // SponsorshipService.draw được ghi (nó tự INSERT, finalAmount = 0 vì tiền
    // đã thu sẵn từ nhà tài trợ). Trước khi chặn, `channel` do CLIENT gửi nên
    // đường bán hàng nhận được kênh này, và hậu quả kép:
    //  (1) MỘT ĐƠN TIỀN MẶT thật bị `getSalesSummary` (và forecast, executive,
    //      analytics — tất cả đều lọc `channel != 'SPONSORSHIP'`) loại khỏi
    //      doanh số: tiền nằm trong két nhưng không có mặt trong báo cáo.
    //  (2) `isCounterChannel()` = false nên lách trọn bộ guard ca két của
    //      kênh quầy (B2a mở ca, B2c quá giờ chốt ngày) — bán tiền mặt ở
    //      hội chợ mà không cần mở ca, `cashbox_session_id` = NULL.
    // Chặn ở service (không phải route) vì đây là nơu mọi caller — kể cả
    // đồng bộ offline và caller nội bộ — đều phải đi qua.
    if (channel === 'SPONSORSHIP') {
      throw AppError.invalid(
        'Kênh SPONSORSHIP do Quỹ tài trợ quản lý, không dùng để bán hàng. Rút sách tài trợ dùng luồng Quỹ tài trợ.'
      );
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
             confirmImmediately,
             items: items || [],
             bundles: params.bundles || [],
           },
           db
         );
          if (params.discountApprovalId) {
           const approval = await DiscountApprovalService.getRequest(params.discountApprovalId);
           // MERGE: bỏ so sánh approval.orderCode. origin/main chỉ set
           // status/updatedAt khi tiêu thụ, KHÔNG ghi orderCode vào yêu cầu, nên
           // phép so sánh này không bao giờ đúng và làm hỏng replay hợp lệ
           // (D07: cùng key + cùng approval phải trả về đúng đơn cũ).
           // Vẫn ràng buộc chặt: approval phải CONSUMED, đúng kho, đúng thu ngân.
           if (
             approval.status !== 'CONSUMED' ||
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
          discountApprovalId: (existingPre[0] as any).discountApprovalId ?? null,
          discountAmount: existingPre[0].discountAmount,
          finalAmount: existingPre[0].finalAmount,
          fiscalScope: existingPre[0].fiscalScope,
          itemsCount: existingLines.length,
          totalQuantity: existingLines.reduce((sum, i) => sum + i.quantity, 0),
          bookQuantity: bookQuantityOf(existingLines),
          pricedQuantity: pricedQuantityOf(existingLines),
          status: existingPre[0].status,
          isDuplicate: true,
        };
      }
    }

    // V4.1 S1.2: chặn bán từ kho ảo/ký gửi/ngưng bán ngay từ cổng vào (đọc DB, không hardcode).
    const sellRow = await WarehouseService.assertSellable(warehouseId);
    // V4.1 S1.2 (lock Q5): đơn giữ chỗ ONLINE (PENDING) chỉ được giữ ở kho chính —
    // sách đã ra gian hàng hội chợ chỉ bán trực tiếp tại quầy, không giữ chỗ cho
    // khách online. Chặn theo KÊNH (isCounterChannel), KHÔNG chặn theo kho: gian
    // hàng hội chợ vẫn bán chuyển khoản/QR tại quầy (POS gửi FAIR_EVENT). Chặn
    // theo kho là ngõ cụt chuyển khoản tại POS hội chợ.
    if (
      params.confirmImmediately === false &&
      sellRow.warehouseType === 'FAIR_EVENT' &&
      !isCounterChannel(channel)
    ) {
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
        throw AppError.forbidden(`Đơn gõ bù quá ${BACKDATE_LIMIT_DAYS} ngày: chỉ Quản lý hoặc Owner được tạo.`);
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
      throw AppError.invalid('Chiết khấu đơn phải nằm trong khoảng 0 - 100%.');
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
      throw AppError.invalid('Chiết khấu đơn phải nằm trong khoảng 0 - 100%.');
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
      throw AppError.invalid('Đơn phải có ít nhất 1 đầu sách hoặc 1 combo.');
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
            confirmImmediately,
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
            discountApprovalId: (existingPre[0] as any).discountApprovalId ?? null,
          discountAmount: existingPre[0].discountAmount,
          finalAmount: existingPre[0].finalAmount,
          fiscalScope: existingPre[0].fiscalScope,
          itemsCount: existingLines.length,
          totalQuantity: existingLines.reduce((sum, i) => sum + i.quantity, 0),
          bookQuantity: bookQuantityOf(existingLines),
          pricedQuantity: pricedQuantityOf(existingLines),
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

    // Phiên két ghi trên đơn: client gửi thì dùng, không gửi thì (đơn quầy chờ,
    // có ca mở) server tự gắn vào ca đang mở — xem khối B2a trong transaction.
    let resolvedCashboxSessionId = params.cashboxSessionId ?? null;

    const isPending = confirmImmediately === false;
    // POS counter transfer: PENDING hạn 30 phút (đơn PENDING khác giữ TTL 48h).
    // Hạn do server đặt, không nhận từ client; "đơn quầy" xác định bằng KÊNH
    // (RETAIL_OFFICE) chứ không phải cashboxSessionId do client gửi.
    const isCounterTransfer = isPending && requiresPaymentProof(paymentMethod) && isCounterChannel(channel);
    const paymentExpiresAt = isCounterTransfer
      ? new Date(Date.now() + 30 * 60_000).toISOString()
      : null;
    // ĐƯỢC phép tạo đơn chờ xác nhận (chuyển khoản/QR) kèm approval chiết khấu.
    // Approval đã được tiêu thụ NGUYÊN TỬ ngay trong tx này (consumeApproval) và
    // mức chiết khấu đã đóng băng vào dòng đơn; confirmOrder không đụng approval.
    // Trước đây chặn ở đây khiến "chiết khấu >=20% + chuyển khoản" là ngõ cụt:
    // 400 chết, không tạo được đơn, không hiện được QR. Cấm thêm lại guard này.
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

    // 2. Tra cứu giá bìa từ cơ sở dữ liệu nếu chưa có (master data).
    //
    // Tra từ BẢNG `products` (tầng gốc), KHÔNG phải `editions`. Sách đã được
    // mirror vào `products` với `id` TRÙNG `editions.id` nên kết quả y hệt trước
    // đây; hàng hóa thì chỉ có `products`.
    //
    // Trước đây tra `FROM editions` ⇒ hàng hóa không có dòng editions nên chết
    // NGAY TẠI ĐÂY, trước cả bước kiểm ATP — đơn không tạo được. Đây là lỗi
    // đã lên production; bằng chứng ở scripts/test-goods-sell-e2e.ts.
    const editionIds = stockCheckItems.map((i) => i.editionId);
    const dbProducts = await withDbRetry(async () => {
      return await db
        .select({
          id: products.id,
          name: products.name,
          coverPrice: products.sellingPrice,
          // Lấy LUÔN ở đây vì câu này đã chạy rồi — không tốn thêm subrequest.
          // Dùng để biết dòng này là SÁCH hay HÀNG HÓA, quyết định ghi
          // `inventory_ledger.edition_id` là NULL hay không. Đường này gần với
          // trần 50 subrequest của Worker nên tuyệt đối không thêm query.
          productKind: products.productKind,
        })
        .from(products)
        .where(inArray(products.id, editionIds));
    });

    // Khoá theo `products.id`; giá trị vẫn là `editionId` (với sách chúng BẰNG
    // nhau) để không phá vỡ các call site phía dưới.
    const editionMap = new Map(dbProducts.map((e) => [e.id, e]));

    // 3. Tính toán dòng tiền và chi tiết đơn hàng ngoài transaction
    let calculatedSubtotal = 0;
    let calculatedFinalAmount = 0;

    // Tra chương trình khuyến mại đang chạy. Đây là nguồn SỰ THẬT để xác minh
    // dòng quà — client KHÔNG được tự quyết mình có quà.
    // Chỉ tra khi client có gắn cờ quà, để không tốn query cho đơn thường
    // (đường này sát trần 50 subrequest của Worker).
    const claimedGiftIds = looseItems.filter((i) => i.isGiftLine).map((i) => i.editionId);
    let allowedGiftProducts = new Set<string>();
    // Quà tay đã duyệt (theo `discountApprovalId`) — dùng ở cả engine lẫn
    // `consumeApproval` phía dưới nên khai ở scope hàm, không phải trong `if`.
    const approvedManualSet = new Set<string>();
    if (claimedGiftIds.length) {
      const campaigns = await db
        .select()
        .from(promotions)
        .where(eq(promotions.isActive, true));
      const rules = campaigns.length
        ? await db
            .select()
            .from(promotionGifts)
        : [];
      const byCampaign = new Map(campaigns.map((c) => [c.id, c]));
      const shaped: PromotionCampaign[] = campaigns
        // 0034: chiến dịch kho khác không được xác minh quà cho kho này.
        .filter((c) => !(c as any).warehouseId || (c as any).warehouseId === warehouseId)
        .map((c) => ({
        id: c.id,
        name: c.name,
        isActive: c.isActive,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        gifts: rules
          .filter((r) => r.promotionId === c.id)
          .map((r) => ({
            minSubtotal: r.minSubtotal,
            productId: r.productId,
            giftQuantity: r.giftQuantity,
          })),
      })).filter((c) => byCampaign.has(c.id));

      // eligibleBase = tổng giá GỐC của các dòng KHÔNG phải quà.
      // Tuyệt đối không lấy `calculatedSubtotal` vì nó đã bị trừ chiết khấu, và
      // không bao giờ lấy tổng cả đơn vì dòng quà sẽ tự đẩy tổng lên bậc kế
      // tiếp (vòng lặp — đã tốn một đêm tìm hiểu).
      const eligibleBase = looseItems
        .filter((i) => !claimedGiftIds.includes(i.editionId))
        .reduce((s, i) => {
          const p = dbProducts.find((x) => x.id === i.editionId);
          // PHẢI NHÂN SỐ LƯỢNG. Bản đầu chỉ cộng `coverPrice` một lần ⇒ đơn
          // nhiều cuốn tính ra đúng bằng giá bìa của MỘT cuốn, dưới mốc ⇒
          // quà thật cũng bị hạ. Bắt được bởi scripts/test-gift-forgery.ts.
          return s + (p?.coverPrice || 0) * (i.quantity || 0);
        }, 0);

      // Dòng quà do người tự thêm đã qua duyệt thì được phép, kể cả khi không
      // nằm trong cấu hình — nhưng BẮT BUỘC phải có `discountApprovalId`.
      // Engine nhận `approvedManual` để công nhận chúng là quà hợp lệ.
      let approvedManual: Set<string> | undefined;
      if (params.discountApprovalId) {
        const appr = await DiscountApprovalService.getRequest(params.discountApprovalId);
        // Dòng hàng đã duyệt nằm trong `cartSnapshot` (JSON) của yêu cầu.
        let snapshotItems: any[] = [];
        try {
          const parsed: any = JSON.parse(String((appr as any)?.cartSnapshot ?? '[]'));
          snapshotItems = Array.isArray(parsed) ? parsed : [];
        } catch {
          snapshotItems = [];
        }
        approvedManual = new Set(
          snapshotItems
            .filter((i: any) => i?.isManual === true && i?.isGiftLine === true)
            .map((i: any) => String(i.editionId))
        );
        for (const id of Array.from(approvedManual)) approvedManualSet.add(id);
      }

      allowedGiftProducts = new Set(
        computeGifts({ eligibleBase, campaigns: shaped, approvedManual }).map((g) => g.productId)
      );
    }

    const preparedItems = [
      ...looseItems.map((item) => {
        const edition = editionMap.get(item.editionId);
        // FIX-01: giá bìa LUÔN lấy từ DB, tuyệt đối không tin unitCoverPrice client gửi.
        if (!edition) throw AppError.invalid(`Ấn bản ${item.editionId} không tồn tại trong danh mục.`);
        const coverPrice = edition.coverPrice || 0;
        const itemDiscountRate = item.unitDiscountRate ?? discountRate;
        const claimedGift = Boolean(item.isGiftLine);

        // ⚠️ KHÔNG TIN CỜ `isGiftLine` TỪ CLIENT.
        // Client gửi lên là dễ sửa: thu ngân tự gắn cờ ⇒ bán 0đ, miễn trần 20%,
        // không cần Quản lý duyệt. Server phải tự tra `promotions` xác nhận món
        // này THẬT SỰ nằm trong bậc mà đơn đạt tới.
        const isGiftLine = claimedGift && allowedGiftProducts.has(item.editionId);

        // Cờ client gắn mà không có trong chương trình ⇒ hạ về dòng thường,
        // khách trả đúng giá. KHÔNG báo lỗi: người dùng không có lý do biết.
        // `isGiftClaimedRejected` đưa vào audit để sau này điều tra.
        let isGiftClaimedRejected = false;
        if (claimedGift && !isGiftLine) {
          isGiftClaimedRejected = true;
        }

        // Dòng bị hạ về thường thì giá phải đúng: chiết khấu theo đơn, không
        // phải 1 (100%) mà client gửi lên.
        const effectiveDiscountRate = isGiftLine
          ? 1
          : claimedGift
            ? discountRate
            : itemDiscountRate;
        const priced = priceLine(coverPrice, effectiveDiscountRate, item.quantity);

        // DÒNG QUÀ: finalAmount vẫn cộng (bằng 0 vì giá bán 0đ) nhưng KHÔNG cộng
        // subtotal. Nếu cộng, `subtotal` và `discountAmount` của đơn mang giá bìa
        // của món quà ⇒ báo cáo cuối ngày (daily-settlement.service.ts:101-102) báo
        // như khách được chiết khấu 300.000đ dù không có 1đ chiết khấu nào.
        if (!isGiftLine) {
          calculatedSubtotal += priced.subtotal;
        }
        calculatedFinalAmount += priced.finalAmount;

return {
          id: `oi-${generateUUIDv7()}`,
          // Hàng hóa không có dòng `editions` ⇒ `edition_id = NULL`, vì cột này
          // VẪN CÒN FK `editions(id)` (nullable ≠ bỏ FK).
          editionId: edition.productKind === 'BOOK' ? item.editionId : null,
          productId: item.editionId,
          // Cờ này đi xuống `recordMovementsBatch` để quyết định ghi sổ kho,
          // thay vì tra thêm một query (đường này sát trần subrequest Worker).
          isBook: edition.productKind === 'BOOK',
          isGiftLine,
          quantity: item.quantity,
          unitCoverPrice: priced.coverPrice,
          // Lưu `effectiveDiscountRate`, KHÔNG lưu `itemDiscountRate`. Nếu lưu
          // giá trị client gửi, một dòng quà GIẢ bị hạ xuống dòng thường vẫn
          // mang `unit_discount_rate = 1` trong DB ⇒ báo cáo tưởng khách được
          // chiết khấu 100%. Bắt được bởi scripts/test-gift-forgery.ts.
          unitDiscountRate: effectiveDiscountRate,
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
          productId: line.editionId,
          // Dòng combo luôn là ấn bản sách.
          isBook: true,
          isGiftLine: false,
          quantity: line.quantity,
          unitCoverPrice: line.unitCoverPrice,
          unitDiscountRate: line.unitDiscountRate,
          unitSellingPrice: line.unitSellingPrice,
          totalAmount: line.totalAmount,
          // PHẢI giữ `line.*` — tôi đã đổi nhầm thành `undefined` một lần, làm
          // dòng combo mất `bundle_id` ⇒ đếm chiết khấu sai, replay combo đụng
          // IDEMPOTENCY_CONFLICT. Bằng chứng: test-pay2-money-audit F4.
          bundleId: line.bundleId,
          bundleQty: line.bundleQty,
        };
      }),
    ];

    const calculatedDiscountAmount = calculatedSubtotal - calculatedFinalAmount;

    // 4. Sinh Idempotency Key cố định (giữ nguyên khi retry)
    // MÃ ĐƠN KHÔNG sinh ở đây nữa — nó cần số thứ tự từ DB, mà số đó phải được
    // cấp BÊN TRONG transaction (xem `allocateOrderCode`) mới nguyên tử giữa các
    // máy POS. `orderId` vẫn sinh ở đây vì không cần thứ tự.
    const orderId = params.id || `ord-${generateUUIDv7()}`;
    const idempotencyKey = params.idempotencyKey || `idem-order-${orderId}`;
    const createdAt = params.createdAt || new Date().toISOString();
    const giftTag = isGift ? `[QUÀ TẶNG: ${giftReason || (note || '').trim() || 'Tặng sách / Quà tặng sự kiện'}]` : '';
    const mergedNote = [giftTag, note].filter((s) => s && `${s}`.trim()).join(' | ') || undefined;

    // 5. Ghi nhận Đơn hàng & Khấu trừ kho nguyên tử trong 1 Transaction (ACID + Retry)
    // Toàn bộ kiểm tra idempotency, phiên két, tính ATP và ghi chép nằm trong write transaction.
    // B3: mã hàng hóa có dòng quà hết tồn — ghi ledger, KHÔNG trừ stock_balances.
    const shortfallEditionIds = new Set<string>();
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
              confirmImmediately,
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
            discountApprovalId: (existing[0] as any).discountApprovalId ?? null,
            discountAmount: existing[0].discountAmount,
            finalAmount: existing[0].finalAmount,
            fiscalScope: existing[0].fiscalScope,
            itemsCount: existingLines.length,
            totalQuantity: existingLines.reduce((sum, i) => sum + i.quantity, 0),
            bookQuantity: bookQuantityOf(existingLines),
            pricedQuantity: pricedQuantityOf(existingLines),
            status: existing[0].status,
            isDuplicate: true,
          };
        }

        // B0b (A1-H): tiêu thụ phê duyệt chiết khấu NGUYÊN TỬ trong cùng
        // transaction, SAU kiểm tra replay (replay trả đơn cũ, không consume
        // lại), TRƯỚC khi ghi đơn. consumeApproval tự UPDATE có điều kiện
        // (đúng 1 row còn APPROVED + version + hạn) — hai request tranh nhau
        // chỉ một thắng, còn lại rollback toàn bộ (không ghi đơn, không trừ kho).
        // Không UPDATE trần ở đây: UPDATE trần trước sẽ đốt trạng thái APPROVED
        // khiến consumeApproval (bước verify giỏ/tiền) luôn fail-closed oan.

        // B0c (S-01): kiểm tra lại lease cashier BẰNG CHÍNH tx hiện hành —
        // đọc qua db global sẽ thấy snapshot khác, mất nguyên tử với ghi đơn.
        // Chỉ enforce khi caller truyền sessionId (route luôn có từ session;
        // caller nội bộ legacy thiếu sessionId thì bỏ qua) và khi cờ rollout
        // SESSION_LEASE_ENFORCE bật.
        {
          const leaseRole = params.actorContext?.role;
          const leaseSessionId = params.actorContext?.sessionId;
          if (isLeaseEnforcementEnabled() && isLeaseEnforcedRole(leaseRole) && leaseSessionId) {
            const leaseRows = await tx
              .select()
              .from(activeSessions)
              .where(eq(activeSessions.staffId, params.actorContext!.staffId))
              .limit(1);
            const lease = leaseRows[0];
            const live =
              !!lease &&
              `${lease.sessionId}` === `${leaseSessionId}` &&
              `${lease.leaseExpiresAt}` > new Date().toISOString();
            if (!live) {
              throw AppError.forbidden(
                'Phiên cashier đã hết hiệu lực hoặc đang mở trên thiết bị khác. Vui lòng đăng nhập lại.'
              );
            }
          }
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

        // B2a. Đơn quầy CHỜ (mọi phương thức trừ thanh toán tức thì) bắt buộc phải
        // có ca két đang mở của chính thu ngân tại đúng kho này. Nếu không, đơn vừa
        // tạo sẽ không bao giờ duyệt được (confirmOrder cũng chặn) — thu ngân thấy
        // QR, thu tiền, rồi đơn kẹt giữ ATP tới 30 phút. Chặn ngay lúc tạo để lỗi
        // có hành động được: mở ca két. Owner/Manager miễn (giữ phạm vi quản lý);
        // bán tiền mặt / quà tặng / đơn chốt ngay không đi qua đây (không phải PENDING).
        // Client bỏ trống cashboxSessionId thì gắn vào ca đang mở của chính thu ngân
        // (openSession giữ tối đa 1 ca OPEN cho mỗi (thu ngân, kho) nên không mơ hồ):
        // nếu không gắn, đơn sẽ tồn tại mà không bao giờ xác nhận được — đúng cái bẫy
        // im lặng ta muốn diệt.
        const creatorRole = params.actorContext?.role;
        const creatorIsPrivileged = creatorRole === 'ROLE_OWNER' || creatorRole === 'ROLE_MANAGER';
        let openShiftRows: Array<{ id: string; openedAt: string | null }> = [];
        if (isPending && isCounterChannel(channel) && !creatorIsPrivileged) {
          openShiftRows = await tx
            .select({ id: cashboxSessions.id, openedAt: cashboxSessions.openedAt })
            .from(cashboxSessions)
            .where(
              and(
                eq(cashboxSessions.cashierId, effCashierId),
                eq(cashboxSessions.warehouseId, warehouseId),
                eq(cashboxSessions.status, 'OPEN')
              )
            )
            .limit(1);
          if (openShiftRows.length === 0) {
            throw AppError.conflict(
              `Đơn tại quầy cần ca két đang mở tại kho ${warehouseId} nhưng thu ngân chưa mở ca. ` +
                `Vui lòng mở ca két trước khi tạo đơn chờ thanh toán.`
            );
          }
          if (!resolvedCashboxSessionId) {
            resolvedCashboxSessionId = openShiftRows[0].id;
          }
        }

        // B2c. Ca quá giờ chốt ngày thì POS tạm ngưng bán cho ca đó. Chốt ở
        // SERVER (không chỉ ở UI) vì đây là chốt chặn tiền mặt. Ca mở sau
        // nửa đêm thuộc ngày mới nên không bị chặn. Dùng lại row đã tải ở
        // B2a; đơn tức thì chỉ thêm 1 câu đọc theo index (cashier,kho,status).
        // ponytail: trần hiện tại = 1 câu đọc có index mỗi đơn quầy tức thì.
        // Nếu sau này thấy nóng, nâng lên cache theo (cashier, kho) đã đóng
        // bằng cách bắn bus/event khi AUTO_CLOSE/CLOSE chạy — không cache ở
        // đây vì cache hỏng = bán được sau giờ.
        if (isCounterChannel(channel) && !creatorIsPrivileged) {
          const guardShift: Array<{ openedAt: string | null }> = openShiftRows.length > 0
            ? [openShiftRows[0]]
            : await tx
                .select({ openedAt: cashboxSessions.openedAt })
                .from(cashboxSessions)
                .where(
                  and(
                    eq(cashboxSessions.cashierId, effCashierId),
                    eq(cashboxSessions.warehouseId, warehouseId),
                    eq(cashboxSessions.status, 'OPEN')
                  )
                )
                .limit(1);
          if (guardShift.length > 0 && guardShift[0].openedAt) {
            CashboxService.assertShiftWithinBusinessDay({
              openedAt: guardShift[0].openedAt,
              warehouseId,
              cashierId: effCashierId,
            });
          }
        }

        // B2. Tính toán & Kiểm tra ATP nguyên tử bên trong Transaction
        // BATCH (2 câu cố định thay vì 2 câu/dòng): `getATP` chính là
        // `getBatchATP([id])` nên ngữ nghĩa y hệt, chỉ gom lại. Đo trước khi
        // sửa (bọc client.execute): đơn 10 dòng = 77 câu, biên 7 câu/dòng —
        // Workers free plan chỉ có 50 subrequest/lần gọi, tức đơn ≥ 7 dòng là
        // 500 "Too many subrequests" ⇒ KHÔNG chốt được đơn. Xem
        // scripts/test-auditC-nplus1.ts.
        {
          const atpMap = await this.getBatchATP(Array.from(needTotal.keys()), warehouseId, tx);
          for (const [editionId, qty] of Array.from(needTotal.entries())) {
            const atp = atpMap.get(editionId) ?? 0;
            if (atp < qty) {
              // B3: dòng quà hết tồn KHÔNG chặn đơn. Chỉ miễn khi TOÀN BỘ nhu
              // cầu của mã này đều là dòng quà đã xác minh — còn mã vừa bán
              // thường vừa tặng quà thì vẫn chặn nếu tổng vượt tồn.
              const giftDemand = preparedItems
                .filter((i) => i.isGiftLine && i.productId === editionId)
                .reduce((s, i) => s + i.quantity, 0);
              if (giftDemand === qty) {
                shortfallEditionIds.add(editionId);
                continue;
              }
              throw AppError.atp(
                `HẾT HÀNG KHẢ DỤNG (ATP): Ấn bản ${editionId} chỉ còn ${atp} cuốn có thể bán (đã trừ phần khách online giữ chỗ), không đủ ${qty} cuốn!`
              );
            }
          }
        }

        // B2b. Trần giữ ATP (xem MAX_PENDING_HOLD_UNITS_PER_CASHIER): đo SỐ LƯỢNG
        // đang bị giữ chỗ, mọi phương thức thanh toán, theo (thu ngân, kho).
        // Manager/Owner miễn. Tính ngay trong transaction để hai lần tạo song song
        // không cùng lọt qua trần. Đơn đã quá hạn không tính (cùng quy tắc hạn
        // dùng ở ATP và job dọn).
        if (isPending && !creatorIsPrivileged) {
          const openHoldLines = await tx
            .select({
              quantity: orderItems.quantity,
              createdAt: orders.createdAt,
              paymentExpiresAt: orders.paymentExpiresAt,
            })
            .from(orderItems)
            .innerJoin(orders, eq(orderItems.orderId, orders.id))
            .where(
              and(
                eq(orders.status, 'PENDING_CONFIRMATION'),
                eq(orders.cashierId, effCashierId),
                eq(orders.warehouseId, warehouseId)
              )
            );
          let heldUnits = 0;
          for (const line of openHoldLines) {
            if (this.isPendingExpired(line)) continue;
            heldUnits += Number(line.quantity || 0);
          }
          const newUnits = Array.from(needTotal.values()).reduce((sum, qty) => sum + qty, 0);
          if (heldUnits + newUnits > MAX_PENDING_HOLD_UNITS_PER_CASHIER) {
            throw AppError.conflict(
              `Thu ngân đang giữ chỗ ${heldUnits} cuốn chờ tại kho này; đơn mới cần thêm ${newUnits} cuốn ` +
                `vượt trần ${MAX_PENDING_HOLD_UNITS_PER_CASHIER} cuốn chờ. ` +
                `Vui lòng xác nhận hoặc hủy các đơn cũ trước khi tạo đơn mới.`
            );
          }
        }

        // B3: Tạo bản ghi Master đơn hàng bên trong Transaction
        // Cấp mã đơn 13 ký tự, bên trong transaction đang tạo đơn. Vị trí này có
        // chủ đích:
        //   · sau kiểm tra idempotency ⇒ chơi lại đơn cũ không hao số thứ tự
        //   · sau mọi kiểm tra ATP/két ⇒ đơn bị từ chối không tiêu số
        //   · trong transaction ⇒ số cấp ra bị rollback cùng đơn nếu insert lỗi
        //   · trước khối duyệt chiết khấu vì `createDiscountApproval` cần orderCode
        //     vào đúng bản ghi mà quản lý sẽ đọc
        // `params.orderCode` vẫn được tôn trọng (dữ liệu nhập tay / sửa đơn).
        //
        // ĐƠN CÓ PHÊ DUYỆT dùng lại ĐÚNG mã mà yêu cầu đã cấp, không cấp mã mới.
        // Trước đây mã của yêu cầu do máy thu ngân tự sinh (29 ký tự) còn mã đơn do
        // server cấp (13 ký tự) ⇒ thu ngân đọc mã cho quản lý một đằng, quản lý đối
        // chiếu trên phiếu một nẻo, và báo cáo đối soát ca nối hai bảng bằng
        // `orderCode` nên không khớp đơn nào. Nay mã yêu cầu CHÍNH LÀ mã đơn.
        //
        // `isPosOrderCode` chặn yêu cầu CŨ (mã 29 ký tự sinh ở máy): với chúng vẫn
        // phải cấp mã mới, nếu không sẽ đẩy mã sai định dạng vào cột UNIQUE.
        const approvalOrderCode = await (async () => {
          if (!params.discountApprovalId) return undefined;
          const appr = await DiscountApprovalService.getRequest(params.discountApprovalId, tx);
          return isPosOrderCode(appr.orderCode) ? appr.orderCode! : undefined;
        })();

        const orderCode =
          approvalOrderCode ??
          (params.orderCode || (await allocateOrderCode(tx, businessDateOf(new Date()))));

        if (params.discountApprovalId) {
          const hasUnexpectedLineDiscount = preparedItems.some(
            (item) =>
              // DÒNG QUÀ miễn: giá 0đ là quyền lợi chương trình, không phải chiết
              // khấu thu ngân tự bấm. So sánh nó với `discountRate` sẽ khiến mọi
              // đơn "vừa có quà vừa cần duyệt chiết khấu" chết 409.
              !item.isGiftLine &&
              Math.abs((item.unitDiscountRate ?? discountRate) - discountRate) > 0.0001
          );
          if (hasUnexpectedLineDiscount) {
            throw AppError.conflict('Mức chiết khấu từng dòng không khớp yêu cầu đã được duyệt.');
          }
          // MERGE: giữ consumeApproval() của c-login-ux vì nó chặn cả 2 lớp:
          // (1) verify lại hash giỏ + tổng tiền trong transaction, (2) conditional
          // UPDATE đòi đúng 1 row còn APPROVED + version + chưa hết hạn — mạnh
          // hơn UPDATE trần của origin/main. Hash đã sửa để dùng orderCode của
          // yêu cầu nên không còn lệch với đơn đang tạo.
          await DiscountApprovalService.consumeApproval({
            requestId: params.discountApprovalId,
            currentItems: preparedItems
              // Quà TỰ ĐỘNG loại (consumeApproval tự lọc lại); quà TAY giữ lại
              // kèm cờ để hash khớp với lúc duyệt — lọc mất là mọi đơn quà tay
              // chết 409 dù đã duyệt đúng.
              .filter((item) => !item.bundleId && (!item.isGiftLine || approvedManualSet.has(item.productId)))
              .map((item) => ({
                // `consumeApproval` cần `products.id` để băm hash giỏ — với sách
                // nó BẰNG `edition_id`. `edition_id` có thể NULL cho hàng hóa nên
                // dùng `product_id` (luôn khác NULL).
                editionId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitCoverPrice,
                unitDiscountRate: item.unitDiscountRate,
                isGiftLine: Boolean(item.isGiftLine),
                isManual: Boolean(item.isGiftLine) && approvedManualSet.has(item.productId),
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
          // Đường nối phê duyệt ↔ đơn. Trước đây bảng `orders` KHÔNG có cột này,
          // nên sau sự cố không dựng lại được đơn nào đã được duyệt; báo cáo đối
          // soát ca buộc phải nối bằng `order_code` mà hai bảng lại không bao giờ
          // trùng mã (xem `daily-settlement.service.ts`).
          discountApprovalId: params.discountApprovalId ?? null,
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
          cashboxSessionId: resolvedCashboxSessionId,
          idempotencyKey,
          note: mergedNote,
          createdAt,
        });

        // B4: Ghi nhận các dòng sản phẩm của đơn hàng — MỘT câu INSERT cho cả
        // đơn thay vì 1 câu/dòng (đo trước: 5 câu/dòng, xem B2). Cùng
        // transaction, cùng thứ tự chỉ số `lineIdx` ⇒ idempotency key bút toán
        // kho y hệt, không đổi hợp đồng với `confirmOrder`/đối soát.
        await tx.insert(orderItems).values(
          preparedItems.map((item) => {
            const lineValues: Record<string, unknown> = {
              id: item.id,
              orderId,
              // 0032/0033: `order_items.edition_id` nullable nhưng VẪN CÒN FK
              // `editions(id)`. Hàng hóa không có dòng editions nên phải ghi
              // NULL — ghi id hàng hóa vào đây là FK violation, đơn rollback.
              editionId: item.isBook ? item.editionId : null,
              // 0032: NOT NULL + FK `products(id)`. PHẢI dùng `item.productId`
              // chứ không phải `item.editionId` — với hàng hóa `editionId` đã là
              // NULL ở dòng trên, dùng nó sẽ vi phạm NOT NULL.
              productId: item.productId,
              quantity: item.quantity,
              unitCoverPrice: item.unitCoverPrice,
              unitDiscountRate: item.unitDiscountRate,
              unitSellingPrice: item.unitSellingPrice,
              totalAmount: item.totalAmount,
              // 0031: cột chặn vòng lặp khi tính mốc khuyến mại — phải ghi
              // xuống DB, không chỉ giữ trong RAM.
              isGiftLine: Boolean(item.isGiftLine),
              // B3: quà hết tồn vẫn bán được — gắn cờ để báo cáo tách riêng.
              isGiftShortfall:
                Boolean(item.isGiftLine) && shortfallEditionIds.has(item.productId),
            };
            if (item.bundleId != null) lineValues.bundleId = item.bundleId;
            if (item.bundleQty != null) lineValues.bundleQty = item.bundleQty;
            return lineValues as any;
          })
        );

        // Đơn PENDING chỉ giữ chỗ ATP — KHÔNG sinh bút toán kho.
        if (!isPending) {
          // B5: Khấu trừ tồn kho vật lý tự động qua Thẻ kho bất biến (Append-Only Ledger)
          let lineIdx = 0;
          for (const item of preparedItems) {
            const shortfall =
              Boolean(item.isGiftLine) && shortfallEditionIds.has(item.productId);
            await InventoryService.recordMovement({
              editionId: item.productId,
              // 0033: hàng hóa ghi `inventory_ledger.edition_id = NULL`.
              isBook: item.isBook !== false,
              warehouseId,
              eventType: 'DISPATCH_SALE',
              quantityDelta: -item.quantity,
              condition: 'NEW',
              skipStockUpdate: shortfall,
              documentRef: orderCode,
              note: shortfall
                ? `Quà hết tồn — ghi sổ xuất, KHÔNG trừ bảng cân đối (is_gift_shortfall) trong đơn ${orderCode}`
                : item.bundleId
                ? `Bán combo ${item.bundleId} x${item.bundleQty} trong đơn ${orderCode}`
                : isGift
                ? `Tặng sách (QUÀ TẶNG) đơn ${orderCode} (${giftReason || 'Quà tặng sự kiện'})`
                : `Bán đơn ${orderCode} (${fiscalScope === 'OFFICIAL_TAX' ? 'Hóa đơn VAT' : 'Nội bộ'})`,
              actorId: effCashierId,
              correlationId: orderId,
              idempotencyKey: `idem-stock-${orderId}-${lineIdx}-${item.editionId}`,
              tx,
            });
            lineIdx++;
          }
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
          // Trả về `cashierId` để PHIẾU IN có dòng "Thu ngân:". Trước đây
          // response không có trường này, mà `resolveCashierLabel` cần
          // `cashierId` làm dự phòng khi tên thật chưa tải xong (mạng chậm ở hội
          // chợ) ⇒ phiếu in ra KHÔNG có dòng thu ngân, im lặng, khó phát hiện.
          cashierId: effCashierId,
          warehouseId,
          // Đường nối phê duyệt ↔ đơn trả về cho client (và cho test) kiểm chứng:
          // trước 0035 không có cách nào hỏi "đơn này đã dùng yêu cầu duyệt nào".
          discountApprovalId: params.discountApprovalId ?? null,
          customerName,
          subtotal: calculatedSubtotal,
          discountAmount: calculatedDiscountAmount,
          finalAmount: calculatedFinalAmount,
          fiscalScope,
          status: isPending ? 'PENDING_CONFIRMATION' : 'COMPLETED',
          paymentExpiresAt,
          itemsCount: preparedItems.length,
          totalQuantity: preparedItems.reduce((sum, i) => sum + i.quantity, 0),
          bookQuantity: bookQuantityOf(preparedItems),
          pricedQuantity: pricedQuantityOf(preparedItems),
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

    // Đơn CÓ phê duyệt: mã đơn do server cấp khi tạo yêu cầu, KHÔNG phải mã máy POS
    // gửi lên. Nên không so mã của client với đơn đã có — nếu so, mọi lần POS thử
    // lại cùng `idempotencyKey` (mạng hội chợ chập chờn, bấm lại nút) sẽ sinh
    // IDEMPOTENCY_CONFLICT giả, dù đơn y hệt.
    const ordHasApproval = Boolean((ord as any).discountApprovalId);
    if (want.orderCode && !ordHasApproval && ord.orderCode !== want.orderCode) {
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

    // Ngữ nghĩa hoàn tất là một phần của fingerprint: replay key của đơn PENDING
    // với confirmImmediately mặc định (true) là payload của sync offline — nếu
    // im lặng trả lại đơn PENDING, client tưởng đã bán, xoá bản ghi offline và
    // không có bút toán kho nào. Phải báo xung đột để client giữ đơn + ảnh ở
    // NEEDS_RECONCILIATION. Chiều ngược lại (key của đơn đã COMPLETED) vẫn trả
    // bản ghi cũ: đơn đã chốt thì trả về là đúng.
    if (want.confirmImmediately !== false && ord.status === 'PENDING_CONFIRMATION') {
      throw AppError.idempotency(
        `Idempotency-Key đã gắn với đơn ${ord.orderCode} đang chờ xác nhận (PENDING_CONFIRMATION), ` +
          `nhưng request lại yêu cầu chốt đơn ngay. Dùng action=CONFIRM để hoàn tất đơn đang chờ.`
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
    // Client KHÔNG gửi phiên két ⇒ server tự gắn ca OPEN của chính thu ngân tại
    // đúng kho (xem khối B2a, chỉ khi đơn PENDING ở kênh quầy). Khi đó
    // `ord.cashboxSessionId` là giá trị DO SERVER chọn, mà request replay lại
    // không có gì để so ⇒ so thô bất đối xứng và mọi lần thử lại (F5, mạng lỗi)
    // đều nhận 409 thay vì đúng đơn cũ. Đo được: PENDING quầy không gửi session
    // → tạo lại cùng payload ⇒ "phiên két khác (cbs-… vs null)" dù nội dung
    // đơn y hệt. CHỈ bỏ qua đúng trường hợp đó: đơn PENDING kênh quầy mà ca đó
    // do server tự gắn (đã kiểm vẫn OPEN + đúng thu ngân + đúng kho). Mọi trường
    // hợp khác — kể cả "đơn đã chốt mà replay bỏ session" — vẫn so chặt như cũ.
    if (dbCashbox === wantCashbox) {
      // Khớp (kể cả cả hai null) — không có gì để soi.
    } else if (
      wantCashbox === null &&
      dbCashbox !== null &&
      ord.status === 'PENDING_CONFIRMATION' &&
      isCounterChannel(ord.channel)
    ) {
      // Server tự gắn: hợp lệ khi ca đó vẫn OPEN và thuộc đúng thu ngân/đúng kho —
      // các điều kiện đó đã bị chặn ở B1/B2a khi ghi đơn đầu tiên.
      const sessRows = await txOrDb
        .select({
          status: cashboxSessions.status,
          warehouseId: cashboxSessions.warehouseId,
          cashierId: cashboxSessions.cashierId,
        })
        .from(cashboxSessions)
        .where(eq(cashboxSessions.id, dbCashbox))
        .limit(1);
      const s = sessRows[0];
      if (
        !s ||
        s.status !== 'OPEN' ||
        s.warehouseId !== ord.warehouseId ||
        s.cashierId !== (want.effCashierId || null)
      ) {
        throw AppError.idempotency(
          `Idempotency-Key đã gắn với đơn ${ord.orderCode} nhưng phiên két server tự gắn (${dbCashbox}) không còn hợp lệ.`
        );
      }
    } else {
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

    const dbCustName = (ord.customerName || '').trim() || 'Khách lẻ';
    const wantCustName = (want.customerName || '').trim() || 'Khách lẻ';
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
   * V4.1 S1.2 (lock Q5) — Tồn khả dụng ATP:
   * - Mọi kho: ATP = physical NEW trừ phần đơn PENDING còn hạn giữ chỗ.
   *   Kể cả kho hội chợ (FAIR_EVENT): quầy tại đó tạo đơn chuyển khoản
   *   PENDING_CONFIRMATION tại chính kho đó, giữ hàng thật, nên cũng phải trừ.
   *   (Trước 2026-09-29 kho hội chợ trả thẳng tồn vật lý ⇒ bán vượt tồn.
   *   Xem scripts/test-fair-atp-hold.ts.)
   * Đơn PENDING không có bút toán ledger nên phải tính động từ order_items.
   * Hỗ trợ nhận `txOrDb` để thực thi đồng nhất trong cùng write transaction.
   */
  /**
   * Batch ATP cho nhiều ấn bản — CÙNG semantics với getATP nhưng 2 query cố
   * định thay vì 2N. Bắt buộc cho phiếu nhiều dòng trên Cloudflare Workers:
   * gọi getATP từng cuốn vượt giới hạn subrequest → 500 "Too many subrequests".
   */
  static async getBatchATP(
    editionIds: string[],
    warehouseId: string,
    txOrDb: any = db
  ): Promise<Map<string, number>> {
    const ids = Array.from(new Set(editionIds.filter(Boolean)));
    const out = new Map<string, number>();
    if (ids.length === 0) return out;
    const balRows = await txOrDb
      .select({
        productId: stockBalances.productId,
        qty: stockBalances.physicalQuantity,
      })
      .from(stockBalances)
      .where(
        and(
          inArray(stockBalances.productId, ids),
          eq(stockBalances.warehouseId, warehouseId),
          eq(stockBalances.condition, 'NEW')
        )
      );
    const balMap = new Map<string, number>();
    for (const r of balRows) balMap.set(`${r.productId}`, Number(r.qty || 0));
    // KHÔNG có nhánh riêng cho kho hội chợ nữa. Trước đây có:
    //   if (wh?.warehouseType === 'FAIR_EVENT') { out = balMap; return; }
    // với lý do ghi ở doc là "API giữ chỗ online từ chối kho hội chợ bằng 422 nên
    // không cần trừ". Giả định đó đã lệch: quầy tại kho hội chợ tạo đơn chuyển
    // khoản PENDING_CONFIRMATION ngay tại chính kho đó, giữ hàng thật. Nhánh đó
    // làm ATP kho hội chợ = tồn vật lý ⇒ createOrder (:754) dùng số sai đó để
    // chặn ⇒ chặn không có tác dụng ⇒ bán vượt tồn.
    // Đo được: 5 cuốn tồn + 1 đơn quầy giữ 5 cuốn ⇒ ATP trả 5 thay vì 0.
    // Xem scripts/test-fair-atp-hold.ts (P1/P2/P3).
    // CHỈ so NGÀY UTC ('YYYY-MM-DD'), không so timestamp đầy đủ: created_at
    // trong DB lẫn thứ tự "YYYY-MM-DD HH:MM:SS" (SQLite) lẫn ISO "...T...Z"
    // (app) — so chuỗi giữa hai họ này là vô nghĩa (' ' < 'T') và âm thầm
    // loại mất đơn do DB ghi, tức là nhả ATP oan. Ngày là tiền tố chung nên
    // luôn siêu tập, không bao giờ loại nhầm.
    const cutoffDate = new Date(Date.now() - PENDING_TTL_HOURS * 3600000).toISOString().slice(0, 10);
    // Prefilter rộng (siêu tập) trong SQL; quyết định giữ chỗ cuối cùng do
    // getPendingEffectiveExpiry (một quy tắc hạn duy nhất của hệ thống).
    const held = await txOrDb
      .select({
        productId: orderItems.productId,
        quantity: orderItems.quantity,
        createdAt: orders.createdAt,
        paymentExpiresAt: orders.paymentExpiresAt,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(
        and(
          inArray(orderItems.productId, ids),
          eq(orders.warehouseId, warehouseId),
          eq(orders.status, 'PENDING_CONFIRMATION'),
          or(isNotNull(orders.paymentExpiresAt), gte(orders.createdAt, cutoffDate))
        )
      );
    const now = Date.now();
    const heldMap = new Map<string, number>();
    for (const row of held) {
      const expiry = this.getPendingEffectiveExpiry(row);
      if (!expiry || expiry.getTime() <= now) continue;
      const key = `${row.productId}`;
      heldMap.set(key, (heldMap.get(key) || 0) + Number(row.quantity || 0));
    }
    for (const id of ids) out.set(id, (balMap.get(id) || 0) - (heldMap.get(id) || 0));
    return out;
  }

  /**
   * ATP một ấn bản (đường lẻ) — uỷ quyền cho batch để chỉ có MỘT nơi định
   * nghĩa semantics: fair = physical, còn lại trừ giữ chỗ PENDING còn hạn
   * (payment_expires_at nếu có, nếu không thì TTL 48h).
   */
  static async getATP(editionId: string, warehouseId: string, txOrDb: any = db): Promise<number> {
    const batch = await this.getBatchATP([editionId], warehouseId, txOrDb);
    return batch.get(editionId) ?? 0;
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
      const explicit = parseDbTimestamp(order.paymentExpiresAt);
      // payment_expires_at hỏng (dữ liệu cũ/sửa tay) → rơi về TTL 48h, không để đơn
      // PENDING treo vĩnh viễn và không nhả ATP.
      if (explicit) return explicit;
    }
    // created_at phải đọc theo UTC: SQLite CURRENT_TIMESTAMP ghi UTC không múi
    // giờ, đọc bằng new Date() lệch 7 tiếng ở GMT+7 → đơn bị coi là hết hạn sớm
    // và ATP bị nhả oan.
    const created = parseDbTimestamp(order.createdAt);
    if (!created) return null;
    return new Date(created.getTime() + PENDING_TTL_HOURS * 3600_000);
  }

  static isPendingExpired(order: { createdAt: string | null; paymentExpiresAt?: string | null }): boolean {
    const expiry = this.getPendingEffectiveExpiry(order);
    if (!expiry) return false;
    return Date.now() > expiry.getTime();
  }

  /** Duyệt đơn PENDING → COMPLETED + trừ kho thật (nguyên tử toàn phần).
   *  Cashier chỉ duyệt được đơn của chính mình; Owner/Manager duyệt mọi đơn.
   *  Đơn BANK_TRANSFER/QR_CODE bắt buộc có paymentProof (chốt quy trình, server
   *  không kiểm chứng ảnh).
   *  `actorId` TUYỆT ĐỐI không có giá trị mặc định: mọi duyệt đơn đều là quyết định
   *  của con người nên phải truy ra được người đó (session/actorContext). Không có
   *  định danh thì fail loud — không bao giờ ghi 'staff-admin' (vừa là actor giả
   *  trong audit + bút toán kho, vừa trùng cashierId mặc định của đơn legacy và
   *  biến thành điều kiện vượt phân quyền của một caller không định danh). */
  static async confirmOrder(
    orderId: string,
    actorRole: string,
    actorId?: string,
    actorContext?: ActorContext,
    paymentProof?: TransferPaymentProof,
    /**
     * Ghi chú chốt lúc xác nhận (04/10/2026): ô Ghi chú trong modal thanh
     * toán mở SAU khi đơn PENDING đã tạo — thu ngân gõ ở đó mà CONFIRM không
     * nhận note thì chữ rớt mất. Chỉ ghi đè khi chuỗi non-blank; blank giữ
     * nguyên note lúc tạo đơn.
     */
    opts?: { note?: string }
  ) {
    if (actorContext) {
      actorRole = actorContext.role;
      actorId = actorContext.staffId;
    }
    if (!actorId) {
      throw AppError.forbidden('Thiếu định danh người duyệt đơn: không thể ghi nhận đơn dưới danh tính giả.');
    }
    const resolvedActorId: string = actorId;

    return await withDbRetry(async () => {
      let expiredError: Error | null = null;

      const result = await db.transaction(async (tx) => {
        // 1. Đọc lại order trong transaction
        const rows = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
        if (rows.length === 0) throw AppError.invalid('Không tìm thấy đơn.');
        const ord = rows[0];

        // 1b. Phân quyền ngay trong transaction (route không phải lớp bảo vệ duy nhất)
        this.assertOrderActor(ord, actorRole, resolvedActorId, 'xác nhận');

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
         } else if (isCounterChannel(ord.channel)) {
           // Đơn quầy mà không gắn phiên két: KHÔNG được duyệt. cashboxSessionId do
           // client gửi nên bỏ trống là lách toàn bộ guard két — tiền chuyển khoản/QR
           // thu được sẽ không nằm trong két nào và đối soát tiền mặt lệch. Đơn quầy
           // phải mở ca két trước rồi mới bán được; hủy thì vẫn cho phép để không
           // kẹt vĩnh viễn (xem cancelOrder — hủy không ghi doanh thu vào két nào).
           throw AppError.conflict('Đơn tại quầy chưa gắn phiên két ca đang mở, không thể duyệt.');
         }

         // 5. Đọc order items trong transaction
        const lines = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));

        // 6. Gộp nhu cầu theo edition & kiểm tra tồn trong transaction
        // ATP gom BATCH (2 câu cố định) vì lý do subrequest nêu ở createOrder B2.
        const ownNeed = new Map<string, number>();
        for (const ln of lines) {
          // 0032: `edition_id` nullable nên không làm khóa Map được. Dùng
          // `product_id` (NOT NULL). Với sách `product_id === edition_id` nên giá
          // trị truyền xuống `getBatchATP` y hệt trước đây.
          const key = ln.productId;
          ownNeed.set(key, (ownNeed.get(key) || 0) + ln.quantity);
        }
    const atpMap = await this.getBatchATP(Array.from(ownNeed.keys()), ord.warehouseId, tx);
    // TỒN VẬT LÝ GỘP 1 CÂU (30/09). Trước đây gọi `getBalance` TỪNG DÒNG — mỗi
    // dòng là 1 subrequest từ Cloudflare Worker tới Turso. Đơn 12 dòng thì riêng
    // vòng này đã 12 subrequest, cộng `recordMovement` ~4/dòng nữa thì vượt trần
    // 50 subrequest của Workers ⇒ Worker ném lỗi runtime thô ⇒
    // `handleApiError` che thành "Lỗi hệ thống, vui lòng thử lại." và thu ngân
    // không xác nhận được đơn. Gộp còn 1 câu.
    const balMap = await InventoryService.getBatchBalance(
      Array.from(ownNeed.keys()),
      ord.warehouseId,
      'NEW',
      tx
    );
    for (const [editionId, qty] of Array.from(ownNeed.entries())) {
      const bal = balMap.get(editionId) ?? 0;
      if (bal < qty) {
        throw AppError.atp(`KHÔNG ĐỦ TỒN để duyệt: ${editionId} còn ${bal}, cần ${qty}.`);
      }
      const atp = atpMap.get(editionId) ?? 0;
      if (atp + qty < qty) {
        throw AppError.atp(
          `Hết hàng khả dụng để duyệt (ATP ${atp} đã bị đơn khác giữ): ${editionId} cần ${qty}.`
        );
      }
    }

    // 7. Ghi sổ kho (DISPATCH_SALE) — GỘP CẢ ĐƠN trong 1 lần gọi (30/09).
    // Trước đây gọi `recordMovement` TỪNG DÒNG = ~4 câu SQL/dòng. Trên Turso từ
    // xa mỗi câu là 1 subrequest từ Cloudflare Worker, mà Worker chỉ chịu 50 ⇒ đơn
    // từ 5 dòng trở lên vượt trần và hỏng (lỗi bị che thành "Lỗi hệ thống").
    // Đo thật: production đơn 1–4 dòng được, 5/12/16/17 dòng hỏng với ledger = 0.
    // `recordMovementsBatch` cho KẾT QUẢ Y HỆT, chỉ gom câu lệnh.
    await InventoryService.recordMovementsBatch(
      lines.map((ln) => ({
        // 0032: `order_items.edition_id` nullable nên không truyền thẳng được.
        // `product_id` NOT NULL và với sách thì BẰNG `edition_id`.
        //
        // 0033: `inventory_ledger.edition_id` cũng nullable. Hàng hóa KHÔNG có
        // dòng `editions` nên phải để NULL — còn sách thì giữ nguyên để báo cáo
        // và royalty vẫn tra được. Cờ `is_gift_line` không đủ vì quà tặng cũng
        // có thể là sách; dùng `product_id` có trong `products` (không tốn query
        // thêm vì đã tra ở bước 2).
        editionId: ln.productId,
        // 0033: hàng hóa ghi `edition_id = NULL` vào sổ kho. `order_items` chỉ
        // giữ `product_id`; quyết định sách/hàng hóa đã có sẵn ở bước 2.
        isBook: !ln.productId.startsWith('pr-'),
        quantityDelta: -ln.quantity,
        condition: 'NEW' as const,
      })),
      {
        warehouseId: ord.warehouseId,
        eventType: 'DISPATCH_SALE',
        documentRef: ord.orderCode,
        note: `Duyệt đơn online ${ord.orderCode} (${ord.channel})`,
        actorId: resolvedActorId,
        correlationId: orderId,
        // Giữ đúng tiền tố mà nhánh idempotent ở trên dò tìm
        // (`idem-confirm-<orderId>-`), nếu không lần gọi lại sẽ tưởng đơn chưa
        // có bút toán và báo nhầm "đã COMPLETED nhưng không có bút toán".
        idempotencyPrefix: `idem-confirm-${orderId}`,
      },
      tx
    );

        // 8. Chuyển trạng thái có điều kiện: PENDING_CONFIRMATION → COMPLETED.
        // Kèm ghi chú chốt (nếu có): ô Ghi chú ở modal thanh toán mở sau khi
        // đơn đã tạo, không cập nhật ở đây thì chữ thu ngân gõ bị rớt.
        const confirmNote = `${opts?.note || ''}`.trim() || null;
        const updateRes: any = await tx.run(sql`
          UPDATE orders
          SET status = 'COMPLETED',
              note = COALESCE(NULLIF(TRIM(${confirmNote}), ''), note)
          WHERE id = ${orderId} AND status = 'PENDING_CONFIRMATION'
        `);

    if (updateRes.rowsAffected !== 1) {
      // 30/09: trước đây `throw new Error('SQLITE_BUSY: ...')`. Hai hại:
      //  1. Error thô ⇒ `handleApiError` che thành "Lỗi hệ thống, vui lòng thử lại."
      //     ⇒ thu ngân không hiểu, không biết phải làm gì.
      //  2. Chuỗi "SQLITE_BUSY" khiến `withDbRetry` tưởng là lỗi tạm thời và
      //     xoay vòng 30 lần trong 15 giây vô ích trước khi ném ra.
      // Dùng AppError.conflict: thu ngân thấy thông báo thật, không phải chờ.
      throw AppError.conflict(
        'Trạng thái đơn đã đổi (có tiến trình khác xử lý trước). Tải lại trang và kiểm tra lại.'
      );
    }

        // 9. Audit nguyên tử cùng transaction (id xác định → retry không nhân bản)
        await tx
          .insert(auditLogs)
          .values({
            id: `aud-order-confirm-${orderId}`,
            action: 'ORDER_CONFIRMED',
            actorRole,
            actorId: resolvedActorId,
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
        if (rows.length === 0) throw AppError.invalid('Không tìm thấy đơn.');
        const ord = rows[0];

        this.assertOrderActor(ord, actorRole, resolvedActorId, 'hủy');

        if (ord.status === 'CANCELLED') {
          return { orderId, status: 'CANCELLED', isIdempotent: true };
        }
        if (ord.status !== 'PENDING_CONFIRMATION') {
          throw AppError.conflict(`Đơn đang ở trạng thái ${ord.status}, không thể hủy.`);
        }

        // Đóng ca = không được xử lý đơn chờ thuộc két (đồng bộ với confirmOrder).
        // Đơn quầy KHÔNG gắn két thì vẫn hủy được: hủy không ghi doanh thu vào
        // két nào mà chỉ nhả chỗ giữ ATP — từ chối hủy sẽ kẹt vĩnh viễn đơn.
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
      // Xem giải thích ở confirmOrder: bỏ chữ "SQLITE_BUSY" để `withDbRetry`
      // khỏi xoay vòng 15 giây, và dùng AppError để thu ngân thấy thông báo thật.
      throw AppError.conflict(
        'Trạng thái đơn đã đổi trong lúc đang hủy. Tải lại trang và kiểm tra lại.'
      );
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

  /**
   * Hủy đơn COMPLETED → CANCELLED (Dành cho Quản lý / Chủ doanh nghiệp).
   *
   * Nghiệp vụ an toàn tuyệt đối:
   * 1. Phân quyền: Cấm Thu ngân; Quản lý chỉ hủy trong ca OPEN; Chủ được cưỡng chế ca CLOSED nếu có forceCloseBypass.
   * 2. Thẻ kho (Ledger): Bất biến - không xoá dòng cũ, tạo bút toán RETURN_INBOUND (+quantityDelta) hoàn trả đủ sách và quà.
   * 3. Sổ dòng tiền: Ca mở tự động loại trừ khỏi calculateSessionStats (do lọc status = 'COMPLETED').
   * 4. Kiểm toán: Ghi nhận audit_logs chi tiết.
   */
  static async voidCompletedOrder(params: {
    orderId: string;
    actorRole: string;
    actorId?: string;
    reason: string;
    forceCloseBypass?: boolean;
    actorContext?: ActorContext;
  }) {
    let { orderId, actorRole, actorId, reason, forceCloseBypass, actorContext } = params;
    if (actorContext) { actorRole = actorContext.role; }
    const resolvedActorId = actorContext?.staffId ?? actorId;

    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      throw AppError.invalid('Lý do hủy đơn bắt buộc (tối thiểu 5 ký tự).');
    }

    const isPrivileged = actorRole === 'ROLE_OWNER' || actorRole === 'ROLE_MANAGER';
    if (!isPrivileged) {
      throw AppError.forbidden('Thu ngân không có quyền hủy đơn đã hoàn tất. Vui lòng liên hệ Quản lý.');
    }

    return await withDbRetry(async () => {
      return await db.transaction(async (tx) => {
        const rows = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
        if (rows.length === 0) throw AppError.invalid('Không tìm thấy đơn.');
        const ord = rows[0];

        if (ord.status === 'CANCELLED') {
          return { orderId, orderCode: ord.orderCode, status: 'CANCELLED' as const, isIdempotent: true };
        }
        if (ord.status !== 'COMPLETED') {
          throw AppError.conflict(`Đơn đang ở trạng thái ${ord.status}, chỉ có thể hủy đơn COMPLETED.`);
        }

        let wasShiftClosed = false;
        if (ord.cashboxSessionId) {
          const sessionRows = await tx
            .select()
            .from(cashboxSessions)
            .where(eq(cashboxSessions.id, ord.cashboxSessionId))
            .limit(1);
          const cashbox = sessionRows[0];
          if (cashbox && cashbox.status === 'CLOSED') {
            wasShiftClosed = true;
            if (actorRole !== 'ROLE_OWNER') {
              throw AppError.conflict(
                'Két ca của đơn này đã đóng. Chỉ Chủ doanh nghiệp mới có quyền duyệt hủy đơn của ca đã đóng.'
              );
            }
            if (!forceCloseBypass) {
              throw AppError.conflict(
                'Két ca của đơn này đã đóng. Thao tác hủy đơn sẽ làm lệch số liệu biên bản bàn giao két. Cần xác nhận cưỡng chế để tiếp tục.'
              );
            }
          }
        }

        const lines = await tx
          .select()
          .from(orderItems)
          .where(eq(orderItems.orderId, orderId));

        // Hoàn trả thẻ kho: loại trừ quà ảo thiếu tồn (isGiftShortfall)
        const returnItems = lines
          .filter((ln) => !ln.isGiftShortfall && ln.quantity > 0)
          .map((ln) => {
            const isBook = !ln.productId.startsWith('pr-');
            return {
              editionId: ln.productId,
              isBook,
              quantityDelta: ln.quantity, // Dương: hoàn trả vào kho
              condition: 'NEW' as const,
            };
          });

        if (returnItems.length > 0) {
          await InventoryService.recordMovementsBatch(
            returnItems,
            {
              warehouseId: ord.warehouseId,
              eventType: 'RETURN_INBOUND',
              documentRef: ord.orderCode,
              note: `Hoàn kho do hủy đơn ${ord.orderCode} (lý do: ${reason.trim()})`,
              actorId: resolvedActorId,
              correlationId: orderId,
              idempotencyPrefix: `idem-void-${orderId}-`,
            },
            tx
          );
        }

        const noteUpdate = `${ord.note ? ord.note + ' | ' : ''}[HỦY ĐƠN: ${reason.trim()}]`;
        const updateRes: any = await tx.run(sql`
          UPDATE orders
          SET status = 'CANCELLED',
              note = ${noteUpdate}
          WHERE id = ${orderId} AND status = 'COMPLETED'
        `);

        if (updateRes.rowsAffected !== 1) {
          throw AppError.conflict('Trạng thái đơn đã thay đổi trong lúc đang hủy. Vui lòng tải lại trang.');
        }

        await tx
          .insert(auditLogs)
          .values({
            id: `aud-order-void-${orderId}-${Date.now()}`,
            action: 'ORDER_VOIDED',
            actorRole,
            actorId: resolvedActorId || `unattributed:${actorRole}`,
            resource: `/api/orders/${orderId}/void`,
            details: `Hủy ${ord.orderCode} (lý do: ${reason.trim()})${wasShiftClosed ? ' [CẢNH BÁO: CA ĐÃ ĐÓNG]' : ''}`,
          })
          .onConflictDoNothing({ target: auditLogs.id });

        return { orderId, orderCode: ord.orderCode, status: 'CANCELLED' as const, isIdempotent: false };
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
    // Ngày trần = NGÀY NGHIỆP VỤ VN; ISO đầy đủ = mốc UTC (xem createdAtBetween).
    conditions.push(...createdAtBetween(orders.createdAt, startDate, endDate));

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

export interface AutoCloseCashboxParams {
  sessionId: string;
  actorRole: string;
  actorId: string;
  notes?: string;
  reason?: string;
}

// ============================================================================
// CHỐT CA QUÁ GIỜ (auto-close shift) — bảo vệ "không ca nào bị bỏ quên qua ngày"
// ----------------------------------------------------------------------------
// Ràng buộc toàn vẹn: KHÔNG BAO GIỜ bịa số tiền thực đếm. closeSession tính
// cashDiscrepancy = closingCashActual - expectedCash; nếu tự động chốt bằng
// closingCashActual = expectedCash thì hệ thống khẳng định một con người đã
// đếm két — đúng thứ ta không được phép nói. Mọi chốt tự động ghi
// closingCashActual = NULL, cashDiscrepancy = NULL và đánh dấu UNVERIFIED.
// ============================================================================

/** Giờ chốt ngày (múi giờ máy chủ) mặc định: 23:59. */
export const BUSINESS_DAY_CUTOFF_HHMM = '23:59';

const CUTOFF_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseCutoff(raw: unknown): { h: number; m: number } | null {
  if (typeof raw !== 'string') return null;
  const m = CUTOFF_RE.exec(raw.trim());
  return m ? { h: Number(m[1]), m: Number(m[2]) } : null;
}

/**
 * Ngưỡng chốt ca cho một kho.
 *
 * FALLBACK ĐÃ GHI RÕ: bảng `warehouses` KHÔNG có cột giờ mở/đóng nên không thể
 * đọc ngưỡng riêng từ dữ liệu kho mà không thêm migration. Nguồn duy nhất cho
 * ngưỡng riêng từng kho (không đụng schema) là biến môi trường
 * CASHBOX_CUTOFF_BY_WAREHOUSE='{"<warehouseId>":"HH:MM"}'; sau đó tới
 * CASHBOX_BUSINESS_DAY_CUTOFF cho toàn hệ thống; cuối cùng lùi về hằng số
 * BUSINESS_DAY_CUTOFF_HHMM (23:59).
 */
export function resolveBusinessDayCutoff(
  warehouseId?: string | null,
  override?: string | null
): { cutoff: string; source: 'OVERRIDE' | 'WAREHOUSE_ENV' | 'GLOBAL_ENV' | 'DEFAULT' } {
  const asOverride = parseCutoff(override);
  if (asOverride) return { cutoff: `${pad2(asOverride.h)}:${pad2(asOverride.m)}`, source: 'OVERRIDE' };

  if (warehouseId) {
    let map: Record<string, string> = {};
    try {
      map = JSON.parse(process.env.CASHBOX_CUTOFF_BY_WAREHOUSE || '{}') || {};
    } catch {
      map = {};
    }
    const perWarehouse = parseCutoff(map[warehouseId]);
    if (perWarehouse) return { cutoff: `${pad2(perWarehouse.h)}:${pad2(perWarehouse.m)}`, source: 'WAREHOUSE_ENV' };
  }

  const global = parseCutoff(process.env.CASHBOX_BUSINESS_DAY_CUTOFF);
  if (global) return { cutoff: `${pad2(global.h)}:${pad2(global.m)}`, source: 'GLOBAL_ENV' };

  return { cutoff: BUSINESS_DAY_CUTOFF_HHMM, source: 'DEFAULT' };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Ngày nghiệp vụ (YYYY-MM-DD) theo GIỜ VIỆT NAM — KHÔNG theo múi giờ máy chủ.
 *
 * Trước đây dùng `getFullYear/getMonth/getDate()` tức múi giờ của máy đang chạy.
 * Đó là lỗi thật: Cloudflare Workers luôn chạy UTC còn máy dev là GMT+7, nên
 * CÙNG một đoạn code trả về ngày khác nhau giữa production và máy dev — trong
 * khung 00:00-07:00 giờ VN. Ngày nghiệp vụ là khái niệm kế toán của Việt Nam, phải
 * cố định theo múi giờ Việt Nam ở mọi môi trường.
 *
 * `en-CA` cho ra đúng định dạng YYYY-MM-DD. Cùng cách với `vnToday()` ở
 * GET /api/pos/live-monitor và hàm `d(back)` ở cron auto-close — ba nơi này giờ
 * cùng một định nghĩa.
 */
export const VN_TZ = 'Asia/Ho_Chi_Minh';

/** Lệch giờ của Việt Nam so với UTC. Cố định +7, không có DST. */
export const VN_UTC_OFFSET_MIN = 7 * 60;

/** Ký tự base36: 0-9 rồi A-Z. Số thứ tự đơn trong ngày viết bằng hệ này. */

/**
 * Số nguyên → chuỗi base36 đệm `width` ký tự.
 *
 * Nhờ base36, số thứ tự tự động "tràn" sang chữ cái: 9999 = `23P`, 10000 = `23Q`.
 * Nên KHÔNG cần nhánh xử lý riêng cho giới hạn 9999 — 36^4 = 1.679.616 đơn/ngày.
 */

export function businessDateOf(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: VN_TZ }).format(instant);
}

const BARE_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Điều kiện lọc `created_at` theo khoảng ngày, hiểu đúng ngày nghiệp vụ Việt Nam.
 *
 * `created_at` luôn là UTC, còn mọi nút "HÔM NAY / 7 NGÀY / 30 NGÀY" người dùng
 * bấm đều nghĩa là ngày VIỆT NAM. Trước đây caller gửi `toISOString().slice(0,10)`
 * — tức NGÀY UTC — rồi ta so chuỗi thô. Hậu quả: báo cáo hôm nay thiếu trọn
 * ca 00:00–07:00 và lại nuốt đơn 17:00–24:00 của hôm qua. Người dùng đối chiếu
 * sổ với két thì lệch, và không có màn hình nào chỉ ra lệch ở đâu.
 *
 * Phân biệt hai quy ước đang lẫn lộn trong codebase bằng DẠNG của tham số:
 *   · 'YYYY-MM-DD' trần  = NGÀY NGHIỆP VỤ → so ngày VN của `created_at`,
 *     bao trọn cả ngày, không lệch 7 tiếng, và không lỗ với việc cột lưu
 *     hai họ timestamp (SQLite CURRENT_TIMESTAMP 'YYYY-MM-DD HH:mm:ss' và ISO
 *     'YYYY-MM-DDTHH:mm:ssZ' mà app ghi) — vì `datetime()` nhận được cả hai.
 *   · chuỗi dài hơn (ISO đầy đủ) = MỐC THỜI GIAN UTC → so thô như trước, giữ
 *     nguyên hành vi cho `TopEditionsPanel` và `executive-query` vốn truyền
 *     `toISOString()`.
 */
export function createdAtBetween(
  col: any,
  startDate?: string | null,
  endDate?: string | null
) {
  const conds = [];
  // Ngày trần YYYY-MM-DD = NGÀY NGHIỆP VỤ VIỆT NAM: so ngày của `col` đã cộng +7.
  if (startDate) {
    conds.push(
      BARE_DAY.test(startDate)
        ? sql`substr(datetime(${col}, '+7 hours'), 1, 10) >= ${startDate}`
        // Mốc ISO đầy đủ = MỐC UTC, nên phải so giá trị THỜI GIAN chứ không so
        // chuỗi. Cột `text` trong CSDL đang chứa song song hai họ: SQLite
        // CURRENT_TIMESTAMP ('YYYY-MM-DD HH:mm:ss') và ISO của app ('...THH:mm...Z').
        // 'T' (0x54) > ' ' (0x20) nên `gte(col, iso)` coi MỌI dòng SQLite trong
        // kỳ là "lớn hơn" mốc ⇒ lọc sai. `datetime()` chuẩn hoá được cả hai họ.
        : sql`datetime(${col}) >= datetime(${startDate})`
    );
  }
  if (endDate) {
    conds.push(
      BARE_DAY.test(endDate)
        ? sql`substr(datetime(${col}, '+7 hours'), 1, 10) <= ${endDate}`
        : sql`datetime(${col}) <= datetime(${endDate})`
    );
  }
  return conds;
}

/**
 * Dựng thời điểm từ GIỜ VIỆT NAM (ngày nghiệp vụ + giờ cắt chốt).
 *
 * `new Date(y, mo-1, d, h, m)` dùng múi giờ của máy chủ, nên trên Cloudflare
 * (UTC) mốc 23:59 thành 23:59 UTC = 06:59 VN hôm sau ⇒ ngày bị coi là quá hạn
 * sớm 7 tiếng. Dựng thẳng từ số giây UTC rồi trừ 7 giờ cho nhất quán.
 */
export function cutoffInstantOf(businessDate: string, cutoff: string): Date {
  const [y, mo, d] = businessDate.split('-').map(Number);
  const p = parseCutoff(cutoff)!;
  return new Date(
    Date.UTC(y, mo - 1, d, p.h, p.m, 0, 0) - VN_UTC_OFFSET_MIN * 60_000
  );
}

/**
 * Đồng hồ dùng cho kiểm tra chốt ca. CASHBOX_TEST_NOW chỉ dùng cho test tự
 * động (đồng hồ thật ở mọi lần chạy thật) — để case "quá giờ" không phụ thuộc
 * giờ thật lúc chạy suite.
 */
function businessDayNow(): Date {
  const override = process.env.CASHBOX_TEST_NOW;
  const d = override ? new Date(override) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export interface ShiftCutoffEvaluation {
  businessDate: string;
  cutoff: string;
  cutoffSource: 'OVERRIDE' | 'WAREHOUSE_ENV' | 'GLOBAL_ENV' | 'DEFAULT';
  cutoffAt: string;
  openedAt: string;
  /** false = opened_at hỏng/không đọc được → KHÔNG chặn bán (không đoán bừa). */
  openedAtValid: boolean;
  elapsedMinutes: number;
  overdue: boolean;
}

/**
 * Ca quá giờ khi ĐÃ QUA mốc chốt ngày của chính ngày nghiệp vụ mà ca mở.
 * Nhờ vậy ca mở SAU NỬA ĐÊM (bán đêm, mở 00:10) thuộc ngày mới nên chưa quá
 * giờ — ca đêm hợp lệ không bị chặn.
 *
 * opened_at phải đi qua parseDbTimestamp: SQLite CURRENT_TIMESTAMP ghi UTC
 * không kèm múi giờ, đọc bằng `new Date()` sẽ lệch +7 tiếng ở GMT+7 và chặn
 * nhầm ngay ca vừa mở.
 */
export function evaluateShiftCutoff(
  openedAt: string | Date | null | undefined,
  opts: { warehouseId?: string | null; now?: Date; cutoff?: string | null } = {}
): ShiftCutoffEvaluation {
  const now = opts.now || businessDayNow();
  const { cutoff, source } = resolveBusinessDayCutoff(opts.warehouseId, opts.cutoff);
  const opened = openedAt instanceof Date ? openedAt : parseDbTimestamp(openedAt);

  if (opened === null) {
    // opened_at hỏng (dữ liệu cũ/sửa tay): KHÔNG chặn bán — một chốt chặn sai
    // chặn cả POS. Đồng thời cờ openedAtValid=false để báo cáo/cảnh báo thấy.
    const today = businessDateOf(now);
    return {
      businessDate: today,
      cutoff,
      cutoffSource: source,
      cutoffAt: cutoffInstantOf(today, cutoff).toISOString(),
      openedAt: '',
      openedAtValid: false,
      elapsedMinutes: 0,
      overdue: false,
    };
  }

  const businessDate = businessDateOf(opened);
  const cutoffAt = cutoffInstantOf(businessDate, cutoff);
  const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - opened.getTime()) / 60_000));
  return {
    businessDate,
    cutoff,
    cutoffSource: source,
    cutoffAt: cutoffAt.toISOString(),
    openedAt: opened.toISOString(),
    openedAtValid: true,
    elapsedMinutes,
    overdue: now.getTime() > cutoffAt.getTime(),
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
    // CHỈ tính hoàn của đơn gốc trả bằng TIỀN MẶT: hoàn chuyển khoản/QR đối soát
    // ngân hàng riêng, tiền đó chưa từng nằm trong két nên trừ vào két là BỎA
    // thêm một khoản tiền mặt. `return_orders.cashbox_session_id` do CLIENT gửi
    // và `createRequest` (return.service.ts:315) ghi thẳng, kể cả khi đơn gốc
    // trả bằng chuyển khoản — nên phải lọc theo `orders.payment_method` thật.
    const refunds = await txOrDb
      .select({ refundAmount: returnOrders.refundAmount })
      .from(returnOrders)
      .innerJoin(orders, eq(returnOrders.orderId, orders.id))
      .where(
        and(
          eq(returnOrders.cashboxSessionId, sessionId),
          eq(returnOrders.status, 'COMPLETED'),
          eq(orders.paymentMethod, 'CASH')
        )
      );
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
   * KIỂM TRA CHỐT CA QUÁ GIỜ (read-only).
   *
   * Rẻ + idempotent + KHÔNG ghi gì: một câu đọc theo index status của
   * cashbox_sessions, rồi chỉ tính thống kê ca cho các ca thực sự quá giờ
   * (thường 0-1 ca/kho/ngày). Nhờ vậy POS gọi được mỗi lần mở app.
   */
  static async getStaleOpenShiftCheck(
    params: {
      warehouseId?: string | null;
      cashierId?: string | null;
      now?: Date;
      cutoff?: string | null;
    } = {},
    txOrDb: any = db
  ) {
    const now = params.now || businessDayNow();
    const conditions = [eq(cashboxSessions.status, 'OPEN')];
    if (params.warehouseId) conditions.push(eq(cashboxSessions.warehouseId, params.warehouseId));
    if (params.cashierId) conditions.push(eq(cashboxSessions.cashierId, params.cashierId));

    const openSessions = await txOrDb
      .select()
      .from(cashboxSessions)
      .where(and(...conditions));

    const shifts: any[] = [];
    for (const s of openSessions) {
      const evaluation = evaluateShiftCutoff(s.openedAt, {
        warehouseId: s.warehouseId,
        now,
        cutoff: params.cutoff,
      });
      if (!evaluation.overdue) continue;

      const stats = await this.calculateSessionStats(s.id, txOrDb);
      const amountNeedingClosure = (s.openingCash || 0) + stats.totalCashSales;
      const wh = await txOrDb
        .select({ code: warehouses.code, name: warehouses.name })
        .from(warehouses)
        .where(eq(warehouses.id, s.warehouseId))
        .limit(1);
      shifts.push({
        sessionId: s.id,
        warehouseId: s.warehouseId,
        warehouseCode: wh[0]?.code || null,
        warehouseName: wh[0]?.name || null,
        cashierId: s.cashierId,
        // openedAt = ISO chuẩn có Z (mọi client parse đúng); openedAtRaw = giá trị
        // nguyên trong DB để đối chiếu. TUYỆT ĐỐI không đưa thẳng chuỗi DB ra
        // API cho client tự parse — đó là chính là lỗi múi giờ này.
        openedAt: evaluation.openedAt,
        openedAtRaw: s.openedAt,
        businessDate: evaluation.businessDate,
        cutoff: evaluation.cutoff,
        cutoffAt: evaluation.cutoffAt,
        elapsedMinutes: evaluation.elapsedMinutes,
        amountNeedingClosure,
        expectedCash: amountNeedingClosure,
        action: 'CLOSE_SHIFT' as const,
        actionBy: 'CASHIER' as const,
        autoCloseAction: 'AUTO_CLOSE' as const,
        autoCloseActionBy: 'MANAGER' as const,
        message:
          `Ca két ${s.id} của thu ngân ${s.cashierId} tại kho ${s.warehouseId} mở từ ${evaluation.openedAt} ` +
          `đã quá giờ chốt ngày (${evaluation.cutoff} ngày ${evaluation.businessDate}). ` +
          `Thu ngân cần đếm tiền thực tế và chốt ca. Nếu không thể, quản lý chốt tự động: ` +
          `tiền mặt sẽ KHÔNG được đếm nên chênh lệch KHÔNG xác minh.`,
      });
    }

    const resolvedCutoff = resolveBusinessDayCutoff(params.warehouseId, params.cutoff);
    return {
      serverTime: now.toISOString(),
      cutoff: resolvedCutoff.cutoff,
      cutoffSource: resolvedCutoff.source,
      count: shifts.length,
      salesBlocked: shifts.length > 0,
      shifts,
    };
  }

  /**
   * CHỐT CA TỰ ĐỘNG — chỉ gọi được bởi quản lý.
   *
   * KHÔNG bịa tiền thực đếm: closingCashActual = NULL, cashDiscrepancy = NULL,
   * discrepancyVerified = false. Audit riêng (AUTO_CLOSE_SHIFT, actor SYSTEM)
   * nên không bao giờ nhập nhầm với chốt tay của con người.
   */
  static async autoCloseSession(params: AutoCloseCashboxParams, txOrDb?: any) {
    if (txOrDb) return withDbRetry(() => this.applyAutoClose(txOrDb, params));
    return withDbRetry(() => db.transaction((tx) => this.applyAutoClose(tx, params)));
  }

  private static async applyAutoClose(tx: any, params: AutoCloseCashboxParams) {
    const { sessionId, notes, reason } = params;
    const AUDIT_ID = `aud-cashbox-auto-close-${sessionId}`;
    const AUTO_NOTE = 'AUTO_CLOSE_UNVERIFIED_CASH';

    return (async () => {
      const existing = await tx
        .select()
        .from(cashboxSessions)
        .where(eq(cashboxSessions.id, sessionId))
        .limit(1);
      if (existing.length === 0) {
        throw AppError.invalid(`Không tìm thấy phiên két tiền: ${sessionId}`);
      }
      const session = existing[0];

      // Đã chốt tự động trước đó → replay, không ghi thêm.
      if (session.status === 'CLOSED') {
        const priorAudit = await tx
          .select({ id: auditLogs.id })
          .from(auditLogs)
          .where(eq(auditLogs.id, AUDIT_ID))
          .limit(1);
        if (priorAudit.length === 0) {
          throw AppError.conflict('Phiên két tiền đã được chốt tay bởi con người, không thể chốt tự động ghi đè.');
        }
        return {
          sessionId,
          cashierId: session.cashierId,
          warehouseId: session.warehouseId,
          openingCash: session.openingCash,
          closingCashActual: null,
          expectedCash: session.expectedCash ?? 0,
          cashDiscrepancy: null,
          discrepancyVerified: false,
          totalCashSales: session.totalCashSales ?? 0,
          totalTransferSales: session.totalTransferSales ?? 0,
          totalOrdersCount: session.totalOrdersCount ?? 0,
          openedAt: session.openedAt,
          closedAt: session.closedAt,
          status: 'CLOSED' as const,
          closeType: 'AUTO' as const,
          isIdempotent: true,
        };
      }

      // Giữ nguyên guard của chốt tay: còn đơn chờ THÌ CÒN HẠN thì không đụng
      // (không bỏ rơi đơn). P2 SỬA 2026-09-29: trước đây chặn mọi dòng
      // PENDING kể cả đã hết hạn ⇒ ca treo vô hạn, rồi chặn luôn cả
      // closeDay (deadlock 2 bước trong cron).
      const pending = await tx
        .select({
          id: orders.id,
          createdAt: orders.createdAt,
          paymentExpiresAt: orders.paymentExpiresAt,
        })
        .from(orders)
        .where(
          and(
            eq(orders.cashboxSessionId, sessionId),
            eq(orders.status, 'PENDING_CONFIRMATION')
          )
        );
      const livePending = pending.filter((o: any) => !OrderService.isPendingExpired(o));
      if (livePending.length > 0) {
        throw AppError.conflict('Còn đơn chuyển khoản/QR đang chờ. Hãy xác nhận hoặc hủy trước khi chốt ca.');
      }

      const stats = await this.calculateSessionStats(sessionId, tx);
      const expectedCash = session.openingCash + stats.totalCashSales;
      const closedAt = new Date().toISOString();
      const noteText = [
        AUTO_NOTE,
        reason ? `Lý do: ${reason}` : null,
        notes || null,
      ]
        .filter(Boolean)
        .join(' | ');

      const updateResult = await tx
        .update(cashboxSessions)
        .set({
          closingCashActual: null, // KHÔNG có số đếm — KHÔNG được bịa
          expectedCash,
          cashDiscrepancy: null, // lệch chưa kiểm chứng
          totalCashSales: stats.totalCashSales,
          totalTransferSales: stats.totalTransferSales,
          totalOrdersCount: stats.totalOrdersCount,
          status: 'CLOSED',
          notes: session.notes ? `${session.notes} | ${noteText}` : noteText,
          closedAt,
        })
        .where(and(eq(cashboxSessions.id, sessionId), eq(cashboxSessions.status, 'OPEN')));
      if (updateResult.rowsAffected !== 1) {
        throw AppError.conflict('Phiên két tiền đã được đóng bởi thao tác khác.');
      }

      await tx
        .insert(auditLogs)
        .values({
          id: AUDIT_ID,
          action: 'AUTO_CLOSE_SHIFT',
          actorRole: 'SYSTEM',
          actorId: 'SYSTEM',
          resource: '/api/cashbox',
          details:
            `HỆ THỐNG chốt ca két tự động ${sessionId} (thủ phát: ${params.actorRole} ${params.actorId}). ` +
            `KHÔNG đếm tiền mặt (closingCashActual = NULL) nên chênh lệch KHÔNG xác minh. ` +
            `Kỳ vọng hệ thống: ${expectedCash} đ.`.slice(0, 500),
          ipAddress: 'local',
        })
        .onConflictDoNothing({ target: auditLogs.id });

      return {
        sessionId,
        cashierId: session.cashierId,
        warehouseId: session.warehouseId,
        openingCash: session.openingCash,
        closingCashActual: null,
        expectedCash,
        cashDiscrepancy: null,
        discrepancyVerified: false,
        totalCashSales: stats.totalCashSales,
        totalTransferSales: stats.totalTransferSales,
        totalOrdersCount: stats.totalOrdersCount,
        openedAt: session.openedAt,
        closedAt,
        status: 'CLOSED' as const,
        closeType: 'AUTO' as const,
        isIdempotent: false,
      };
    })();
  }

  /**
   * CẬP NHẬT SỐ TIỀN THỰC ĐẾM (POST-AUDIT) — Chỉ Quản lý/Chủ cửa hàng.
   * Dùng khi ca bị tự động chốt (closingCashActual = null) hoặc cần đối soát
   * lại số tiền thực tế trong két sau khi đã đóng ca.
   */
  static async auditClosingCash(
    params: {
      sessionId: string;
      closingCashActual: number;
      notes?: string;
      actorRole: string;
      actorId: string;
    },
    txOrDb?: any
  ) {
    if (txOrDb) return withDbRetry(() => this.applyAuditClosingCash(txOrDb, params));
    return withDbRetry(() => db.transaction((tx) => this.applyAuditClosingCash(tx, params)));
  }

  private static async applyAuditClosingCash(
    tx: any,
    params: {
      sessionId: string;
      closingCashActual: number;
      notes?: string;
      actorRole: string;
      actorId: string;
    }
  ) {
    const { sessionId, closingCashActual, notes, actorRole, actorId } = params;
    if (actorRole !== 'ROLE_OWNER' && actorRole !== 'ROLE_MANAGER') {
      throw AppError.forbidden('Chỉ Quản lý hoặc Chủ cửa hàng mới được cập nhật tiền thực đếm sau khi chốt ca.');
    }
    if (!sessionId) {
      throw AppError.invalid('Thiếu mã phiên két tiền (sessionId).');
    }
    if (typeof closingCashActual !== 'number' || !Number.isFinite(closingCashActual) || closingCashActual < 0) {
      throw AppError.invalid('Số tiền thực đếm không hợp lệ.');
    }

    const rows = await tx
      .select()
      .from(cashboxSessions)
      .where(eq(cashboxSessions.id, sessionId))
      .limit(1);

    if (rows.length === 0) {
      throw AppError.invalid(`Không tìm thấy phiên két tiền: ${sessionId}`);
    }

    const session = rows[0];
    if (session.status !== 'CLOSED') {
      throw AppError.invalid(`Phiên két tiền đang mở (${session.status}), vui lòng chốt ca trước khi nhập bổ sung.`);
    }

    const expectedCash = session.expectedCash ?? (session.openingCash + (session.totalCashSales ?? 0));
    const cashDiscrepancy = closingCashActual - expectedCash;
    const auditTag = `AUDIT_COUNT: ${closingCashActual.toLocaleString('vi-VN')} đ (bởi ${actorRole} ${actorId}${notes ? `: ${notes}` : ''})`;
    const updatedNotes = session.notes ? `${session.notes} | ${auditTag}` : auditTag;

    await tx
      .update(cashboxSessions)
      .set({
        closingCashActual,
        cashDiscrepancy,
        notes: updatedNotes,
      })
      .where(eq(cashboxSessions.id, sessionId));

    const AUDIT_ID = `aud-cashbox-audit-count-${sessionId}-${Date.now()}`;
    await tx
      .insert(auditLogs)
      .values({
        id: AUDIT_ID,
        action: 'AUDIT_CASHBOX_COUNT',
        actorRole,
        actorId,
        resource: '/api/cashbox',
        details: `Cập nhật số tiền thực đếm sau khi chốt ca ${sessionId}: ${closingCashActual.toLocaleString('vi-VN')} đ (kỳ vọng ${expectedCash.toLocaleString('vi-VN')} đ, lệch ${cashDiscrepancy.toLocaleString('vi-VN')} đ).`.slice(0, 500),
        ipAddress: 'local',
      });

    return {
      sessionId,
      cashierId: session.cashierId,
      warehouseId: session.warehouseId,
      openingCash: session.openingCash,
      closingCashActual,
      expectedCash,
      cashDiscrepancy,
      status: session.status,
    };
  }

  /**
   * Chặn bán tại quầy khi ca của thu ngân đã quá giờ chốt ngày.
   * Hàm thuần: không đọc DB (dùng session row đã tải sẵn) để không làm nặng
   * đường nóng tạo đơn.
   */
  static assertShiftWithinBusinessDay(params: {
    openedAt: string;
    warehouseId: string;
    cashierId: string;
    now?: Date;
    cutoff?: string | null;
  }) {
    const evaluation = evaluateShiftCutoff(params.openedAt, {
      warehouseId: params.warehouseId,
      now: params.now,
      cutoff: params.cutoff,
    });
    if (!evaluation.overdue) return evaluation;
    throw AppError.conflict(
      `Đã quá giờ chốt ngày ${evaluation.cutoff} ngày ${evaluation.businessDate}: ca két của thu ngân ` +
        `${params.cashierId} tại kho ${params.warehouseId} vẫn chưa chốt, POS tạm ngưng tạo đơn cho ca này. ` +
        `Vui lòng đếm tiền thực tế trong két và chốt ca (Đóng ca) trước khi bán tiếp.`
    );
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


