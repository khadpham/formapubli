import { db } from '../db';
import { rmaTickets, editions, works, warehouses, orders } from '../db/schema';
import { eq, desc, and, sql } from 'drizzle-orm';
import { InventoryService } from './inventory.service';
import { randomUUID } from 'crypto';


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

    if (quantity <= 0) {
      throw new Error('Số lượng sách lỗi/cách ly phải lớn hơn 0.');
    }

    const ticketId = `RMA-${new Date().toISOString().substring(0, 10).replace(/-/g, '')}-${randomUUID().substring(0, 6).toUpperCase()}`;


    // 1. Tạo phiếu RMA
    const [ticket] = await db
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

    // 2. Chuyển tồn kho sang QUARANTINE/DEFECTIVE
    // Nếu chuyển từ NEW, trừ NEW và cộng QUARANTINE
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
      });
    } else {
      // Nhận trực tiếp vào QUARANTINE (ví dụ thu hồi từ khách mà đơn cũ đã xóa hoặc hàng ký gửi bổ sung)
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
      });
    }

    return ticket;
  }

  /**
   * Xử lý giải tỏa phiếu RMA sau khi có kết luận kiểm định
   */
  static async resolveTicket(params: ResolveRmaParams) {
    const { ticketId, action, actorId, notes } = params;

    const tickets = await db
      .select()
      .from(rmaTickets)
      .where(eq(rmaTickets.id, ticketId))
      .limit(1);

    if (tickets.length === 0) {
      throw new Error(`Không tìm thấy phiếu RMA với mã [${ticketId}].`);
    }

    const ticket = tickets[0];
    if (ticket.status === 'RESOLVED' || ticket.status === 'SCRAPPED') {
      throw new Error(`Phiếu RMA [${ticketId}] đã được giải quyết từ trước.`);
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
        note: `[RMA Phục Hồi] Nhập lại tồn NEW sẵn sàng mở bán.`,
      });
    }

    const newStatus = action === 'WRITE_OFF_SCRAP' ? 'SCRAPPED' : 'RESOLVED';
    const [updated] = await db
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
