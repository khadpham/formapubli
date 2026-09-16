import { db, orders, orderItems, returnOrders, returnOrderItems, returnActions, inventoryLedger, rmaTickets, cashboxSessions } from '../db';
import { InventoryService } from './inventory.service';
import { SELLABLE_WAREHOUSE_IDS } from './order.service';
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
   * Hoàn tất phiếu (APPROVED -> COMPLETED): ghi RETURN_INBOUND nguyên tử.
   * EXCHANGE kèm exchangeItems sẽ trừ kho cuốn thay thế trong cùng transaction.
   */
  static async complete(returnId: string, actorRole: string, exchangeItems?: ReturnItemInput[], actorContext?: ActorContext) {
    if (actorContext) { actorRole = actorContext.role; }
    const effActor = actorContext?.staffId ?? actorRole;
    if (actorRole !== 'ROLE_OWNER' && actorRole !== 'ROLE_MANAGER') {
      throw AppError.forbidden('Chỉ Manager/Owner được hoàn tất phiếu đổi/trả.');
    }
    const { header, items } = await this.getById(returnId);
    if (header.status !== 'APPROVED') throw AppError.conflict(`Phiếu đang ở trạng thái ${header.status}, cần DUYỆT trước khi hoàn tất.`);

    const condition = header.inventoryDisposition === 'RESTOCK' ? 'NEW' : 'QUARANTINE';
    const exLines = exchangeItems || [];
    if (header.returnType === 'EXCHANGE' && exLines.length === 0) {
      throw AppError.invalid('Phiếu EXCHANGE bắt buộc kèm cuốn thay thế (exchangeItems).');
    }
    if (header.returnType !== 'EXCHANGE' && exLines.length > 0) {
      throw AppError.invalid('Chỉ phiếu EXCHANGE mới có cuốn thay thế.');
    }
    for (const ex of exLines) {
      if (!ex.editionId || ex.quantity <= 0 || !Number.isInteger(ex.quantity)) {
        throw AppError.invalid(`Cuốn thay thế ${ex.editionId} phải có số lượng nguyên > 0.`);
      }
      const exEditionId: string = ex.editionId;
      // Contract §3.3.4: cuốn thay thế cũng phải tôn trọng ATP giữ chỗ
      const { OrderService } = await import('./order.service');
      const atpEx = await OrderService.getATP(exEditionId, header.targetWarehouseId);
      if (atpEx < ex.quantity) throw AppError.atp(`Không đủ tồn khả dụng cuốn thay thế ${exEditionId} (còn ${atpEx}, cần ${ex.quantity}). Rollback toàn bộ.`);
    }

    await withDbRetry(async () => {
      await db.transaction(async (tx) => {
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
        // Hàng lỗi: link sang luồng RMA kiểm định có sẵn
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
        // Cuốn thay thế: trừ kho trong cùng transaction (nguyên tử với hoàn kho)
        let exIdx = 0;
        for (const ex of exLines) {
          if (!ex.editionId) throw AppError.invalid('Cuốn thay thế thiếu editionId.');
          await InventoryService.recordMovement({
            editionId: ex.editionId,
            warehouseId: header.targetWarehouseId,
            eventType: 'DISPATCH_SALE',
            quantityDelta: -ex.quantity,
            condition: 'NEW',
            documentRef: header.returnCode,
            note: `Xuất cuốn thay thế phiếu đổi ${header.returnCode}`,
            actorId: effActor,
            correlationId: returnId,
            idempotencyKey: `idem-exchange-${returnId}-${exIdx}-${ex.editionId}`,
            tx,
          });
          exIdx++;
        }
        await tx.update(returnOrders).set({ status: 'COMPLETED', decidedAt: new Date().toISOString() }).where(eq(returnOrders.id, returnId));
      });
    });

    return { returnId, status: 'COMPLETED' };
  }

  /**
   * Hủy phiếu đã hoàn tất (COMPLETED -> VOIDED): sinh bút toán đảo, không xóa.
   * Nếu hàng đã bán tiếp (không đủ tồn để đảo), guard âm kho sẽ từ chối an toàn.
   */
  static async voidReturn(returnId: string, actorRole: string, voidReason: string, actorContext?: ActorContext) {
    if (actorContext) { actorRole = actorContext.role; }
    const effActor = actorContext?.staffId ?? actorRole;
    if (actorRole !== 'ROLE_OWNER' && actorRole !== 'ROLE_MANAGER') {
      throw AppError.forbidden('Chỉ Manager/Owner được hủy phiếu đổi/trả.');
    }
    if (!voidReason || !voidReason.trim()) throw AppError.invalid('Hủy phiếu bắt buộc ghi lý do.');
    const { header } = await this.getById(returnId);
    if (header.status !== 'COMPLETED') throw AppError.conflict(`Chỉ hủy được phiếu COMPLETED (hiện: ${header.status}).`);

    await withDbRetry(async () => {
      await db.transaction(async (tx) => {
        const inbound = await tx.select().from(inventoryLedger).where(eq(inventoryLedger.correlationId, returnId));
        let vIdx = 0;
        for (const row of inbound) {
          // Bỏ qua các dòng đã bị đảo trước đó (tránh đảo 2 lần)
          const alreadyReversed = await tx.select().from(inventoryLedger).where(eq(inventoryLedger.reversalOf, row.id));
          if (alreadyReversed.length > 0) continue;
          await InventoryService.recordMovement({
            editionId: row.editionId,
            warehouseId: row.warehouseId,
            eventType: 'ADJUSTMENT',
            quantityDelta: -row.quantityDelta,
            condition: (row.condition || 'NEW') as 'NEW' | 'MINOR_DAMAGE' | 'DEFECTIVE' | 'QUARANTINE',
            documentRef: header.returnCode,
            note: `Đảo phiếu trả ${header.returnCode} (VOID: ${voidReason.trim()})`,
            actorId: effActor,
            correlationId: returnId,
            reversalOf: row.id,
            idempotencyKey: `idem-void-${returnId}-${vIdx}-${row.editionId}`,
            tx,
          });
          vIdx++;
        }
        await tx.update(returnOrders).set({
          status: 'VOIDED', decidedAt: new Date().toISOString(),
          note: `${header.note ? header.note + ' | ' : ''}[VOID: ${voidReason.trim()}]`,
        }).where(eq(returnOrders.id, returnId));
      });
    });

    return { returnId, status: 'VOIDED' };
  }

  static async list(filters: { orderId?: string; status?: string } = {}) {
    const all = await db.select().from(returnOrders).orderBy(sql`${returnOrders.createdAt} DESC`).limit(200);
    return all.filter((r) => (!filters.orderId || r.orderId === filters.orderId) && (!filters.status || r.status === filters.status));
  }
}
