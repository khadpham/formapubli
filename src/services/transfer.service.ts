import { db, transferShipments, transferShipmentItems, warehouses } from '../db';
import { InventoryService } from './inventory.service';
import { withDbRetry } from '../lib/db-retry';
import { eq, and, desc, lt } from 'drizzle-orm';

/**
 * ĐỘNG CƠ LUÂN CHUYỂN KHO 2 BƯỚC QUA TRẠM TRUNG CHUYỂN IN_TRANSIT.
 *
 * - 1 kho ảo chung wh-in-transit (tự tạo nếu chưa có) để ma trận kho
 *   không bùng nổ theo tổ hợp tuyến N×(N-1).
 * - Dispatch:  kho gửi -X  ->  transit +X  (TRANSFER_OUT / TRANSFER_IN).
 * - Receive đủ: transit -X  ->  kho nhận +X, đóng phiếu RECEIVED_FULL.
 * - Receive lệch (nhận R lành, D rách/ướt, L mất; R+D+L = X):
 *     transit -(R+D) -> kho nhận +R (NEW) +D (QUARANTINE),
 *     transit -L (TRANSFER_LOSS) để transit về 0, sổ cân tuyệt đối.
 * - Cancel (chỉ khi còn IN_TRANSIT): transit -X -> kho gửi +X.
 */
export const TRANSIT_WAREHOUSE_ID = 'wh-in-transit';
export const TRANSIT_WAREHOUSE_CODE = 'KHO_IN_TRANSIT';
export const DEFAULT_STALE_HOURS = 12;

export type ShipmentStatus =
  | 'IN_TRANSIT'
  | 'RECEIVED_FULL'
  | 'RECEIVED_DISCREPANCY'
  | 'CANCELLED';

export interface DispatchItemInput {
  editionId: string;
  quantity: number;
  notes?: string;
}

export interface DispatchParams {
  fromWarehouseId: string;
  toWarehouseId: string;
  dispatcherId: string;
  vehicleInfo?: string;
  notes?: string;
  items: DispatchItemInput[];
}

export interface ReceiveItemInput {
  editionId: string;
  receivedQty: number;
  damagedQty?: number;
  lostQty?: number;
  notes?: string;
}

export interface ReceiveParams {
  shipmentId: string;
  receiverId: string;
  items: ReceiveItemInput[];
  notes?: string;
}

function shipmentCode(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `TRF-${date}-${rand}`;
}

function sqliteNowPlus(hours: number): string {
  return new Date(Date.now() + hours * 3600 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

export class TransferService {
  /** Đảm bảo kho ảo trung chuyển tồn tại (tự tạo lần đầu, an toàn gọi lại). */
  static async ensureTransitWarehouse(txOrDb: any = db) {
    await txOrDb
      .insert(warehouses)
      .values({
        id: TRANSIT_WAREHOUSE_ID,
        code: TRANSIT_WAREHOUSE_CODE,
        name: 'Kho ảo Trung chuyển (In-Transit)',
        address: 'Trạm trung gian trên đường vận chuyển',
        isActive: true,
      })
      .onConflictDoNothing({ target: warehouses.id });
  }

  /**
   * BƯỚC 1 — Xuất kho gửi: trừ kho nguồn, cộng kho transit, mở phiếu IN_TRANSIT.
   */
  static async dispatch(params: DispatchParams) {
    const { fromWarehouseId, toWarehouseId, dispatcherId, vehicleInfo, notes, items } = params;

    if (!items || items.length === 0) {
      throw new Error('Phiếu luân chuyển phải có ít nhất 1 ấn bản.');
    }
    if (fromWarehouseId === toWarehouseId) {
      throw new Error('Kho gửi và kho nhận phải khác nhau.');
    }
    if (fromWarehouseId === TRANSIT_WAREHOUSE_ID || toWarehouseId === TRANSIT_WAREHOUSE_ID) {
      throw new Error('Không dùng dispatch trực tiếp với kho transit (nhận hàng qua receive).');
    }
    for (const it of items) {
      if (!it.editionId || it.quantity <= 0) {
        throw new Error(`Số lượng gửi của ấn bản ${it.editionId} phải lớn hơn 0.`);
      }
    }

    const code = shipmentCode();

    return await withDbRetry(async () =>
      db.transaction(async (tx) => {
        await this.ensureTransitWarehouse(tx);

        await tx.insert(transferShipments).values({
          id: code,
          fromWarehouseId,
          toWarehouseId,
          dispatcherId,
          status: 'IN_TRANSIT',
          vehicleInfo,
          notes,
        });

        for (const it of items) {
          // Trừ kho nguồn (atomic guard chặn xuất âm ngay trong transaction).
          await InventoryService.recordMovement({
            editionId: it.editionId,
            warehouseId: fromWarehouseId,
            eventType: 'TRANSFER_OUT',
            quantityDelta: -it.quantity,
            condition: 'NEW',
            documentRef: code,
            correlationId: code,
            note: `Xuất luân chuyển tới kho [${toWarehouseId}] qua transit. ${it.notes || ''}`.trim(),
            actorId: dispatcherId,
            idempotencyKey: `idem-dispatch-out-${code}-${it.editionId}`,
            tx,
          });

          // Cộng kho transit.
          await InventoryService.recordMovement({
            editionId: it.editionId,
            warehouseId: TRANSIT_WAREHOUSE_ID,
            eventType: 'TRANSFER_IN',
            quantityDelta: it.quantity,
            condition: 'NEW',
            documentRef: code,
            correlationId: code,
            note: `Hàng đang trên đường tới kho [${toWarehouseId}].`,
            actorId: dispatcherId,
            idempotencyKey: `idem-dispatch-transit-${code}-${it.editionId}`,
            tx,
          });

          await tx.insert(transferShipmentItems).values({
            id: `tsi-${code}-${it.editionId}`,
            shipmentId: code,
            editionId: it.editionId,
            dispatchedQty: it.quantity,
            notes: it.notes,
          });
        }

        return {
          shipmentId: code,
          status: 'IN_TRANSIT' as ShipmentStatus,
          fromWarehouseId,
          toWarehouseId,
          itemsCount: items.length,
          totalQuantity: items.reduce((s, i) => s + i.quantity, 0),
        };
      })
    );
  }

  /**
   * BƯỚC 2 — Thực nhận tại kho đích: kiểm đếm R lành + D hỏng + L mất = X.
   */
  static async receive(params: ReceiveParams) {
    const { shipmentId, receiverId, items, notes } = params;

    const ship = (
      await db.select().from(transferShipments).where(eq(transferShipments.id, shipmentId)).limit(1)
    )[0];
    if (!ship) throw new Error(`Không tìm thấy phiếu luân chuyển ${shipmentId}.`);
    if (ship.status !== 'IN_TRANSIT') {
      throw new Error(`Phiếu ${shipmentId} đã xử lý (trạng thái ${ship.status}), không nhận lại.`);
    }

    const dispatched = await db
      .select()
      .from(transferShipmentItems)
      .where(eq(transferShipmentItems.shipmentId, shipmentId));

    if (items.length !== dispatched.length) {
      throw new Error(
        `Phiếu có ${dispatched.length} dòng hàng, biên bản nhận phải đủ ${dispatched.length} dòng.`
      );
    }

    const plan = dispatched.map((d) => {
      const r = items.find((i) => i.editionId === d.editionId);
      if (!r) throw new Error(`Thiếu biên bản nhận cho ấn bản ${d.editionId}.`);
      const received = r.receivedQty ?? 0;
      const damaged = r.damagedQty ?? 0;
      const lost = r.lostQty ?? 0;
      if (received < 0 || damaged < 0 || lost < 0) {
        throw new Error(`Số lượng nhận của ấn bản ${d.editionId} không được âm.`);
      }
      if (received + damaged + lost !== d.dispatchedQty) {
        throw new Error(
          `Ấn bản ${d.editionId}: nhận (${received}) + hỏng (${damaged}) + mất (${lost}) phải bằng số gửi (${d.dispatchedQty}).`
        );
      }
      return { dispatched: d, received, damaged, lost, notes: r.notes };
    });

    const totalLost = plan.reduce((s, p) => s + p.lost, 0);
    const totalDamaged = plan.reduce((s, p) => s + p.damaged, 0);
    const status: ShipmentStatus =
      totalLost === 0 && totalDamaged === 0 ? 'RECEIVED_FULL' : 'RECEIVED_DISCREPANCY';

    return await withDbRetry(async () =>
      db.transaction(async (tx) => {
        for (const p of plan) {
          const inTransitOut = p.received + p.damaged;

          // Hàng rời transit về kho đích (chỉ khi có hàng thật về).
          if (inTransitOut > 0) {
            await InventoryService.recordMovement({
              editionId: p.dispatched.editionId,
              warehouseId: TRANSIT_WAREHOUSE_ID,
              eventType: 'TRANSFER_OUT',
              quantityDelta: -inTransitOut,
              condition: 'NEW',
              documentRef: shipmentId,
              correlationId: shipmentId,
              note: `Thực nhận tại kho [${ship.toWarehouseId}]: lành ${p.received}, hỏng ${p.damaged}.`,
              actorId: receiverId,
              idempotencyKey: `idem-receive-transit-${shipmentId}-${p.dispatched.editionId}`,
              tx,
            });
          }

          // Hàng lành vào kho đích.
          if (p.received > 0) {
            await InventoryService.recordMovement({
              editionId: p.dispatched.editionId,
              warehouseId: ship.toWarehouseId,
              eventType: 'TRANSFER_IN',
              quantityDelta: p.received,
              condition: 'NEW',
              documentRef: shipmentId,
              correlationId: shipmentId,
              note: `Thực nhận luân chuyển từ kho [${ship.fromWarehouseId}]. ${p.notes || ''}`.trim(),
              actorId: receiverId,
              idempotencyKey: `idem-receive-dest-${shipmentId}-${p.dispatched.editionId}`,
              tx,
            });
          }

          // Hàng rách/ướt vào khu cách ly chờ thẩm định.
          if (p.damaged > 0) {
            await InventoryService.recordMovement({
              editionId: p.dispatched.editionId,
              warehouseId: ship.toWarehouseId,
              eventType: 'TRANSFER_IN',
              quantityDelta: p.damaged,
              condition: 'QUARANTINE',
              documentRef: shipmentId,
              correlationId: shipmentId,
              note: `Hàng hỏng trên đường vận chuyển, chờ thẩm định RMA. ${p.notes || ''}`.trim(),
              actorId: receiverId,
              idempotencyKey: `idem-receive-quar-${shipmentId}-${p.dispatched.editionId}`,
              tx,
            });
          }

          // Hàng mất: trừ nốt phần còn kẹt ở transit để transit về 0, sổ cân tuyệt đối.
          if (p.lost > 0) {
            await InventoryService.recordMovement({
              editionId: p.dispatched.editionId,
              warehouseId: TRANSIT_WAREHOUSE_ID,
              eventType: 'TRANSFER_LOSS',
              quantityDelta: -p.lost,
              condition: 'NEW',
              documentRef: shipmentId,
              correlationId: shipmentId,
              note: `Thất lạc trên đường từ [${ship.fromWarehouseId}] tới [${ship.toWarehouseId}], lập biên bản bồi thường.`,
              actorId: receiverId,
              idempotencyKey: `idem-receive-loss-${shipmentId}-${p.dispatched.editionId}`,
              tx,
            });
          }

          await tx
            .update(transferShipmentItems)
            .set({ receivedQty: p.received, damagedQty: p.damaged, lostQty: p.lost, notes: p.notes })
            .where(
              and(
                eq(transferShipmentItems.shipmentId, shipmentId),
                eq(transferShipmentItems.editionId, p.dispatched.editionId)
              )
            );
        }

        await tx
          .update(transferShipments)
          .set({ status, receiverId, receivedAt: sqliteNowPlus(0), notes: notes ?? ship.notes })
          .where(eq(transferShipments.id, shipmentId));

        return {
          shipmentId,
          status,
          toWarehouseId: ship.toWarehouseId,
          totalReceived: plan.reduce((s, p) => s + p.received, 0),
          totalDamaged,
          totalLost,
        };
      })
    );
  }

  /**
   * Hủy phiếu chưa nhận: rút hàng từ transit trả về kho gửi.
   */
  static async cancel(shipmentId: string, actorId: string) {
    const ship = (
      await db.select().from(transferShipments).where(eq(transferShipments.id, shipmentId)).limit(1)
    )[0];
    if (!ship) throw new Error(`Không tìm thấy phiếu luân chuyển ${shipmentId}.`);
    if (ship.status !== 'IN_TRANSIT') {
      throw new Error(`Phiếu ${shipmentId} đã ở trạng thái ${ship.status}, không thể hủy.`);
    }

    const lines = await db
      .select()
      .from(transferShipmentItems)
      .where(eq(transferShipmentItems.shipmentId, shipmentId));

    return await withDbRetry(async () =>
      db.transaction(async (tx) => {
        for (const line of lines) {
          await InventoryService.recordMovement({
            editionId: line.editionId,
            warehouseId: TRANSIT_WAREHOUSE_ID,
            eventType: 'TRANSFER_OUT',
            quantityDelta: -line.dispatchedQty,
            condition: 'NEW',
            documentRef: shipmentId,
            correlationId: shipmentId,
            note: `Hủy phiếu luân chuyển, rút hàng về kho gửi [${ship.fromWarehouseId}].`,
            actorId,
            idempotencyKey: `idem-cancel-transit-${shipmentId}-${line.editionId}`,
            tx,
          });
          await InventoryService.recordMovement({
            editionId: line.editionId,
            warehouseId: ship.fromWarehouseId,
            eventType: 'TRANSFER_IN',
            quantityDelta: line.dispatchedQty,
            condition: 'NEW',
            documentRef: shipmentId,
            correlationId: shipmentId,
            note: `Nhận lại hàng hủy phiếu ${shipmentId}.`,
            actorId,
            idempotencyKey: `idem-cancel-src-${shipmentId}-${line.editionId}`,
            tx,
          });
        }
        await tx
          .update(transferShipments)
          .set({ status: 'CANCELLED', receivedAt: sqliteNowPlus(0) })
          .where(eq(transferShipments.id, shipmentId));
        return { shipmentId, status: 'CANCELLED' as ShipmentStatus };
      })
    );
  }

  /** Chi tiết phiếu + dòng hàng (cho UI biên bản giao nhận). */
  static async getShipment(shipmentId: string) {
    const ship = (
      await db.select().from(transferShipments).where(eq(transferShipments.id, shipmentId)).limit(1)
    )[0];
    if (!ship) throw new Error(`Không tìm thấy phiếu luân chuyển ${shipmentId}.`);
    const lines = await db
      .select()
      .from(transferShipmentItems)
      .where(eq(transferShipmentItems.shipmentId, shipmentId));
    return { ...ship, items: lines };
  }

  /** Liệt kê phiếu kẹt quá ngưỡng giờ (mặc định 12h) để thủ kho gọi xe. */
  static async listStaleShipments(thresholdHours: number = DEFAULT_STALE_HOURS) {
    const cutoff = sqliteNowPlus(-thresholdHours);
    return await db
      .select()
      .from(transferShipments)
      .where(
        and(eq(transferShipments.status, 'IN_TRANSIT'), lt(transferShipments.dispatchedAt, cutoff))
      )
      .orderBy(desc(transferShipments.dispatchedAt));
  }

  static async listShipments(status?: string, limit = 50) {
    if (status) {
      return await db
        .select()
        .from(transferShipments)
        .where(eq(transferShipments.status, status))
        .orderBy(desc(transferShipments.dispatchedAt))
        .limit(limit);
    }
    return await db
      .select()
      .from(transferShipments)
      .orderBy(desc(transferShipments.dispatchedAt))
      .limit(limit);
  }
}
