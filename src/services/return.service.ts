import { db, orders, orderItems, returnOrders, returnOrderItems, inventoryLedger, rmaTickets, cashboxSessions } from '../db';
import { InventoryService } from './inventory.service';
import { eq, and, sql } from 'drizzle-orm';
import { withDbRetry } from '../lib/db-retry';

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
  editionId: string;
  quantity: number;
  unitRefund?: number;
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
  items: ReturnItemInput[];
}

function daysSince(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return (Date.now() - t) / 86400000;
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
    if (rows.length === 0) throw new Error('Không tìm thấy phiếu đổi/trả.');
    const items = await db.select().from(returnOrderItems).where(eq(returnOrderItems.returnId, returnId));
    return { header: rows[0], items };
  }

  /** Lập phiếu đổi/trả (status REQUESTED). Chưa đụng ledger. */
  static async createRequest(params: CreateReturnParams) {
    const {
      orderId, returnType, reason, targetWarehouseId, inventoryDisposition,
      refundAmount = 0, cashboxSessionId, createdBy = 'staff-admin',
      actorRole = 'ROLE_OWNER', idempotencyKey, note, bypassWindow = false,
      items,
    } = params;

    if (!VALID_TYPES.includes(returnType)) throw new Error('returnType không hợp lệ (REFUND | EXCHANGE | DAMAGED_REPLACE).');
    if (!VALID_REASONS.includes(reason)) throw new Error('reason không hợp lệ.');
    if (inventoryDisposition !== 'RESTOCK' && inventoryDisposition !== 'DEFECTIVE_HOLD') {
      throw new Error('inventoryDisposition phải là RESTOCK hoặc DEFECTIVE_HOLD.');
    }
    if (!items || items.length === 0) throw new Error('Phiếu trả phải có ít nhất 1 dòng sách.');
    for (const it of items) {
      if (!it.editionId || it.quantity <= 0 || !Number.isInteger(it.quantity)) {
        throw new Error(`Dòng trả ${it.editionId} phải có số lượng nguyên > 0.`);
      }
    }
    if (actorRole === 'ROLE_TAX') throw new Error('Kế toán thuế không được lập phiếu đổi/trả.');

    // Idempotency: gửi trùng key trả về phiếu cũ
    if (idempotencyKey) {
      const dup = await db.select().from(returnOrders).where(eq(returnOrders.idempotencyKey, idempotencyKey)).limit(1);
      if (dup.length > 0) {
        const dupItems = await db.select().from(returnOrderItems).where(eq(returnOrderItems.returnId, dup[0].id));
        return { returnId: dup[0].id, returnCode: dup[0].returnCode, status: dup[0].status, isDuplicate: true, itemsCount: dupItems.length };
      }
    }

    const ordRows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (ordRows.length === 0) throw new Error('Đơn gốc không tồn tại.');
    const origin = ordRows[0];

    // Đơn gốc OFFICIAL_TAX: chỉ Manager/Owner được lập phiếu
    if (origin.fiscalScope === 'OFFICIAL_TAX' && actorRole !== 'ROLE_OWNER' && actorRole !== 'ROLE_MANAGER') {
      throw new Error('Phiếu trả cho đơn VAT chỉ Manager/Owner được lập.');
    }

    // Time window server-side (privileged hoặc bypassWindow với PIN được miễn)
    const isPrivileged = actorRole === 'ROLE_OWNER' || actorRole === 'ROLE_MANAGER';
    const ageDays = daysSince(origin.createdAt);
    if (!isPrivileged && !bypassWindow && ageDays > WINDOW_DAYS[reason]) {
      throw new Error(`Quá hạn đổi/trả (${Math.floor(ageDays)} ngày > ${WINDOW_DAYS[reason]} ngày cho lý do ${reason}). Cần PIN Quản lý.`);
    }

    const soldMap = await this.getSoldMap(orderId);
    const returnedMap = await this.getReturnedMap(orderId);

    // Guard chống hoàn kho vô hạn: lũy kế trả + mới <= đã bán (từng edition)
    for (const it of items) {
      const sold = soldMap.get(it.editionId)?.qty || 0;
      if (sold <= 0) throw new Error(`Ấn bản ${it.editionId} không có trong đơn gốc.`);
      const returned = returnedMap.get(it.editionId) || 0;
      if (returned + it.quantity > sold) {
        throw new Error(`Vượt số lượng đã bán: ${it.editionId} đã bán ${sold}, đã trả ${returned}, xin thêm ${it.quantity}.`);
      }
    }

    // Đơn quà tặng (final 0đ): refund bắt buộc 0, chỉ đổi bảo hành lỗi
    const isGiftOrder = (origin.finalAmount || 0) === 0;
    if (isGiftOrder) {
      if (refundAmount !== 0) throw new Error('Đơn quà tặng không được hoàn tiền mặt (refundAmount phải = 0).');
      if (returnType !== 'DAMAGED_REPLACE') throw new Error('Đơn quà tặng chỉ hỗ trợ đổi 1-1 khi lỗi NSX (DAMAGED_REPLACE).');
    }

    // Trần hoàn tiền: không vượt giá trị thực bán của các dòng trả
    let maxRefund = 0;
    for (const it of items) {
      maxRefund += (soldMap.get(it.editionId)?.unitPrice || 0) * it.quantity;
    }
    if (refundAmount < 0 || refundAmount > maxRefund) {
      throw new Error(`Tiền hoàn ${refundAmount} vượt giá trị thực bán ${maxRefund} của các dòng trả.`);
    }

    // Hoàn tiền mặt bắt buộc gắn két ca đang OPEN
    if (refundAmount > 0 && origin.paymentMethod === 'CASH') {
      if (!cashboxSessionId) throw new Error('Hoàn tiền mặt bắt buộc gắn phiên két ca (cashboxSessionId).');
      const sess = await db.select().from(cashboxSessions).where(eq(cashboxSessions.id, cashboxSessionId)).limit(1);
      if (sess.length === 0 || sess[0].status !== 'OPEN') throw new Error('Phiên két ca không tồn tại hoặc đã đóng.');
    }

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const returnId = params.id || `ret-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const returnCode = params.returnCode || `RET-${dateStr}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const key = idempotencyKey || `idem-return-${returnId}`;

    await db.transaction(async (tx) => {
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
        createdBy,
        approvedBy: null,
        idempotencyKey: key,
        note,
      });
      for (const it of items) {
        await tx.insert(returnOrderItems).values({
          id: `ri-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
          returnId,
          editionId: it.editionId,
          quantity: it.quantity,
          unitRefund: it.unitRefund ?? 0,
        });
      }
    });

    return { returnId, returnCode, status: 'REQUESTED', isDuplicate: false, itemsCount: items.length };
  }

  /** Duyệt phiếu (REQUESTED -> APPROVED). Chỉ Manager/Owner. */
  static async approve(returnId: string, actorRole: string, approvedBy: string) {
    if (actorRole !== 'ROLE_OWNER' && actorRole !== 'ROLE_MANAGER') {
      throw new Error('Chỉ Manager/Owner được duyệt phiếu đổi/trả.');
    }
    const { header } = await this.getById(returnId);
    if (header.status !== 'REQUESTED') throw new Error(`Phiếu đang ở trạng thái ${header.status}, không thể duyệt.`);
    await db.update(returnOrders).set({ status: 'APPROVED', approvedBy, decidedAt: new Date().toISOString() }).where(eq(returnOrders.id, returnId));
    return { returnId, status: 'APPROVED' };
  }

  /** Từ chối phiếu (REQUESTED -> REJECTED). Chỉ Manager/Owner. */
  static async reject(returnId: string, actorRole: string, rejectNote?: string) {
    if (actorRole !== 'ROLE_OWNER' && actorRole !== 'ROLE_MANAGER') {
      throw new Error('Chỉ Manager/Owner được từ chối phiếu đổi/trả.');
    }
    const { header } = await this.getById(returnId);
    if (header.status !== 'REQUESTED') throw new Error(`Phiếu đang ở trạng thái ${header.status}, không thể từ chối.`);
    await db.update(returnOrders).set({
      status: 'REJECTED', decidedAt: new Date().toISOString(),
      note: rejectNote ? `${header.note ? header.note + ' | ' : ''}[TỪ CHỐI: ${rejectNote}]` : header.note,
    }).where(eq(returnOrders.id, returnId));
    return { returnId, status: 'REJECTED' };
  }

  /**
   * Hoàn tất phiếu (APPROVED -> COMPLETED): ghi RETURN_INBOUND nguyên tử.
   * EXCHANGE kèm exchangeItems sẽ trừ kho cuốn thay thế trong cùng transaction.
   */
  static async complete(returnId: string, actorRole: string, exchangeItems?: ReturnItemInput[]) {
    if (actorRole !== 'ROLE_OWNER' && actorRole !== 'ROLE_MANAGER') {
      throw new Error('Chỉ Manager/Owner được hoàn tất phiếu đổi/trả.');
    }
    const { header, items } = await this.getById(returnId);
    if (header.status !== 'APPROVED') throw new Error(`Phiếu đang ở trạng thái ${header.status}, cần DUYỆT trước khi hoàn tất.`);

    const condition = header.inventoryDisposition === 'RESTOCK' ? 'NEW' : 'QUARANTINE';
    const exLines = exchangeItems || [];
    if (header.returnType === 'EXCHANGE' && exLines.length === 0) {
      throw new Error('Phiếu EXCHANGE bắt buộc kèm cuốn thay thế (exchangeItems).');
    }
    if (header.returnType !== 'EXCHANGE' && exLines.length > 0) {
      throw new Error('Chỉ phiếu EXCHANGE mới có cuốn thay thế.');
    }
    for (const ex of exLines) {
      if (!ex.editionId || ex.quantity <= 0 || !Number.isInteger(ex.quantity)) {
        throw new Error(`Cuốn thay thế ${ex.editionId} phải có số lượng nguyên > 0.`);
      }
      const avail = await InventoryService.getBalance(ex.editionId, header.targetWarehouseId, 'NEW');
      if (avail < ex.quantity) throw new Error(`Không đủ tồn cuốn thay thế ${ex.editionId} (còn ${avail}, cần ${ex.quantity}). Rollback toàn bộ.`);
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
            actorId: actorRole,
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
              inspectedBy: actorRole,
              status: 'QUARANTINED',
              notes: `Từ phiếu trả ${header.returnCode}`,
            });
          }
        }
        // Cuốn thay thế: trừ kho trong cùng transaction (nguyên tử với hoàn kho)
        let exIdx = 0;
        for (const ex of exLines) {
          await InventoryService.recordMovement({
            editionId: ex.editionId,
            warehouseId: header.targetWarehouseId,
            eventType: 'DISPATCH_SALE',
            quantityDelta: -ex.quantity,
            condition: 'NEW',
            documentRef: header.returnCode,
            note: `Xuất cuốn thay thế phiếu đổi ${header.returnCode}`,
            actorId: actorRole,
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
  static async voidReturn(returnId: string, actorRole: string, voidReason: string) {
    if (actorRole !== 'ROLE_OWNER' && actorRole !== 'ROLE_MANAGER') {
      throw new Error('Chỉ Manager/Owner được hủy phiếu đổi/trả.');
    }
    if (!voidReason || !voidReason.trim()) throw new Error('Hủy phiếu bắt buộc ghi lý do.');
    const { header } = await this.getById(returnId);
    if (header.status !== 'COMPLETED') throw new Error(`Chỉ hủy được phiếu COMPLETED (hiện: ${header.status}).`);

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
            actorId: actorRole,
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
