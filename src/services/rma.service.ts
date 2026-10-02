import { db } from '../db';
import { rmaTickets, editions, works, warehouses, orders } from '../db/schema';
import { AppError } from './app-error';
import { eq, desc, and, sql } from 'drizzle-orm';
import { InventoryService } from './inventory.service';


export type DefectReason =
  | 'PRINT_DEFECT'      // In ngược, trang trắng, lem mực
  | 'BINDING_DEFECT'    // Bung gáy, dán keo hỏng, rách mép
  | 'TRANSIT_DAMAGE'    // Cấn góc, móp hộp, dập bìa khi vận chuyển
  | 'CUSTOMER_RETURN'   // Khách hàng đổi trả
  | 'WATER_DAMAGE'      // Ẩm ướt, mốc nước
  | 'OTHER';

export type QuarantineCondition = 'QUARANTINE' | 'DEFECTIVE';

export type ResolutionAction =
  | 'HOLD_IN_QUARANTINE'
  | 'RETURN_TO_SUPPLIER'
  | 'WRITE_OFF_SCRAP'
  | 'REPAIRED_RESTOCK';

export interface CreateRmaParams {
  warehouseId: string;
  editionId: string;
  quantity: number;
  defectReason: DefectReason;
  orderId?: string;
  sourceCondition?: 'NEW' | 'NONE'; // Nếu phát hiện từ kho NEW thì trừ kho NEW; nếu khách mang trả ngoài hệ thống thì NONE
  targetCondition?: QuarantineCondition; // Mặc định là QUARANTINE
  inspectedBy?: string;
  notes?: string;
}

export interface ResolveRmaParams {
  ticketId: string;
  action: ResolutionAction;
  actorId: string;
  notes?: string;
}

export class RmaService {
  /**
   * Tiếp nhận sách lỗi / đổi trả và đưa ngay vào phân loại cách ly (QUARANTINE / DEFECTIVE)
   * Tuyệt đối không để lẫn vào tồn kho NEW bán cho độc giả.
   */
  static async createTicket(params: CreateRmaParams) {
    const {
      warehouseId,
      editionId,
      quantity,
      defectReason,
      orderId,
      sourceCondition = 'NEW',
      targetCondition = 'QUARANTINE',
      inspectedBy = 'staff-admin',
      notes,
    } = params;

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw AppError.invalid('Số lượng sách lỗi/cách ly phải là số nguyên lớn hơn 0.');
    }

      const ticketId = `RMA-${new Date().toISOString().substring(0, 10).replace(/-/g, '')}-${crypto.randomUUID().substring(0, 6).toUpperCase()}`;


    // FIX-07: Bọc toàn bộ kiểm tra tồn + tạo phiếu RMA + 2 bút toán Thẻ Kho trong 1 transaction ACID
    // Tuyệt đối không để lại ticket mồ côi nếu kho không đủ sách cách ly.
    return await db.transaction(async (tx) => {
      // 1. Kiểm tra tồn kho trước nếu nguồn là NEW
      if (sourceCondition === 'NEW') {
        const balanceRows = await tx
          .select()
          .from(editions)
          .where(eq(editions.id, editionId))
          .limit(1);
        if (balanceRows.length === 0) throw AppError.invalid('Ấn bản không tồn tại.');

        const currentNewBalance = await InventoryService.getBalance(editionId, warehouseId, 'NEW', tx);
        if (currentNewBalance < quantity) {
          throw AppError.atp(
            `Kho không đủ tồn NEW để chuyển sang cách ly (Yêu cầu: ${quantity}, Hiện có: ${currentNewBalance}).`
          );
        }
      }

      // 2. Tạo phiếu RMA
      const [ticket] = await tx
        .insert(rmaTickets)
        .values({
          id: ticketId,
          warehouseId,
          orderId,
          editionId,
          quantity,
          defectReason,
          quarantineCondition: targetCondition,
          resolutionAction: 'HOLD_IN_QUARANTINE',
          inspectedBy,
          status: 'QUARANTINED',
          notes,
        })
        .returning();

      // 3. Chuyển tồn kho sang QUARANTINE/DEFECTIVE
      if (sourceCondition === 'NEW') {
        // Bút toán 1: Trừ kho NEW
        await InventoryService.recordMovement({
          editionId,
          warehouseId,
          eventType: 'ADJUSTMENT',
          quantityDelta: -quantity,
          condition: 'NEW',
          documentRef: ticketId,
          correlationId: ticketId,
          actorId: inspectedBy,
          note: `[RMA Cách Ly] Trừ tồn NEW do lỗi: ${defectReason}. ${notes || ''}`,
          tx,
        });

        // Bút toán 2: Tăng kho QUARANTINE
        await InventoryService.recordMovement({
          editionId,
          warehouseId,
          eventType: 'ADJUSTMENT',
          quantityDelta: quantity,
          condition: targetCondition,
          documentRef: ticketId,
          correlationId: ticketId,
          actorId: inspectedBy,
          note: `[RMA Cách Ly] Tiếp nhận sách lỗi vào kho ${targetCondition}. ${notes || ''}`,
          tx,
        });
      } else {
        // Nhận trực tiếp vào QUARANTINE từ nguồn ngoài
        await InventoryService.recordMovement({
          editionId,
          warehouseId,
          eventType: 'RECEIPT',
          quantityDelta: quantity,
          condition: targetCondition,
          documentRef: ticketId,
          correlationId: ticketId,
          actorId: inspectedBy,
          note: `[RMA Đổi Trả] Nhập kho cách ly ${targetCondition} từ nguồn ngoài. ${notes || ''}`,
          tx,
        });
      }

      return ticket;
    });
  }

  /**
   * Xử lý giải tỏa phiếu RMA sau khi có kết luận kiểm định.
   *
   * TOÀN BỘ (bút toán kho + cập nhật trạng thái phiếu) nằm trong MỘT
   * transaction. Trước đây các bước chạy rời nhau: `REPAIRED_RESTOCK` ghi
   * bút toán 1 (trừ QUARANTINE) xong mới ghi bút toán 2 (cộng NEW) rồi mới
   * update phiếu. Lỗi giữa chừng ⇒ tồn QUARANTINE đã bị trừ vĩnh viễn còn
   * phiếu vẫn QUARANTINED, và lần gọi lại chết vì không còn tồn để trừ ⇒ mất
   * hàng không thể ghi nhận lại. Đó là lỗi "lỗi giữa chừng để dữ liệu lệch".
   */
  static async resolveTicket(params: ResolveRmaParams) {
    const { ticketId, action, actorId, notes } = params;

    const tickets = await db
      .select()
      .from(rmaTickets)
      .where(eq(rmaTickets.id, ticketId))
      .limit(1);

    if (tickets.length === 0) {
      throw AppError.invalid(`Không tìm thấy phiếu RMA với mã [${ticketId}].`);
    }

    const ticket = tickets[0];
    if (ticket.status === 'RESOLVED' || ticket.status === 'SCRAPPED') {
      throw AppError.conflict(`Phiếu RMA [${ticketId}] đã được giải quyết từ trước.`);
    }

    return await db.transaction(async (tx) => {
      // Conditional update CHỐT trạng thái trước: ai cũng thấy phiếu đã xử lý
      // ngay khi vào tx, và nếu bút toán hỏng thì cả nhóm rollback.
      // 'INSPECTING' chỉ tồn tại trong write transaction (SQLite một-writer) và
      // bị rollback theo — không có dòng nào mang trạng thái này sau commit,
      // nên không rò sang listTickets.
      const claim: any = await tx.run(sql`
        UPDATE rma_tickets SET status = 'INSPECTING'
        WHERE id = ${ticketId} AND status = 'QUARANTINED'
      `);
      if (claim.rowsAffected !== 1) {
        throw AppError.conflict(`Phiếu RMA [${ticketId}] đã được giải từ giao dịch khác.`);
      }

      // Thực hiện bút toán kho tùy theo hướng giải quyết:
      if (action === 'WRITE_OFF_SCRAP') {
        // Tiêu hủy phế liệu -> Trừ khỏi QUARANTINE
        await InventoryService.recordMovement({
          editionId: ticket.editionId,
          warehouseId: ticket.warehouseId,
          eventType: 'ADJUSTMENT',
          quantityDelta: -ticket.quantity,
          condition: ticket.quarantineCondition as any,
          documentRef: ticket.id,
          correlationId: ticket.id,
          actorId,
          idempotencyKey: `idem-rma-${ticketId}-scrap`,
          tx,
          note: `[RMA Tiêu Hủy] Xuất hủy phế liệu theo quyết định kiểm định. ${notes || ''}`,
        });
      } else if (action === 'RETURN_TO_SUPPLIER') {
        // Xuất trả Nhà in / Nhà cung cấp -> Trừ khỏi QUARANTINE
        await InventoryService.recordMovement({
          editionId: ticket.editionId,
          warehouseId: ticket.warehouseId,
          eventType: 'ADJUSTMENT', // Xuất điều chỉnh giảm để trả đối tác
          quantityDelta: -ticket.quantity,
          condition: ticket.quarantineCondition as any,
          documentRef: ticket.id,
          correlationId: ticket.id,
          actorId,
          idempotencyKey: `idem-rma-${ticketId}-supplier`,
          tx,
          note: `[RMA Trả NXB/Nhà In] Xuất trả nhà in/đối tác bù hàng. ${notes || ''}`,
        });
      } else if (action === 'REPAIRED_RESTOCK') {
        // Đã sửa chữa / đóng lại bìa màng co -> Trả về NEW
        await InventoryService.recordMovement({
          editionId: ticket.editionId,
          warehouseId: ticket.warehouseId,
          eventType: 'ADJUSTMENT',
          quantityDelta: -ticket.quantity,
          condition: ticket.quarantineCondition as any,
          documentRef: ticket.id,
          correlationId: ticket.id,
          actorId,
          idempotencyKey: `idem-rma-${ticketId}-restock-out`,
          tx,
          note: `[RMA Phục Hồi] Chuyển từ cách ly về tồn NEW sau khi xử lý.`,
        });

        await InventoryService.recordMovement({
          editionId: ticket.editionId,
          warehouseId: ticket.warehouseId,
          eventType: 'ADJUSTMENT',
          quantityDelta: ticket.quantity,
          condition: 'NEW',
          documentRef: ticket.id,
          correlationId: ticket.id,
          actorId,
          idempotencyKey: `idem-rma-${ticketId}-restock-in`,
          tx,
          note: `[RMA Phục Hồi] Nhập lại tồn NEW sẵn sàng mở bán.`,
        });
      }

      const newStatus = action === 'WRITE_OFF_SCRAP' ? 'SCRAPPED' : 'RESOLVED';
      const [updated] = await tx
        .update(rmaTickets)
        .set({
          resolutionAction: action,
          status: newStatus,
          resolvedAt: new Date().toISOString(),
          notes: notes ? `${ticket.notes || ''}\n[Resolution]: ${notes}`.trim() : ticket.notes,
        })
        .where(eq(rmaTickets.id, ticketId))
        .returning();

      return updated;
    });
  }

  /**
   * Truy vấn danh sách phiếu cách ly sách lỗi
   */
  static async listTickets(filter?: {
    warehouseId?: string;
    status?: string;
    editionId?: string;
  }) {
    let query = db
      .select({
        id: rmaTickets.id,
        warehouseId: rmaTickets.warehouseId,
        orderId: rmaTickets.orderId,
        editionId: rmaTickets.editionId,
        editionCode: editions.code,
        title: sql<string>`coalesce(${editions.title}, ${works.title})`,
        quantity: rmaTickets.quantity,
        defectReason: rmaTickets.defectReason,
        quarantineCondition: rmaTickets.quarantineCondition,
        resolutionAction: rmaTickets.resolutionAction,
        inspectedBy: rmaTickets.inspectedBy,
        status: rmaTickets.status,
        notes: rmaTickets.notes,
        createdAt: rmaTickets.createdAt,
        resolvedAt: rmaTickets.resolvedAt,
      })
      .from(rmaTickets)
      .innerJoin(editions, eq(rmaTickets.editionId, editions.id))
      .innerJoin(works, eq(editions.workId, works.id))
      .$dynamic();

    const conditions = [];
    if (filter?.warehouseId) conditions.push(eq(rmaTickets.warehouseId, filter.warehouseId));
    if (filter?.status) conditions.push(eq(rmaTickets.status, filter.status));
    if (filter?.editionId) conditions.push(eq(rmaTickets.editionId, filter.editionId));

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    return await query.orderBy(desc(rmaTickets.createdAt));
  }
}
