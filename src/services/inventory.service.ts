import { db, inventoryLedger, stockBalances, editions, warehouses, works } from '../db';
import { eq, and, desc, sql } from 'drizzle-orm';
import { ActorContext } from './actor-context';
import { AppError } from './app-error';
import { withDbRetry } from '../lib/db-retry';
import { isDirectTransferAllowed } from './direct-transfer-policy';

export interface RecordMovementParams {
  editionId: string;
  warehouseId: string;
  eventType: 'RECEIPT' | 'DISPATCH_SALE' | 'DISPATCH_GIFT' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'TRANSFER_LOSS' | 'CONSIGNMENT_SOLD' | 'CONSIGNMENT_LOSS' | 'ADJUSTMENT' | 'OPENING_BALANCE' | 'RETURN_INBOUND' | 'SPONSORSHIP_DRAWDOWN';
  quantityDelta: number; // positive or negative, must be non-zero
  condition?: 'NEW' | 'MINOR_DAMAGE' | 'DEFECTIVE' | 'QUARANTINE';
  documentRef: string;
  note?: string;
  actorId?: string;
  idempotencyKey?: string;

  ownerId?: string;
  lotId?: string;
  unitCostSnapshot?: number;
  correlationId?: string;
  reversalOf?: string;
  effectiveAt?: string;
  tx?: any; // Cho phép truyền transaction context bên ngoài
  actorContext?: ActorContext; // M1 §1: thắng actorId client gửi
}

export interface TransferParams {
  editionId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  quantity: number;
  condition?: 'NEW' | 'MINOR_DAMAGE' | 'DEFECTIVE' | 'QUARANTINE';
  documentRef: string;
  note?: string;
  // CP3-B1.1: khóa chống replay — bắt buộc từ caller (route đã 400 khi thiếu).
  idempotencyKey: string;
  actorContext: ActorContext; // Bắt buộc: chỉ OWNER/MANAGER; ledger actor lấy duy nhất từ đây (mục 4).
}

export class InventoryService {
  /**
   * Lấy số dư tồn kho hiện tại của một ấn bản tại một kho cụ thể.
   * Hỗ trợ nhận context transaction `tx` hiện hành để đọc an toàn trong snapshot transaction.
   */
  static async getBalance(
    editionId: string,
    warehouseId: string,
    condition: 'NEW' | 'MINOR_DAMAGE' | 'DEFECTIVE' | 'QUARANTINE' = 'NEW',
    txOrDb: any = db
  ): Promise<number> {
    const existing = await txOrDb
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
      actorId = 'system',
      idempotencyKey = `idem-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      ownerId,
      lotId,
      unitCostSnapshot,
      correlationId,
      reversalOf,
      effectiveAt,
      tx: externalTx,
    } = params;
    const effActorId = params.actorContext?.staffId || actorId;

    if (quantityDelta === 0) {
      throw AppError.invalid('Độ biến động tồn kho (quantityDelta) phải khác 0.');
    }

    const executeWork = async (tx: any) => {
      // 1. Ghi bút toán vào Sổ cái bất biến (Append-Only) trước để sinh ledgerId và ràng buộc kiểm toán
      const ledgerId = `led-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      await tx.insert(inventoryLedger).values({
        id: ledgerId,
        editionId,
        warehouseId,
        ownerId,
        lotId,
        eventType,
        quantityDelta,
        unitCostSnapshot,
        condition,
        documentRef,
        note,
        actorId: effActorId,
        correlationId,
        reversalOf,
        idempotencyKey,
        effectiveAt: effectiveAt || new Date().toISOString(),
      });

      // 2. Bảo đảm bucket tồn kho tồn tại (nếu chưa có thì tạo mới với số lượng 0)
      const bucketId = `sb-${editionId}-${warehouseId}-${condition}`;
      await tx
        .insert(stockBalances)
        .values({
          id: bucketId,
          editionId,
          warehouseId,
          condition,
          physicalQuantity: 0,
        })
        .onConflictDoNothing({
          target: [stockBalances.editionId, stockBalances.warehouseId, stockBalances.condition],
        });

      // 3. ATOMIC GUARD: UPDATE trực tiếp bằng biểu thức nguyên tử, chặn đứng triệt để Lost-Update race condition
      // Điều kiện physical_quantity + ? >= 0 ngăn ngừa xuất âm ngay tại mức engine database
      const updateResult: any = await tx.run(sql`
        UPDATE stock_balances
        SET physical_quantity = physical_quantity + ${quantityDelta},
            updated_at = CURRENT_TIMESTAMP
        WHERE edition_id = ${editionId}
          AND warehouse_id = ${warehouseId}
          AND condition = ${condition}
          AND (physical_quantity + ${quantityDelta} >= 0)
      `);

      if (updateResult.rowsAffected === 0) {
        // Nếu không có dòng nào được cập nhật, kiểm tra số dư hiện tại để báo lỗi chính xác
        const currentBalance = await tx
          .select({ physicalQuantity: stockBalances.physicalQuantity })
          .from(stockBalances)
          .where(
            and(
              eq(stockBalances.editionId, editionId),
              eq(stockBalances.warehouseId, warehouseId),
              eq(stockBalances.condition, condition)
            )
          )
          .limit(1);

        const currentQty = currentBalance.length > 0 ? currentBalance[0].physicalQuantity : 0;
        throw AppError.atp(
          `LỖI XUẤT ÂM KHO: Tồn kho hiện tại là ${currentQty}, không đủ để xuất ${Math.abs(quantityDelta)} cuốn!`
        );
      }

      // 4. Đọc lại số lượng mới sau cập nhật nguyên tử
      const updatedRow = await tx
        .select({ physicalQuantity: stockBalances.physicalQuantity })
        .from(stockBalances)
        .where(
          and(
            eq(stockBalances.editionId, editionId),
            eq(stockBalances.warehouseId, warehouseId),
            eq(stockBalances.condition, condition)
          )
        )
        .limit(1);

      const newQty = updatedRow.length > 0 ? updatedRow[0].physicalQuantity : 0;
      const previousQty = newQty - quantityDelta;

      return {
        ledgerId,
        editionId,
        warehouseId,
        previousQuantity: previousQty,
        newQuantity: newQty,
        quantityDelta,
      };
    };

    if (externalTx) {
      return await executeWork(externalTx);
    }
    return await db.transaction(async (tx) => {
      return await executeWork(tx);
    });
  }

  /**
   * Thực hiện điều chuyển sách giữa 2 kho vật lý (ví dụ: Quỳnh Mai ➔ Âu Cơ, hoặc Âu Cơ ➔ Dự phòng).
   * Tạo 2 bút toán liên kết trong cùng nghiệp vụ: TRANSFER_OUT và TRANSFER_IN.
   * Chạy nguyên tử trong một Transaction duy nhất.
   */
  static async transfer(params: TransferParams) {
    const {
      editionId,
      fromWarehouseId,
      toWarehouseId,
      quantity,
      condition = 'NEW',
      documentRef,
      note = '',
    } = params;

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw AppError.invalid('Số lượng chuyển kho phải là số nguyên > 0.');
    }

    if (fromWarehouseId === toWarehouseId) {
      throw AppError.invalid('Kho xuất và kho nhập phải khác nhau.');
    }

    // CP3-B1.1 (mục 1): actorContext BẮT BUỘC và chỉ OWNER/MANAGER.
    // Không suy role, không mặc định. Pair-allowlist + cấm virtual enforced
    // ngay tại service qua isDirectTransferAllowed (mục 1).
    const role = params.actorContext?.role;
    if (!params.actorContext || !params.actorContext.staffId?.trim()) {
      throw AppError.invalid('Thiếu actorContext cho thao tác chuyển kho trực tiếp.');
    }
    if (role !== 'ROLE_OWNER' && role !== 'ROLE_MANAGER') {
      throw AppError.forbidden(
        `Chuyển nội bộ trực tiếp chỉ dành cho Quản lý hoặc Chủ cửa hàng (vai trò hiện tại: ${role || 'không xác định'}).`
      );
    }
    const effTransferActor = params.actorContext.staffId.trim();

    // CP3-B1.1 (mục 1): idempotencyKey BẮT BUỘC từ caller — không suy từ
    // documentRef, không tự sinh.
    const transferBatchId = params.idempotencyKey?.trim() || '';
    if (!transferBatchId) {
      throw AppError.invalid('Bắt buộc cung cấp idempotencyKey cho thao tác chuyển kho trực tiếp.');
    }

    // CP3-B1.1 (mục 1): allowlist + cấm virtual NGAY TẠI SERVICE.
    if (!isDirectTransferAllowed(fromWarehouseId, toWarehouseId)) {
      throw AppError.forbidden(
        `Tuyến chuyển kho trực tiếp từ [${fromWarehouseId}] tới [${toWarehouseId}] không nằm trong danh mục cho phép (allowlist). Vui lòng dùng luân chuyển 2 bước /api/transfers.`
      );
    }

    const cleanCondition = condition;
    if (!documentRef || !`${documentRef}`.trim()) {
      throw AppError.invalid('Thiếu chứng từ chuyển kho (documentRef).');
    }
    const cleanDocRef = `${documentRef}`.trim();

    // Fingerprint đầy đủ: edition + nguồn + đích + qty + condition + documentRef
    // (hàm matchesFingerprint/readLegs bên dưới).

    const matchesFingerprint = (outLeg: any, inLeg: any | null) =>
      !!inLeg &&
      outLeg.editionId === editionId &&
      outLeg.warehouseId === fromWarehouseId &&
      outLeg.quantityDelta === -quantity &&
      outLeg.condition === cleanCondition &&
      outLeg.documentRef === cleanDocRef &&
      inLeg.editionId === editionId &&
      inLeg.warehouseId === toWarehouseId &&
      inLeg.quantityDelta === quantity &&
      inLeg.condition === cleanCondition &&
      inLeg.documentRef === cleanDocRef;

    const readLegs = async (tx: any) => {
      const outLeg = (
        await tx
          .select()
          .from(inventoryLedger)
          .where(eq(inventoryLedger.idempotencyKey, `${transferBatchId}-out`))
          .limit(1)
      )[0];
      const inLeg = (
        await tx
          .select()
          .from(inventoryLedger)
          .where(eq(inventoryLedger.idempotencyKey, `${transferBatchId}-in`))
          .limit(1)
      )[0];
      return { outLeg, inLeg };
    };

    return await withDbRetry(() =>
      db.transaction(async (tx) => {
        // Replay check: đối chiếu fingerprint đầy đủ + BẮT BUỘC đủ cả 2 chân.
        // Thiếu chân IN (partial) -> FAIL, không trả replay thành công.
        const { outLeg, inLeg } = await readLegs(tx);
        if (outLeg) {
          if (!matchesFingerprint(outLeg, inLeg)) {
            if (!inLeg) {
              throw AppError.conflict(
                `STATE_CONFLICT: Chuyến chuyển kho [${transferBatchId}] dở dang (thiếu chân IN) — từ chối replay, cần đối soát thủ công.`
              );
            }
            throw AppError.idempotency(
              `IDEMPOTENCY_CONFLICT: Key "${transferBatchId}" đã được sử dụng cho một giao dịch chuyển kho khác.`
            );
          }
          return {
            transferBatchId,
            editionId,
            fromWarehouseId,
            toWarehouseId,
            quantity,
            outLedgerId: outLeg.id,
            inLedgerId: (inLeg as any).id,
            fromWarehouse: null,
            toWarehouse: null,
            isDuplicate: true as const,
          };
        }

      // Contract §3.3.4: ATP check inside write transaction
      const { OrderService } = await import('./order.service');
      const atpOut = await OrderService.getATP(editionId, fromWarehouseId, tx);
      if (atpOut < quantity) {
        throw AppError.atp(
          `Không đủ tồn khả dụng để chuyển: ${editionId} tại ${fromWarehouseId} còn khả dụng ${atpOut}, cần ${quantity} (phần còn lại đang giữ cho đơn online).`
        );
      }

      // 1+2. Cặp OUT/IN nguyên tử. Race cùng key: Gordon qua replay-check
      // có thể đụng UNIQUE trên ledger key -> map về replay/CONFLICT (mục C),
      // không để SQLITE_CONSTRAINT_UNIQUE thô thoát ra.
      let outResult: any;
      let inResult: any;
      try {
        // 1. Xuất kho nguồn (TRANSFER_OUT)
        outResult = await this.recordMovement({
          editionId,
          warehouseId: fromWarehouseId,
          eventType: 'TRANSFER_OUT',
          quantityDelta: -quantity,
          condition,
          documentRef,
          actorId: effTransferActor,
          correlationId: transferBatchId,
          note: `Chuyển kho tới kho đích [${toWarehouseId}]. ${note}`.trim(),
          idempotencyKey: `${transferBatchId}-out`,
          tx,
        });

        // 2. Nhập kho đích (TRANSFER_IN)
        inResult = await this.recordMovement({
          editionId,
          warehouseId: toWarehouseId,
          eventType: 'TRANSFER_IN',
          quantityDelta: quantity,
          condition,
          documentRef,
          actorId: effTransferActor,
          correlationId: transferBatchId,
          note: `Tiếp nhận chuyển kho từ kho nguồn [${fromWarehouseId}]. ${note}`.trim(),
          idempotencyKey: `${transferBatchId}-in`,
          tx,
        });
      } catch (e: any) {
        const hay = `${e?.message || ''} ${e?.code || ''}`;
        if (!/UNIQUE constraint|SQLITE_CONSTRAINT_UNIQUE/i.test(hay)) throw e;
        const legs = await readLegs(tx);
        if (legs.outLeg && matchesFingerprint(legs.outLeg, legs.inLeg)) {
          return {
            transferBatchId,
            editionId,
            fromWarehouseId,
            toWarehouseId,
            quantity,
            outLedgerId: legs.outLeg.id,
            inLedgerId: (legs.inLeg as any).id,
            fromWarehouse: null,
            toWarehouse: null,
            isDuplicate: true as const,
          };
        }
        if (legs.outLeg && !legs.inLeg) {
          throw AppError.conflict(
            `STATE_CONFLICT: Chuyến chuyển kho [${transferBatchId}] dở dang (thiếu chân IN) — từ chối, cần đối soát thủ công.`
          );
        }
        throw AppError.idempotency(
          `IDEMPOTENCY_CONFLICT: Key "${transferBatchId}" đã được sử dụng cho một giao dịch chuyển kho khác.`
        );
      }

      return {
        transferBatchId,
        editionId,
        fromWarehouseId,
        toWarehouseId,
        quantity,
        outLedgerId: outResult.ledgerId,
        inLedgerId: inResult.ledgerId,
        fromWarehouse: outResult,
        toWarehouse: inResult,
        isDuplicate: false as const,
      };
      })
    );
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