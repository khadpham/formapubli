import crypto from 'node:crypto';
import { db, discountApprovalRequests, warehouses } from '../db';
import { and, desc, eq, gt, or, sql } from 'drizzle-orm';
import { AppError } from './app-error';

export interface CartItemInput {
  editionId: string;
  quantity: number;
  unitPrice: number;
}

export interface ActorContext {
  staffId: string;
  role: string;
  fullName?: string;
}

const JWT_SECRET = process.env.AUTH_SECRET || 'formapubli-pos-discount-hmac-secret-2026';

function base64UrlEncode(data: string | Buffer): string {
  return Buffer.from(data)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/**
 * Sinh mã băm SHA-256 giỏ hàng chuẩn hóa theo V4.1 §4.1:
 * - Sắp xếp ấn bản theo editionId tăng dần (deterministic)
 * - Ép giá và discountRate về số nguyên VND
 * - Khóa chặt theo warehouseId + orderCode để tránh đụng độ giữa các quầy/kho
 */
export function generateCanonicalCartHash(
  items: CartItemInput[],
  discountRate: number,
  warehouseId: string,
  orderCode: string
): string {
  const sorted = [...items].sort((a, b) => a.editionId.localeCompare(b.editionId));
  const tokens = sorted.map(
    (i) => `${i.editionId}:${i.quantity}:${Math.round(i.unitPrice)}`
  );
  tokens.push(
    `wh:${warehouseId}`,
    `ord:${orderCode}`,
    `rate:${Math.round(discountRate * 10000)}`
  );
  return crypto.createHash('sha256').update(tokens.join('|')).digest('hex');
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
export function signQrJwt(payload: Record<string, any>): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = base64UrlEncode(
    crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest()
  );
  return `${header}.${body}.${signature}`;
}

export function verifyQrJwt(token: string): Record<string, any> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw AppError.invalid('Mã QR không hợp lệ (sai định dạng JWT)');
  }
  const [header, body, signature] = parts;
  const expectedSignature = base64UrlEncode(
    crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest()
  );
  if (
    !crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )
  ) {
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

    const originalAmount = items.reduce(
      (sum, item) => sum + item.quantity * Math.round(item.unitPrice),
      0
    );
    const discountAmount = Math.round(originalAmount * requestedDiscountRate);
    const finalAmount = originalAmount - discountAmount;

    const cartHash = generateCanonicalCartHash(
      items,
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
        const qrToken = signQrJwt({
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
    const nonce = crypto.randomBytes(8).toString('hex');
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString(); // 5 phút TTL
    const shortCode = extractShortCode(orderCode);

    const qrToken = signQrJwt({
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
      const payload = verifyQrJwt(qrToken);
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
  static async listPending(warehouseId?: string, txOrDb: any = db) {
    const conditions = [
      eq(discountApprovalRequests.status, 'PENDING'),
      gt(discountApprovalRequests.expiresAt, new Date().toISOString()),
    ];

    if (warehouseId) {
      conditions.push(eq(discountApprovalRequests.warehouseId, warehouseId));
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
