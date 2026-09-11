import { db, inventoryLedger, stockBalances, editions, warehouses, works } from '../db';
import { eq, and, desc, sql } from 'drizzle-orm';

export interface RecordMovementParams {
  editionId: string;
  warehouseId: string;
  eventType: 'RECEIPT' | 'DISPATCH_SALE' | 'DISPATCH_GIFT' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'ADJUSTMENT' | 'OPENING_BALANCE';
  quantityDelta: number; // positive or negative, must be non-zero
  condition?: 'NEW' | 'MINOR_DAMAGE' | 'DEFECTIVE';
  documentRef: string;
  note?: string;
  actorId: string;
  idempotencyKey?: string;
}

export interface TransferParams {
  editionId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  quantity: number;
  condition?: 'NEW' | 'MINOR_DAMAGE' | 'DEFECTIVE';
  documentRef: string;
  actorId: string;
  note?: string;
}

export class InventoryService {
  /**
   * Lấy số dư tồn kho hiện tại của một ấn bản tại một kho cụ thể.
   */
  static async getBalance(
    editionId: string,
    warehouseId: string,
    condition: 'NEW' | 'MINOR_DAMAGE' | 'DEFECTIVE' = 'NEW'
  ): Promise<number> {
    const existing = await db
      .select()
      .from(stockBalances)
      .where(
        and(
          eq(stockBalances.editionId, editionId),
          eq(stockBalances.warehouseId, warehouseId),
          eq(stockBalances.condition, condition)
        )
      )
      .limit(1);

    return existing.length > 0 ? existing[0].physicalQuantity : 0;
  }

  /**
   * Ghi nhận một biến động vào Sổ cái bất biến (Append-Only) và cập nhật Bảng cân đối tồn kho tức thời.
   * Chặn tuyệt đối việc xuất âm kho (Negative Stock Prevention).
   */
  static async recordMovement(params: RecordMovementParams) {
    const {
      editionId,
      warehouseId,
      eventType,
      quantityDelta,
      condition = 'NEW',
      documentRef,
      note,
      actorId,
      idempotencyKey = `idem-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    } = params;

    if (quantityDelta === 0) {
      throw new Error('Độ biến động tồn kho (quantityDelta) phải khác 0.');
    }

    // 1. Kiểm tra tồn kho trước khi xuất (nếu delta < 0)
    const currentQty = await this.getBalance(editionId, warehouseId, condition);
    if (quantityDelta < 0 && currentQty + quantityDelta < 0) {
      throw new Error(
        `LỖI XUẤT ÂM KHO: Tồn kho hiện tại là ${currentQty}, không đủ để xuất ${Math.abs(quantityDelta)} cuốn!`
      );
    }

    const ledgerId = `led-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // 2. Ghi bút toán vào Sổ cái bất biến (Append-Only)
    await db.insert(inventoryLedger).values({
      id: ledgerId,
      editionId,
      warehouseId,
      eventType,
      quantityDelta,
      condition,
      documentRef,
      note,
      actorId,
      idempotencyKey,
    });

    // 3. Cập nhật bảng cân đối tồn kho tức thời (Stock Balance)
    const newQty = currentQty + quantityDelta;
    const bucketId = `sb-${editionId}-${warehouseId}-${condition}`;

    await db
      .insert(stockBalances)
      .values({
        id: bucketId,
        editionId,
        warehouseId,
        condition,
        physicalQuantity: newQty,
      })
      .onConflictDoUpdate({
        target: [stockBalances.editionId, stockBalances.warehouseId, stockBalances.condition],
        set: {
          physicalQuantity: newQty,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      });

    return {
      ledgerId,
      editionId,
      warehouseId,
      previousQuantity: currentQty,
      newQuantity: newQty,
      quantityDelta,
    };
  }

  /**
   * Thực hiện điều chuyển sách giữa 2 kho vật lý (ví dụ: Quỳnh Mai ➔ Âu Cơ, hoặc Âu Cơ ➔ Dự phòng).
   * Tạo 2 bút toán liên kết trong cùng nghiệp vụ: TRANSFER_OUT và TRANSFER_IN.
   */
  static async transfer(params: TransferParams) {
    const {
      editionId,
      fromWarehouseId,
      toWarehouseId,
      quantity,
      condition = 'NEW',
      documentRef,
      actorId,
      note = '',
    } = params;

    if (quantity <= 0) {
      throw new Error('Số lượng chuyển kho phải lớn hơn 0.');
    }

    if (fromWarehouseId === toWarehouseId) {
      throw new Error('Kho xuất và kho nhập phải khác nhau.');
    }

    // Kiểm tra số dư kho nguồn
    const sourceQty = await this.getBalance(editionId, fromWarehouseId, condition);
    if (sourceQty < quantity) {
      throw new Error(
        `Kho xuất không đủ hàng: Hiện chỉ có ${sourceQty} cuốn, yêu cầu chuyển ${quantity} cuốn.`
      );
    }

    const transferBatchId = `trf-${Date.now()}`;

    // 1. Xuất kho nguồn (TRANSFER_OUT)
    const outResult = await this.recordMovement({
      editionId,
      warehouseId: fromWarehouseId,
      eventType: 'TRANSFER_OUT',
      quantityDelta: -quantity,
      condition,
      documentRef,
      actorId,
      note: `Chuyển kho tới kho đích [${toWarehouseId}]. ${note}`.trim(),
      idempotencyKey: `${transferBatchId}-out`,
    });

    // 2. Nhập kho đích (TRANSFER_IN)
    const inResult = await this.recordMovement({
      editionId,
      warehouseId: toWarehouseId,
      eventType: 'TRANSFER_IN',
      quantityDelta: quantity,
      condition,
      documentRef,
      actorId,
      note: `Tiếp nhận chuyển kho từ kho nguồn [${fromWarehouseId}]. ${note}`.trim(),
      idempotencyKey: `${transferBatchId}-in`,
    });

    return {
      transferBatchId,
      documentRef,
      quantity,
      fromWarehouse: outResult,
      toWarehouse: inResult,
    };
  }

  /**
   * Lấy ma trận tồn kho của toàn bộ 81 đầu sách x 3 Kho vật lý (Âu Cơ, Quỳnh Mai, Dự phòng).
   */
  static async getStockMatrix() {
    // 1. Lấy danh sách toàn bộ editions kèm thông tin work
    const allEditions = await db
      .select({
        id: editions.id,
        code: editions.code,
        title: editions.title,
        isbn: editions.isbn,
        isbnLast4: editions.isbnLast4,
        coverPrice: editions.coverPrice,
        status: editions.status,
        publisher: editions.publisher,
        author: works.author,
        translator: works.translator,
        shortCode: works.shortCode,
      })
      .from(editions)
      .innerJoin(works, eq(editions.workId, works.id));

    // 2. Lấy toàn bộ số dư tồn kho
    const allBalances = await db.select().from(stockBalances);

    // Map số dư theo format: Map<editionId, Map<warehouseCode, quantity>>
    // Lấy thông tin kho để map warehouseId sang code
    const allWarehouses = await db.select().from(warehouses);
    const whIdToCode = new Map<string, string>();
    for (const wh of allWarehouses) {
      whIdToCode.set(wh.id, wh.code);
    }

    const balanceMap = new Map<string, { auCo: number; quynhMai: number; duPhong: number }>();

    for (const bal of allBalances) {
      const whCode = whIdToCode.get(bal.warehouseId);
      if (!balanceMap.has(bal.editionId)) {
        balanceMap.set(bal.editionId, { auCo: 0, quynhMai: 0, duPhong: 0 });
      }
      const record = balanceMap.get(bal.editionId)!;
      if (whCode === 'KHO_AU_CO') {
        record.auCo += bal.physicalQuantity;
      } else if (whCode === 'KHO_QUYNH_MAI') {
        record.quynhMai += bal.physicalQuantity;
      } else if (whCode === 'KHO_DU_PHONG') {
        record.duPhong += bal.physicalQuantity;
      }
    }

    return allEditions.map((ed) => {
      const bal = balanceMap.get(ed.id) || { auCo: 0, quynhMai: 0, duPhong: 0 };
      const totalStock = bal.auCo + bal.quynhMai + bal.duPhong;
      return {
        ...ed,
        stockAuCo: bal.auCo,
        stockQuynhMai: bal.quynhMai,
        stockDuPhong: bal.duPhong,
        totalStock,
      };
    });
  }

  /**
   * Lấy lịch sử biến động sổ cái kho gần nhất (Audit Trail).
   */
  static async getLedgerHistory(limit = 50) {
    return await db
      .select({
        id: inventoryLedger.id,
        eventType: inventoryLedger.eventType,
        quantityDelta: inventoryLedger.quantityDelta,
        condition: inventoryLedger.condition,
        documentRef: inventoryLedger.documentRef,
        note: inventoryLedger.note,
        actorId: inventoryLedger.actorId,
        recordedAt: inventoryLedger.recordedAt,
        bookCode: editions.code,
        bookTitle: editions.title,
        isbnLast4: editions.isbnLast4,
        warehouseCode: warehouses.code,
        warehouseName: warehouses.name,
      })
      .from(inventoryLedger)
      .innerJoin(editions, eq(inventoryLedger.editionId, editions.id))
      .innerJoin(warehouses, eq(inventoryLedger.warehouseId, warehouses.id))
      .orderBy(desc(inventoryLedger.recordedAt))
      .limit(limit);
  }
}