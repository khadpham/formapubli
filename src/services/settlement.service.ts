import { db, consignmentStatements, consignmentPayments } from '../db';
import { withDbRetry } from '../lib/db-retry';
import { eq, and, desc, sql } from 'drizzle-orm';

/**
 * THU TIỀN CÔNG NỢ KÝ GỬI (CONSIGNMENT SETTLEMENT).
 *
 * - 1 kỳ CONFIRMED cho thu nhiều lần, mỗi lần <= dư nợ còn lại (chặn overpay).
 * - Thu đủ 100% AR -> kỳ chuyển PAID. Tạm ứng không gắn kỳ: tách backlog.
 * - Sai sót xử lý bằng VOID bất biến (giữ record, hoàn hạn mức nợ), cấm xóa cứng.
 * - Vòng đời kỳ: DRAFT -> CONFIRMED -> PAID (VOID phiếu thu lùi PAID về CONFIRMED).
 */
export type SettlementMethod = 'CASH' | 'BANK_TRANSFER';

export interface StatementBalance {
  statementId: string;
  partnerId: string;
  status: string;
  totalReceivable: number;
  paid: number;
  remaining: number;
  paymentsCount: number;
}

function receiptCode(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PT-${date}-${rand}`;
}

export class SettlementService {
  /** Tổng đã thu (ACTIVE) của 1 kỳ. */
  static async paidAmount(statementId: string, txOrDb: any = db): Promise<number> {
    const rows = await txOrDb
      .select({ total: sql<number>`COALESCE(SUM(${consignmentPayments.amount}), 0)` })
      .from(consignmentPayments)
      .where(
        and(
          eq(consignmentPayments.statementId, statementId),
          eq(consignmentPayments.status, 'ACTIVE')
        )
      );
    return Number(rows[0]?.total ?? 0);
  }

  static async getBalance(statementId: string): Promise<StatementBalance> {
    const stmt = (
      await db.select().from(consignmentStatements).where(eq(consignmentStatements.id, statementId)).limit(1)
    )[0];
    if (!stmt) throw new Error(`Không tìm thấy kỳ đối soát ${statementId}.`);
    const paid = await this.paidAmount(statementId);
    return {
      statementId,
      partnerId: stmt.partnerId,
      status: stmt.status,
      totalReceivable: stmt.totalReceivable ?? 0,
      paid,
      remaining: (stmt.totalReceivable ?? 0) - paid,
      paymentsCount: (
        await db
          .select()
          .from(consignmentPayments)
          .where(
            and(
              eq(consignmentPayments.statementId, statementId),
              eq(consignmentPayments.status, 'ACTIVE')
            )
          )
      ).length,
    };
  }

  /** Ghi nhận 1 lần thu tiền vào kỳ đã CONFIRMED/PAID. */
  static async recordPayment(params: {
    statementId: string;
    amount: number;
    paymentMethod: SettlementMethod;
    reference: string;
    paidAt?: string;
    receivedBy: string;
    cashboxSessionId?: string;
    notes?: string;
  }) {
    const { statementId, amount, paymentMethod, reference, receivedBy, cashboxSessionId, notes } = params;
    const paidAt = params.paidAt || new Date().toISOString().slice(0, 10);

    if (!amount || amount <= 0) throw new Error('Số tiền thu phải lớn hơn 0.');
    if (paymentMethod !== 'CASH' && paymentMethod !== 'BANK_TRANSFER') {
      throw new Error('Hình thức chỉ chấp nhận CASH hoặc BANK_TRANSFER.');
    }
    if (!reference || !reference.trim()) throw new Error('Bắt buộc kèm mã tham chiếu giao dịch (reference).');
    if (!receivedBy || !receivedBy.trim()) throw new Error('Bắt buộc ghi rõ người thu tiền.');

    const stmt = (
      await db.select().from(consignmentStatements).where(eq(consignmentStatements.id, statementId)).limit(1)
    )[0];
    if (!stmt) throw new Error(`Không tìm thấy kỳ đối soát ${statementId}.`);
    if (stmt.status !== 'CONFIRMED' && stmt.status !== 'PAID') {
      throw new Error(`Kỳ ${statementId} chưa chốt (${stmt.status}), chỉ thu tiền kỳ đã CONFIRMED.`);
    }

    return await withDbRetry(async () =>
      db.transaction(async (tx) => {
        const paid = await this.paidAmount(statementId, tx);
        const remaining = (stmt.totalReceivable ?? 0) - paid;
        if (amount > remaining) {
          throw new Error(
            `Vượt dư nợ: kỳ ${statementId} còn nợ ${remaining.toLocaleString('vi-VN')} đ, không thu ${amount.toLocaleString('vi-VN')} đ.`
          );
        }

        const id = receiptCode();
        await tx.insert(consignmentPayments).values({
          id,
          partnerId: stmt.partnerId,
          statementId,
          amount,
          paymentMethod,
          reference: reference.trim(),
          paidAt,
          receivedBy: receivedBy.trim(),
          cashboxSessionId,
          status: 'ACTIVE',
          notes,
        });

        const newRemaining = remaining - amount;
        if (newRemaining === 0) {
          await tx
            .update(consignmentStatements)
            .set({ status: 'PAID' })
            .where(eq(consignmentStatements.id, statementId));
        }

        return {
          paymentId: id,
          statementId,
          amount,
          paymentMethod,
          remaining: newRemaining,
          status: newRemaining === 0 ? ('PAID' as const) : (stmt.status as string),
        };
      })
    );
  }

  /** VOID phiếu thu sai: giữ record, hoàn hạn mức, lùi PAID về CONFIRMED. */
  static async voidPayment(paymentId: string, actorId: string, reason: string) {
    if (!reason || !reason.trim()) throw new Error('VOID bắt buộc ghi rõ lý do.');
    const pay = (
      await db.select().from(consignmentPayments).where(eq(consignmentPayments.id, paymentId)).limit(1)
    )[0];
    if (!pay) throw new Error(`Không tìm thấy phiếu thu ${paymentId}.`);
    if (pay.status !== 'ACTIVE') throw new Error(`Phiếu ${paymentId} đã ở trạng thái ${pay.status}.`);

    return await withDbRetry(async () =>
      db.transaction(async (tx) => {
        await tx
          .update(consignmentPayments)
          .set({ status: 'VOIDED', voidReason: reason.trim() })
          .where(eq(consignmentPayments.id, paymentId));

        // Hoàn hạn mức: PAID mà phát sinh dư nợ trở lại -> lùi về CONFIRMED.
        const stmt = (
          await tx
            .select()
            .from(consignmentStatements)
            .where(eq(consignmentStatements.id, pay.statementId))
            .limit(1)
        )[0];
        const paid = await this.paidAmount(pay.statementId, tx);
        const remaining = (stmt.totalReceivable ?? 0) - paid;
        if (stmt.status === 'PAID' && remaining > 0) {
          await tx
            .update(consignmentStatements)
            .set({ status: 'CONFIRMED' })
            .where(eq(consignmentStatements.id, pay.statementId));
        }

        return { paymentId, statementId: pay.statementId, status: 'VOIDED' as const, remaining, voidBy: actorId };
      })
    );
  }

  static async listPayments(filters: { partnerId?: string; statementId?: string; includeVoided?: boolean; limit?: number } = {}) {
    const { partnerId, statementId, includeVoided = false, limit = 50 } = filters;
    const conds = [];
    if (partnerId) conds.push(eq(consignmentPayments.partnerId, partnerId));
    if (statementId) conds.push(eq(consignmentPayments.statementId, statementId));
    if (!includeVoided) conds.push(eq(consignmentPayments.status, 'ACTIVE'));
    if (conds.length > 0) {
      return await db
        .select()
        .from(consignmentPayments)
        .where(and(...conds))
        .orderBy(desc(consignmentPayments.createdAt))
        .limit(limit);
    }
    return await db
      .select()
      .from(consignmentPayments)
      .orderBy(desc(consignmentPayments.createdAt))
      .limit(limit);
  }
}
