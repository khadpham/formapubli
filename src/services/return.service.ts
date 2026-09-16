import { db, orders, orderItems, editions, exchangeReplacementItems, returnOrders, returnOrderItems, returnActions, inventoryLedger, rmaTickets, cashboxSessions } from '../db';
import { InventoryService } from './inventory.service';
import { OrderService, SELLABLE_WAREHOUSE_IDS } from './order.service';
import { eq, and, sql } from 'drizzle-orm';
import { withDbRetry } from '../lib/db-retry';
import { canonicalHash } from '../lib/transfer-fingerprint';
import { ActorContext } from './actor-context';
import { AppError } from './app-error';

export type ReturnType = 'REFUND' | 'EXCHANGE' | 'DAMAGED_REPLACE';
export type ReturnReason = 'PRINTING_DEFECT' | 'WRONG_ITEM' | 'CUSTOMER_CHANGE_MIND' | 'DAMAGED_SHIPPING';
export type ReturnDisposition = 'RESTOCK' | 'DEFECTIVE_HOLD';

const VALID_TYPES: ReturnType[] = ['REFUND', 'EXCHANGE', 'DAMAGED_REPLACE'];
const VALID_REASONS: ReturnReason[] = ['PRINTING_DEFECT', 'WRONG_ITEM', 'CUSTOMER_CHANGE_MIND', 'DAMAGED_SHIPPING'];

// Thời hạn đổi/trả tính từ ngày tạo đơn gốc (server-enforce).
const WINDOW_DAYS: Record<ReturnReason, number> = {
  PRINTING_DEFECT: 30,
  DAMAGED_SHIPPING: 30,
  WRONG_ITEM: 7,
  CUSTOMER_CHANGE_MIND: 7,
};

export interface ReturnItemInput {
  orderItemId?: string; // CP3-R1: định danh dòng mua (bắt buộc cho caller mới)
  editionId?: string; // Tương thích legacy: tự resolve sang orderItemId duy nhất
  quantity: number;
  unitRefund?: number; // Bị bỏ qua: server luôn snapshot từ order_items
}

export interface CreateReturnParams {
  id?: string;
  returnCode?: string;
  orderId: string;
  returnType: ReturnType;
  reason: ReturnReason;
  targetWarehouseId: string;
  inventoryDisposition: ReturnDisposition;
  refundAmount?: number;
  cashboxSessionId?: string;
  createdBy?: string;
  actorRole?: string;
  idempotencyKey?: string;
  note?: string;
  bypassWindow?: boolean; // true khi đã có PIN quản lý / quyền override
  actorContext?: ActorContext; // M1 §1: thắng actorRole/createdBy client gửi
  items: ReturnItemInput[];
}

function daysSince(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return (Date.now() - t) / 86400000;
}

/** true khi lỗi là vi phạm UNIQUE (race cùng key -> replay/CONFLICT, không lọt raw). */
function isUniqueViolation(e: any): boolean {
  const hay = `${e?.message || ''} ${e?.code || ''} ${e?.cause?.message || ''} ${e?.cause?.code || ''}`;
  return /UNIQUE constraint|SQLITE_CONSTRAINT_UNIQUE/i.test(hay);
}

export class ReturnService {
  /** Số lượng đã bán theo từng edition trong đơn gốc. */
  static async getSoldMap(orderId: string): Promise<Map<string, { qty: number; unitPrice: number }>> {
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    const map = new Map<string, { qty: number; unitPrice: number }>();
    for (const l of lines) {
      const cur = map.get(l.editionId) || { qty: 0, unitPrice: l.unitSellingPrice };
      cur.qty += l.quantity;
      map.set(l.editionId, cur);
    }
    return map;
  }

  /** Số lượng đã trả lũy kế (REQUESTED + APPROVED + COMPLETED; loại REJECTED/VOIDED). */
  static async getReturnedMap(orderId: string): Promise<Map<string, number>> {
    const rows = await db
      .select({ editionId: returnOrderItems.editionId, qty: returnOrderItems.quantity, status: returnOrders.status })
      .from(returnOrderItems)
      .innerJoin(returnOrders, eq(returnOrderItems.returnId, returnOrders.id))
      .where(eq(returnOrders.orderId, orderId));
    const map = new Map<string, number>();
    for (const r of rows) {
      if (r.status === 'REJECTED' || r.status === 'VOIDED') continue;
      map.set(r.editionId, (map.get(r.editionId) || 0) + r.qty);
    }
    return map;
  }

  static async getById(returnId: string) {
    const rows = await db.select().from(returnOrders).where(eq(returnOrders.id, returnId)).limit(1);
    if (rows.length === 0) throw AppError.invalid('Không tìm thấy phiếu đổi/trả.');
    const items = await db.select().from(returnOrderItems).where(eq(returnOrderItems.returnId, returnId));
    return { header: rows[0], items };
  }

  /**
   * Lập phiếu đổi/trả (status REQUESTED). CP3-R1: dòng hàng định danh bằng
   * orderItemId, mọi kiểm tra + idempotency + quota nằm trong write tx
   * (BEGIN IMMEDIATE để 2 request đồng thời không cùng ăn một quota).
   * Chưa đụng ledger/két — chỉ snapshot giá và tổng tiền dự kiến.
   */
  static async createRequest(params: CreateReturnParams) {
    const {
      orderId, returnType, reason, targetWarehouseId, inventoryDisposition,
      cashboxSessionId, note, bypassWindow = false,
      items,
    } = params;
    // CP3-R1 repair (mục 1-2): actorContext BẮT BUỘC — không fallback
    // createdBy/actorRole, không suy role.
    if (!params.actorContext?.staffId?.trim()) {
      throw AppError.invalid('Thiếu actorContext cho thao tác lập phiếu đổi/trả.');
    }
    const effRole = params.actorContext.role;
    const effCreatedBy = params.actorContext.staffId.trim();

    if (!VALID_TYPES.includes(returnType)) throw AppError.invalid('returnType không hợp lệ (REFUND | EXCHANGE | DAMAGED_REPLACE).');
    if (!VALID_REASONS.includes(reason)) throw AppError.invalid('reason không hợp lệ.');
    if (inventoryDisposition !== 'RESTOCK' && inventoryDisposition !== 'DEFECTIVE_HOLD') {
      throw AppError.invalid('inventoryDisposition phải là RESTOCK hoặc DEFECTIVE_HOLD.');
    }
    if (!SELLABLE_WAREHOUSE_IDS.includes(targetWarehouseId)) {
      throw AppError.invalid(`Kho nhận hàng trả ${targetWarehouseId} không hợp lệ (chỉ nhận tại: ${SELLABLE_WAREHOUSE_IDS.join(', ')}).`);
    }
    if (!items || items.length === 0) throw AppError.invalid('Phiếu trả phải có ít nhất 1 dòng sách.');
    for (const it of items) {
      if (!Number.isInteger(it.quantity) || (it.quantity as number) <= 0) {
        throw AppError.invalid(`Dòng trả ${it.orderItemId || it.editionId || '?'} phải có số lượng nguyên > 0.`);
      }
    }
    // Quyền lập phiếu: OWNER/MANAGER/CASHIER. TAX và WAREHOUSE bị chặn (mục 6).
    if (effRole !== 'ROLE_OWNER' && effRole !== 'ROLE_MANAGER' && effRole !== 'ROLE_CASHIER') {
      throw AppError.forbidden(`Vai trò ${effRole} không được lập phiếu đổi/trả.`);
    }
    // Key bắt buộc — không tự sinh (mục 1-2).
    const key = params.idempotencyKey?.trim() || '';
    if (!key) {
      throw AppError.invalid('Bắt buộc cung cấp idempotencyKey cho thao tác lập phiếu đổi/trả.');
    }

    return await withDbRetry(() =>
      db.transaction(async (tx) => {
        // Replay check trước mọi tác động.
        const priorReq = await tx
          .select()
          .from(returnOrders)
          .where(eq(returnOrders.idempotencyKey, key))
          .limit(1);
        // Fingerprint tính sau khi resolve dòng (cần orderLine) — đọc order trước.
        const ordRows = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
        if (ordRows.length === 0) throw AppError.invalid('Đơn gốc không tồn tại.');
        const origin: any = ordRows[0];
        if (origin.status !== 'COMPLETED') {
          throw AppError.conflict(`Không thể lập phiếu trả cho đơn hàng có trạng thái '${origin.status}'. Đơn hàng phải ở trạng thái 'COMPLETED'.`);
        }

        // Map orderItemId -> dòng đơn (để validate + snapshot giá server).
        const orderLines: any[] = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
        const lineById = new Map(orderLines.map((l: any) => [l.id, l]));
        const lineByEdition = new Map<string, any[]>();
        for (const l of orderLines) {
          const arr = lineByEdition.get(l.editionId) || [];
          arr.push(l);
          lineByEdition.set(l.editionId, arr);
        }

        // Resolve từng dòng yêu cầu về orderItemId duy nhất.
        const resolved = items.map((it) => {
          let line: any = null;
          if (it.orderItemId) {
            line = lineById.get(it.orderItemId);
            if (!line) {
              throw AppError.invalid(`orderItemId ${it.orderItemId} không thuộc đơn gốc ${orderId}.`);
            }
          } else if (it.editionId) {
            // Tương thích legacy: resolve edition -> dòng đơn duy nhất.
            const cands = lineByEdition.get(it.editionId) || [];
            if (cands.length === 0) throw AppError.invalid(`Ấn bản ${it.editionId} không có trong đơn gốc.`);
            if (cands.length > 1) {
              throw AppError.invalid(`Ấn bản ${it.editionId} xuất hiện nhiều dòng giá trong đơn — bắt buộc chỉ định orderItemId.`);
            }
            line = cands[0];
          } else {
            throw AppError.invalid('Mỗi dòng trả phải có orderItemId (hoặc editionId để resolve).');
          }
          return { orderItemId: line.id, editionId: line.editionId, quantity: it.quantity, unitPrice: line.unitSellingPrice };
        });

        // CP3-R1 repair (mục 3): GỘP các dòng trùng orderItemId TRƯỚC KHI
        // fingerprint, quota và insert — [1+1] và [2] cùng fingerprint.
        const consolidated = new Map<string, { orderItemId: string; editionId: string; quantity: number; unitPrice: number }>();
        for (const r of resolved) {
          const prev = consolidated.get(r.orderItemId);
          if (prev) prev.quantity += r.quantity;
          else consolidated.set(r.orderItemId, { ...r });
        }
        const lines = Array.from(consolidated.values());

        // Fingerprint chuẩn: orderId + loại + lý do + kho + disposition + két
        // + danh sách chuẩn hóa [orderItemId, quantity] (đã gộp).
        const fpLines = lines
          .map((r) => ({ orderItemId: r.orderItemId, quantity: r.quantity }))
          .sort((a, b) => a.orderItemId.localeCompare(b.orderItemId));
        const fingerprint = canonicalHash({
          cashboxSessionId: cashboxSessionId || null,
          inventoryDisposition,
          lines: fpLines,
          orderId,
          reason,
          returnType,
          targetWarehouseId,
        });

        if (priorReq.length > 0) {
          const old = priorReq[0] as any;
          if (old.fingerprint && old.fingerprint !== fingerprint) {
            throw AppError.idempotency(
              `IDEMPOTENCY_CONFLICT: Key "${key}" đã được sử dụng cho một phiếu trả khác (nội dung khác).`
            );
          }
          const oldItems = await tx
            .select()
            .from(returnOrderItems)
            .where(eq(returnOrderItems.returnId, old.id));
          return {
            returnId: old.id, returnCode: old.returnCode, status: old.status,
            isDuplicate: true, itemsCount: oldItems.length,
          };
        }

        // Đơn gốc OFFICIAL_TAX: chỉ Manager/Owner được lập phiếu.
        if (origin.fiscalScope === 'OFFICIAL_TAX' && effRole !== 'ROLE_OWNER' && effRole !== 'ROLE_MANAGER') {
          throw AppError.invalid('Phiếu trả cho đơn VAT chỉ Manager/Owner được lập.');
        }

        // Time window server-side (giữ nguyên legacy).
        const isPrivileged = effRole === 'ROLE_OWNER' || effRole === 'ROLE_MANAGER';
        const ageDays = daysSince(origin.createdAt);
        if (!isPrivileged && !bypassWindow && ageDays > WINDOW_DAYS[reason]) {
          throw AppError.forbidden(`Quá hạn đổi/trả (${Math.floor(ageDays)} ngày > ${WINDOW_DAYS[reason]} ngày cho lý do ${reason}). Cần PIN Quản lý.`);
        }

        // Quota theo orderItemId: đã giữ (REQUESTED/APPROVED/COMPLETED) + mới <= đã bán.
        const heldRows: any[] = await tx
          .select({ orderItemId: returnOrderItems.orderItemId, quantity: returnOrderItems.quantity, status: returnOrders.status })
          .from(returnOrderItems)
          .innerJoin(returnOrders, eq(returnOrderItems.returnId, returnOrders.id))
          .where(eq(returnOrders.orderId, orderId));
        const held = new Map<string, number>();
        for (const r of heldRows) {
          if (r.status === 'REJECTED' || r.status === 'VOIDED') continue;
          if (!r.orderItemId) continue;
          held.set(r.orderItemId, (held.get(r.orderItemId) || 0) + r.quantity);
        }
        const reqSum = new Map<string, number>();
        for (const r of lines) {
          reqSum.set(r.orderItemId, (reqSum.get(r.orderItemId) || 0) + r.quantity);
        }
        for (const [lineId, reqQty] of Array.from(reqSum.entries())) {
          const line = lineById.get(lineId);
          const sold = line.quantity;
          const has = held.get(lineId) || 0;
          if (has + reqQty > sold) {
            throw AppError.overReturnLimit(
              `Vượt số lượng đã bán: dòng ${lineId} đã bán ${sold}, đang giữ ${has}, xin thêm ${reqQty} (vượt giới hạn đơn gốc).`
            );
          }
        }

        // CP3-R1 repair (mục 4): Server TỰ TÍNH refundAmount từ snapshot giá
        // thực bán — bỏ qua mọi giá trị client gửi (kể cả refundAmount param).
        // REFUND: đủ giá trị dòng; EXCHANGE/DAMAGED_REPLACE: 0đ (đổi hàng, không tiền).
        let computedRefund = 0;
        for (const r of lines) computedRefund += r.unitPrice * r.quantity;
        const refundAmount = returnType === 'REFUND' ? computedRefund : 0;

        // Đơn quà tặng (final 0đ): chỉ DAMAGED_REPLACE (không tiền).
        // Kiểm tra TRƯỚC cashbox để gift+REFUND bị chặn đúng mã quà tặng.
        const isGiftOrder = (origin.finalAmount || 0) === 0;
        if (isGiftOrder && returnType !== 'DAMAGED_REPLACE') {
          throw AppError.invalid('Đơn quà tặng chỉ hỗ trợ đổi 1-1 khi lỗi NSX (DAMAGED_REPLACE).');
        }

        // Hoàn tiền mặt bắt buộc gắn két ca đang OPEN (validate, chưa chi tiền).
        if (refundAmount > 0 && origin.paymentMethod === 'CASH') {
          if (!cashboxSessionId) throw AppError.invalid('Hoàn tiền mặt bắt buộc gắn phiên két ca (cashboxSessionId).');
          const sess = await tx.select().from(cashboxSessions).where(eq(cashboxSessions.id, cashboxSessionId)).limit(1);
          if (sess.length === 0 || (sess[0] as any).status !== 'OPEN') {
            throw AppError.invalid('Phiên két ca không tồn tại hoặc đã đóng.');
          }
        }

        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const { id: paramId, returnCode: paramCode } = params;
        const returnId = paramId || `ret-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const returnCode = paramCode || `RET-${dateStr}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

        try {
          await tx.insert(returnOrders).values({
            id: returnId,
            orderId,
            returnCode,
            returnType,
            reason,
            status: 'REQUESTED',
            refundAmount,
            targetWarehouseId,
            inventoryDisposition,
            cashboxSessionId,
            createdBy: effCreatedBy,
            approvedBy: null,
            idempotencyKey: key,
            fingerprint,
            note,
          });
        } catch (e: any) {
          // Race cùng key: UNIQUE thoát ra -> replay/CONFLICT, không lọt raw.
          if (!isUniqueViolation(e)) throw e;
          const raced: any[] = await tx
            .select()
            .from(returnOrders)
            .where(eq(returnOrders.idempotencyKey, key))
            .limit(1);
          if (raced.length === 0) throw e;
          if (raced[0].fingerprint && raced[0].fingerprint !== fingerprint) {
            throw AppError.idempotency(
              `IDEMPOTENCY_CONFLICT: Key "${key}" đã được sử dụng cho một phiếu trả khác (nội dung khác).`
            );
          }
          const racedItems = await tx
            .select()
            .from(returnOrderItems)
            .where(eq(returnOrderItems.returnId, raced[0].id));
          return {
            returnId: raced[0].id, returnCode: raced[0].returnCode, status: raced[0].status,
            isDuplicate: true, itemsCount: racedItems.length,
          };
        }
        for (const r of lines) {
          await tx.insert(returnOrderItems).values({
            id: `ri-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
            returnId,
            editionId: r.editionId,
            orderItemId: r.orderItemId,
            quantity: r.quantity,
            unitRefund: r.unitPrice,
          });
        }

        return { returnId, returnCode, status: 'REQUESTED', isDuplicate: false, itemsCount: lines.length };
      }, { behavior: 'immediate' } as any)
    );
  }

  /**
   * Duyệt phiếu (REQUESTED -> APPROVED). Chỉ Manager/Owner. CP3-R1:
   * conditional update (rowsAffected = 1) + đúng một return_actions APPROVE.
   * Không ledger, không RMA, không tác động tài chính.
   */
  static async approve(returnId: string, actorRole: string, approvedBy: string, actorContext?: ActorContext, idempotencyKey?: string) {
    // CP3-R1 repair (mục 1-2): actorContext + key bắt buộc, không fallback.
    if (!actorContext?.staffId?.trim()) {
      throw AppError.invalid('Thiếu actorContext cho thao tác duyệt phiếu đổi/trả.');
    }
    actorRole = actorContext.role;
    approvedBy = actorContext.staffId.trim();
    if (actorRole !== 'ROLE_OWNER' && actorRole !== 'ROLE_MANAGER') {
      throw AppError.forbidden('Chỉ Manager/Owner được duyệt phiếu đổi/trả.');
    }
    const key = idempotencyKey?.trim() || '';
    if (!key) {
      throw AppError.invalid('Bắt buộc cung cấp idempotencyKey cho thao tác duyệt phiếu đổi/trả.');
    }
    const fingerprint = canonicalHash({ action: 'APPROVE', actorId: approvedBy, returnId });

    return await withDbRetry(() =>
      db.transaction(async (tx) => {
        const prior: any[] = await tx
          .select()
          .from(returnActions)
          .where(eq(returnActions.idempotencyKey, key))
          .limit(1);
        if (prior.length > 0) {
          if (prior[0].fingerprint !== fingerprint) {
            throw AppError.idempotency(
              `IDEMPOTENCY_CONFLICT: Key "${key}" đã được sử dụng cho một thao tác duyệt/trả khác.`
            );
          }
          return { returnId, status: prior[0].resultingStatus, isDuplicate: true as const };
        }

        const upd: any = await tx.run(sql`
          UPDATE return_orders
          SET status = 'APPROVED', approved_by = ${approvedBy}, decided_at = CURRENT_TIMESTAMP
          WHERE id = ${returnId} AND status = 'REQUESTED'
        `);
        if (upd.rowsAffected !== 1) {
          throw AppError.conflict(
            `STATE_CONFLICT: Phiếu ${returnId} không ở trạng thái REQUESTED (đã bị duyệt/từ chối bởi giao dịch song song).`
          );
        }

        try {
          await tx.insert(returnActions).values({
            id: `ra-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            returnId,
            action: 'APPROVE',
            actorId: approvedBy,
            resultingStatus: 'APPROVED',
            idempotencyKey: key,
            fingerprint,
          });
        } catch (e: any) {
          if (!isUniqueViolation(e)) throw e;
          const raced: any[] = await tx
            .select()
            .from(returnActions)
            .where(eq(returnActions.idempotencyKey, key))
            .limit(1);
          if (raced.length === 0) throw e;
          if (raced[0].fingerprint !== fingerprint) {
            throw AppError.idempotency(
              `IDEMPOTENCY_CONFLICT: Key "${key}" đã được sử dụng cho một thao tác duyệt/trả khác.`
            );
          }
          return { returnId, status: raced[0].resultingStatus, isDuplicate: true as const };
        }

        return { returnId, status: 'APPROVED', isDuplicate: false as const };
      })
    );
  }

  /**
   * Từ chối phiếu (REQUESTED -> REJECTED). Chỉ Manager/Owner. CP3-R1:
   * conditional update + đúng một return_actions REJECT. Reject giải phóng quota.
   */
  static async reject(returnId: string, actorRole: string, rejectNote?: string, actorContext?: ActorContext, idempotencyKey?: string) {
    // CP3-R1 repair (mục 1-2): actorContext + key bắt buộc, không fallback.
    if (!actorContext?.staffId?.trim()) {
      throw AppError.invalid('Thiếu actorContext cho thao tác từ chối phiếu đổi/trả.');
    }
    actorRole = actorContext.role;
    if (actorRole !== 'ROLE_OWNER' && actorRole !== 'ROLE_MANAGER') {
      throw AppError.forbidden('Chỉ Manager/Owner được từ chối phiếu đổi/trả.');
    }
    const effActor = actorContext.staffId.trim();
    const key = idempotencyKey?.trim() || '';
    if (!key) {
      throw AppError.invalid('Bắt buộc cung cấp idempotencyKey cho thao tác từ chối phiếu đổi/trả.');
    }
    const fingerprint = canonicalHash({ action: 'REJECT', actorId: effActor, returnId });

    return await withDbRetry(() =>
      db.transaction(async (tx) => {
        const prior: any[] = await tx
          .select()
          .from(returnActions)
          .where(eq(returnActions.idempotencyKey, key))
          .limit(1);
        if (prior.length > 0) {
          if (prior[0].fingerprint !== fingerprint) {
            throw AppError.idempotency(
              `IDEMPOTENCY_CONFLICT: Key "${key}" đã được sử dụng cho một thao tác duyệt/trả khác.`
            );
          }
          return { returnId, status: prior[0].resultingStatus, isDuplicate: true as const };
        }

        const upd: any = await tx.run(sql`
          UPDATE return_orders
          SET status = 'REJECTED', decided_at = CURRENT_TIMESTAMP
          WHERE id = ${returnId} AND status = 'REQUESTED'
        `);
        if (upd.rowsAffected !== 1) {
          throw AppError.conflict(
            `STATE_CONFLICT: Phiếu ${returnId} không ở trạng thái REQUESTED (đã bị duyệt/từ chối bởi giao dịch song song).`
          );
        }

        const header: any = (
          await tx.select().from(returnOrders).where(eq(returnOrders.id, returnId)).limit(1)
        )[0];
        try {
          await tx.insert(returnActions).values({
            id: `ra-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            returnId,
            action: 'REJECT',
            actorId: effActor,
            resultingStatus: 'REJECTED',
            idempotencyKey: key,
            fingerprint,
          });
        } catch (e: any) {
          if (!isUniqueViolation(e)) throw e;
          const raced: any[] = await tx
            .select()
            .from(returnActions)
            .where(eq(returnActions.idempotencyKey, key))
            .limit(1);
          if (raced.length === 0) throw e;
          if (raced[0].fingerprint !== fingerprint) {
            throw AppError.idempotency(
              `IDEMPOTENCY_CONFLICT: Key "${key}" đã được sử dụng cho một thao tác duyệt/trả khác.`
            );
          }
          return { returnId, status: raced[0].resultingStatus, isDuplicate: true as const };
        }

        if (rejectNote) {
          await tx
            .update(returnOrders)
            .set({ note: `${header?.note ? header.note + ' | ' : ''}[TỪ CHỐI: ${rejectNote}]` })
            .where(eq(returnOrders.id, returnId));
        }

        return { returnId, status: 'REJECTED', isDuplicate: false as const };
      })
    );
  }

  /**
   * Hoàn tất phiếu REFUND (APPROVED -> COMPLETED). CP3-R2:
   * - actorContext + idempotencyKey bắt buộc.
   * - EXCHANGE / DAMAGED_REPLACE fail-closed giữ cho R3.
   * - Toàn bộ trong một write tx: replay/fingerprint, đọc APPROVED,
   *   kiểm tra lại quota, két OPEN (CASH), conditional update,
   *   RETURN_INBOUND (NEW/QUARANTINE + RMA cùng tx), return_actions.
   * - Refund dùng đúng refundAmount server đã chốt khi lập phiếu.
   * - Không bút toán tiền riêng (báo cáo két đọc return_orders COMPLETED).
   */
  /**
   * Hoàn tất phiếu đổi/trả (APPROVED -> COMPLETED). CP3-R3:
   * - actorContext + idempotencyKey bắt buộc.
   * - Hỗ trợ REFUND, EXCHANGE, DAMAGED_REPLACE.
   * - REFUND: Két OPEN (nếu CASH + refund > 0), RETURN_INBOUND (NEW/QUARANTINE + RMA).
   * - EXCHANGE: Kiểm tra đối ứng ngang giá VNĐ chính xác, kiểm tra ATP sách thay thế,
   *   nhập sách trả + xuất sách đổi (DISPATCH_SALE) + ghi exchange_replacement_items.
   * - DAMAGED_REPLACE: Đổi bảo hành 0đ, nhập lỗi QUARANTINE + RMA, xuất sách mới từ NEW.
   * - Toàn bộ trong một write tx: replay/fingerprint, đọc APPROVED,
   *   kiểm tra lại quota, conditional update, inventory movements, return_actions.
   */
  static async complete(
    returnId: string, actorRole: string, exchangeItems?: ReturnItemInput[],
    actorContext?: ActorContext, idempotencyKey?: string,
  ) {
    if (!actorContext?.staffId?.trim()) {
      throw AppError.invalid('Thiếu actorContext cho thao tác hoàn tất phiếu đổi/trả.');
    }
    actorRole = actorContext.role;
    const effActor = actorContext.staffId.trim();
    if (actorRole !== 'ROLE_OWNER' && actorRole !== 'ROLE_MANAGER') {
      throw AppError.forbidden('Chỉ Manager/Owner được hoàn tất phiếu đổi/trả.');
    }
    const key = idempotencyKey?.trim() || '';
    if (!key) {
      throw AppError.invalid('Bắt buộc cung cấp idempotencyKey cho thao tác hoàn tất phiếu đổi/trả.');
    }

    const normalizedEx = Array.isArray(exchangeItems) && exchangeItems.length > 0
      ? exchangeItems
          .map((it) => ({
            editionId: it.editionId?.trim() || '',
            quantity: Number(it.quantity) || 0,
          }))
          .filter((it) => it.quantity > 0)
          .sort((a, b) => a.editionId.localeCompare(b.editionId))
      : undefined;

    const fingerprint = canonicalHash({
      action: 'COMPLETE',
      actorId: effActor,
      returnId,
      ...(normalizedEx && normalizedEx.length > 0 ? { exchangeItems: normalizedEx } : {}),
    });

    return await withDbRetry(() =>
      db.transaction(async (tx) => {
        // 1. Replay check.
        const prior: any[] = await tx
          .select()
          .from(returnActions)
          .where(eq(returnActions.idempotencyKey, key))
          .limit(1);
        if (prior.length > 0) {
          if (prior[0].fingerprint !== fingerprint) {
            throw AppError.idempotency(
              `IDEMPOTENCY_CONFLICT: Key "${key}" đã được sử dụng cho một thao tác hoàn tất khác.`
            );
          }
          return { returnId, status: prior[0].resultingStatus, isDuplicate: true as const };
        }

        // 2. Đọc phiếu: phải APPROVED.
        const header: any = (
          await tx.select().from(returnOrders).where(eq(returnOrders.id, returnId)).limit(1)
        )[0];
        if (!header) throw AppError.invalid(`Không tìm thấy phiếu đổi/trả ${returnId}.`);
        if (header.status !== 'APPROVED') {
          throw AppError.conflict(
            `STATE_CONFLICT: Phiếu ${returnId} đang ở trạng thái ${header.status}, cần APPROVED để hoàn tất.`
          );
        }

        const items: any[] = await tx
          .select()
          .from(returnOrderItems)
          .where(eq(returnOrderItems.returnId, returnId));

        // 3. Kiểm tra lại quota (trừ chính phiếu này).
        const orderLines: any[] = await tx
          .select()
          .from(orderItems)
          .where(eq(orderItems.orderId, header.orderId));
        const soldByLine = new Map(orderLines.map((l: any) => [l.id, l.quantity]));
        const heldRows: any[] = await tx
          .select({ orderItemId: returnOrderItems.orderItemId, quantity: returnOrderItems.quantity, status: returnOrders.status, returnId: returnOrders.id })
          .from(returnOrderItems)
          .innerJoin(returnOrders, eq(returnOrderItems.returnId, returnOrders.id))
          .where(eq(returnOrders.orderId, header.orderId));
        const heldOther = new Map<string, number>();
        for (const r of heldRows) {
          if (r.status === 'REJECTED' || r.status === 'VOIDED') continue;
          if (r.returnId === returnId) continue;
          if (!r.orderItemId) continue;
          heldOther.set(r.orderItemId, (heldOther.get(r.orderItemId) || 0) + r.quantity);
        }
        for (const it of items) {
          const sold = soldByLine.get(it.orderItemId) ?? 0;
          const others = heldOther.get(it.orderItemId) || 0;
          if (it.quantity + others > sold) {
            throw AppError.overReturnLimit(
              `Vượt số lượng đã bán khi hoàn tất: dòng ${it.orderItemId} đã bán ${sold}, phiếu khác giữ ${others}, phiếu này ${it.quantity}.`
            );
          }
        }

        // 4. Xử lý theo từng loại phiếu:
        const replacementDetails: Array<{ editionId: string; quantity: number; coverPrice: number }> = [];

        if (header.returnType === 'REFUND') {
          if (exchangeItems && exchangeItems.length > 0) {
            throw AppError.invalid('Phiếu hoàn tiền REFUND không nhận cuốn thay thế.');
          }
          // Két: đơn CASH + refund > 0 -> session phải OPEN, đúng kho, đúng chủ.
          const refundAmount = header.refundAmount || 0;
          if (refundAmount > 0) {
            const origin: any = (
              await tx.select().from(orders).where(eq(orders.id, header.orderId)).limit(1)
            )[0];
            if (origin && origin.paymentMethod === 'CASH') {
              if (!header.cashboxSessionId) {
                throw AppError.invalid('Hoàn tiền mặt bắt buộc gắn phiên két ca (cashboxSessionId).');
              }
              const sess: any = (
                await tx.select().from(cashboxSessions).where(eq(cashboxSessions.id, header.cashboxSessionId)).limit(1)
              )[0];
              if (!sess || sess.status !== 'OPEN') {
                throw AppError.conflict(
                  `STATE_CONFLICT: Phiên két ${header.cashboxSessionId} không OPEN — rollback toàn bộ phiếu hoàn.`
                );
              }
              if (sess.warehouseId !== header.targetWarehouseId) {
                throw AppError.conflict(
                  `STATE_CONFLICT: Két ${sess.id} thuộc kho ${sess.warehouseId}, không khớp kho trả ${header.targetWarehouseId} — rollback toàn bộ.`
                );
              }
              if (sess.cashierId !== effActor) {
                throw AppError.forbidden(
                  `FORBIDDEN: Két ${sess.id} thuộc thu ngân ${sess.cashierId}, người hoàn tất ${effActor} không phải chủ sở hữu — rollback toàn bộ.`
                );
              }
            }
          }
        } else if (header.returnType === 'EXCHANGE') {
          const exLines = Array.isArray(exchangeItems) ? exchangeItems : [];
          if (exLines.length === 0) {
            throw AppError.invalid('Phiếu đổi hàng EXCHANGE bắt buộc có danh sách ấn bản thay thế (exchangeItems).');
          }
          const exchangeMap = new Map<string, number>();
          for (const ex of exLines) {
            if (!ex.editionId?.trim()) throw AppError.invalid('Cuốn thay thế thiếu editionId.');
            const q = Number(ex.quantity);
            if (!Number.isInteger(q) || q <= 0) {
              throw AppError.invalid(`Số lượng cuốn thay thế không hợp lệ: ${ex.quantity}`);
            }
            const edId = ex.editionId.trim();
            exchangeMap.set(edId, (exchangeMap.get(edId) || 0) + q);
          }

          const oldRefundableValue = items.reduce(
            (sum, it) => sum + Math.round(Number(it.quantity) * Number(it.unitRefund || 0)),
            0
          );

          let replacementValue = 0;
          for (const [editionId, quantity] of Array.from(exchangeMap.entries())) {
            const edRow: any = (
              await tx.select().from(editions).where(eq(editions.id, editionId)).limit(1)
            )[0];
            if (!edRow) throw AppError.invalid(`Ấn bản thay thế ${editionId} không tồn tại.`);
            const coverPrice = Math.round(Number(edRow.coverPrice || 0));
            replacementValue += quantity * coverPrice;
            replacementDetails.push({ editionId, quantity, coverPrice });
          }

          if (oldRefundableValue !== replacementValue) {
            throw AppError.invalid(
              `Giá trị sách đổi (${replacementValue.toLocaleString('vi-VN')} đ) không bằng giá trị sách trả (${oldRefundableValue.toLocaleString('vi-VN')} đ). Chênh lệch: ${(replacementValue - oldRefundableValue).toLocaleString('vi-VN')} đ.`
            );
          }

          for (const rep of replacementDetails) {
            const atp = await OrderService.getATP(rep.editionId, header.targetWarehouseId, tx);
            if (atp < rep.quantity) {
              throw AppError.atp(
                `Không đủ tồn khả dụng (ATP) để xuất sách thay thế: ấn bản ${rep.editionId} tại kho ${header.targetWarehouseId} chỉ còn ${atp} cuốn, cần ${rep.quantity} cuốn.`
              );
            }
          }
        } else if (header.returnType === 'DAMAGED_REPLACE') {
          // Đổi bảo hành lỗi in 0đ
          if (Array.isArray(exchangeItems) && exchangeItems.length > 0) {
            const exchangeMap = new Map<string, number>();
            for (const ex of exchangeItems) {
              if (!ex.editionId?.trim()) throw AppError.invalid('Cuốn thay thế thiếu editionId.');
              const q = Number(ex.quantity);
              if (!Number.isInteger(q) || q <= 0) throw AppError.invalid(`Số lượng cuốn thay thế không hợp lệ: ${ex.quantity}`);
              const edId = ex.editionId.trim();
              exchangeMap.set(edId, (exchangeMap.get(edId) || 0) + q);
            }
            for (const [editionId, quantity] of Array.from(exchangeMap.entries())) {
              replacementDetails.push({ editionId, quantity, coverPrice: 0 });
            }
          } else {
            for (const it of items) {
              replacementDetails.push({ editionId: it.editionId, quantity: it.quantity, coverPrice: 0 });
            }
          }

          for (const rep of replacementDetails) {
            const atp = await OrderService.getATP(rep.editionId, header.targetWarehouseId, tx);
            if (atp < rep.quantity) {
              throw AppError.atp(
                `Không đủ tồn khả dụng (ATP) để xuất sách đổi bảo hành: ấn bản ${rep.editionId} tại kho ${header.targetWarehouseId} chỉ còn ${atp} cuốn, cần ${rep.quantity} cuốn.`
              );
            }
          }
        }

        // 5. Conditional update APPROVED -> COMPLETED.
        const upd: any = await tx.run(sql`
          UPDATE return_orders
          SET status = 'COMPLETED', decided_at = CURRENT_TIMESTAMP
          WHERE id = ${returnId} AND status = 'APPROVED'
        `);
        if (upd.rowsAffected !== 1) {
          throw AppError.conflict(
            `STATE_CONFLICT: Phiếu ${returnId} đã rời APPROVED bởi giao dịch song song.`
          );
        }

        // 6. RETURN_INBOUND: Hoàn kho sách trả lại (RESTOCK -> NEW; DEFECTIVE_HOLD -> QUARANTINE + RMA).
        const condition = header.inventoryDisposition === 'RESTOCK' ? 'NEW' : 'QUARANTINE';
        let lineIdx = 0;
        for (const it of items) {
          await InventoryService.recordMovement({
            editionId: it.editionId,
            warehouseId: header.targetWarehouseId,
            eventType: 'RETURN_INBOUND',
            quantityDelta: it.quantity,
            condition: condition as 'NEW' | 'QUARANTINE',
            documentRef: header.returnCode,
            note: `Hoàn kho phiếu ${header.returnCode} (${header.inventoryDisposition}) từ đơn ${header.orderId}`,
            actorId: effActor,
            correlationId: returnId,
            idempotencyKey: `idem-return-${returnId}-${lineIdx}-${it.editionId}`,
            tx,
          });
          lineIdx++;
        }

        // Fault hook R-ATOMIC (test-only): ép lỗi SAU inbound để kiểm chứng rollback.
        if (
          process.env.CP3_R2_FAULT === 'after-inbound' &&
          process.env.CP3_R2_FAULT_RETURN === returnId
        ) {
          throw AppError.conflict('CP3_R2_FAULT: lỗi ép kiểm chứng atomicity (after-inbound).');
        }

        if (header.inventoryDisposition === 'DEFECTIVE_HOLD') {
          for (const it of items) {
            await tx.insert(rmaTickets).values({
              id: `rma-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
              warehouseId: header.targetWarehouseId,
              orderId: header.orderId,
              editionId: it.editionId,
              quantity: it.quantity,
              defectReason: header.reason === 'PRINTING_DEFECT' ? 'PRINT_DEFECT' : 'CUSTOMER_RETURN',
              quarantineCondition: 'QUARANTINE',
              resolutionAction: 'HOLD_IN_QUARANTINE',
              inspectedBy: effActor,
              status: 'QUARANTINED',
              notes: `Từ phiếu trả ${header.returnCode}`,
            });
          }
        }

        // 7. Xuất sách thay thế cho EXCHANGE và DAMAGED_REPLACE.
        let exIdx = 0;
        for (const rep of replacementDetails) {
          await InventoryService.recordMovement({
            editionId: rep.editionId,
            warehouseId: header.targetWarehouseId,
            eventType: 'DISPATCH_SALE',
            quantityDelta: -rep.quantity,
            condition: 'NEW',
            documentRef: header.returnCode,
            note: `Xuất cuốn thay thế phiếu đổi ${header.returnCode}`,
            actorId: effActor,
            correlationId: returnId,
            idempotencyKey: `idem-exchange-${returnId}-${exIdx}-${rep.editionId}`,
            tx,
          });
          await tx.insert(exchangeReplacementItems).values({
            id: `exi-${Date.now()}-${Math.random().toString(36).substring(2, 7)}-${exIdx}`,
            returnId,
            editionId: rep.editionId,
            quantity: rep.quantity,
            unitPrice: rep.coverPrice,
          });
          exIdx++;
        }

        // 8. Ghi return_actions (UNIQUE -> replay/CONFLICT).
        try {
          await tx.insert(returnActions).values({
            id: `ra-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            returnId,
            action: 'COMPLETE',
            actorId: effActor,
            resultingStatus: 'COMPLETED',
            idempotencyKey: key,
            fingerprint,
          });
        } catch (e: any) {
          const hay = `${e?.message || ''} ${e?.code || ''}`;
          if (!/UNIQUE constraint|SQLITE_CONSTRAINT_UNIQUE/i.test(hay)) throw e;
          const raced: any[] = await tx
            .select()
            .from(returnActions)
            .where(eq(returnActions.idempotencyKey, key))
            .limit(1);
          if (raced.length === 0) throw e;
          if (raced[0].fingerprint !== fingerprint) {
            throw AppError.idempotency(
              `IDEMPOTENCY_CONFLICT: Key "${key}" đã được sử dụng cho một thao tác hoàn tất khác.`
            );
          }
          return { returnId, status: raced[0].resultingStatus, isDuplicate: true as const };
        }

        return { returnId, status: 'COMPLETED', refundAmount: header.refundAmount || 0, isDuplicate: false as const };
      })
    );
  }

  /**
   * Hủy phiếu đã hoàn tất (COMPLETED -> VOIDED): sinh bút toán đảo, không xóa.
   * Nếu hàng đã bán tiếp (không đủ tồn để đảo), guard âm kho sẽ từ chối an toàn.
   * Ràng buộc két: nếu phiếu có hoàn tiền mặt (refundAmount > 0), phiên két ca gốc
   * bắt buộc phải còn OPEN (chặn hủy tài chính khi két đã đóng).
   */
  static async voidReturn(
    returnId: string,
    actorRole: string,
    voidReason: string,
    actorContext?: ActorContext,
    idempotencyKey?: string,
  ) {
    if (!actorContext?.staffId?.trim()) {
      throw AppError.invalid('Thiếu actorContext cho thao tác hủy phiếu đổi/trả.');
    }
    actorRole = actorContext.role;
    const effActor = actorContext.staffId.trim();
    if (actorRole !== 'ROLE_OWNER' && actorRole !== 'ROLE_MANAGER') {
      throw AppError.forbidden('Chỉ Manager/Owner được hủy phiếu đổi/trả.');
    }
    const reason = voidReason?.trim() || '';
    if (!reason) {
      throw AppError.invalid('Hủy phiếu bắt buộc ghi lý do.');
    }
    const key = idempotencyKey?.trim() || '';
    if (!key) {
      throw AppError.invalid('Bắt buộc cung cấp idempotencyKey cho thao tác hủy phiếu đổi/trả.');
    }
    const fingerprint = canonicalHash({ action: 'VOID', actorId: effActor, returnId, voidReason: reason });

    return await withDbRetry(() =>
      db.transaction(async (tx) => {
        // 1. Replay check
        const prior: any[] = await tx
          .select()
          .from(returnActions)
          .where(eq(returnActions.idempotencyKey, key))
          .limit(1);
        if (prior.length > 0) {
          if (prior[0].fingerprint !== fingerprint) {
            throw AppError.idempotency(
              `IDEMPOTENCY_CONFLICT: Key "${key}" đã được sử dụng cho một thao tác hủy khác.`
            );
          }
          return { returnId, status: prior[0].resultingStatus, isDuplicate: true as const };
        }

        // 2. Read return order: must be COMPLETED
        const header: any = (
          await tx.select().from(returnOrders).where(eq(returnOrders.id, returnId)).limit(1)
        )[0];
        if (!header) throw AppError.invalid(`Không tìm thấy phiếu đổi/trả ${returnId}.`);
        if (header.status !== 'COMPLETED') {
          throw AppError.conflict(
            `STATE_CONFLICT: Chỉ hủy được phiếu COMPLETED (hiện tại: ${header.status}).`
          );
        }

        // 3. Cashbox session guard: if refundAmount > 0 and origin is CASH, cashbox must still be OPEN
        const refundAmount = header.refundAmount || 0;
        if (refundAmount > 0) {
          const origin: any = (
            await tx.select().from(orders).where(eq(orders.id, header.orderId)).limit(1)
          )[0];
          if (origin && origin.paymentMethod === 'CASH') {
            if (!header.cashboxSessionId) {
              throw AppError.conflict(
                'STATE_CONFLICT: Phiếu hoàn tiền mặt thiếu cashboxSessionId, không thể hủy.'
              );
            }
            const sess: any = (
              await tx
                .select()
                .from(cashboxSessions)
                .where(eq(cashboxSessions.id, header.cashboxSessionId))
                .limit(1)
            )[0];
            if (!sess || sess.status !== 'OPEN') {
              throw AppError.conflict(
                `STATE_CONFLICT: Phiên két ${header.cashboxSessionId} không còn OPEN — từ chối hủy tài chính phiếu hoàn tiền mặt.`
              );
            }
          }
        }

        // 4. Conditional update COMPLETED -> VOIDED
        const upd: any = await tx.run(sql`
          UPDATE return_orders
          SET status = 'VOIDED', decided_at = CURRENT_TIMESTAMP,
              note = CASE WHEN note IS NULL OR note = '' THEN ${`[VOID: ${reason}]`} ELSE note || ${` | [VOID: ${reason}]`} END
          WHERE id = ${returnId} AND status = 'COMPLETED'
        `);
        if (upd.rowsAffected !== 1) {
          throw AppError.conflict(
            `STATE_CONFLICT: Phiếu ${returnId} đã rời COMPLETED bởi giao dịch song song.`
          );
        }

        // 5. Invert inventory movements
        const movements: any[] = await tx
          .select()
          .from(inventoryLedger)
          .where(eq(inventoryLedger.correlationId, returnId));
        let vIdx = 0;
        for (const row of movements) {
          const alreadyReversed: any[] = await tx
            .select()
            .from(inventoryLedger)
            .where(eq(inventoryLedger.reversalOf, row.id))
            .limit(1);
          if (alreadyReversed.length > 0) continue;

          await InventoryService.recordMovement({
            editionId: row.editionId,
            warehouseId: row.warehouseId,
            eventType: 'ADJUSTMENT',
            quantityDelta: -row.quantityDelta,
            condition: (row.condition || 'NEW') as any,
            documentRef: header.returnCode,
            note: `Đảo phiếu đổi/trả ${header.returnCode} (VOID: ${reason})`,
            actorId: effActor,
            correlationId: returnId,
            reversalOf: row.id,
            idempotencyKey: `idem-void-${returnId}-${vIdx}-${row.editionId}`,
            tx,
          });
          vIdx++;
        }

        // 6. Ghi return_actions
        try {
          await tx.insert(returnActions).values({
            id: `ra-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            returnId,
            action: 'VOID',
            actorId: effActor,
            resultingStatus: 'VOIDED',
            idempotencyKey: key,
            fingerprint,
          });
        } catch (e: any) {
          const hay = `${e?.message || ''} ${e?.code || ''}`;
          if (!/UNIQUE constraint|SQLITE_CONSTRAINT_UNIQUE/i.test(hay)) throw e;
          const raced: any[] = await tx
            .select()
            .from(returnActions)
            .where(eq(returnActions.idempotencyKey, key))
            .limit(1);
          if (raced.length === 0) throw e;
          if (raced[0].fingerprint !== fingerprint) {
            throw AppError.idempotency(
              `IDEMPOTENCY_CONFLICT: Key "${key}" đã được sử dụng cho một thao tác hủy khác.`
            );
          }
          return { returnId, status: raced[0].resultingStatus, isDuplicate: true as const };
        }

        return { returnId, status: 'VOIDED', isDuplicate: false as const };
      })
    );
  }

  static async list(filters: { orderId?: string; status?: string } = {}) {
    const all = await db.select().from(returnOrders).orderBy(sql`${returnOrders.createdAt} DESC`).limit(200);
    return all.filter((r) => (!filters.orderId || r.orderId === filters.orderId) && (!filters.status || r.status === filters.status));
  }
}
