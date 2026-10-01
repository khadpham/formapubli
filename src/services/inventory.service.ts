import { db, idempotencyKeys, inventoryLedger, stockBalances, editions, warehouses, works } from '../db';
import { eq, and, or, desc, inArray, sql } from 'drizzle-orm';
import { ActorContext } from './actor-context';
import { AppError } from './app-error';
import { withDbRetry } from '../lib/db-retry';
import { isDirectTransferAllowed, isForbiddenWarehouseFamily } from './direct-transfer-policy';
import { WarehouseService } from './warehouse.service';
import { computeTransferDispatchFingerprint } from '../lib/transfer-fingerprint';

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

export interface TransferBatchItemInput {
  editionId: string;
  quantity: number;
}

export interface TransferBatchParams {
  fromWarehouseId: string;
  toWarehouseId: string;
  items: TransferBatchItemInput[];
  note?: string;
  // Chống replay — bắt buộc từ caller (route đã 400 khi thiếu).
  idempotencyKey: string;
  actorContext: ActorContext; // Bắt buộc: chỉ OWNER/MANAGER.
}

export interface StaleItem {
  editionId: string;
  requested: number;
  availableNow: number;
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
   * Tồn vật lý của N ấn bản trong 1 câu — anh/chị em của `getBalance`.
   *
   * 30/09: POS chốt đơn cần tra ATP cho cả giỏ. Trước đây gọi `/api/atp` MỘT
   * LẦN cho TỪNG cuốn nối tiếp ⇒ đơn 12 cuốn = 12 vòng mạng, mỗi vòng lại vài
   * câu DB xa ⇒ thu ngân đứng chờ nhiều giây. `getBatchATP` đã gộp được phía
   * giữ chỗ; hàm này gộp nốt phía tồn vật lý để tra cả hai trong 2 câu.
   */
  static async getBatchBalance(
    editionIds: string[],
    warehouseId: string,
    condition: 'NEW' | 'MINOR_DAMAGE' | 'DEFECTIVE' | 'QUARANTINE' = 'NEW',
    txOrDb: any = db
  ): Promise<Map<string, number>> {
    const ids = Array.from(new Set(editionIds.filter(Boolean)));
    const out = new Map<string, number>();
    if (ids.length === 0) return out;
    const rows = await txOrDb
      .select({
        editionId: stockBalances.editionId,
        qty: stockBalances.physicalQuantity,
      })
      .from(stockBalances)
      .where(
        and(
          inArray(stockBalances.editionId, ids),
          eq(stockBalances.warehouseId, warehouseId),
          eq(stockBalances.condition, condition)
        )
      );
    for (const r of rows) out.set(`${r.editionId}`, Number(r.qty || 0));
    // Ấn bản chưa có dòng tồn = 0, để tra ATP không phải phân biệt "thiếu" với
    // "bằng 0" (cả hai đều là không bán được).
    for (const id of ids) if (!out.has(id)) out.set(id, 0);
    return out;
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
    // Sổ cái kho là bằng SỐ CUỐN: số thập phân làm physical_quantity lẻ
    // (10 -> 11.5) và mọi phép so sánh tồn/ATP về sau lệch. Chặn ở đây (hàm
    // dùng chung) thay vì ở từng caller — NaN cũng bị chặn vì NaN không phải
    // số nguyên.
    if (!Number.isInteger(quantityDelta)) {
      throw AppError.invalid(`Độ biến động tồn kho phải là số nguyên (nhận ${quantityDelta}).`);
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
          // 0032: `product_id` NOT NULL + FK `products(id)`. Sách có
          // `products.id === editions.id`, nên đặt bằng `editionId`.
          productId: editionId,
          warehouseId,
          condition,
          physicalQuantity: 0,
        })
        .onConflictDoNothing({
          // 0032 đổi unique `uq_stock_bucket` từ (edition_id,…) sang
          // (product_id,…). Bắt buộc phải khớp index đúng, nếu không SQLite
          // ném "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE
          // constraint" và mọi ghi nhập kho chết.
          target: [stockBalances.productId, stockBalances.warehouseId, stockBalances.condition],
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
   * Ghi N bút toán kho trong MỘT lần gọi — dùng cho `confirmOrder` (30/09).
   *
   * VÌ SAO CẦN: `recordMovement` gọi lặp tốn 4 câu SQL mỗi dòng. Trên DB từ xa
   * (Turso) mỗi câu là một subrequest HTTPS từ Cloudflare Worker, mà Worker chỉ
   * chịu 50 subrequest/lần gọi. Đo thật trên production: đơn 1–4 dòng xác nhận
   * được, đơn 5 dòng trở lên thì hỏng — đúng ngưỡng đó, và lỗi bị
   * `handleApiError` che thành "Lỗi hệ thống". Cục bộ (file DB) 20 dòng vẫn chạy
   * vì không có chặn subrequest, nên lỗi chỉ lộ trên production.
   *
   * Kết quả y hệt gọi lặp, chỉ khác số câu:
   *   gọi lặp : ~4 câu/dòng  →  đơn 17 dòng ≈ 72 câu (vượt trần)
   *   gộp     : ~1 câu/dòng + 4 câu chung → đơn 17 dòng ≈ 21 câu
   *
   * AN TOÀN: vẫn nằm trong transaction của caller, nên sai số lượng âm làm hỏng
   * CẢ đơn (rollback) chứ không lọt. Bước 4 của `recordMovement` (đọc lại tồn kho)
   * chỉ để dựng giá trị trả về mà `confirmOrder` không dùng, nên ở đây bỏ hẳn và
   * thay bằng MỘT câu đọc lại cho toàn đơn.
   */
  static async recordMovementsBatch(
    items: Array<{
      editionId: string;
      quantityDelta: number;
      condition?: 'NEW' | 'MINOR_DAMAGE' | 'DEFECTIVE' | 'QUARANTINE';
      ownerId?: string;
      lotId?: string;
      unitCostSnapshot?: number;
    }>,
    common: {
      warehouseId: string;
      eventType: RecordMovementParams['eventType'];
      documentRef: string;
      note?: string;
      actorId?: string;
      correlationId?: string;
      effectiveAt?: string;
      /**
       * Tiền tố idempotencyKey. BẮT BUỘC giữ đúng tiền tố mà `confirmOrder` dùng
       * để nhận diện "đã duyệt rồi" (`idem-confirm-<orderId>-`), nếu đổi tiền tố
       * thì lần gọi lại sẽ tưởng đơn chưa có bút toán và báo nhầm. Test
       * test-transfer-payment-flow bắt đúng lỗi này.
       */
      idempotencyPrefix?: string;
    },
    tx: any
  ): Promise<number> {
    if (items.length === 0) return 0;
    const actorId = common.actorId || 'system';
    const effectiveAt = common.effectiveAt || new Date().toISOString();
    const stamp = Date.now();

    for (const it of items) {
      if (!Number.isInteger(it.quantityDelta) || it.quantityDelta === 0) {
        throw AppError.invalid(`Biến động tồn kho phải khác 0 (nhận ${it.quantityDelta}).`);
      }
    }
    // 1. MỘT câu cho MỌI bút toán trong sổ cái bất biến.
    await tx.insert(inventoryLedger).values(
      items.map((it, i) => ({
        id: `led-${stamp}-${i}-${Math.random().toString(36).substring(2, 9)}`,
        editionId: it.editionId,
        warehouseId: common.warehouseId,
        ownerId: it.ownerId,
        lotId: it.lotId,
        eventType: common.eventType,
        quantityDelta: it.quantityDelta,
        unitCostSnapshot: it.unitCostSnapshot,
        condition: it.condition || 'NEW',
        documentRef: common.documentRef,
        note: common.note,
        actorId,
        correlationId: common.correlationId,
        idempotencyKey: `${common.idempotencyPrefix || `idem-bat-${common.correlationId || common.documentRef}`}-${i}-${it.editionId}`,
        effectiveAt,
      }))
    );

    // 2. MỘT câu cho mỗi nhóm condition tạo bucket tồn kho còn thiếu.
    const groups = new Map<string, Array<{ editionId: string; quantityDelta: number; condition?: string; ownerId?: string; lotId?: string; unitCostSnapshot?: number }>>();
    for (const it of items) {
      const key = it.condition || 'NEW';
      const bucket = groups.get(key);
      if (bucket) bucket.push(it);
      else groups.set(key, [it]);
    }
    const entries = Array.from(groups.entries());
    for (let g = 0; g < entries.length; g++) {
      const condition = entries[g][0];
      const rows = entries[g][1];
      await tx
        .insert(stockBalances)
        .values(
          rows.map((it) => ({
            id: `sb-${it.editionId}-${common.warehouseId}-${condition}`,
            editionId: it.editionId,
            // 0032: NOT NULL + FK. Sách có `products.id === editions.id`.
            productId: it.editionId,
            warehouseId: common.warehouseId,
            condition: condition as typeof stockBalances.$inferInsert.condition,
            physicalQuantity: 0,
          }))
        )
        .onConflictDoNothing({
          // 0032 đổi UNIQUE `uq_stock_bucket` sang (product_id,…). Phải khớp
          // index đúng, không thì SQLite ném "ON CONFLICT clause does not match
          // any PRIMARY KEY or UNIQUE constraint". Còn 3 chỗ trong file này
          // dùng mẫu này — đã quét hết bằng grep.
          target: [stockBalances.productId, stockBalances.warehouseId, stockBalances.condition],
        });
    }

    // 3. MỘT câu trừ tồn cho MỌI dòng. CASE ghép từng ấn bản với delta của nó.
    //    BẮT BUỘC gộp delta theo (ấn bản, condition) TRƯỚC: nếu một ấn bản xuất
    //    hiện ở nhiều dòng, `CASE` chỉ khớp nhánh WHEN đầu tiên ⇒ chỉ trừ một
    //    lần và TỒN KHO SAI. (Test bắt được đúng lỗi này: 2 dòng cùng 1 ấn bản
    //    cho -47 cuốn thay vì -49.) Sổ cái vẫn giữ MỘT DÒNG MỖI DÒNG đơn.
    //    Bản lặp dùng mệnh đề `AND (physical_quantity + delta >= 0)`; bản gộp
    //    không diễn đạt được điều kiện riêng từng dòng trong một câu, nên chuyển
    //    sang kiểm âm ở bước 4 — tương đương vì cùng transaction, lỗi ⇒ rollback
    //    cả đơn. Trigger mức DB (migration 0027/0029) vẫn chạy và vẫn chặn âm.
    const deltaByKey = new Map<string, number>();
    for (const it of items) {
      const key = `${it.editionId}::${it.condition || 'NEW'}`;
      deltaByKey.set(key, (deltaByKey.get(key) ?? 0) + it.quantityDelta);
    }
    const agg = Array.from(deltaByKey.entries());
    const branches = agg
      .map(([key, delta]) => {
        const [editionId, condition] = key.split('::');
        return sql`WHEN ${stockBalances.editionId} = ${editionId} AND ${stockBalances.condition} = ${condition} THEN ${delta}`;
      })
      .reduce((acc, b) => sql`${acc} ${b}`, sql``);
    const matches = items.map(
      (it) =>
        sql`(${stockBalances.editionId} = ${it.editionId} AND ${stockBalances.condition} = ${it.condition || 'NEW'})`
    );
    await tx.run(sql`
      UPDATE stock_balances
      SET physical_quantity = physical_quantity + CASE ${branches} ELSE 0 END,
          updated_at = CURRENT_TIMESTAMP
      WHERE warehouse_id = ${common.warehouseId}
        AND (${sql.join(matches, sql` OR `)})
    `);

    // 4. Kiểm âm: đọc lại TẤT CẢ tồn kho trong 1 câu. Sai ⇒ ném lỗi ⇒ rollback
    //    cả đơn, y hệt bản lặp.
    const after = await tx
      .select({ editionId: stockBalances.editionId, condition: stockBalances.condition, qty: stockBalances.physicalQuantity })
      .from(stockBalances)
      .where(
        and(
          eq(stockBalances.warehouseId, common.warehouseId),
          or(
            ...items.map((it) =>
              and(
                eq(stockBalances.editionId, it.editionId),
                eq(stockBalances.condition, it.condition || 'NEW')
              )
            )
          )
        )
      );
    for (const r of after) {
      if (Number(r.qty || 0) < 0) {
        throw AppError.atp(`LỖI XUẤT ÂM KHO: ${r.editionId} còn ${r.qty} cuốn sau khi trừ.`);
      }
    }
    return items.length;
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
   * V4.1 S1.3 — Điều chuyển hàng loạt nhiều đầu sách trong 1 phiếu (chuẩn bị hội chợ).
   * Khác transfer() 1-cuốn: không cần pair-allowlist tĩnh (kho hội chợ tạo động),
   * bù lại bắt buộc role OWNER/MANAGER + 2 kho active + số PCK do server cấp trong cùng tx.
   */
  static async transferBatch(params: TransferBatchParams) {
    const { fromWarehouseId, toWarehouseId, note = '' } = params;

    const role = params.actorContext?.role;
    if (!params.actorContext || !params.actorContext.staffId?.trim()) {
      throw AppError.invalid('Thiếu actorContext cho thao tác chuyển kho hàng loạt.');
    }
    if (role !== 'ROLE_OWNER' && role !== 'ROLE_MANAGER') {
      throw AppError.forbidden(
        `Chuyển kho hàng loạt chỉ dành cho Quản lý hoặc Chủ cửa hàng (vai trò hiện tại: ${role || 'không xác định'}).`
      );
    }
    const effActor = params.actorContext.staffId.trim();
    const batchKey = params.idempotencyKey?.trim() || '';
    if (!batchKey) {
      throw AppError.invalid('Bắt buộc cung cấp idempotencyKey cho thao tác chuyển kho hàng loạt.');
    }

    const merged = this.normalizeBatchItems(params.items);
    const fingerprint = computeTransferDispatchFingerprint({
      fromWarehouseId: fromWarehouseId.trim(),
      toWarehouseId: toWarehouseId.trim(),
      dispatcherId: effActor,
      items: merged,
    });

    return await withDbRetry(() =>
      db.transaction(async (tx) => {
        // Replay: key đã commit → trả cached (đúng nội dung) hoặc CONFLICT (sai nội dung).
        const prior = await tx.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, batchKey)).limit(1);
        if (prior.length > 0) {
          let envelope: any = null;
          try { envelope = JSON.parse(prior[0].responseJson || 'null'); } catch { envelope = null; }
          if (envelope?.fp === fingerprint && envelope?.res) {
            return { ...envelope.res, isDuplicate: true as const };
          }
          throw AppError.idempotency(`IDEMPOTENCY_CONFLICT: Key "${batchKey}" đã được sử dụng cho một phiếu chuyển kho khác.`);
        }

        // Re-validate ATP trong tx (TOCTOU) — stale → 409 kèm số thực để UI re-cap 1 chạm.
        const check = await this.checkBatchAvailability(
          { fromWarehouseId, toWarehouseId, items: merged },
          tx
        );
        if (!check.ok) {
          throw AppError.toctouStale('Tồn kho nguồn đã biến động kể từ lúc kiểm tra.', { staleItems: check.staleItems });
        }

        // Số PCK do server cấp, cùng commit/rollback với phiếu.
        const pckCode = await WarehouseService.getNextDocumentCode('PCK', tx);

        // GHI GOM LÔ: 4 query bất kể số dòng.
        // Trước đây gọi recordMovement 2×/dòng (~5 query mỗi lần) → phiếu 5 dòng
        // là 50 query, vượt trần subrequest Cloudflare Worker → 500.
        const fromId = fromWarehouseId.trim();
        const toId = toWarehouseId.trim();
        const nowIso = new Date().toISOString();

        // 1. Bảo đảm bucket tồn của cả 2 kho cho mọi dòng (1 query).
        await tx
          .insert(stockBalances)
          .values(
            merged.flatMap((it) => [
              { id: `sb-${it.editionId}-${fromId}-NEW`, editionId: it.editionId, productId: it.editionId, warehouseId: fromId, condition: 'NEW' as const, physicalQuantity: 0 },
              { id: `sb-${it.editionId}-${toId}-NEW`, editionId: it.editionId, productId: it.editionId, warehouseId: toId, condition: 'NEW' as const, physicalQuantity: 0 },
            ])
          )
          // 0032: unique index đã sang product_id — xem giải thích ở recordMovement.
          .onConflictDoNothing({ target: [stockBalances.productId, stockBalances.warehouseId, stockBalances.condition] });

        // 2. Bút toán sổ cái: 1 lệnh cho toàn bộ 2N dòng (1 query).
        const ledgerRows = merged.flatMap((it) => ([
          {
            id: crypto.randomUUID(), editionId: it.editionId, warehouseId: fromId, eventType: 'TRANSFER_OUT',
            quantityDelta: -it.quantity, condition: 'NEW', documentRef: pckCode, actorId: effActor,
            correlationId: batchKey, effectiveAt: nowIso,
            note: `Chuyển kho hàng loạt tới [${toId}] (${pckCode}). ${note}`.trim(),
            idempotencyKey: `${batchKey}-out-${it.editionId}`,
          },
          {
            id: crypto.randomUUID(), editionId: it.editionId, warehouseId: toId, eventType: 'TRANSFER_IN',
            quantityDelta: it.quantity, condition: 'NEW', documentRef: pckCode, actorId: effActor,
            correlationId: batchKey, effectiveAt: nowIso,
            note: `Tiếp nhận chuyển kho hàng loạt từ [${fromId}] (${pckCode}). ${note}`.trim(),
            idempotencyKey: `${batchKey}-in-${it.editionId}`,
          },
        ]));
        await tx.insert(inventoryLedger).values(ledgerRows as any);

        // 3. Trừ tồn nguồn bằng CASE + điều kiện chặn âm, kiểm đủ số dòng (1 query).
        //    rowsAffected < số dòng ⇒ có dòng thiếu tồn ⇒ ném để rollback toàn phiếu.
        const caseSql = (delta: (q: number) => number) =>
          sql.join(merged.map((it) => sql`WHEN ${it.editionId} THEN ${delta(it.quantity)}`), sql.raw(' '));
        const outResult: any = await tx.run(sql`
          UPDATE stock_balances
          SET physical_quantity = physical_quantity + CASE edition_id ${caseSql((q) => -q)} ELSE 0 END,
              updated_at = CURRENT_TIMESTAMP
          WHERE warehouse_id = ${fromId} AND condition = 'NEW'
            AND edition_id IN (${sql.join(merged.map((it) => sql`${it.editionId}`), sql.raw(', '))})
            AND physical_quantity + CASE edition_id ${caseSql((q) => -q)} ELSE 0 END >= 0
        `);
        if (outResult.rowsAffected !== merged.length) {
          const { OrderService } = await import('./order.service');
          const atpByEdition = await OrderService.getBatchATP(merged.map((m) => m.editionId), fromId, tx);
          const staleItems: StaleItem[] = [];
          for (const it of merged) {
            const availableNow = atpByEdition.get(it.editionId) ?? 0;
            if (availableNow < it.quantity) {
              staleItems.push({ editionId: it.editionId, requested: it.quantity, availableNow });
            }
          }
          throw AppError.toctouStale(
            `Tồn kho nguồn không đủ cho ${staleItems.length}/${merged.length} dòng.`,
            { staleItems: staleItems.length ? staleItems : undefined }
          );
        }

        // 4. Cộng tồn đích bằng CASE (1 query).
        await tx.run(sql`
          UPDATE stock_balances
          SET physical_quantity = physical_quantity + CASE edition_id ${caseSql((q) => q)} ELSE 0 END,
              updated_at = CURRENT_TIMESTAMP
          WHERE warehouse_id = ${toId} AND condition = 'NEW'
            AND edition_id IN (${sql.join(merged.map((it) => sql`${it.editionId}`), sql.raw(', '))})
        `);

        const ledgerByKey = new Map(ledgerRows.map((r: any) => [`${r.warehouseId}|${r.editionId}`, r.id]));
        const lines = merged.map((it) => ({
          editionId: it.editionId,
          quantity: it.quantity,
          outLedgerId: ledgerByKey.get(`${fromId}|${it.editionId}`)!,
          inLedgerId: ledgerByKey.get(`${toId}|${it.editionId}`)!,
        }));

        const response = {
          transferBatchId: batchKey,
          pckCode,
          fromWarehouseId: fromWarehouseId.trim(),
          toWarehouseId: toWarehouseId.trim(),
          lines,
          isDuplicate: false as const,
        };
        try {
          await tx.insert(idempotencyKeys).values({
            key: batchKey,
            scope: 'transfer-batch',
            responseJson: JSON.stringify({ fp: fingerprint, res: response }),
          });
        } catch (e: any) {
          // Đua key cùng tick: đọc lại để replay thay vì văng lỗi UNIQUE thô.
          const hay = `${e?.message || ''} ${e?.code || ''}`;
          if (!/UNIQUE constraint|SQLITE_CONSTRAINT_UNIQUE/i.test(hay)) throw e;
          const raced = await tx.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, batchKey)).limit(1);
          let envelope: any = null;
          try { envelope = JSON.parse(raced[0]?.responseJson || 'null'); } catch { envelope = null; }
          if (envelope?.fp === fingerprint && envelope?.res) {
            return { ...envelope.res, isDuplicate: true as const };
          }
          throw AppError.idempotency(`IDEMPOTENCY_CONFLICT: Key "${batchKey}" đã được sử dụng cho một phiếu chuyển kho khác.`);
        }
        return response;
      })
    );
  }

  /**
   * V4.1 S1.3 — Kiểm tra tồn trước (pre-validation, không ghi gì).
   * Nút "Kiểm tra tồn kho" gọi hàm này (200 + ok:false để UI highlight đỏ, không toast lỗi);
   * commit gọi lại trong tx, stale lúc đó mới ném 409.
   */
  static async checkBatchAvailability(
    params: { fromWarehouseId: string; toWarehouseId: string; items: TransferBatchItemInput[] },
    txOrDb: any = db
  ): Promise<{ ok: true } | { ok: false; staleItems: StaleItem[] }> {
    const { fromWarehouseId, toWarehouseId } = params;
    if (!fromWarehouseId?.trim() || !toWarehouseId?.trim()) {
      throw AppError.invalid('Thiếu kho nguồn hoặc kho đích.');
    }
    if (fromWarehouseId.trim() === toWarehouseId.trim()) {
      throw AppError.invalid('Kho xuất và kho nhập phải khác nhau.');
    }
    for (const w of [fromWarehouseId.trim(), toWarehouseId.trim()]) {
      const row = await WarehouseService.getWarehouse(w, txOrDb);
      if (!row || row.isActive !== true) {
        throw AppError.invalid(`Kho ${w} không tồn tại hoặc đã ngưng hoạt động.`);
      }
      if (isForbiddenWarehouseFamily(w)) {
        throw AppError.forbidden(`Kho ${w} thuộc họ kho ảo/ký gửi/cách ly, không được điều chuyển trực tiếp.`);
      }
    }
    const merged = this.normalizeBatchItems(params.items);
    const existingEditions = await txOrDb
      .select({ id: editions.id })
      .from(editions)
      .where(inArray(editions.id, merged.map((m) => m.editionId)));
    if (existingEditions.length !== merged.length) {
      const known = new Set(existingEditions.map((e: any) => e.id));
      const unknown = merged.filter((m) => !known.has(m.editionId)).map((m) => m.editionId);
      throw AppError.invalid(`Ấn bản không tồn tại trong danh mục: ${unknown.join(', ')}.`);
    }
    const { OrderService } = await import('./order.service');
    // Batch ATP: 2 query cố định cho cả phiếu. Trước đây gọi getATP từng
    // dòng → 500 "Too many subrequests" trên Workers khi phiếu ~50+ dòng.
    const atpByEdition = await OrderService.getBatchATP(
      merged.map((m) => m.editionId),
      fromWarehouseId.trim(),
      txOrDb
    );
    const staleItems: StaleItem[] = [];
    for (const it of merged) {
      const atpNow = atpByEdition.get(it.editionId) ?? 0;
      if (atpNow < it.quantity) {
        staleItems.push({ editionId: it.editionId, requested: it.quantity, availableNow: atpNow });
      }
    }
    if (staleItems.length > 0) return { ok: false, staleItems };
    return { ok: true };
  }

  /** Chuẩn hóa dòng batch: gộp trùng edition (cộng dồn), validate tồn tại ấn bản + số nguyên > 0. */
  private static normalizeBatchItems(items: TransferBatchItemInput[]): Array<{ editionId: string; quantity: number }> {
    if (!items || items.length === 0) {
      throw AppError.invalid('Phiếu chuyển kho phải có ít nhất 1 đầu sách.');
    }
    // ponytail: trần 100 dòng/phiếu để giữ tx gọn; ca chuẩn bị hội chợ 20-50 dòng.
    if (items.length > 100) {
      throw AppError.invalid('Phiếu chuyển kho tối đa 100 dòng (tách thành nhiều phiếu).');
    }
    const merged = new Map<string, number>();
    for (const it of items) {
      const editionId = `${it?.editionId || ''}`.trim();
      if (!editionId) throw AppError.invalid('Dòng chuyển kho thiếu editionId.');
      const qty = typeof it.quantity === 'number' ? it.quantity : Number(`${it.quantity}`.trim());
      if (!Number.isInteger(qty) || qty <= 0) {
        throw AppError.invalid(`Số lượng chuyển cho ấn bản ${editionId} phải là số nguyên > 0.`);
      }
      merged.set(editionId, (merged.get(editionId) || 0) + qty);
    }
    return Array.from(merged.entries())
      .map(([editionId, quantity]) => ({ editionId, quantity }))
      .sort((a, b) => a.editionId.localeCompare(b.editionId));
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
        // POS sắp xếp "Cũ → Mới" theo năm phát hành, nên ma trận tồn kho phải
        // trả field này. `publication_year` có trong 81/81 ấn bản.
        publicationYear: editions.publicationYear,
      })
      .from(editions)
      .innerJoin(works, eq(editions.workId, works.id));

    // 2. Lấy toàn bộ số dư tồn kho
    // CHỈ bucket condition = 'NEW': transferBatch chỉ trừ/cộng NEW, đếm cả
    // hàng hỏng/cách ly làm tổng ma trận lệch với tồn chuyển được thật.
    const allBalances = await db
      .select()
      .from(stockBalances)
      .where(eq(stockBalances.condition, 'NEW'));

    // Map số dư theo format: Map<editionId, Map<warehouseCode, quantity>>
    // Lấy thông tin kho để map warehouseId sang code
    const allWarehouses = await db.select().from(warehouses);
    const whIdToCode = new Map<string, string>();
    for (const wh of allWarehouses) {
      whIdToCode.set(wh.id, wh.code);
    }

    // Tồn theo TẤT CẢ kho (kể cả kho hội chợ), khóa theo warehouseId — trước đây
    // chỉ đếm 3 mã kho cứng nên kho hội chợ không bao giờ hiện trong ma trận.
    const balanceMap = new Map<string, Record<string, number>>();
    for (const bal of allBalances) {
      // 0032: `edition_id` nullable cho hàng hóa nên không dùng làm khóa Map.
      // `product_id` NOT NULL, và với sách thì BẰNG `edition_id` — nên khoá và
      // giá trị trả về y hệt trước đây. Tới C2b (ATP chuyển sang product) thì
      // khoá này đã sẵn đúng chiều.
      const key = bal.productId;
      if (!balanceMap.has(key)) balanceMap.set(key, {});
      const record = balanceMap.get(key)!;
      record[bal.warehouseId] = (record[bal.warehouseId] || 0) + Number(bal.physicalQuantity || 0);
    }

    return allEditions.map((ed) => {
      const bal = balanceMap.get(ed.id) || {};
      const totalStock = Object.values(bal).reduce((s, n) => s + n, 0);
      return {
        ...ed,
        stockAuCo: bal['wh-au-co'] || 0,
        stockQuynhMai: bal['wh-quynh-mai'] || 0,
        stockDuPhong: bal['wh-du-phong'] || 0,
        stockByWarehouse: bal,
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