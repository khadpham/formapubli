import { db, discountApprovalRequests, editions, warehouses } from '../db';
import { and, desc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { AppError } from './app-error';
import { hashString } from '../lib/export-hash';

export interface CartItemInput {
  editionId: string;
  quantity: number;
  unitPrice: number;
  // P1a: mức giảm từng dòng tham gia hash (fallback = mức tổng đơn).
  // Không bind là lọt gian lận: giữ nguyên tổng đã duyệt, gắn 90% vào 1 dòng.
  unitDiscountRate?: number;
}

export interface ActorContext {
  staffId: string;
  role: string;
  fullName?: string;
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
 */
export function generateCanonicalCartHash(
  items: CartItemInput[],
  discountRate: number,
  warehouseId: string,
  orderCode: string
): string {
  const sorted = [...items].sort((a, b) => a.editionId.localeCompare(b.editionId));
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
   */
  static async createRequest(params: {
    orderCode: string;
    warehouseId: string;
    cashierId: string;
    items: CartItemInput[];
    requestedDiscountRate: number;
    actorContext: ActorContext;
    txOrDb?: any;
  }) {
    const {
      orderCode,
      warehouseId,
      cashierId,
      items,
      requestedDiscountRate,
      txOrDb = db,
    } = params;

    if (!items || items.length === 0) {
      throw AppError.invalid('Giỏ hàng không được để trống khi xin duyệt chiết khấu');
    }
    if (requestedDiscountRate <= 0 || requestedDiscountRate > 1.0) {
      throw AppError.invalid('Tỷ lệ chiết khấu yêu cầu không hợp lệ (phải từ > 0% đến 100%)');
    }

    // A1-H: chuẩn hóa giá bìa từ DB (bỏ qua unitPrice client gửi — client có
    // thể khai sai để lừa số tiền duyệt). Hash + số tiền duyệt tính trên giá
    // chuẩn này; route checkout recompute y hệt để khớp.
    const editionIds = Array.from(new Set(items.map((i) => `${i.editionId || ''}`.trim()).filter(Boolean)));
    if (editionIds.length === 0) {
      throw AppError.invalid('Giỏ hàng thiếu mã ấn bản hợp lệ.');
    }
    const coverRows = await txOrDb
      .select({ id: editions.id, coverPrice: editions.coverPrice })
      .from(editions)
      .where(inArray(editions.id, editionIds));
    const coverMap = new Map<string, number>();
    for (const r of coverRows) coverMap.set(r.id, Number(r.coverPrice || 0));
    const missing = editionIds.filter((id) => !coverMap.has(id));
    if (missing.length > 0) {
      throw AppError.invalid(`Ấn bản không tồn tại trong danh mục: ${missing.slice(0, 3).join(', ')}`);
    }
    const canonicalItems = items.map((item) => {
      const lineRate = item.unitDiscountRate ?? requestedDiscountRate;
      if (!Number.isFinite(lineRate) || lineRate < 0 || lineRate > 1) {
        throw AppError.invalid(`Mức giảm dòng ${item.editionId} phải nằm trong khoảng 0 - 100%.`);
      }
      return {
        editionId: `${item.editionId}`.trim(),
        quantity: Math.floor(Number(item.quantity) || 0),
        unitPrice: coverMap.get(`${item.editionId}`.trim()) || 0,
        unitDiscountRate: lineRate,
      };
    });
    if (canonicalItems.some((i) => i.quantity <= 0)) {
      throw AppError.invalid('Số lượng mỗi dòng phải là số nguyên dương.');
    }

    const originalAmount = canonicalItems.reduce(
      (sum, item) => sum + item.quantity * Math.round(item.unitPrice),
      0
    );
    const discountAmount = Math.round(originalAmount * requestedDiscountRate);
    const finalAmount = originalAmount - discountAmount;

    const cartHash = generateCanonicalCartHash(
      canonicalItems,
      requestedDiscountRate,
      warehouseId,
      orderCode
    );

    const now = new Date();
    const nowIso = now.toISOString();

    // Kiểm tra xem đơn hàng này đã có yêu cầu duyệt nào trước đó không
    const existing = await txOrDb
      .select()
      .from(discountApprovalRequests)
      .where(
        and(
          eq(discountApprovalRequests.orderCode, orderCode),
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
        prev.cartHash === cartHash &&
        Math.abs(prev.requestedDiscountRate - requestedDiscountRate) < 0.0001
      ) {
        const shortCode = extractShortCode(orderCode);
        const qrToken = await signQrJwt({
          reqId: prev.id,
          nonce: prev.nonce,
          cartHash: prev.cartHash,
          orderCode,
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
      await txOrDb
        .update(discountApprovalRequests)
        .set({
          status: 'SUPERSEDED',
          updatedAt: nowIso,
          version: sql`${discountApprovalRequests.version} + 1`,
        })
        .where(eq(discountApprovalRequests.id, prev.id));
    }

    const id = crypto.randomUUID();
    const nonce = randomHex(8);
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString(); // 5 phút TTL
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
      orderCode,
      warehouseId,
      cashierId,
      cartHash,
      cartSnapshot: JSON.stringify(items),
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
   * Quản lý phê duyệt chiết khấu:
   * - Hỗ trợ 4 phương thức: ONE_TOUCH (session Web/Mobile), SHORTCODE_BOUND (nhập 4 số),
   *   QR_JWT (quét mã), OFFLINE_EMERGENCY (mã khẩn cấp khi rớt mạng, trần 25%).
   */
  static async approveRequest(params: {
    requestId: string;
    method: 'ONE_TOUCH' | 'QR_JWT' | 'SHORTCODE_BOUND' | 'OFFLINE_EMERGENCY';
    shortCode?: string;
    qrToken?: string;
    emergencyCode?: string;
    actorContext: ActorContext;
    txOrDb?: any;
  }) {
    const {
      requestId,
      method,
      shortCode,
      qrToken,
      emergencyCode,
      actorContext,
      txOrDb = db,
    } = params;

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

    const request = rows[0];

    // Lazy expiration check
    if (new Date(request.expiresAt).getTime() <= Date.now()) {
      await txOrDb
        .update(discountApprovalRequests)
        .set({ status: 'EXPIRED', updatedAt: new Date().toISOString() })
        .where(eq(discountApprovalRequests.id, requestId));
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
          `Mã 4 số '${shortCode}' không khớp với đơn hàng (kỳ vọng: ${expectedShortCode})`
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
    } else if (method === 'OFFLINE_EMERGENCY') {
      // V4.1 §4.3: TRẦN: mã khẩn cấp chỉ duyệt tối đa CK 25%. Vượt 25% -> bắt buộc online.
      if (request.requestedDiscountRate > 0.25001) {
        throw AppError.invalid(
          'Mã khẩn cấp ngoại tuyến chỉ duyệt tối đa chiết khấu 25%. Mức chiết khấu này yêu cầu duyệt online.'
        );
      }
      if (!emergencyCode || !emergencyCode.trim().startsWith('EMG-')) {
        throw AppError.invalid('Mã khẩn cấp không hợp lệ (sai định dạng EMG-...)');
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
          eq(discountApprovalRequests.status, 'PENDING')
        )
      );

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

    const request = rows[0];
    if (request.status !== 'PENDING') {
      throw AppError.conflict(
        `Không thể từ chối yêu cầu ở trạng thái ${request.status}`
      );
    }

    const nowIso = new Date().toISOString();
    await txOrDb
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
          eq(discountApprovalRequests.status, 'PENDING')
        )
      );

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
   * Conditional UPDATE chỉ thắng khi còn PENDING/APPROVED: race
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
    if (rows.length === 0) throw AppError.invalid('Không tìm thấy yêu cầu duyệt chiết khấu');
    const request = rows[0];

    const isPrivileged =
      actorContext.role === 'ROLE_OWNER' || actorContext.role === 'ROLE_MANAGER';
    if (!isPrivileged && `${request.cashierId}` !== `${actorContext.staffId}`) {
      throw AppError.forbidden('Chỉ người tạo yêu cầu hoặc Quản lý được hủy yêu cầu duyệt.');
    }
    if (request.status !== 'PENDING' && request.status !== 'APPROVED') {
      throw AppError.conflict(`Không thể hủy yêu cầu ở trạng thái ${request.status}`);
    }

    const nowIso = new Date().toISOString();
    const res: any = await txOrDb
      .update(discountApprovalRequests)
      .set({
        status: 'SUPERSEDED',
        rejectedReason: `Hủy bởi ${actorContext.staffId}`,
        version: sql`${discountApprovalRequests.version} + 1`,
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(discountApprovalRequests.id, requestId),
          inArray(discountApprovalRequests.status, ['PENDING', 'APPROVED'])
        )
      );
    if ((res?.rowsAffected ?? 0) !== 1) {
      throw AppError.conflict('Yêu cầu vừa được duyệt/tiêu thụ, vui lòng tải lại.');
    }

    return { ...request, status: 'SUPERSEDED', updatedAt: nowIso };
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
        .where(eq(discountApprovalRequests.id, req.id));
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
    items: Array<{ editionId: string; quantity: number }>;
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
    const coverRows =
      editionIds.length > 0
        ? await db
            .select({ id: editions.id, coverPrice: editions.coverPrice })
            .from(editions)
            .where(inArray(editions.id, editionIds))
        : [];
    const coverMap = new Map<string, number>();
    for (const r of coverRows) coverMap.set(r.id, Number(r.coverPrice || 0));
    const canonical = params.items.map((i) => ({
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
    txOrDb?: any;
  }) {
    const {
      requestId,
      currentItems,
      discountRate,
      warehouseId,
      orderCode,
      txOrDb = db,
    } = params;

    const request = await this.getRequest(requestId, txOrDb);

    if (request.status === 'CONSUMED') {
      throw AppError.conflict('Yêu cầu chiết khấu này đã được sử dụng');
    }
    if (request.status !== 'APPROVED') {
      throw AppError.conflict(
        `Yêu cầu chiết khấu không ở trạng thái APPROVED (trạng thái hiện tại: ${request.status})`
      );
    }

    // Chống tráo giỏ hàng: giỏ hàng thanh toán phải khớp 100% với giỏ đã duyệt
    const currentHash = generateCanonicalCartHash(
      currentItems,
      discountRate,
      warehouseId,
      orderCode
    );

    if (currentHash !== request.cartHash) {
      throw AppError.conflict(
        'Giỏ hàng đã bị thay đổi sau khi được duyệt chiết khấu. Vui lòng xin duyệt lại.'
      );
    }

    const nowIso = new Date().toISOString();
    await txOrDb
      .update(discountApprovalRequests)
      .set({
        status: 'CONSUMED',
        version: sql`${discountApprovalRequests.version} + 1`,
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(discountApprovalRequests.id, requestId),
          eq(discountApprovalRequests.status, 'APPROVED')
        )
      );

    return {
      ...request,
      status: 'CONSUMED',
      updatedAt: nowIso,
    };
  }
}
