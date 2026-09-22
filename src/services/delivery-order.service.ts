import crypto from 'node:crypto';
import {
  db,
  deliveryOrders,
  deliveryOrderItems,
  warehouses,
  partners,
  stockBalances,
  inventoryLedger,
  idempotencyKeys,
} from '../db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AppError } from './app-error';
import { withDbRetry } from '../lib/db-retry';
import { WarehouseService } from './warehouse.service';

export interface DeliveryItemInput {
  editionId: string;
  quantity: number;
  unitCoverPrice: number;
  unitSellingPrice: number;
}

export interface ActorContext {
  staffId: string;
  role: string;
  fullName?: string;
}

export class DeliveryOrderService {
  /**
   * Lập phiếu xuất bán sỉ đại lý ở trạng thái DRAFT.
   */
  static async createDraft(params: {
    partnerId: string;
    fromWarehouseId: string;
    discountRate?: number;
    fiscalScope?: 'COMMERCIAL_WHOLESALE' | 'CONSIGNMENT_DISPATCH';
    note?: string;
    items: DeliveryItemInput[];
    actorContext: ActorContext;
    txOrDb?: any;
  }) {
    const {
      partnerId,
      fromWarehouseId,
      discountRate = 0.0,
      fiscalScope = 'COMMERCIAL_WHOLESALE',
      note,
      items,
      actorContext,
      txOrDb = db,
    } = params;

    if (!items || items.length === 0) {
      throw AppError.invalid('Phiếu xuất kho phải có ít nhất một ấn bản');
    }

    // Kiểm tra kho xuất tồn tại
    const wh = await txOrDb
      .select()
      .from(warehouses)
      .where(eq(warehouses.id, fromWarehouseId))
      .limit(1);
    if (wh.length === 0 || !wh[0].isActive) {
      throw AppError.invalid(`Kho xuất ${fromWarehouseId} không tồn tại hoặc đã ngừng hoạt động`);
    }

    // Kiểm tra đối tác tồn tại
    const partner = await txOrDb
      .select()
      .from(partners)
      .where(eq(partners.id, partnerId))
      .limit(1);
    if (partner.length === 0) {
      throw AppError.invalid(`Đối tác ${partnerId} không tồn tại`);
    }

    const subtotal = items.reduce(
      (sum, item) => sum + item.quantity * item.unitCoverPrice,
      0
    );
    const finalAmount = items.reduce(
      (sum, item) => sum + item.quantity * item.unitSellingPrice,
      0
    );

    const orderId = crypto.randomUUID();
    const draftCode = `DRAFT-${orderId.slice(0, 8).toUpperCase()}`;
    const nowIso = new Date().toISOString();

    const newOrder = {
      id: orderId,
      code: draftCode,
      partnerId,
      fromWarehouseId,
      subtotal,
      discountRate,
      finalAmount,
      fiscalScope,
      status: 'DRAFT',
      reversalOf: null,
      note: note || null,
      createdBy: actorContext.staffId,
      dispatchedBy: null,
      dispatchedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await txOrDb.insert(deliveryOrders).values(newOrder);

    const itemRows = items.map((item) => ({
      id: crypto.randomUUID(),
      deliveryOrderId: orderId,
      editionId: item.editionId,
      quantity: item.quantity,
      unitCoverPrice: item.unitCoverPrice,
      unitSellingPrice: item.unitSellingPrice,
      totalAmount: item.quantity * item.unitSellingPrice,
      createdAt: nowIso,
    }));

    await txOrDb.insert(deliveryOrderItems).values(itemRows);

    return {
      ...newOrder,
      items: itemRows,
    };
  }

  /**
   * Ký duyệt và Khóa sổ Phiếu xuất kho:
   * - Kiểm tra tồn ATP
   * - Cấp mã PXK-YYYY-XXXX liên tục trong cùng transaction
   * - Trừ thẻ kho DISPATCH_SALE
   * - Khóa cứng DISPATCHED_LOCKED bất biến
   * - Đảm bảo Idempotency
   */
  static async dispatchAndLock(params: {
    deliveryOrderId: string;
    idempotencyKey: string;
    actorContext: ActorContext;
  }) {
    const { deliveryOrderId, idempotencyKey, actorContext } = params;

    if (!idempotencyKey) {
      throw AppError.invalid('Bắt buộc có Idempotency-Key khi xuất kho');
    }

    // Kiểm tra idempotency trước khi vào transaction
    const existingIdem = await db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, idempotencyKey))
      .limit(1);

    if (existingIdem.length > 0 && existingIdem[0].responseJson) {
      return JSON.parse(existingIdem[0].responseJson);
    }

    return await withDbRetry(async () => {
      return await db.transaction(async (tx) => {
        // 1. Đọc và khóa phiếu xuất kho
        const orderRows = await tx
          .select()
          .from(deliveryOrders)
          .where(eq(deliveryOrders.id, deliveryOrderId))
          .limit(1);

        if (orderRows.length === 0) {
          throw AppError.invalid('Không tìm thấy phiếu xuất kho');
        }

        const order = orderRows[0];

        // Nếu đã được xuất rồi (do retry trùng), trả về luôn
        if (order.status === 'DISPATCHED_LOCKED') {
          const items = await tx
            .select()
            .from(deliveryOrderItems)
            .where(eq(deliveryOrderItems.deliveryOrderId, order.id));
          return { ...order, items };
        }

        if (order.status !== 'DRAFT') {
          throw AppError.conflict(
            `Không thể xuất phiếu ở trạng thái ${order.status} (chỉ cho phép xuất từ DRAFT)`
          );
        }

        const items = await tx
          .select()
          .from(deliveryOrderItems)
          .where(eq(deliveryOrderItems.deliveryOrderId, order.id));

        if (items.length === 0) {
          throw AppError.invalid('Phiếu xuất kho không có sản phẩm');
        }

        // 2. Re-validate ATP tồn kho
        for (const item of items) {
          const balances = await tx
            .select()
            .from(stockBalances)
            .where(
              and(
                eq(stockBalances.editionId, item.editionId),
                eq(stockBalances.warehouseId, order.fromWarehouseId),
                eq(stockBalances.condition, 'NEW')
              )
            )
            .limit(1);

          const currentQty = balances[0]?.physicalQuantity ?? 0;
          if (currentQty < item.quantity) {
            throw AppError.atp(
              `Ấn bản ${item.editionId} không đủ tồn kho tại kho xuất (Cần: ${item.quantity}, Có: ${currentQty})`
            );
          }
        }

        // 3. Cấp mã chứng từ PXK-YYYY-XXXX liên tục trong cùng transaction
        const pxkCode = await WarehouseService.getNextDocumentCode('PXK', tx);
        const nowIso = new Date().toISOString();

        // 4. Trừ kho và ghi nhận Thẻ kho (inventoryLedger)
        const eventType =
          order.fiscalScope === 'CONSIGNMENT_DISPATCH'
            ? 'CONSIGNMENT_DISPATCH'
            : 'DISPATCH_SALE';

        for (const item of items) {
          // Trừ physicalQuantity
          await tx
            .update(stockBalances)
            .set({
              physicalQuantity: sql`${stockBalances.physicalQuantity} - ${item.quantity}`,
              updatedAt: nowIso,
            })
            .where(
              and(
                eq(stockBalances.editionId, item.editionId),
                eq(stockBalances.warehouseId, order.fromWarehouseId),
                eq(stockBalances.condition, 'NEW')
              )
            );

          // Ghi thẻ kho bất biến
          await tx.insert(inventoryLedger).values({
            id: crypto.randomUUID(),
            editionId: item.editionId,
            warehouseId: order.fromWarehouseId,
            ownerId: order.partnerId,
            eventType,
            quantityDelta: -item.quantity,
            condition: 'NEW',
            documentRef: pxkCode,
            actorId: actorContext.staffId,
            note: `Xuất kho bán buôn ${pxkCode} cho đại lý`,
            idempotencyKey: `${idempotencyKey}-${item.editionId}`,
            effectiveAt: nowIso,
            recordedAt: nowIso,
          });
        }

        // 5. Cập nhật phiếu sang DISPATCHED_LOCKED
        await tx
          .update(deliveryOrders)
          .set({
            code: pxkCode,
            status: 'DISPATCHED_LOCKED',
            dispatchedBy: actorContext.staffId,
            dispatchedAt: nowIso,
            updatedAt: nowIso,
          })
          .where(
            and(
              eq(deliveryOrders.id, order.id),
              eq(deliveryOrders.status, 'DRAFT')
            )
          );

        const responseData = {
          ...order,
          code: pxkCode,
          status: 'DISPATCHED_LOCKED',
          dispatchedBy: actorContext.staffId,
          dispatchedAt: nowIso,
          updatedAt: nowIso,
          items,
        };

        // 6. Ghi nhận Idempotency Key
        await tx.insert(idempotencyKeys).values({
          key: idempotencyKey,
          scope: 'pxk-create',
          responseJson: JSON.stringify(responseData),
          createdAt: nowIso,
        });

        return responseData;
      });
    });
  }

  /**
   * Đảo bút toán hủy phiếu xuất kho (Reversal):
   * - Nguyên tắc kế toán bất biến: Phiếu xuất đã khóa không xóa, không sửa trực tiếp.
   * - Cấp mã PXK_R-YYYY-XXXX (namespace riêng, giữ dãy PXK gốc liên tục).
   * - Sinh bút toán RECEIPT_RETURN để hoàn kho.
   * - Đánh dấu phiếu gốc sang VOIDED_REVERSED.
   */
  static async reverse(params: {
    deliveryOrderId: string;
    reason: string;
    idempotencyKey: string;
    actorContext: ActorContext;
  }) {
    const { deliveryOrderId, reason, idempotencyKey, actorContext } = params;

    if (!idempotencyKey) {
      throw AppError.invalid('Bắt buộc có Idempotency-Key khi thực hiện đảo bút toán');
    }

    const existingIdem = await db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, idempotencyKey))
      .limit(1);

    if (existingIdem.length > 0 && existingIdem[0].responseJson) {
      return JSON.parse(existingIdem[0].responseJson);
    }

    return await withDbRetry(async () => {
      return await db.transaction(async (tx) => {
        const orderRows = await tx
          .select()
          .from(deliveryOrders)
          .where(eq(deliveryOrders.id, deliveryOrderId))
          .limit(1);

        if (orderRows.length === 0) {
          throw AppError.invalid('Không tìm thấy phiếu xuất kho cần hủy');
        }

        const original = orderRows[0];

        if (original.status === 'VOIDED_REVERSED') {
          throw AppError.conflict(
            `Phiếu ${original.code} đã được đảo bút toán hủy trước đó`
          );
        }

        if (original.status !== 'DISPATCHED_LOCKED') {
          throw AppError.conflict(
            `Chỉ phiếu đã khóa (DISPATCHED_LOCKED) mới cần đảo bút toán. Phiếu hiện tại ở trạng thái ${original.status}`
          );
        }

        const items = await tx
          .select()
          .from(deliveryOrderItems)
          .where(eq(deliveryOrderItems.deliveryOrderId, original.id));

        // 1. Cấp số PXK_R-YYYY-XXXX liên tục trong cùng transaction
        const revCode = await WarehouseService.getNextDocumentCode('PXK_R', tx);
        const nowIso = new Date().toISOString();
        const revOrderId = crypto.randomUUID();

        // 2. Tạo phiếu đối ứng PXK_R
        const reversalOrder = {
          id: revOrderId,
          code: revCode,
          partnerId: original.partnerId,
          fromWarehouseId: original.fromWarehouseId,
          subtotal: -original.subtotal,
          discountRate: original.discountRate,
          finalAmount: -original.finalAmount,
          fiscalScope: original.fiscalScope,
          status: 'DISPATCHED_LOCKED',
          reversalOf: original.code,
          note: `Đảo bút toán hủy phiếu ${original.code}. Lý do: ${reason}`,
          createdBy: actorContext.staffId,
          dispatchedBy: actorContext.staffId,
          dispatchedAt: nowIso,
          createdAt: nowIso,
          updatedAt: nowIso,
        };

        await tx.insert(deliveryOrders).values(reversalOrder);

        // 3. Tạo chi tiết hàng đối ứng
        const revItems = items.map((item) => ({
          id: crypto.randomUUID(),
          deliveryOrderId: revOrderId,
          editionId: item.editionId,
          quantity: -item.quantity,
          unitCoverPrice: item.unitCoverPrice,
          unitSellingPrice: item.unitSellingPrice,
          totalAmount: -item.totalAmount,
          createdAt: nowIso,
        }));

        await tx.insert(deliveryOrderItems).values(revItems);

        // 4. Hoàn kho: cộng lại physicalQuantity và ghi RECEIPT_RETURN
        for (const item of items) {
          await tx
            .update(stockBalances)
            .set({
              physicalQuantity: sql`${stockBalances.physicalQuantity} + ${item.quantity}`,
              updatedAt: nowIso,
            })
            .where(
              and(
                eq(stockBalances.editionId, item.editionId),
                eq(stockBalances.warehouseId, original.fromWarehouseId),
                eq(stockBalances.condition, 'NEW')
              )
            );

          await tx.insert(inventoryLedger).values({
            id: crypto.randomUUID(),
            editionId: item.editionId,
            warehouseId: original.fromWarehouseId,
            ownerId: original.partnerId,
            eventType: 'RECEIPT_RETURN',
            quantityDelta: item.quantity,
            condition: 'NEW',
            documentRef: revCode,
            actorId: actorContext.staffId,
            note: `Hoàn kho đảo bút toán hủy phiếu ${original.code}`,
            idempotencyKey: `${idempotencyKey}-${item.editionId}`,
            effectiveAt: nowIso,
            recordedAt: nowIso,
          });
        }

        // 5. Cập nhật phiếu gốc sang VOIDED_REVERSED
        await tx
          .update(deliveryOrders)
          .set({
            status: 'VOIDED_REVERSED',
            updatedAt: nowIso,
          })
          .where(eq(deliveryOrders.id, original.id));

        const responseData = {
          ...reversalOrder,
          items: revItems,
        };

        // 6. Ghi nhận Idempotency Key
        await tx.insert(idempotencyKeys).values({
          key: idempotencyKey,
          scope: 'pxk-reverse',
          responseJson: JSON.stringify(responseData),
          createdAt: nowIso,
        });

        return responseData;
      });
    });
  }

  /**
   * Tra cứu chi tiết phiếu xuất kho theo ID hoặc mã (PXK-YYYY-XXXX).
   */
  static async getDeliveryOrder(idOrCode: string, txOrDb: any = db) {
    const rows = await txOrDb
      .select({
        order: deliveryOrders,
        warehouseName: warehouses.name,
        partnerName: partners.name,
        partnerCode: partners.code,
      })
      .from(deliveryOrders)
      .leftJoin(warehouses, eq(deliveryOrders.fromWarehouseId, warehouses.id))
      .leftJoin(partners, eq(deliveryOrders.partnerId, partners.id))
      .where(
        sql`${deliveryOrders.id} = ${idOrCode} OR ${deliveryOrders.code} = ${idOrCode}`
      )
      .limit(1);

    if (rows.length === 0) {
      throw AppError.invalid('Không tìm thấy phiếu xuất kho');
    }

    const { order, warehouseName, partnerName, partnerCode } = rows[0];
    const items = await txOrDb
      .select()
      .from(deliveryOrderItems)
      .where(eq(deliveryOrderItems.deliveryOrderId, order.id));

    return {
      ...order,
      warehouseName,
      partnerName,
      partnerCode,
      items,
    };
  }

  /**
   * Danh sách phiếu xuất kho với các bộ lọc.
   */
  static async listDeliveryOrders(
    filter: {
      status?: string;
      fromWarehouseId?: string;
      partnerId?: string;
    } = {},
    txOrDb: any = db
  ) {
    const conditions = [];

    if (filter.status) {
      conditions.push(eq(deliveryOrders.status, filter.status));
    }
    if (filter.fromWarehouseId) {
      conditions.push(eq(deliveryOrders.fromWarehouseId, filter.fromWarehouseId));
    }
    if (filter.partnerId) {
      conditions.push(eq(deliveryOrders.partnerId, filter.partnerId));
    }

    const rows = await txOrDb
      .select({
        order: deliveryOrders,
        warehouseName: warehouses.name,
        partnerName: partners.name,
      })
      .from(deliveryOrders)
      .leftJoin(warehouses, eq(deliveryOrders.fromWarehouseId, warehouses.id))
      .leftJoin(partners, eq(deliveryOrders.partnerId, partners.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(deliveryOrders.createdAt));

    return rows.map((r: any) => ({
      ...r.order,
      warehouseName: r.warehouseName,
      partnerName: r.partnerName,
    }));
  }
}
