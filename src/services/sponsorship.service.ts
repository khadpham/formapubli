import { db, orders, orderItems, editions, sponsorshipFunds, sponsorshipDrawdowns } from '../db';
import { AppError } from './app-error';
import { InventoryService } from './inventory.service';
import { WarehouseService } from './warehouse.service';
import { eq, and, desc, gte, sql } from 'drizzle-orm';
import { withDbRetry } from '../lib/db-retry';

// Bước 4 — Quỹ Tài trợ: tiền cọc INTERNAL (SPONSORSHIP_DEPOSIT), không VAT lúc nhận.
// Rút sách trừ kho thật bằng event SPONSORSHIP_DRAWDOWN + đơn SPONSORSHIP final 0đ.

export type QuotaType = 'CAPPED' | 'OPEN';

export class SponsorshipService {
  static async createFund(params: {
    sponsorName: string;
    amountReceived: number;
    quotaType: QuotaType;
    quotaLimit?: number;
    partnerId?: string;
    createdBy?: string;
    note?: string;
    id?: string;
    fundCode?: string;
    actorRole?: string;
  }) {
    const { sponsorName, amountReceived, quotaType, partnerId, createdBy = 'staff-admin', note, actorRole = 'ROLE_OWNER' } = params;
    if (actorRole !== 'ROLE_OWNER' && actorRole !== 'ROLE_MANAGER') {
      throw AppError.forbidden('Chỉ Manager/Owner được mở quỹ tài trợ.');
    }
    if (!sponsorName || !sponsorName.trim()) throw AppError.invalid('Thiếu tên nhà tài trợ.');
    if (!(amountReceived > 0)) throw AppError.invalid('Tiền tài trợ phải > 0.');
    if (quotaType !== 'CAPPED' && quotaType !== 'OPEN') throw AppError.invalid('quotaType phải là CAPPED hoặc OPEN.');
    const limit = quotaType === 'CAPPED' ? (params.quotaLimit ?? amountReceived) : 0;
    if (quotaType === 'CAPPED' && !(limit > 0)) throw AppError.invalid('Quỹ CAPPED bắt buộc có quotaLimit > 0.');

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const id = params.id || `fund-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const fundCode = params.fundCode || `SPF-${dateStr}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    await db.insert(sponsorshipFunds).values({
      id,
      fundCode,
      sponsorName: sponsorName.trim(),
      partnerId,
      amountReceived,
      quotaType,
      quotaLimit: limit,
      balanceRemaining: limit,
      totalDrawnQty: 0,
      totalDrawnValue: 0,
      status: 'ACTIVE',
      createdBy,
      note,
    });
    return { fundId: id, fundCode, status: 'ACTIVE' };
  }

  static async getFund(fundId: string) {
    const rows = await db.select().from(sponsorshipFunds).where(eq(sponsorshipFunds.id, fundId)).limit(1);
    if (rows.length === 0) throw AppError.invalid('Không tìm thấy quỹ tài trợ.');
    return rows[0];
  }

  /**
   * Rút sách khỏi quỹ: 1 đơn SPONSORSHIP (final 0đ, INTERNAL) + ledger
   * SPONSORSHIP_DRAWDOWN trừ kho thật + trừ balance nếu CAPPED. Nguyên tử.
   */
  static async draw(params: {
    fundId: string;
    editionId: string;
    warehouseId: string;
    quantity: number;
    drawnBy?: string;
    note?: string;
    idempotencyKey?: string;
    actorRole?: string;
  }) {
    const { fundId, editionId, warehouseId, quantity, drawnBy = 'staff-admin', note, actorRole = 'ROLE_OWNER' } = params;
    if (actorRole === 'ROLE_TAX') throw AppError.forbidden('Kế toán thuế không được rút sách tài trợ.');
    // V4.1 S1.2: guard kho bán dùng chung (đọc DB).
    await WarehouseService.assertSellable(warehouseId);
    if (!Number.isInteger(quantity) || quantity <= 0) throw AppError.invalid('Số lượng rút phải nguyên > 0.');

    const fund = await this.getFund(fundId);
    if (fund.status !== 'ACTIVE') throw AppError.conflict(`Quỹ đang ở trạng thái ${fund.status}, không rút được.`);

    const edRows = await db.select({ id: editions.id, coverPrice: editions.coverPrice }).from(editions).where(eq(editions.id, editionId)).limit(1);
    if (edRows.length === 0) throw AppError.invalid('Ấn bản không tồn tại.');
    const cover = edRows[0].coverPrice || 0;
    const drawnValue = quantity * cover;

    // Báo sớm cho thu ngân (nhanh, thân thiện) — nhưng KHÔNG phải chốt chặn.
    // Chốt chặn thật nằm trong transaction (UPDATE có điều kiện bên dưới).
    if (fund.quotaType === 'CAPPED' && drawnValue > (fund.balanceRemaining || 0)) {
      throw AppError.atp(`Vượt hạn mức quỹ: còn ${(fund.balanceRemaining || 0).toLocaleString('vi-VN')}đ, cần ${drawnValue.toLocaleString('vi-VN')}đ.`);
    }
    const avail = await InventoryService.getBalance(editionId, warehouseId, 'NEW');
    if (avail < quantity) throw AppError.atp(`Không đủ tồn để rút: còn ${avail}, cần ${quantity}.`);

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const orderId = `ord-spf-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const orderCode = `SPF-ORD-${dateStr}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const drawId = `spd-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const key = params.idempotencyKey || `idem-spf-draw-${drawId}`;

    // Idempotency theo orderCode của đợt rút
    const dupOrder = params.idempotencyKey
      ? await db.select().from(orders).where(eq(orders.idempotencyKey, params.idempotencyKey)).limit(1)
      : [];
    if (dupOrder.length > 0) {
      return { orderId: dupOrder[0].id, orderCode: dupOrder[0].orderCode, drawId: null as string | null, isDuplicate: true };
    }

    await withDbRetry(async () => {
      await db.transaction(async (tx) => {
        // ĐỌC LẠI QUỸ BẰNG CHÍNH `tx` — bản đọc ở ngoài (getFund) là ảnh chụp cũ.
        // Trước đây phép trừ số dư tính từ ảnh chụp đó nên hai lần rút chạy song
        // song (bấm hai tay, F5, hoặc API lặp) đều vượt hạn mức rồi CÙNG ghi đè
        // nhau: sách đã ra kho 2 lần, sổ quỹ chỉ giảm 1 lần. Đo được trước khi
        // sửa: balance 72.000đ → 36.000đ trong khi 2 drawdown × 36.000đ đã ghi.
        const fundRows = await tx
          .select()
          .from(sponsorshipFunds)
          .where(eq(sponsorshipFunds.id, fundId))
          .limit(1);
        if (fundRows.length === 0) throw AppError.invalid('Không tìm thấy quỹ tài trợ.');
        const fundTx = fundRows[0];
        if (fundTx.status === 'CLOSED') {
          throw AppError.conflict(`Quỹ đang ở trạng thái ${fundTx.status}, không rút được.`);
        }
        const subtotal = drawnValue;
        await tx.insert(orders).values({
          id: orderId,
          orderCode,
          warehouseId,
          channel: 'SPONSORSHIP',
          customerName: fund.sponsorName,
          subtotal,
          discountRate: 1,
          discountAmount: subtotal,
          finalAmount: 0,
          paymentMethod: 'BANK_TRANSFER',
          fiscalScope: 'INTERNAL_MANAGEMENT',
          status: 'COMPLETED',
          syncStatus: 'SYNCED',
          cashierId: drawnBy,
          idempotencyKey: key,
          note: `[SPONSORSHIP: ${fund.fundCode}]${note ? ` ${note}` : ''}`,
        });
        await tx.insert(orderItems).values({
          id: `oi-spf-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
          orderId,
          editionId,
          productId: editionId,
          quantity,
          unitCoverPrice: cover,
          unitDiscountRate: 1,
          unitSellingPrice: 0,
          totalAmount: 0,
        });
        await InventoryService.recordMovement({
          editionId,
          warehouseId,
          eventType: 'SPONSORSHIP_DRAWDOWN',
          quantityDelta: -quantity,
          condition: 'NEW',
          documentRef: orderCode,
          note: `Rút sách tài trợ ${fund.fundCode} (${quantity} cuốn)`,
          actorId: drawnBy,
          correlationId: orderId,
          idempotencyKey: `idem-spf-stock-${orderId}-${editionId}`,
          tx,
        });
        await tx.insert(sponsorshipDrawdowns).values({
          id: drawId,
          fundId,
          orderId,
          editionId,
          warehouseId,
          quantity,
          unitCoverPrice: cover,
          drawnValue,
          drawnBy,
        });
        // Trừ quỹ NGAY TRONG `tx` bằng UPDATE CÓ ĐIỀU KIỆN: số dư phải còn
        // ≥ giá trị rút, và hai tổng phải CỘNG DỒN bằng SQL chứ không gán từ
        // ảnh chụp — gán từ ảnh chụp là mất tiền của mỗi đợt rút chạy song song.
        const capped = fundTx.quotaType === 'CAPPED';
        const res: any = await tx
          .update(sponsorshipFunds)
          .set({
            balanceRemaining: capped
              ? sql`${sponsorshipFunds.balanceRemaining} - ${drawnValue}`
              : sql`${sponsorshipFunds.balanceRemaining}`,
            totalDrawnQty: sql`${sponsorshipFunds.totalDrawnQty} + ${quantity}`,
            totalDrawnValue: sql`${sponsorshipFunds.totalDrawnValue} + ${drawnValue}`,
            // CASE đọc `balance_remaining` TRƯỚC cập nhật (SQLite tính mọi vế SET
            // trên bản ghi gốc) nên đây chính là số dư còn lại sau lần rút này.
            status: capped
              ? sql`CASE WHEN ${sponsorshipFunds.balanceRemaining} - ${drawnValue} <= 0 THEN 'EXHAUSTED' ELSE ${sponsorshipFunds.status} END`
              : sql`${sponsorshipFunds.status}`,
          })
          .where(
            capped
              ? and(eq(sponsorshipFunds.id, fundId), gte(sponsorshipFunds.balanceRemaining, drawnValue))
              : and(eq(sponsorshipFunds.id, fundId), sql`${sponsorshipFunds.status} <> 'CLOSED'`)
          );
        if (res.rowsAffected !== 1) {
          // Đợt rút song song đã giành số dư trước (hoặc quỹ vừa cạn) ⇒ rollback
          // trọn vẹn: không đơn, không bút toán kho, không dòng drawdown.
          const cur = fundTx.balanceRemaining || 0;
          throw AppError.atp(
            `Vượt hạn mức quỹ: còn ${cur.toLocaleString('vi-VN')}đ, cần ${drawnValue.toLocaleString('vi-VN')}đ.`
          );
        }
      });
    });

    return { orderId, orderCode, drawId, isDuplicate: false, drawnValue };
  }

  /** Đóng quỹ (ngừng rút; số dư CAPPED còn lại bảo lưu theo thỏa thuận ngoài). */
  static async closeFund(fundId: string, actorRole: string) {
    if (actorRole !== 'ROLE_OWNER' && actorRole !== 'ROLE_MANAGER') {
      throw AppError.forbidden('Chỉ Manager/Owner được đóng quỹ.');
    }
    const fund = await this.getFund(fundId);
    if (fund.status === 'CLOSED') throw AppError.conflict('Quỹ đã đóng.');
    await db.update(sponsorshipFunds).set({ status: 'CLOSED', closedAt: new Date().toISOString() }).where(eq(sponsorshipFunds.id, fundId));
    return { fundId, status: 'CLOSED' };
  }

  /** Báo cáo đối soát 1 quỹ: tiền rót / đã rút (số cuốn + trị giá) / chi tiết từng đợt. */
  static async getStatement(fundId: string) {
    const fund = await this.getFund(fundId);
    const draws = await db.select().from(sponsorshipDrawdowns).where(eq(sponsorshipDrawdowns.fundId, fundId)).orderBy(desc(sponsorshipDrawdowns.createdAt));
    return { fund, draws, drawCount: draws.length };
  }

  static async list() {
    return await db.select().from(sponsorshipFunds).orderBy(desc(sponsorshipFunds.createdAt)).limit(200);
  }
}
