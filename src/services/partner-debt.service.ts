import {
  db,
  partners,
  deliveryOrders,
  partnerReceipts,
} from '../db';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { AppError } from './app-error';
import { withDbRetry } from '../lib/db-retry';

export interface RecordReceiptParams {
  partnerId: string;
  deliveryOrderId?: string | null;
  amount: number;
  paymentMethod: 'CASH' | 'BANK_TRANSFER';
  reference: string;
  paidAt: string; // YYYY-MM-DD
  receivedBy: string;
  idempotencyKey: string;
  notes?: string;
}

function receiptCode(): string {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `RC-${d}-${rand}`;
}

/**
 * CÔNG NỢ BÁN ĐỨT ĐẠI LÝ (gối đầu + hạn trả).
 *
 * - Mỗi PXK đã khóa là một khoản phải thu (finalAmount).
 * - Mỗi phiếu thu trừ vào nợ chung theo FIFO (phiếu cũ trước);
 *   `deliveryOrderId` chỉ để ghi chú, không gắn cứng phân bổ.
 * - Quá hạn = còn dư sau `dispatchedAt + paymentDueDays`. Chỉ CẢNH BÁO
 *   (summary), không chặn giao hàng mới - chặn là quyết định UX riêng.
 * - Ký gửi KHÔNG dùng bảng này (có `consignment_payments` riêng).
 */
export class PartnerDebtService {
  static async recordReceipt(params: RecordReceiptParams) {
    const {
      partnerId, deliveryOrderId, amount, paymentMethod,
      reference, paidAt, receivedBy, idempotencyKey, notes,
    } = params;
    if (!partnerId?.trim()) throw AppError.invalid('Thiếu đại lý.');
    const sum = Number(amount);
    if (!Number.isFinite(sum) || sum <= 0) throw AppError.invalid('Số tiền thu phải lớn hơn 0.');
    if (paymentMethod !== 'CASH' && paymentMethod !== 'BANK_TRANSFER') {
      throw AppError.invalid('Hình thức thu chỉ CASH hoặc BANK_TRANSFER.');
    }
    if (!`${reference || ''}`.trim()) throw AppError.invalid('Bắt buộc mã bill/sao kê đối chiếu.');
    if (!`${paidAt || ''}`.trim()) throw AppError.invalid('Thiếu ngày tiền về.');
    if (!`${receivedBy || ''}`.trim()) throw AppError.invalid('Thiếu người thu tiền.');
    const key = `${idempotencyKey || ''}`.trim();
    if (!key) throw AppError.invalid('Bắt buộc idempotencyKey (chống thu trùng).');

    return await withDbRetry(async () =>
      db.transaction(async (tx) => {
        const partner = (await tx.select().from(partners).where(eq(partners.id, partnerId)).limit(1))[0];
        if (!partner) throw AppError.invalid(`Không tìm thấy đối tác ${partnerId}.`);
        if (deliveryOrderId) {
          const pxk = (await tx.select().from(deliveryOrders).where(eq(deliveryOrders.id, deliveryOrderId)).limit(1))[0];
          if (!pxk) throw AppError.invalid(`Không tìm thấy phiếu ${deliveryOrderId}.`);
          if (pxk.partnerId !== partnerId) throw AppError.invalid('Phiếu không thuộc đại lý này.');
        }
        const id = receiptCode();
        const nowIso = new Date().toISOString();
        try {
          await tx.insert(partnerReceipts).values({
            id,
            partnerId,
            deliveryOrderId: deliveryOrderId || null,
            amount: sum,
            paymentMethod,
            reference: `${reference}`.trim(),
            paidAt: `${paidAt}`.trim(),
            receivedBy: `${receivedBy}`.trim(),
            status: 'ACTIVE',
            idempotencyKey: key,
            notes: notes || null,
            createdAt: nowIso,
          });
        } catch (e: any) {
          const hay = `${e?.message || ''} ${e?.code || ''} ${e?.cause?.message || ''} ${e?.cause?.code || ''}`;
          if (/UNIQUE constraint|SQLITE_CONSTRAINT_UNIQUE/i.test(hay)) {
            const [dup] = await tx.select().from(partnerReceipts).where(eq(partnerReceipts.idempotencyKey, key)).limit(1);
            return { ...(dup as any), isDuplicate: true as const };
          }
          throw e;
        }
        const [row] = await tx.select().from(partnerReceipts).where(eq(partnerReceipts.id, id)).limit(1);
        return { ...row, isDuplicate: false as const };
      })
    );
  }

  /**
   * Sửa chiết khấu cố định hợp đồng của đại lý (tab Đối tác).
   * Chỉ đổi mức mặc định để phiếu sau prefill theo - phiếu cũ không hồi tố.
   */
  static async updateTerms(params: { id: string; discountRate: number }) {
    return await this.updateProfile({ id: params.id, discountRate: params.discountRate });
  }

  /**
   * Sửa hồ sơ đại lý (tất cả trường giao nhận + điều khoản). Chỉ validate
   * trường nào được gửi lên; trường vắng mặt giữ nguyên.
   */
  static async updateProfile(params: {
    id: string;
    name?: string;
    type?: string;
    discountRate?: number;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    taxCode?: string | null;
    receiverName?: string | null;
    shipNote?: string | null;
    creditLimit?: number;
    paymentDueDays?: number;
    paymentNote?: string | null;
  }) {
    const id = `${params.id || ''}`.trim();
    if (!id) throw AppError.invalid('Thiếu đại lý.');
    const patch: Partial<typeof partners.$inferInsert> = {};
    if (params.name !== undefined) {
      const name = `${params.name || ''}`.trim().slice(0, 120);
      if (!name) throw AppError.invalid('Tên đại lý không được để trống.');
      patch.name = name;
    }
    if (params.type !== undefined) {
      if (!['CONSIGNMENT', 'WHOLESALE'].includes(`${params.type}`)) {
        throw AppError.invalid('Loại đại lý chỉ Ký gửi (CONSIGNMENT) hoặc Bán đứt (WHOLESALE).');
      }
      patch.type = `${params.type}`;
    }
    if (params.discountRate !== undefined) {
      const rate = Number(params.discountRate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
        throw AppError.invalid('Chiết khấu cố định phải từ 0 đến 1 (0%–100%).');
      }
      patch.discountRate = rate;
    }
    const text50 = (v: unknown, label: string, max = 200) => {
      const s = v === null ? null : `${v ?? ''}`.trim().slice(0, max) || null;
      return s;
    };
    if (params.address !== undefined) patch.address = text50(params.address, 'address', 300);
    if (params.receiverName !== undefined) patch.receiverName = text50(params.receiverName, 'receiver', 120);
    if (params.shipNote !== undefined) patch.shipNote = text50(params.shipNote, 'ship', 300);
    if (params.paymentNote !== undefined) patch.paymentNote = text50(params.paymentNote, 'paynote', 300);
    if (params.phone !== undefined) {
      const digits = `${params.phone || ''}`.replace(/\D/g, '');
      if (digits !== '' && (digits.length < 8 || digits.length > 12)) {
        throw AppError.invalid('Số điện thoại phải 8–12 chữ số.');
      }
      patch.phone = digits || null;
    }
    if (params.email !== undefined) {
      const email = `${params.email || ''}`.trim();
      if (email !== '' && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
        throw AppError.invalid('Email không đúng định dạng.');
      }
      patch.email = email || null;
    }
    if (params.taxCode !== undefined) {
      const tax = `${params.taxCode || ''}`.replace(/\D/g, '');
      if (tax !== '' && !(tax.length === 10 || tax.length === 13)) {
        throw AppError.invalid('Mã số thuế phải 10 hoặc 13 chữ số.');
      }
      patch.taxCode = tax || null;
    }
    if (params.creditLimit !== undefined) {
      const lim = Number(params.creditLimit);
      if (!Number.isFinite(lim) || lim < 0) throw AppError.invalid('Hạn mức nợ phải số không âm.');
      patch.creditLimit = Math.round(lim);
    }
    if (params.paymentDueDays !== undefined) {
      const days = Number(params.paymentDueDays);
      if (!Number.isInteger(days) || days < 0 || days > 365) {
        throw AppError.invalid('Hạn trả phải số nguyên 0–365 ngày.');
      }
      patch.paymentDueDays = days;
    }
    if (Object.keys(patch).length === 0) throw AppError.invalid('Không có gì để cập nhật.');
    return await withDbRetry(async () =>
      db.transaction(async (tx) => {
        const [row] = await tx.select().from(partners).where(eq(partners.id, id)).limit(1);
        if (!row) throw AppError.invalid(`Không tìm thấy đối tác ${id}.`);
        await tx.update(partners).set(patch).where(eq(partners.id, id));
        const [after] = await tx.select().from(partners).where(eq(partners.id, id)).limit(1);
        return after;
      })
    );
  }

  static async voidReceipt(params: { id: string; reason: string; actorId: string }) {    const { id, reason } = params;
    if (!`${reason || ''}`.trim()) throw AppError.invalid('Hủy phiếu thu bắt buộc ghi lý do.');
    return await withDbRetry(async () =>
      db.transaction(async (tx) => {
        const [row] = await tx.select().from(partnerReceipts).where(eq(partnerReceipts.id, id)).limit(1);
        if (!row) throw AppError.invalid(`Không tìm thấy phiếu thu ${id}.`);
        if (row.status !== 'ACTIVE') throw AppError.conflict(`Phiếu thu ${id} đã ${row.status}, không hủy lại.`);
        await tx.update(partnerReceipts).set({ status: 'VOIDED', voidReason: `${reason}`.trim() }).where(eq(partnerReceipts.id, id));
        return { id, status: 'VOIDED' as const };
      })
    );
  }

  static async summary(partnerId: string, asOfIso?: string) {
    const [partner] = await db.select().from(partners).where(eq(partners.id, partnerId)).limit(1);
    if (!partner) throw AppError.invalid(`Không tìm thấy đối tác ${partnerId}.`);
    const asOf = asOfIso ? new Date(asOfIso).getTime() : Date.now();
    const dueDays = Number(partner.paymentDueDays ?? 30);
    const creditLimit = Number(partner.creditLimit ?? 0);

    const pxks = await db.select({
      id: deliveryOrders.id,
      finalAmount: deliveryOrders.finalAmount,
      dispatchedAt: deliveryOrders.dispatchedAt,
      createdAt: deliveryOrders.createdAt,
    }).from(deliveryOrders).where(and(
      eq(deliveryOrders.partnerId, partnerId),
      eq(deliveryOrders.status, 'DISPATCHED_LOCKED'),
      eq(deliveryOrders.fiscalScope, 'COMMERCIAL_WHOLESALE')
    )).orderBy(asc(deliveryOrders.dispatchedAt));
    const receipts = await db.select({
      amount: partnerReceipts.amount,
      paidAt: partnerReceipts.paidAt,
    }).from(partnerReceipts).where(and(
      eq(partnerReceipts.partnerId, partnerId),
      eq(partnerReceipts.status, 'ACTIVE')
    )).orderBy(asc(partnerReceipts.paidAt));

    const receivable = pxks.reduce((s, p) => s + Number(p.finalAmount || 0), 0);
    const received = receipts.reduce((s, r) => s + Number(r.amount || 0), 0);
    // FIFO: tiền về trừ phiếu cũ trước.
    let pool = received;
    let overdue = 0;
    let overdueCount = 0;
    let oldestOverdueDays = 0;
    for (const p of pxks) {
      const amt = Number(p.finalAmount || 0);
      const take = Math.min(pool, amt);
      pool -= take;
      const rest = amt - take;
      if (rest > 0) {
        const lockedAt = new Date(p.dispatchedAt || p.createdAt || Date.now()).getTime();
        const dueAt = lockedAt + dueDays * 86400000;
        if (dueAt < asOf) {
          overdue += rest;
          overdueCount++;
          oldestOverdueDays = Math.max(oldestOverdueDays, Math.floor((asOf - dueAt) / 86400000));
        }
      }
    }
    const balance = receivable - received; // âm = khách trả thừa
    return {
      partnerId,
      receivable,
      received,
      balance,
      overdue,
      overdueCount,
      oldestOverdueDays,
      creditLimit,
      overLimit: balance > creditLimit,
    };
  }
}
