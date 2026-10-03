import { db, discountApprovalRequests, editions, products, warehouses } from '../db';
import { and, desc, eq, gt, inArray, lte, or, sql } from 'drizzle-orm';
import { AppError } from './app-error';
import { hashString } from '../lib/export-hash';
import { priceLine } from '../lib/pricing';
import { allocateOrderCode } from './order-code';
// `vnDayFmt` chứ không phải `businessDateOf` từ `./order.service`: order.service đã
// import file này, lấy từ đó sẽ thành vòng import chỉ nổ lúc chạy thật.
import { vnDayFmt } from '../lib/vn-time';

export interface CartItemInput {
  editionId: string;
  quantity: number;
  unitPrice: number;
  // P1a: mức giảm từng dòng tham gia hash (fallback = mức tổng đơn).
  // Không bind là lọt gian lận: giữ nguyên tổng đã duyệt, gắn 90% vào 1 dòng.
  unitDiscountRate?: number;
  // 0031: dòng QUÀ của chương trình mốc tiền (giá bán 0đ).
  isGiftLine?: boolean;
  // 0031: quà thu ngân TỰ thêm — cần Quản lý duyệt, nên vẫn là phần của
  // phê duyệt (khác quà tự động, xem `isAutoGiftLine`).
  isManual?: boolean;
}

/**
 * Dòng quà TỰ ĐỘNG (`is_gift_line = 1` và `is_manual = 0`): chương trình tự thêm
 * khi đơn đạt mốc tiền. Ngoài phạm vi phê duyệt chiết khấu — không ai duyệt món
 * quà, và nó không phải tiền khách trả — nên nó bị loại khỏi `cartHash` và khỏi
 * phép so tổng tiền. Nếu không, mọi đơn "vừa có quà vừa cần duyệt chiết khấu" chết
 * 409 vì hash lệch đúng bằng giá món quà.
 *
 * Quà TAY (`is_manual = 1`) thì ngược lại và PHẢI nằm lại trong hash + tổng
 * tiền: nó là thứ cần người duyệt. Loại nó ra là biến "thêm quà tay sau khi duyệt"
 * thành một đường lách duyệt không cần đụng DB.
 */
export function isAutoGiftLine(item: {
  isGiftLine?: boolean;
  isManual?: boolean;
}): boolean {
  return item?.isGiftLine === true && item?.isManual !== true;
}

/**
 * Giá bìa (trước chiết khấu) của các dòng quà tự động trong `items` — đúng số
 * tiền bị loại khỏi tổng. Dùng `priceLine` (nguồn sự thật chung) để lệch bao
 * nhiêu cũng không vượt sai số làm tròn.
 */
function autoGiftSubtotal(items: CartItemInput[], fallbackRate: number): number {
  return items.filter(isAutoGiftLine).reduce((sum, i) => {
    const lineRate = Number.isFinite(i.unitDiscountRate as number)
      ? (i.unitDiscountRate as number)
      : fallbackRate;
    return sum + priceLine(i.unitPrice, lineRate, i.quantity).subtotal;
  }, 0);
}

export interface ActorContext {
  staffId: string;
  role: string;
  fullName?: string;
}

function assertTransitionApplied(result: any, message: string) {
  if (result?.rowsAffected !== 1) {
    throw AppError.conflict(message);
  }
}

/**
 * Secret ký QR-JWT duyệt chiết khấu. Fail-closed trên production/strict
 * (đồng chuẩn getAuthSecret): thiếu AUTH_SECRET là từ chối thay vì dùng
 * secret cứng mặc định — kẻ biết default không thể giả mạo QR duyệt giảm giá.
 */
function getDiscountSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (s) return s;
  if (process.env.AUTH_STRICT === 'true' || process.env.NODE_ENV === 'production') {
    throw new Error('BẮT BUỘC cấu hình AUTH_SECRET trên production (ký QR duyệt chiết khấu).');
  }
  return 'formapubli-pos-discount-hmac-secret-2026';
}

// Edge-safe base64url (không Buffer): Web API thuần, chạy Node/edge/workerd.
function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as number[]);
  }
  return btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlEncode(data: string): string {
  return bytesToBase64Url(new TextEncoder().encode(data));
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** HMAC-SHA256 qua WebCrypto (edge-safe) — định dạng base64url giữ nguyên. */
async function hmacBase64Url(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return bytesToBase64Url(sig);
}

/** So sánh hằng thời gian (timing-safe) thuần TS — thay crypto.timingSafeEqual. */
function constTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Hex ngẫu nhiên edge-safe — thay crypto.randomBytes(n).toString('hex'). */
function randomHex(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Sinh mã băm SHA-256 giỏ hàng chuẩn hóa theo V4.1 §4.1 + P1a:
 * - Sắp xếp ấn bản theo editionId tăng dần (deterministic)
 * - Ép giá và discountRate về số nguyên VND
 * - Khóa chặt theo warehouseId + orderCode để tránh đụng độ giữa các quầy/kho
 * - P1a: token mỗi dòng gồm cả mức giảm dòng (fallback = mức tổng) —
 *   không bind là lọt gian lận line-discount sau duyệt.
 * - 0031: dòng quà TỰ ĐỘNG bị loại (xem `isAutoGiftLine`) — nó ngoài phạm vi
 *   phê duyệt, nên có trong giỏ lúc chốt hay không cũng không được làm lệch
 *   phê duyệt. Quà tay vẫn băm bình thường.
 */
export function generateCanonicalCartHash(
  items: CartItemInput[],
  discountRate: number,
  warehouseId: string,
  orderCode: string
): string {
  const sorted = items.filter((i) => !isAutoGiftLine(i)).sort((a, b) =>
    a.editionId.localeCompare(b.editionId)
  );
  const orderRateBp = Math.round(discountRate * 10000);
  const tokens = sorted.map((i) => {
    const lineRate = Number.isFinite(i.unitDiscountRate as number)
      ? (i.unitDiscountRate as number)
      : discountRate;
    return `${i.editionId}:${i.quantity}:${Math.round(i.unitPrice)}:${Math.round(lineRate * 10000)}`;
  });
  tokens.push(
    `wh:${warehouseId}`,
    `ord:${orderCode}`,
    `rate:${orderRateBp}`
  );
  return hashString(tokens.join('|'));
}

/**
 * Rút gọn đuôi 4 số của mã đơn (ShortCode) để thu ngân đọc to cho quản lý duyệt nhanh.
 */
export function extractShortCode(orderCode: string): string {
  const clean = orderCode.replace(/[^a-zA-Z0-9]/g, '');
  return clean.length >= 4 ? clean.slice(-4).toUpperCase() : clean.toUpperCase();
}

/**
 * Sinh mã QR-JWT có chữ ký HMAC-SHA256 theo V4.1 §4.2:
 * Payload: { reqId, nonce, cartHash, orderCode, warehouseId, rate, exp }
 */
export async function signQrJwt(payload: Record<string, any>): Promise<string> {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmacBase64Url(`${header}.${body}`, getDiscountSecret());
  return `${header}.${body}.${signature}`;
}

export async function verifyQrJwt(token: string): Promise<Record<string, any>> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw AppError.invalid('Mã QR không hợp lệ (sai định dạng JWT)');
  }
  const [header, body, signature] = parts;
  const expectedSignature = await hmacBase64Url(`${header}.${body}`, getDiscountSecret());
  if (!constTimeEqual(signature, expectedSignature)) {
    throw AppError.invalid('Chữ ký mã QR không chính xác hoặc đã bị can thiệp');
  }

  const payload = JSON.parse(base64UrlDecode(body));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw AppError.conflict('Mã QR đã hết hạn');
  }
  return payload;
}

export class DiscountApprovalService {
  /**
   * Thu ngân tạo yêu cầu duyệt chiết khấu đặc biệt (chiết khấu > 20% hoặc chính sách quầy).
   *
   * `orderCode` ở đây là MÃ PHIẾU TẠM do máy thu ngân sinh, KHÔNG phải mã đơn thật.
   * Nó chỉ làm khoá nhận diện "phiên giỏ hàng này" để bấm nút hai lần không sinh hai
   * yêu cầu. MÃ ĐƠN THẬT do server cấp (`allocateOrderCode`) và đó mới là giá trị
   * ghi vào `order_code` và trả về cho client — xem `clientOrderCode` ở schema.
   */
  static async createRequest(params: {
    /** Mã phiếu tạm của máy thu ngân (khoá nhận diện phiên), KHÔNG phải mã đơn. */
    orderCode: string;
    warehouseId: string;
    cashierId: string;
    items: CartItemInput[];
    requestedDiscountRate: number;
    actorContext: ActorContext;
    txOrDb?: any;
  }): Promise<any> {
    if (!params.txOrDb) {
      return db.transaction((tx) => this.createRequest({ ...params, txOrDb: tx }));
    }
    const {
      // `orderCode` của caller là MÃ PHIẾU TẠM (sinh ở máy thu ngân). Đặt tên lại
      // ngay ở đây để không lẫn với mã đơn thật do server cấp bên dưới.
      orderCode: clientOrderCode,
      warehouseId,
      cashierId,
      items,
      requestedDiscountRate,
      txOrDb = db,
    } = params;

    if (!items || items.length === 0) {
      throw AppError.invalid('Giỏ hàng không được để trống khi xin duyệt chiết khấu');
    }
    // Quà TAY đi kèm đơn không chiết khấu: cho phép rate = 0, nhưng BẮT BUỘC
    // phải có ít nhất 1 dòng quà tay — nếu không rate 0 nghĩa là "không xin
    // gì cả" và yêu cầu duyệt là dòng rác không ai dọn.
    const hasManualGift = items.some((i) => i?.isManual === true && i?.isGiftLine === true);
    if (requestedDiscountRate < 0 || requestedDiscountRate > 1.0 || (!hasManualGift && requestedDiscountRate <= 0)) {
      throw AppError.invalid('Tỷ lệ chiết khấu yêu cầu không hợp lệ (phải từ > 0% đến 100%)');
    }

    // A1-H: chuẩn hóa giá bìa từ DB (bỏ qua unitPrice client gửi — client có
    // thể khai sai để lừa số tiền duyệt). Tra từ `products` (tầng gốc), KHÔNG
    // phải `editions`: hàng hóa không có dòng editions nên tra đó là chết ngay
    // với "Ấn bản không tồn tại" — đúng lỗi đã tốn một đêm ở order.service.
    // Sách có `products.id === editions.id` và trigger giữ giá khớp nên kết
    // quả y hệt. Hash + số tiền duyệt tính trên giá chuẩn này; route checkout
    // recompute y hệt để khớp.
    const editionIds = Array.from(new Set(items.map((i) => `${i.editionId || ''}`.trim()).filter(Boolean)));
    if (editionIds.length === 0) {
      throw AppError.invalid('Giỏ hàng thiếu mã ấn bản hợp lệ.');
    }
    const editionRows = await txOrDb
      .select({ id: products.id, coverPrice: products.sellingPrice })
      .from(products)
      .where(inArray(products.id, editionIds));
    const editionPriceMap = new Map<string, number>(
      editionRows.map((edition: { id: string; coverPrice: number }) => [edition.id, Number(edition.coverPrice)])
    );
    const missing = editionIds.filter((id) => !editionPriceMap.has(id));
    if (missing.length > 0) {
      throw AppError.invalid(`Ấn bản không tồn tại trong danh mục: ${missing.slice(0, 3).join(', ')}`);
    }
    const canonicalItems = items.map((item) => {
      const lineRate = item.unitDiscountRate ?? requestedDiscountRate;
      if (!Number.isFinite(lineRate) || lineRate < 0 || lineRate > 1) {
        throw AppError.invalid(`Mức giảm dòng ${item.editionId} phải nằm trong khoảng 0 - 100%.`);
      }
      // Quà tay là TẶNG MIỄN PHÍ, không phải "giảm một phần": bắt buộc rate 1.
      // Nếu cho rate lẻ (vd 10%), số tiền duyệt và số tiền đơn (server ép quà
      // đã duyệt về 0đ) lệch nhau ⇒ mọi đơn quà tay chết 409 ở consumeApproval
      // mà không ai hiểu vì sao.
      if (item.isManual === true && item.isGiftLine === true && lineRate !== 1) {
        throw AppError.invalid(`Dòng quà tặng thêm ${item.editionId} phải miễn phí 100% (không giảm một phần).`);
      }
      return {
        editionId: `${item.editionId}`.trim(),
        quantity: Math.floor(Number(item.quantity) || 0),
        unitPrice: editionPriceMap.get(`${item.editionId}`.trim()) || 0,
        unitDiscountRate: lineRate,
        // Giữ cờ dòng quà: hash và tổng tiền phải loại quà tự động (xem
        // `isAutoGiftLine`) — không có cờ thì không biết dòng nào là quà.
        isGiftLine: item.isGiftLine === true,
        isManual: item.isManual === true,
      };
    });
    if (canonicalItems.some((i) => i.quantity <= 0)) {
      throw AppError.invalid('Số lượng mỗi dòng phải là số nguyên dương.');
    }

    // priceLine là nguồn sự thật chung cho cả giảm giá dòng lẫn giảm cả giỏ.
    // 0031: số tiền CHIẾT KHẤU chỉ tính trên dòng hàng bán — dòng quà tự động bị
    // loại (nó không phải tiền khách trả, không ai duyệt nó). `order.service.ts`
    // cũng bỏ đúng các dòng đó khỏi `calculatedSubtotal`, nên hai đầu khớp mà
    // không cần nới sai số 0.01đ. Quà TAY vẫn tính vào đây.
    const approvalItems = canonicalItems.filter((i) => !isAutoGiftLine(i));
    if (approvalItems.length === 0) {
      throw AppError.invalid(
        'Giỏ hàng không còn dòng hàng bán để xin duyệt chiết khấu (chỉ có dòng quà).'
      );
    }
    const pricedLines = approvalItems.map((item) =>
      priceLine(item.unitPrice, item.unitDiscountRate, item.quantity)
    );
    const originalAmount = pricedLines.reduce((sum, line) => sum + line.subtotal, 0);
    const finalAmount = pricedLines.reduce((sum, line) => sum + line.finalAmount, 0);
    const discountAmount = originalAmount - finalAmount;

// KHÔNG tính `cartHash` ở đây: hash phải khoá theo MÃ ĐƠN THẬT (mã mà
    // `assertValidForCheckout` dùng lúc chốt đơn sẽ tính lại), mà mã đơn thật chỉ
    // biết được sau bước "còn yêu cầu cũ nào không" bên dưới — bấm lại nút duyệt
    // trong cùng phiên thì dùng lại mã của yêu cầu cũ, không cấp mã mới.
    const hashFor = (orderCodeForHash: string) =>
      generateCanonicalCartHash(canonicalItems, requestedDiscountRate, warehouseId, orderCodeForHash);

    const now = new Date();
    const nowIso = now.toISOString();

    // Yêu cầu đang mở của CHÍNH PHIÊN GIỎ NÀY (khoá = mã phiếu tạm của máy POS).
    const existing = await txOrDb
      .select()
      .from(discountApprovalRequests)
      .where(
        and(
          eq(discountApprovalRequests.clientOrderCode, clientOrderCode),
          eq(discountApprovalRequests.warehouseId, warehouseId),
          eq(discountApprovalRequests.cashierId, cashierId),
          or(
            eq(discountApprovalRequests.status, 'PENDING'),
            eq(discountApprovalRequests.status, 'APPROVED')
          )
        )
      )
      .orderBy(desc(discountApprovalRequests.createdAt))
      .limit(1);

    if (existing.length > 0) {
      const prev = existing[0];
      const isStillValid = new Date(prev.expiresAt).getTime() > now.getTime();

      // Nếu giỏ hàng và discount rate giống hệt, và vẫn còn hạn -> trả về luôn
      if (
        isStillValid &&
        prev.cartHash === hashFor(prev.orderCode) &&
        Math.abs(prev.requestedDiscountRate - requestedDiscountRate) < 0.0001
      ) {
        const shortCode = extractShortCode(prev.orderCode);
        const qrToken = await signQrJwt({
          reqId: prev.id,
          nonce: prev.nonce,
          cartHash: prev.cartHash,
          orderCode: prev.orderCode,
          warehouseId,
          rate: prev.requestedDiscountRate,
          exp: Math.floor(new Date(prev.expiresAt).getTime() / 1000),
        });
        return {
          ...prev,
          shortCode,
          qrToken,
        };
      }

      // Nếu giỏ hàng thay đổi hoặc discount rate thay đổi -> vô hiệu hóa đơn cũ (SUPERSEDED)
      const supersedeResult = await txOrDb
        .update(discountApprovalRequests)
        .set({
          status: 'SUPERSEDED',
          updatedAt: nowIso,
          version: sql`${discountApprovalRequests.version} + 1`,
        })
        .where(
          and(
            eq(discountApprovalRequests.id, prev.id),
            eq(discountApprovalRequests.version, prev.version),
            or(
              eq(discountApprovalRequests.status, 'PENDING'),
              eq(discountApprovalRequests.status, 'APPROVED')
            )
          )
        );
      assertTransitionApplied(supersedeResult, 'Yêu cầu duyệt đã thay đổi trạng thái, vui lòng tạo lại.');
    }

    const id = crypto.randomUUID();
    const nonce = randomHex(8);
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString(); // 5 phút TTL

    // MÃ ĐƠN THẬT, do server cấp NGAY LÚC TẠO YÊU CẦU — không đợi tới lúc chốt đơn.
    //
    // VÌ SAO phải cấp ở đây: mã đơn là thứ thu ngân ĐỌC TO ra cho quản lý ghi
    // lên phiếu, và là thứ báo cáo đối soát ca dùng để nối. Nếu để tới lúc chốt
    // đơn thì mỗi bên có một mã khác nhau. Nay mã của yêu cầu CHÍNH LÀ mã của đơn,
    // quản lý ghi đúng mã trên phiếu là mã trong hệ thống.
    //
    // Cấp ở đây (trong transaction của `createRequest`) nên khi bấm "Duyệt" rồi đổi
    // giỏ hàng, số thứ tự bị rollback và không để lại lỗ hổng trong mã đơn.
    const orderCode = await allocateOrderCode(txOrDb, vnDayFmt.format(now));
    const cartHash = hashFor(orderCode);
    const shortCode = extractShortCode(orderCode);

    const qrToken = await signQrJwt({
      reqId: id,
      nonce,
      cartHash,
      orderCode,
      warehouseId,
      rate: requestedDiscountRate,
      exp: Math.floor((now.getTime() + 5 * 60 * 1000) / 1000),
    });

    const newRow = {
      id,
      orderCode, // mã đơn THẬT (13 ký tự, server cấp)
      clientOrderCode: clientOrderCode ?? null, // mã phiếu tạm của máy thu ngân
      warehouseId,
      cashierId,
      cartHash,
      cartSnapshot: JSON.stringify(canonicalItems),
      requestedDiscountRate,
      originalAmount,
      discountAmount,
      finalAmount,
      status: 'PENDING',
      approvedBy: null,
      approvalMethod: null,
      rejectedReason: null,
      nonce,
      expiresAt,
      version: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await txOrDb.insert(discountApprovalRequests).values(newRow);

    return {
      ...newRow,
      shortCode,
      qrToken,
    };
  }

  /**
   * Quản lý phê duyệt chiết khấu.
   * - 3 phương thức: ONE_TOUCH (session Web/Mobile), SHORTCODE_BOUND (nhập 4 số),
   *   QR_JWT (quét mã).
   * - Phương thức duyệt bằng "mã khẩn cấp ngoại tuyến" đã GỠ 2026-09-29: nó chỉ
   *   kiểm chuỗi theo tiền tố, không có bảng mã, không single-use, không hạn.
   *   Mọi thứ quản lý dùng được vốn đã có ONE_TOUCH không trần nên nó không cho
   *   thêm quyền, nhưng là cái bẫy: nới role-gate ở đây là biến nó thành
   *   backdoor cho thu ngân tự duyệt chiết khấu của chính mình.
   */
  static async approveRequest(params: {
    requestId: string;
    method: 'ONE_TOUCH' | 'QR_JWT' | 'SHORTCODE_BOUND';
    shortCode?: string;
    qrToken?: string;
    actorContext: ActorContext;
    txOrDb?: any;
  }) {
    const {
      requestId,
      method,
      shortCode,
      qrToken,
      actorContext,
      txOrDb = db,
    } = params;

    if (!['ONE_TOUCH', 'QR_JWT', 'SHORTCODE_BOUND'].includes(method as string)) {
      throw AppError.invalid('Phương thức phê duyệt không hợp lệ.');
    }

    if (
      actorContext.role !== 'ROLE_OWNER' &&
      actorContext.role !== 'ROLE_MANAGER'
    ) {
      throw AppError.forbidden('Chỉ Quản lý (ROLE_MANAGER) hoặc Chủ quầy (ROLE_OWNER) mới có quyền duyệt chiết khấu');
    }

    const rows = await txOrDb
      .select()
      .from(discountApprovalRequests)
      .where(eq(discountApprovalRequests.id, requestId))
      .limit(1);

    if (rows.length === 0) {
      throw AppError.invalid('Không tìm thấy yêu cầu duyệt chiết khấu');
    }

    if (rows[0].cashierId === actorContext.staffId) {
      throw AppError.forbidden('Không thể tự phê duyệt yêu cầu của mình.');
    }

    const request = rows[0];

    // Lazy expiration check
    if (new Date(request.expiresAt).getTime() <= Date.now()) {
      await txOrDb
        .update(discountApprovalRequests)
        .set({ status: 'EXPIRED', updatedAt: new Date().toISOString() })
        .where(
          and(
            eq(discountApprovalRequests.id, requestId),
            eq(discountApprovalRequests.status, 'PENDING'),
            lte(discountApprovalRequests.expiresAt, new Date().toISOString())
          )
        );
      throw AppError.conflict('Yêu cầu duyệt chiết khấu đã hết hạn 5 phút (EXPIRED)');
    }

    if (request.status !== 'PENDING') {
      throw AppError.conflict(
        `Không thể duyệt yêu cầu ở trạng thái ${request.status} (chỉ duyệt khi PENDING)`
      );
    }

    // Kiểm tra theo từng phương thức duyệt
    if (method === 'SHORTCODE_BOUND') {
      const expectedShortCode = extractShortCode(request.orderCode);
      if (!shortCode || shortCode.toUpperCase() !== expectedShortCode) {
        throw AppError.invalid(
          `Mã 4 số '${shortCode}' không khớp với đơn (kỳ vọng: ${expectedShortCode})`
        );
      }
    } else if (method === 'QR_JWT') {
      if (!qrToken) {
        throw AppError.invalid('Thiếu mã QR token để xác thực');
      }
      const payload = await verifyQrJwt(qrToken);
      if (
        payload.reqId !== request.id ||
        payload.cartHash !== request.cartHash
      ) {
        throw AppError.invalid('Mã QR không khớp với yêu cầu duyệt hiện tại');
      }
    }

    // Atomic update with optimistic lock
    const nowIso = new Date().toISOString();
    const result = await txOrDb
      .update(discountApprovalRequests)
      .set({
        status: 'APPROVED',
        approvedBy: actorContext.staffId,
        approvalMethod: method,
        version: sql`${discountApprovalRequests.version} + 1`,
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(discountApprovalRequests.id, requestId),
           eq(discountApprovalRequests.version, request.version),
           eq(discountApprovalRequests.status, 'PENDING'),
           gt(discountApprovalRequests.expiresAt, nowIso)
        )
       );

    assertTransitionApplied(result, 'Yêu cầu duyệt đã thay đổi trạng thái, vui lòng thử lại.');

    return {
      ...request,
      status: 'APPROVED',
      approvedBy: actorContext.staffId,
      approvalMethod: method,
      version: request.version + 1,
      updatedAt: nowIso,
    };
  }

  /**
   * Quản lý từ chối chiết khấu kèm lý do.
   */
  static async rejectRequest(params: {
    requestId: string;
    rejectedReason: string;
    actorContext: ActorContext;
    txOrDb?: any;
  }) {
    const { requestId, rejectedReason, actorContext, txOrDb = db } = params;

    if (
      actorContext.role !== 'ROLE_OWNER' &&
      actorContext.role !== 'ROLE_MANAGER'
    ) {
      throw AppError.forbidden('Chỉ Quản lý hoặc Chủ quầy mới có quyền từ chối chiết khấu');
    }

    const rows = await txOrDb
      .select()
      .from(discountApprovalRequests)
      .where(eq(discountApprovalRequests.id, requestId))
      .limit(1);

    if (rows.length === 0) {
      throw AppError.invalid('Không tìm thấy yêu cầu duyệt chiết khấu');
    }

    if (rows[0].cashierId === actorContext.staffId) {
      throw AppError.forbidden('Không thể tự từ chối yêu cầu của mình.');
    }

    const request = rows[0];
    if (new Date(request.expiresAt).getTime() <= Date.now()) {
      await this.getRequest(requestId, txOrDb);
      throw AppError.conflict('Yêu cầu duyệt chiết khấu đã hết hạn 5 phút (EXPIRED)');
    }
    if (request.status !== 'PENDING') {
      throw AppError.conflict(
        `Không thể từ chối yêu cầu ở trạng thái ${request.status}`
      );
    }

    const nowIso = new Date().toISOString();
    const result = await txOrDb
      .update(discountApprovalRequests)
      .set({
        status: 'REJECTED',
        approvedBy: actorContext.staffId,
        rejectedReason: rejectedReason || 'Quản lý từ chối chiết khấu',
        version: sql`${discountApprovalRequests.version} + 1`,
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(discountApprovalRequests.id, requestId),
           eq(discountApprovalRequests.version, request.version),
           eq(discountApprovalRequests.status, 'PENDING'),
           gt(discountApprovalRequests.expiresAt, nowIso)
        )
      );
    assertTransitionApplied(result, 'Yêu cầu duyệt đã thay đổi trạng thái, vui lòng thử lại.');

    return {
      ...request,
      status: 'REJECTED',
      approvedBy: actorContext.staffId,
      rejectedReason,
      version: request.version + 1,
      updatedAt: nowIso,
    };
  }

  /**
   * A1-F: hủy yêu cầu duyệt — nút "Sửa giỏ và hủy phê duyệt" phía UI gọi
   * trước khi bỏ khóa giỏ. Chủ yêu cầu (cashier) hoặc Manager/Owner.
   * Dùng lại SUPERSEDED (không thêm enum mới — UI đã hiểu "xin duyệt lại").
   * Conditional UPDATE có điều kiện VERSION + PENDING/APPROVED: race
   * cancel-vs-checkout chỉ một bên chuyển trạng thái được (checkout consume
   * cũng là conditional từ APPROVED), bên thua nhận 409 để tải lại.
   */
  static async cancelRequest(params: {
    requestId: string;
    actorContext: ActorContext;
    txOrDb?: any;
  }) {
    const { requestId, actorContext, txOrDb = db } = params;
    const rows = await txOrDb
      .select()
      .from(discountApprovalRequests)
      .where(eq(discountApprovalRequests.id, requestId))
      .limit(1);

    if (rows.length === 0) {
      throw AppError.invalid('Không tìm thấy yêu cầu duyệt chiết khấu');
    }

    const request = rows[0];
    if (
      actorContext.role !== 'ROLE_OWNER' &&
      actorContext.role !== 'ROLE_MANAGER' &&
      actorContext.role !== 'ROLE_CASHIER'
    ) {
      throw AppError.forbidden('Không có quyền hủy yêu cầu duyệt chiết khấu');
    }
    if (actorContext.role === 'ROLE_CASHIER' && request.cashierId !== actorContext.staffId) {
      throw AppError.forbidden('Thu ngân chỉ có thể hủy yêu cầu của mình');
    }
    if (
      (request.status === 'PENDING' || request.status === 'APPROVED') &&
      new Date(request.expiresAt).getTime() <= Date.now()
    ) {
      return this.getRequest(requestId, txOrDb);
    }
    if (request.status === 'CONSUMED') {
      throw AppError.conflict('Yêu cầu duyệt đã được sử dụng cho đơn, không thể hủy.');
    }
    // MERGE: origin/main chặn trạng thái đã kết thúc (REJECTED/EXPIRED/SUPERSEDED)
    // bằng 409. Bản c-login-ux trả 200 kèm record cũ, khiến hủy hai lần im lặng
    // thành công và che mất race. Không suite nào của c-login-ux đòi hành vi đó.
    if (request.status !== 'PENDING' && request.status !== 'APPROVED') {
      throw AppError.conflict(`Không thể hủy yêu cầu ở trạng thái ${request.status}`);
    }

    const nowIso = new Date().toISOString();
    const result = await txOrDb
      .update(discountApprovalRequests)
      .set({
        status: 'SUPERSEDED',
        rejectedReason: 'Yêu cầu đã bị hủy bởi người tạo hoặc quản lý',
        version: sql`${discountApprovalRequests.version} + 1`,
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(discountApprovalRequests.id, requestId),
          eq(discountApprovalRequests.version, request.version),
          or(
            eq(discountApprovalRequests.status, 'PENDING'),
            eq(discountApprovalRequests.status, 'APPROVED')
          )
        )
      );
    assertTransitionApplied(result, 'Yêu cầu duyệt đã thay đổi trạng thái, vui lòng thử lại.');

    return {
      ...request,
      status: 'SUPERSEDED',
      rejectedReason: 'Yêu cầu đã bị hủy bởi người tạo hoặc quản lý',
      version: request.version + 1,
      updatedAt: nowIso,
    };
  }

  /**
   * Tra cứu thông tin yêu cầu duyệt chiết khấu (kèm lazy expiration check).
   */
  static async getRequest(requestId: string, txOrDb: any = db) {
    const rows = await txOrDb
      .select()
      .from(discountApprovalRequests)
      .where(eq(discountApprovalRequests.id, requestId))
      .limit(1);

    if (rows.length === 0) {
      throw AppError.invalid('Không tìm thấy yêu cầu duyệt chiết khấu');
    }

    const req = rows[0];

    // Lazy expiration check nếu đang PENDING hoặc APPROVED mà quá hạn
    if (
      (req.status === 'PENDING' || req.status === 'APPROVED') &&
      new Date(req.expiresAt).getTime() <= Date.now()
    ) {
      const nowIso = new Date().toISOString();
      await txOrDb
        .update(discountApprovalRequests)
        .set({ status: 'EXPIRED', updatedAt: nowIso })
        .where(
          and(
            eq(discountApprovalRequests.id, req.id),
            or(
              eq(discountApprovalRequests.status, 'PENDING'),
              eq(discountApprovalRequests.status, 'APPROVED')
            ),
            lte(discountApprovalRequests.expiresAt, nowIso)
          )
        );
      req.status = 'EXPIRED';
      req.updatedAt = nowIso;
    }

    return req;
  }

  /**
   * Lấy danh sách các đơn đang chờ duyệt cho Quản lý / Dashboard.
   * Tuân thủ V4.1 §4.4: BẮT BUỘC lọc `status = 'PENDING' AND expires_at > CURRENT_TIMESTAMP`.
   */
  static async listPending(warehouseId?: string, cashierId?: string, txOrDb: any = db) {
    const conditions = [
      eq(discountApprovalRequests.status, 'PENDING'),
      gt(discountApprovalRequests.expiresAt, new Date().toISOString()),
    ];

    if (warehouseId) {
      conditions.push(eq(discountApprovalRequests.warehouseId, warehouseId));
    }
    // A1.7: cashier chỉ thấy yêu cầu của chính mình, không thấy cả kho.
    if (cashierId) {
      conditions.push(eq(discountApprovalRequests.cashierId, cashierId));
    }

    const rows = await txOrDb
      .select()
      .from(discountApprovalRequests)
      .where(and(...conditions))
      .orderBy(desc(discountApprovalRequests.createdAt));

    return rows.map((r: any) => ({
      ...r,
      shortCode: extractShortCode(r.orderCode),
    }));
  }

  /**
   * A1-H: xác minh phê duyệt khớp với giỏ checkout TRƯỚC khi tạo đơn.
   * - Không tìm thấy / chưa APPROVED / hết hạn: INVALID (route cho rẽ sang
   *   PIN quản lý như hành vi cũ — phê duyệt cũ không phải bằng chứng gian lận).
   * - Đã APPROVED nhưng lệch kho / mức giảm / người xin / giỏ hàng: FORBIDDEN
   *   cứng, route từ chối ngay không cho rẽ PIN (PIN không rửa được giỏ tráo).
   * - Giỏ tính lại từ giá bìa DB (bỏ qua unitPrice client), dùng orderCode của
   *   chính approval (checkout sinh mã khác — không đòi bằng mã).
   */
  static async assertValidForCheckout(params: {
    requestId: string;
    items: Array<{
      editionId: string;
      quantity: number;
      unitDiscountRate?: number;
      isGiftLine?: boolean;
      isManual?: boolean;
    }>;
    discountRate: number;
    warehouseId: string;
    actorId: string;
  }): Promise<void> {
    const appr = await this.getRequest(params.requestId);
    if (!appr || appr.status !== 'APPROVED') {
      throw AppError.invalid('Phê duyệt chiết khấu chưa hợp lệ hoặc đã hết hiệu lực.');
    }
    if (`${appr.warehouseId || ''}` !== `${params.warehouseId || ''}`) {
      throw AppError.forbidden('Phê duyệt thuộc kho khác, không áp dụng cho đơn này.');
    }
    const rateCheckout = Number(params.discountRate) || 0;
    if (Math.abs(Number(appr.requestedDiscountRate || 0) - rateCheckout) >= 0.0001) {
      throw AppError.forbidden('Mức chiết khấu đã thay đổi sau khi duyệt. Vui lòng xin duyệt lại.');
    }
    if (`${appr.cashierId || ''}` !== `${params.actorId || ''}`) {
      throw AppError.forbidden('Phê duyệt thuộc về thu ngân khác.');
    }
    const editionIds = Array.from(new Set(params.items.map((i) => `${i.editionId || ''}`.trim()).filter(Boolean)));
    // Tra `products` (tầng gốc) như `createRequest` — hàng hóa không có dòng
    // `editions`, tra đó là quà tay hàng hóa chết oan ở bước verify.
    const coverRows =
      editionIds.length > 0
        ? await db
            .select({ id: products.id, coverPrice: products.sellingPrice })
            .from(products)
            .where(inArray(products.id, editionIds))
        : [];
    const coverMap = new Map<string, number>();
    for (const r of coverRows) coverMap.set(r.id, Number(r.coverPrice || 0));
    // 0031: dòng quà tự động không thuộc phạm vi phê duyệt ⇒ băm trên tập dòng
    // KHÔNG phải quà, đúng như `createRequest` và `consumeApproval` đã làm.
    // Nhánh FORBIDDEN cứng bên dưới KHÔNG được nới: nó chặn tráo giỏ thật, và
    // chỉ dòng quà TỰ ĐỘNG mới thoát được (quà tay vẫn nằm trong hash).
    const canonical = params.items
      .filter((i) => !isAutoGiftLine(i))
      .map((i) => ({
      editionId: `${i.editionId || ''}`.trim(),
      quantity: Math.floor(Number(i.quantity) || 0),
      unitPrice: coverMap.get(`${i.editionId || ''}`.trim()) || 0,
      // P1a: giữ mức giảm dòng client gửi (fallback = mức tổng) để hash bao
      // luôn gian lận line-discount; giá lấy từ DB nên không cần tin client.
      unitDiscountRate: (i as CartItemInput).unitDiscountRate ?? rateCheckout,
    }));
    const expected = generateCanonicalCartHash(canonical, rateCheckout, params.warehouseId, appr.orderCode);
    if (expected !== appr.cartHash) {
      throw AppError.forbidden('Giỏ hàng đã thay đổi sau khi duyệt. Vui lòng xin duyệt lại.');
    }
  }

  /**
   * Tiêu thụ chiết khấu khi hoàn tất thanh toán (Checkout).
   * Chống tráo giỏ hàng: băm lại giỏ hàng hiện tại và so với `cartHash` đã được duyệt.
   */
  static async consumeApproval(params: {
    requestId: string;
    currentItems: CartItemInput[];
    discountRate: number;
    warehouseId: string;
    orderCode: string;
    cashierId?: string;
    originalAmount?: number;
    discountAmount?: number;
    finalAmount?: number;
    txOrDb?: any;
  }) {
    const {
      requestId,
      currentItems,
      discountRate,
       warehouseId,
       orderCode,
       cashierId,
       originalAmount,
      discountAmount,
      finalAmount,
      txOrDb = db,
    } = params;

    const request = await this.getRequest(requestId, txOrDb);

    if (cashierId && request.cashierId !== cashierId) {
      throw AppError.forbidden('Yêu cầu duyệt không thuộc thu ngân hiện tại.');
    }

    if (request.status === 'CONSUMED') {
      throw AppError.conflict('Yêu cầu chiết khấu này đã được sử dụng');
    }
    if (request.status !== 'APPROVED') {
      throw AppError.conflict(
        `Yêu cầu chiết khấu không ở trạng thái APPROVED (trạng thái hiện tại: ${request.status})`
      );
    }

    // 0031: dòng quà TỰ ĐỘNG ngoài phạm vi phê duyệt. `order.service.ts` đã lọc
    // trước khi gọi, nhưng ta lọc lại ở đây để mọi call site (kể cả call site
    // mới, ví dụ đường offline) đều đúng mà không cần nhớ quy tắc. Quà TAY vẫn
    // ở lại: đó là thứ cần duyệt.
    const payableItems = currentItems.filter((i) => !isAutoGiftLine(i));
    const giftSubtotal = autoGiftSubtotal(currentItems, discountRate);
    // Quà TAY nằm trong số tiền duyệt (quản lý thấy đúng giá trị cho đi) nhưng
    // KHÔNG nằm trong tiền đơn (đơn không cộng giá quà — luật chống nhiễm tiền).
    // Đọc giá trị quà tay từ chính `cartSnapshot` đã duyệt (giá DB lúc duyệt),
    // không tốn thêm query trong transaction chật subrequest này.
    let manualGiftSubtotal = 0;
    try {
      const snap: any[] = JSON.parse(String((request as any)?.cartSnapshot ?? '[]'));
      if (Array.isArray(snap)) {
        for (const s of snap) {
          if (s?.isManual === true && s?.isGiftLine === true) {
            manualGiftSubtotal += Number(s?.unitPrice || 0) * Math.floor(Number(s?.quantity || 0));
          }
        }
      }
    } catch {
      manualGiftSubtotal = 0;
    }

    // Chống tráo giỏ hàng: giỏ hàng thanh toán phải khớp 100% với giỏ đã duyệt.
    // MERGE: hash theo `request.orderCode` (mã đã khoá lúc tạo yêu cầu) chứ không
    // theo orderCode của đơn đang tạo. assertValidForCheckout() phía trên cũng
    // dùng appr.orderCode, nên hai đầu phải dùng CÙNG một mã — nếu lúc tiêu thụ
    // lấy mã đơn mới thì hash luôn lệch và mọi đơn chiết khấu đều chết.
    const currentHash = generateCanonicalCartHash(
      payableItems,
      discountRate,
      warehouseId,
      request.orderCode
    );

    if (currentHash !== request.cartHash) {
      throw AppError.conflict(
        'Giỏ hàng đã bị thay đổi sau khi được duyệt chiết khấu. Vui lòng xin duyệt lại.'
      );
    }
    // Dung sai 0.01đ như cũ, CỘNG thêm đúng giá trị dòng quà tự động: số tiền
    // lúc chốt có thể đã kèm giá món quà (đơn offline, call site chưa lọc)
    // trong khi bản ghi duyệt thì không. Lệch ĐÚNG BẰNG tiền quà là hợp lệ; lệch
    // bất kỳ số nào khác vẫn bị chặn. Quà tay NGƯỢC LẠI: bản ghi duyệt CÓ giá
    // quà tay mà tiền đơn KHÔNG (luật chống nhiễm tiền) ⇒ chấp nhận lệch đúng
    // bằng `manualGiftSubtotal`. Thêm quà tay sau duyệt vẫn chết vì hash lệch.
    const amountMatches = (approved: number, actual: number): boolean =>
      Math.abs(approved - actual) <= 0.01 ||
      Math.abs(approved - (actual - giftSubtotal)) <= 0.01 ||
      Math.abs(approved - manualGiftSubtotal - actual) <= 0.01 ||
      Math.abs(approved - giftSubtotal - manualGiftSubtotal - actual) <= 0.01;
    if (
      (originalAmount !== undefined && !amountMatches(request.originalAmount, originalAmount)) ||
      (discountAmount !== undefined && !amountMatches(request.discountAmount, discountAmount)) ||
      // finalAmount so KHÔNG nới: dòng quà bán 0đ nên nó không đổi tiền khách
      // phải trả — lệch ở đây là lệch tiền thật.
      (finalAmount !== undefined && Math.abs(request.finalAmount - finalAmount) > 0.01)
    ) {
      throw AppError.conflict('Tổng tiền của giỏ không khớp yêu cầu đã được duyệt.');
    }

    const nowIso = new Date().toISOString();
    const result = await txOrDb
      .update(discountApprovalRequests)
      .set({
        status: 'CONSUMED',
        version: sql`${discountApprovalRequests.version} + 1`,
        updatedAt: nowIso,
      })
      .where(
        and(
           eq(discountApprovalRequests.id, requestId),
           eq(discountApprovalRequests.version, request.version),
           eq(discountApprovalRequests.status, 'APPROVED'),
           gt(discountApprovalRequests.expiresAt, nowIso)
        )
      );
    assertTransitionApplied(result, 'Yêu cầu duyệt đã thay đổi trạng thái, vui lòng thử lại.');

    return {
      ...request,
      status: 'CONSUMED',
      updatedAt: nowIso,
    };
  }
}
