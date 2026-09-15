import { db, orders } from '../db';
import { eq, and } from 'drizzle-orm';

export type ShippingStatus = 'NONE' | 'CREATED' | 'PICKED_UP' | 'IN_TRANSIT' | 'DELIVERED' | 'RETURNED' | 'FAILED';
export type CodStatus = 'NONE' | 'PENDING' | 'RECEIVED';

const VALID_CARRIERS = ['SPX'];
const VALID_SHIPPING: ShippingStatus[] = ['NONE', 'CREATED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'RETURNED', 'FAILED'];

// Ma trận chuyển trạng thái hợp lệ (MVP: webhook/manual đều qua đây)
const ALLOWED_TRANSITIONS: Record<ShippingStatus, ShippingStatus[]> = {
  NONE: ['CREATED'],
  CREATED: ['PICKED_UP', 'FAILED'],
  PICKED_UP: ['IN_TRANSIT', 'FAILED'],
  IN_TRANSIT: ['DELIVERED', 'RETURNED', 'FAILED'],
  DELIVERED: [],
  RETURNED: ['CREATED'], // hoàn về kho → đẩy lại chuyến mới
  FAILED: ['CREATED'],
};

export class ShipmentService {
  static async getByOrder(orderId: string) {
    const rows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (rows.length === 0) throw new Error('Không tìm thấy đơn hàng.');
    return rows[0];
  }

  /**
   * Đẩy đơn sang SPX (sau khi đơn COMPLETED): gắn carrier + tracking,
   * shipping CREATED. Đơn COD → cod_amount = finalAmount, cod PENDING (SPX giữ).
   * TUYỆT ĐỐI không sinh bút toán kho ở đây.
   */
  static async push(orderId: string, carrier: string, trackingCode: string, shippingFee = 0, actorRole = 'ROLE_OWNER') {
    if (actorRole === 'ROLE_TAX') throw new Error('Kế toán thuế không được đẩy vận chuyển.');
    if (!VALID_CARRIERS.includes(carrier)) throw new Error(`Carrier chưa hỗ trợ: ${carrier} (hiện chỉ SPX).`);
    if (!trackingCode || !trackingCode.trim()) throw new Error('Thiếu mã vận đơn (trackingCode).');
    if (shippingFee < 0) throw new Error('Phí ship không được âm.');
    const ord = await this.getByOrder(orderId);
    if (ord.status !== 'COMPLETED') throw new Error(`Chỉ đẩy đơn COMPLETED (hiện: ${ord.status}).`);
    if (ord.shippingStatus !== 'NONE' && ord.shippingStatus !== 'RETURNED' && ord.shippingStatus !== 'FAILED') {
      throw new Error(`Đơn đã có chuyến ${ord.shippingStatus}, không đẩy đè.`);
    }
    const isCod = ord.paymentMethod === 'COD';
    await db.update(orders).set({
      carrier,
      trackingCode: trackingCode.trim(),
      shippingStatus: 'CREATED',
      shippingFee,
      codAmount: isCod ? ord.finalAmount : 0,
      codStatus: isCod ? 'PENDING' : 'NONE',
    }).where(eq(orders.id, orderId));
    return { orderId, carrier, trackingCode: trackingCode.trim(), shippingStatus: 'CREATED', codAmount: isCod ? ord.finalAmount : 0 };
  }

  /** Cập nhật hành trình (webhook SPX / điều phối tay). Không bao giờ đụng ledger. */
  static async updateStatus(orderId: string, next: ShippingStatus, actorRole = 'ROLE_OWNER') {
    if (actorRole === 'ROLE_TAX') throw new Error('Kế toán thuế không được cập nhật vận chuyển.');
    if (!VALID_SHIPPING.includes(next)) throw new Error(`Trạng thái vận chuyển không hợp lệ: ${next}.`);
    const ord = await this.getByOrder(orderId);
    const cur = (ord.shippingStatus || 'NONE') as ShippingStatus;
    if (!ALLOWED_TRANSITIONS[cur].includes(next)) {
      throw new Error(`Chuyển trạng thái không hợp lệ: ${cur} → ${next}.`);
    }
    await db.update(orders).set({ shippingStatus: next }).where(eq(orders.id, orderId));
    return { orderId, shippingStatus: next };
  }

  /**
   * Đối soát COD: SPX đã chuyển khoản → RECEIVED + audit kèm mã đối soát NH.
   * Tiền về tài khoản ngân hàng, KHÔNG đổ vào két ca thu ngân.
   */
  static async settleCod(orderId: string, actorRole: string, bankReference: string) {
    if (actorRole !== 'ROLE_OWNER' && actorRole !== 'ROLE_MANAGER') {
      throw new Error('Chỉ Manager/Owner được đối soát COD.');
    }
    if (!bankReference || !bankReference.trim()) throw new Error('Đối soát COD bắt buộc có mã tham chiếu ngân hàng.');
    const ord = await this.getByOrder(orderId);
    if (ord.codStatus !== 'PENDING') throw new Error(`COD đang ở trạng thái ${ord.codStatus}, không thể tất toán.`);
    await db.update(orders).set({ codStatus: 'RECEIVED' }).where(eq(orders.id, orderId));
    return { orderId, codStatus: 'RECEIVED', codAmount: ord.codAmount, bankReference: bankReference.trim() };
  }

  static async list(filters: { shippingStatus?: string; codStatus?: string; carrier?: string } = {}) {
    const conds = [];
    if (filters.shippingStatus) conds.push(eq(orders.shippingStatus, filters.shippingStatus));
    if (filters.codStatus) conds.push(eq(orders.codStatus, filters.codStatus));
    if (filters.carrier) conds.push(eq(orders.carrier, filters.carrier));
    if (conds.length === 0) return await db.select().from(orders).limit(200);
    return await db.select().from(orders).where(and(...conds)).limit(200);
  }
}
