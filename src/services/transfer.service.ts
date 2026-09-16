import {
  db,
  transferShipments,
  transferShipmentItems,
  transferActions,
  rmaTickets,
  warehouses,
} from '../db';
import { InventoryService } from './inventory.service';
import { withDbRetry } from '../lib/db-retry';
import { eq, and, desc, lt, sql } from 'drizzle-orm';
import { AppError } from './app-error';
import { ActorContext, toActorContext } from './actor-context';
import {
  DispatchItemInput,
  DispatchParams,
  ReceiveItemInput,
  ReceiveParams,
  CancelParams,
} from '../types/cp3';
import { computeTransferDispatchFingerprint,
  computeTransferReceiveFingerprint,
  computeTransferCancelFingerprint,
} from '../lib/transfer-fingerprint';
import {
  isRoleAllowedForDirectTransfer,
  FORBIDDEN_DIRECT_TRANSFER_WAREHOUSES,
} from './direct-transfer-policy';

/** true khi lỗi là vi phạm UNIQUE (dùng để map race cùng key, không để lọt raw). */
function isUniqueViolation(e: any): boolean {
  const hay = `${e?.message || ''} ${e?.code || ''} ${e?.cause?.message || ''} ${e?.cause?.code || ''}`;
  return /UNIQUE constraint|SQLITE_CONSTRAINT_UNIQUE/i.test(hay);
}

/**
 * ĐỘNG CƠ LUÂN CHUYỂN KHO 2 BƯỚC QUA TRẠM TRUNG CHUYỂN IN_TRANSIT (CP3 Hardened).
 *
 * - 1 kho ảo chung wh-in-transit (tự tạo nếu chưa có) để ma trận kho
 *   không bùng nổ theo tổ hợp tuyến N×(N-1).
 * - Dispatch:  kho gửi -X  ->  transit +X  (TRANSFER_OUT / TRANSFER_IN).
 * - Receive đủ: transit -X  ->  kho nhận +X, đóng phiếu RECEIVED_FULL.
 * - Receive lệch (nhận R lành, D rách/ướt, L mất; R+D+L = X):
 *     transit -(R+D) -> kho nhận +R (NEW) +D (QUARANTINE),
 *     transit -L (TRANSFER_LOSS) để transit về 0, sổ cân tuyệt đối.
 *     Mở phiếu rma_tickets cho từng dòng có damagedQty > 0.
 * - Cancel (chỉ khi còn IN_TRANSIT): transit -X -> kho gửi +X.
 *
 * Mọi mutation (dispatch, receive, cancel) bắt buộc có idempotencyKey,
 * actorContext, replay verification, conditional status update, và ghi transfer_actions.
 */
export const TRANSIT_WAREHOUSE_ID = 'wh-in-transit';
export const TRANSIT_WAREHOUSE_CODE = 'KHO_IN_TRANSIT';
export const DEFAULT_STALE_HOURS = 12;

export type ShipmentStatus =
  | 'IN_TRANSIT'
  | 'RECEIVED_FULL'
  | 'RECEIVED_DISCREPANCY'
  | 'CANCELLED';

export type { DispatchItemInput, DispatchParams, ReceiveItemInput, ReceiveParams, CancelParams };

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
    const { fromWarehouseId, toWarehouseId, vehicleInfo, notes, items, actorContext, idempotencyKey } = params;

    if (!items || items.length === 0) {
      throw AppError.invalid('Phiếu luân chuyển phải có ít nhất 1 ấn bản.');
    }
    if (fromWarehouseId === toWarehouseId) {
      throw AppError.invalid('Kho gửi và kho nhận phải khác nhau.');
    }
    // Direct-transfer gate (CP3-D) CHẠY TRƯỚC mọi từ chối INVALID của luồng
    // warehouse 2 bước: caller đánh dấu actorRole muốn ngữ nghĩa direct thì
    // mọi vi phạm role/pair đều là FORBIDDEN.
    // Phạm vi (ghi nhận Lane B): gate này áp chính sách SSOT §9 cho nhánh
    // direct-marked — role Owner/Manager + cấm tuyệt đối virtual families.
    // Riêng allowlist cặp cấu hình (mặc định rỗng) thuộc endpoint
    // /api/inventory/transfer (InventoryService.transfer); shipment dispatch
    // giữa 2 kho vật lý không đòi cặp cấu hình trước (frozen T-DP yêu cầu
    // owner A→B thành công khi ATP cho phép).
    const directRole = (params as any).actorRole;
    const isDirectCall = directRole !== undefined;
    if (isDirectCall) {
      if (!isRoleAllowedForDirectTransfer(directRole)) {
        throw AppError.forbidden(
          `FORBIDDEN: Chuyển kho trực tiếp chỉ dành cho Chủ cửa hàng hoặc Quản lý (role hiện tại: ${directRole}).`
        );
      }
      const v = `${fromWarehouseId}|${toWarehouseId}`.toLowerCase();
      const isVirtualPair =
        FORBIDDEN_DIRECT_TRANSFER_WAREHOUSES.has(fromWarehouseId) ||
        FORBIDDEN_DIRECT_TRANSFER_WAREHOUSES.has(toWarehouseId) ||
        /transit|consign|quarantine|damaged|virtual/i.test(v);
      if (isVirtualPair) {
        throw AppError.forbidden(
          `FORBIDDEN: Cặp kho [${fromWarehouseId} → ${toWarehouseId}] không được chuyển trực tiếp (kho transit/ký gửi/cách ly chỉ đi luồng 2 bước).`
        );
      }
    }
    if (!isDirectCall && (fromWarehouseId === TRANSIT_WAREHOUSE_ID || toWarehouseId === TRANSIT_WAREHOUSE_ID)) {
      throw AppError.invalid('Không dùng dispatch trực tiếp với kho transit (nhận hàng qua receive).');
    }

    // Gộp và chuẩn hóa danh sách items theo editionId
    const itemMap = new Map<string, { quantity: number; notes?: string }>();
    for (const it of items) {
      if (!it.editionId || typeof it.editionId !== 'string' || !it.editionId.trim()) {
        throw AppError.invalid('Mã ấn bản (editionId) không hợp lệ.');
      }
      const eid = it.editionId.trim();
      const qty = it.quantity;
      if (!Number.isInteger(qty) || qty <= 0) {
        throw AppError.invalid(`Số lượng gửi của ấn bản ${eid} phải là số nguyên > 0.`);
      }
      const prev = itemMap.get(eid);
      if (prev) {
        itemMap.set(eid, {
          quantity: prev.quantity + qty,
          notes: [prev.notes, it.notes].filter(Boolean).join('; ') || undefined,
        });
      } else {
        itemMap.set(eid, { quantity: qty, notes: it.notes });
      }
    }

    const consolidatedItems: DispatchItemInput[] = Array.from(itemMap.entries()).map(
      ([editionId, val]) => ({
        editionId,
        quantity: val.quantity,
        notes: val.notes,
      })
    );

    // Actor CP3 chuẩn: actorContext bắt buộc (route bind từ session).
    // Không nhận dispatcherId thay session, không suy role.
    if (!actorContext || !actorContext.staffId?.trim()) {
      throw AppError.invalid('Thiếu actorContext cho thao tác xuất kho luân chuyển (dispatch).');
    }
    const effDispatcherId = actorContext.staffId.trim();

    // Idempotency Key bắt buộc — KHÔNG tự sinh key (fail-closed, mục A).
    const idemKey = idempotencyKey?.trim() || '';
    if (!idemKey) {
      throw AppError.invalid('Bắt buộc cung cấp idempotencyKey cho thao tác xuất kho luân chuyển (dispatch).');
    }

    const fingerprint = computeTransferDispatchFingerprint({
      fromWarehouseId,
      toWarehouseId,
      dispatcherId: effDispatcherId,
      items: consolidatedItems,
    });

    const code = shipmentCode();

    return await withDbRetry(async () =>
      db.transaction(async (tx) => {
        // Replay check inside write transaction
        const existing = await tx
          .select()
          .from(transferShipments)
          .where(eq(transferShipments.idempotencyKey, idemKey))
          .limit(1);

        if (existing.length > 0) {
          const oldShip = existing[0];
          if (oldShip.fingerprint && oldShip.fingerprint !== fingerprint) {
            throw AppError.idempotency(
              `IDEMPOTENCY_CONFLICT: Key "${idemKey}" đã được sử dụng cho phiếu chuyển [${oldShip.id}] với nội dung khác.`
            );
          }

          const oldItems = await tx
            .select()
            .from(transferShipmentItems)
            .where(eq(transferShipmentItems.shipmentId, oldShip.id));

          return {
            shipmentId: oldShip.id,
            status: oldShip.status as ShipmentStatus,
            fromWarehouseId: oldShip.fromWarehouseId,
            toWarehouseId: oldShip.toWarehouseId,
            itemsCount: oldItems.length,
            totalQuantity: oldItems.reduce((s, i) => s + i.dispatchedQty, 0),
            isDuplicate: true as const,
          };
        }

        // Check ATP inside write transaction
        const { OrderService } = await import('./order.service');
        for (const it of consolidatedItems) {
          const atp = await OrderService.getATP(it.editionId, fromWarehouseId, tx);
          if (atp < it.quantity) {
            throw AppError.atp(
              `Không đủ tồn khả dụng để gửi: ${it.editionId} tại ${fromWarehouseId} còn khả dụng ${atp}, cần ${it.quantity} (phần còn lại giữ cho đơn online).`
            );
          }
        }

        await this.ensureTransitWarehouse(tx);

        try {
          await tx.insert(transferShipments).values({
            id: code,
            fromWarehouseId,
            toWarehouseId,
            dispatcherId: effDispatcherId,
            status: 'IN_TRANSIT',
            idempotencyKey: idemKey,
            fingerprint,
            vehicleInfo,
            notes,
          });
        } catch (e: any) {
          // Race cùng key: UNIQUE thoát ra -> map về replay/CONFLICT (mục C),
          // không bao giờ để SQLITE_CONSTRAINT_UNIQUE thô lọt ra ngoài.
          if (!isUniqueViolation(e)) throw e;
          const raced = await tx
            .select()
            .from(transferShipments)
            .where(eq(transferShipments.idempotencyKey, idemKey))
            .limit(1);
          if (raced.length === 0) throw e;
          const oldShip = raced[0];
          if (oldShip.fingerprint && oldShip.fingerprint !== fingerprint) {
            throw AppError.idempotency(
              `IDEMPOTENCY_CONFLICT: Key "${idemKey}" đã được sử dụng cho phiếu chuyển [${oldShip.id}] với nội dung khác.`
            );
          }
          const oldItems = await tx
            .select()
            .from(transferShipmentItems)
            .where(eq(transferShipmentItems.shipmentId, oldShip.id));
          return {
            shipmentId: oldShip.id,
            status: oldShip.status as ShipmentStatus,
            fromWarehouseId: oldShip.fromWarehouseId,
            toWarehouseId: oldShip.toWarehouseId,
            itemsCount: oldItems.length,
            totalQuantity: oldItems.reduce((s, i) => s + i.dispatchedQty, 0),
            isDuplicate: true as const,
          };
        }

        for (const it of consolidatedItems) {
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
            actorId: effDispatcherId,
            actorContext,
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
            actorId: effDispatcherId,
            actorContext,
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
          itemsCount: consolidatedItems.length,
          totalQuantity: consolidatedItems.reduce((s, i) => s + i.quantity, 0),
          isDuplicate: false as const,
        };
      })
    );
  }

  /**
   * BƯỚC 2 — Thực nhận tại kho đích: kiểm đếm R lành + D hỏng + L mất = X.
   */
  static async receive(params: ReceiveParams) {
    const { shipmentId, items, notes, actorContext, idempotencyKey } = params;

    if (!shipmentId || typeof shipmentId !== 'string' || !shipmentId.trim()) {
      throw AppError.invalid('Thiếu mã phiếu luân chuyển (shipmentId).');
    }
    const cleanShipmentId = shipmentId.trim();

    // Actor CP3 chuẩn: actorContext bắt buộc. Không nhận receiverId thay session.
    if (!actorContext || !actorContext.staffId?.trim()) {
      throw AppError.invalid('Thiếu actorContext cho thao tác nhận hàng luân chuyển (receive).');
    }
    const effReceiverId = actorContext.staffId.trim();

    // Idempotency Key bắt buộc — KHÔNG tự sinh key (fail-closed, mục A).
    const idemKey = idempotencyKey?.trim() || '';
    if (!idemKey) {
      throw AppError.invalid('Bắt buộc cung cấp idempotencyKey cho thao tác nhận hàng luân chuyển (receive).');
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw AppError.invalid('Biên bản nhận phải có danh sách kiểm đếm (items).');
    }

    const fingerprint = computeTransferReceiveFingerprint({
      shipmentId: cleanShipmentId,
      receiverId: effReceiverId,
      items: items.map(i => ({
        editionId: i.editionId,
        receivedQty: i.receivedQty ?? 0,
        damagedQty: i.damagedQty ?? 0,
        lostQty: i.lostQty ?? 0,
      })),
    });

    return await withDbRetry(async () =>
      db.transaction(async (tx) => {
        // 1. Replay check in tx against transfer_actions
        const priorAction = await tx
          .select()
          .from(transferActions)
          .where(eq(transferActions.idempotencyKey, idemKey))
          .limit(1);

        if (priorAction.length > 0) {
          const act = priorAction[0];
          if (act.fingerprint !== fingerprint) {
            throw AppError.idempotency(
              `IDEMPOTENCY_CONFLICT: Key "${idemKey}" đã được sử dụng cho một thao tác nhận hàng khác trên phiếu [${act.shipmentId}].`
            );
          }

          const ship = (
            await tx
              .select()
              .from(transferShipments)
              .where(eq(transferShipments.id, cleanShipmentId))
              .limit(1)
          )[0];

          const shipItems = await tx
            .select()
            .from(transferShipmentItems)
            .where(eq(transferShipmentItems.shipmentId, cleanShipmentId));

          return {
            shipmentId: cleanShipmentId,
            status: act.resultingStatus as ShipmentStatus,
            toWarehouseId: ship?.toWarehouseId,
            totalReceived: shipItems.reduce((s, p) => s + (p.receivedQty || 0), 0),
            totalDamaged: shipItems.reduce((s, p) => s + (p.damagedQty || 0), 0),
            totalLost: shipItems.reduce((s, p) => s + (p.lostQty || 0), 0),
            isDuplicate: true as const,
          };
        }

        // 2. Read shipment and items in write transaction
        const ship = (
          await tx
            .select()
            .from(transferShipments)
            .where(eq(transferShipments.id, cleanShipmentId))
            .limit(1)
        )[0];

        if (!ship) throw AppError.invalid(`Không tìm thấy phiếu luân chuyển ${cleanShipmentId}.`);
        if (ship.status !== 'IN_TRANSIT') {
          throw AppError.conflict(
            `STATE_CONFLICT: Phiếu ${cleanShipmentId} đã xử lý (trạng thái ${ship.status}), không nhận lại.`
          );
        }

        const dispatched = await tx
          .select()
          .from(transferShipmentItems)
          .where(eq(transferShipmentItems.shipmentId, cleanShipmentId));

        if (items.length !== dispatched.length) {
          throw AppError.invalid(
            `Phiếu có ${dispatched.length} dòng hàng, biên bản nhận phải đủ ${dispatched.length} dòng.`
          );
        }

        // 3. Validate R + D + L = X
        const plan = dispatched.map((d) => {
          const r = items.find((i) => i.editionId.trim() === d.editionId.trim());
          if (!r) throw AppError.invalid(`Thiếu biên bản nhận cho ấn bản ${d.editionId}.`);
          const received = r.receivedQty ?? 0;
          const damaged = r.damagedQty ?? 0;
          const lost = r.lostQty ?? 0;
          if (
            !Number.isInteger(received) || received < 0 ||
            !Number.isInteger(damaged) || damaged < 0 ||
            !Number.isInteger(lost) || lost < 0
          ) {
            throw AppError.invalid(`Số lượng nhận của ấn bản ${d.editionId} phải là số nguyên không âm.`);
          }
          if (received + damaged + lost !== d.dispatchedQty) {
            throw AppError.invalid(
              `Ấn bản ${d.editionId}: nhận (${received}) + hỏng (${damaged}) + mất (${lost}) phải bằng số gửi (${d.dispatchedQty}).`
            );
          }
          return { dispatched: d, received, damaged, lost, notes: r.notes };
        });

        const totalLost = plan.reduce((s, p) => s + p.lost, 0);
        const totalDamaged = plan.reduce((s, p) => s + p.damaged, 0);
        const nextStatus: ShipmentStatus =
          totalLost === 0 && totalDamaged === 0 ? 'RECEIVED_FULL' : 'RECEIVED_DISCREPANCY';

        // 4. Conditional update IN_TRANSIT -> nextStatus (affectedRows = 1)
        const updateShipRes: any = await tx.run(sql`
          UPDATE transfer_shipments
          SET status = ${nextStatus},
              receiver_id = ${effReceiverId},
              received_at = CURRENT_TIMESTAMP,
              notes = ${notes ?? ship.notes}
          WHERE id = ${cleanShipmentId}
            AND status = 'IN_TRANSIT'
        `);

        if (updateShipRes.rowsAffected !== 1) {
          throw AppError.conflict(
            `STATE_CONFLICT: Phiếu ${cleanShipmentId} đã bị thay đổi trạng thái bởi giao dịch song song.`
          );
        }

        // 5. Balance stock movements. Ledger keys ở đây là deterministic theo
        // (shipmentId, editionId): nếu UNIQUE nổ nghĩa là một receive song song
        // đã post bút toán -> fail-closed STATE_CONFLICT, không lọt raw (mục C).
        try {
          for (const p of plan) {
          const inTransitOut = p.received + p.damaged;

          // Hàng rời transit về kho đích (chỉ khi có hàng thật về: R + D).
          if (inTransitOut > 0) {
            await InventoryService.recordMovement({
              editionId: p.dispatched.editionId,
              warehouseId: TRANSIT_WAREHOUSE_ID,
              eventType: 'TRANSFER_OUT',
              quantityDelta: -inTransitOut,
              condition: 'NEW',
              documentRef: cleanShipmentId,
              correlationId: cleanShipmentId,
              note: `Thực nhận tại kho [${ship.toWarehouseId}]: lành ${p.received}, hỏng ${p.damaged}.`,
              actorId: effReceiverId,
              actorContext,
              idempotencyKey: `idem-receive-transit-${cleanShipmentId}-${p.dispatched.editionId}`,
              tx,
            });
          }

          // Hàng mất: trừ nốt phần thất lạc ở transit để transit về 0 tuyệt đối.
          if (p.lost > 0) {
            await InventoryService.recordMovement({
              editionId: p.dispatched.editionId,
              warehouseId: TRANSIT_WAREHOUSE_ID,
              eventType: 'TRANSFER_LOSS',
              quantityDelta: -p.lost,
              condition: 'NEW',
              documentRef: cleanShipmentId,
              correlationId: cleanShipmentId,
              note: `Thất lạc trên đường từ [${ship.fromWarehouseId}] tới [${ship.toWarehouseId}], lập biên bản bồi thường.`,
              actorId: effReceiverId,
              actorContext,
              idempotencyKey: `idem-receive-loss-${cleanShipmentId}-${p.dispatched.editionId}`,
              tx,
            });
          }

          // Hàng lành vào kho đích (NEW).
          if (p.received > 0) {
            await InventoryService.recordMovement({
              editionId: p.dispatched.editionId,
              warehouseId: ship.toWarehouseId,
              eventType: 'TRANSFER_IN',
              quantityDelta: p.received,
              condition: 'NEW',
              documentRef: cleanShipmentId,
              correlationId: cleanShipmentId,
              note: `Thực nhận luân chuyển từ kho [${ship.fromWarehouseId}]. ${p.notes || ''}`.trim(),
              actorId: effReceiverId,
              actorContext,
              idempotencyKey: `idem-receive-dest-${cleanShipmentId}-${p.dispatched.editionId}`,
              tx,
            });
          }

          // Hàng rách/ướt vào kho đích (QUARANTINE) chờ RMA.
          if (p.damaged > 0) {
            await InventoryService.recordMovement({
              editionId: p.dispatched.editionId,
              warehouseId: ship.toWarehouseId,
              eventType: 'TRANSFER_IN',
              quantityDelta: p.damaged,
              condition: 'QUARANTINE',
              documentRef: cleanShipmentId,
              correlationId: cleanShipmentId,
              note: `Hàng hỏng trên đường vận chuyển, chờ thẩm định RMA. ${p.notes || ''}`.trim(),
              actorId: effReceiverId,
              actorContext,
              idempotencyKey: `idem-receive-quar-${cleanShipmentId}-${p.dispatched.editionId}`,
              tx,
            });

            // Mở phiếu RMA cách ly cho hàng hỏng do vận chuyển
            const rmaId = `RMA-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
            await tx.insert(rmaTickets).values({
              id: rmaId,
              warehouseId: ship.toWarehouseId,
              transferShipmentId: cleanShipmentId,
              editionId: p.dispatched.editionId,
              quantity: p.damaged,
              defectReason: 'TRANSIT_DAMAGE',
              quarantineCondition: 'QUARANTINE',
              resolutionAction: 'HOLD_IN_QUARANTINE',
              inspectedBy: effReceiverId,
              status: 'QUARANTINED',
              notes: `Biên bản nhận hỏng từ phiếu luân chuyển ${cleanShipmentId}. ${p.notes || ''}`.trim(),
            });
          }

          await tx
            .update(transferShipmentItems)
            .set({ receivedQty: p.received, damagedQty: p.damaged, lostQty: p.lost, notes: p.notes })
            .where(
              and(
                eq(transferShipmentItems.shipmentId, cleanShipmentId),
                eq(transferShipmentItems.editionId, p.dispatched.editionId)
              )
            );
          }
        } catch (e: any) {
          if (!isUniqueViolation(e)) throw e;
          const shipNow = (
            await tx
              .select()
              .from(transferShipments)
              .where(eq(transferShipments.id, cleanShipmentId))
              .limit(1)
          )[0];
          if (!shipNow || shipNow.status !== 'IN_TRANSIT') {
            throw AppError.conflict(
              `STATE_CONFLICT: Phiếu ${cleanShipmentId} đã được nhận bởi giao dịch song song (trạng thái ${shipNow?.status || 'không rõ'}).`
            );
          }
          throw e;
        }

        // 6. Ghi vết transfer_actions (UNIQUE -> replay/CONFLICT, mục C).
        const actionId = `ta-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        try {
          await tx.insert(transferActions).values({
            id: actionId,
            shipmentId: cleanShipmentId,
            action: 'RECEIVE',
            actorId: effReceiverId,
            resultingStatus: nextStatus,
            idempotencyKey: idemKey,
            fingerprint,
          });
        } catch (e: any) {
          if (!isUniqueViolation(e)) throw e;
          const raced = await tx
            .select()
            .from(transferActions)
            .where(eq(transferActions.idempotencyKey, idemKey))
            .limit(1);
          if (raced.length === 0) throw e;
          if (raced[0].fingerprint !== fingerprint) {
            throw AppError.idempotency(
              `IDEMPOTENCY_CONFLICT: Key "${idemKey}" đã được sử dụng cho một thao tác nhận hàng khác trên phiếu [${raced[0].shipmentId}].`
            );
          }
          const shipNow = (
            await tx
              .select()
              .from(transferShipments)
              .where(eq(transferShipments.id, cleanShipmentId))
              .limit(1)
          )[0];
          const shipItemsNow = await tx
            .select()
            .from(transferShipmentItems)
            .where(eq(transferShipmentItems.shipmentId, cleanShipmentId));
          return {
            shipmentId: cleanShipmentId,
            status: (shipNow?.status || nextStatus) as ShipmentStatus,
            toWarehouseId: shipNow?.toWarehouseId,
            totalReceived: shipItemsNow.reduce((s, p) => s + (p.receivedQty || 0), 0),
            totalDamaged: shipItemsNow.reduce((s, p) => s + (p.damagedQty || 0), 0),
            totalLost: shipItemsNow.reduce((s, p) => s + (p.lostQty || 0), 0),
            isDuplicate: true as const,
          };
        }

        return {
          shipmentId: cleanShipmentId,
          status: nextStatus,
          toWarehouseId: ship.toWarehouseId,
          totalReceived: plan.reduce((s, p) => s + p.received, 0),
          totalDamaged,
          totalLost,
          isDuplicate: false as const,
        };
      })
    );
  }

  /**
   * Hủy phiếu chưa nhận: rút hàng từ transit trả về kho gửi.
   */
  static async cancel(params: CancelParams) {
    const { shipmentId, notes, actorContext, idempotencyKey } = params;
    let cleanShipmentId = shipmentId;
    // Actor + key CP3 chuẩn, bắt buộc. Không overload legacy (mục 3).
    if (!actorContext || !actorContext.staffId?.trim()) {
      throw AppError.invalid('Thiếu actorContext cho thao tác hủy phiếu luân chuyển (cancel).');
    }
    const effActorId = actorContext.staffId.trim();
    const idemKey = idempotencyKey?.trim() || '';
    if (!cleanShipmentId || typeof cleanShipmentId !== 'string' || !cleanShipmentId.trim()) {
      throw AppError.invalid('Thiếu mã phiếu luân chuyển (shipmentId).');
    }
    cleanShipmentId = cleanShipmentId.trim();

    if (!idemKey) {
      throw AppError.invalid('Bắt buộc cung cấp idempotencyKey cho thao tác hủy phiếu luân chuyển (cancel).');
    }

    const fingerprint = computeTransferCancelFingerprint({
      shipmentId: cleanShipmentId,
      actorId: effActorId,
    });

    return await withDbRetry(async () =>
      db.transaction(async (tx) => {
        // 1. Replay check in tx against transfer_actions
        const priorAction = await tx
          .select()
          .from(transferActions)
          .where(eq(transferActions.idempotencyKey, idemKey))
          .limit(1);

        if (priorAction.length > 0) {
          const act = priorAction[0];
          if (act.fingerprint !== fingerprint) {
            throw AppError.idempotency(
              `IDEMPOTENCY_CONFLICT: Key "${idemKey}" đã được sử dụng cho thao tác hủy phiếu khác.`
            );
          }
          return { shipmentId: cleanShipmentId, status: 'CANCELLED' as ShipmentStatus, isDuplicate: true as const };
        }

        // 2. Read shipment in write transaction
        const ship = (
          await tx
            .select()
            .from(transferShipments)
            .where(eq(transferShipments.id, cleanShipmentId))
            .limit(1)
        )[0];

        if (!ship) throw AppError.invalid(`Không tìm thấy phiếu luân chuyển ${cleanShipmentId}.`);
        if (ship.status !== 'IN_TRANSIT') {
          throw AppError.conflict(
            `STATE_CONFLICT: Phiếu ${cleanShipmentId} đã ở trạng thái ${ship.status}, không thể hủy.`
          );
        }

        // 3. Conditional update IN_TRANSIT -> CANCELLED (affectedRows = 1)
        const updateShipRes: any = await tx.run(sql`
          UPDATE transfer_shipments
          SET status = 'CANCELLED',
              received_at = CURRENT_TIMESTAMP
          WHERE id = ${cleanShipmentId}
            AND status = 'IN_TRANSIT'
        `);

        if (updateShipRes.rowsAffected !== 1) {
          throw AppError.conflict(
            `STATE_CONFLICT: Phiếu ${cleanShipmentId} đã bị thay đổi trạng thái bởi giao dịch song song.`
          );
        }

        const lines = await tx
          .select()
          .from(transferShipmentItems)
          .where(eq(transferShipmentItems.shipmentId, cleanShipmentId));

        for (const line of lines) {
          await InventoryService.recordMovement({
            editionId: line.editionId,
            warehouseId: TRANSIT_WAREHOUSE_ID,
            eventType: 'TRANSFER_OUT',
            quantityDelta: -line.dispatchedQty,
            condition: 'NEW',
            documentRef: cleanShipmentId,
            correlationId: cleanShipmentId,
            note: `Hủy phiếu luân chuyển, rút hàng về kho gửi [${ship.fromWarehouseId}].`,
            actorId: effActorId,
            actorContext,
            idempotencyKey: `idem-cancel-transit-${cleanShipmentId}-${line.editionId}`,
            tx,
          });
          await InventoryService.recordMovement({
            editionId: line.editionId,
            warehouseId: ship.fromWarehouseId,
            eventType: 'TRANSFER_IN',
            quantityDelta: line.dispatchedQty,
            condition: 'NEW',
            documentRef: cleanShipmentId,
            correlationId: cleanShipmentId,
            note: `Nhận lại hàng hủy phiếu ${cleanShipmentId}.`,
            actorId: effActorId,
            actorContext,
            idempotencyKey: `idem-cancel-src-${cleanShipmentId}-${line.editionId}`,
            tx,
          });
        }

        // 4. Record action in transfer_actions (UNIQUE -> replay/CONFLICT, mục C).
        const actionId = `ta-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        try {
          await tx.insert(transferActions).values({
            id: actionId,
            shipmentId: cleanShipmentId,
            action: 'CANCEL',
            actorId: effActorId,
            resultingStatus: 'CANCELLED',
            idempotencyKey: idemKey,
            fingerprint,
          });
        } catch (e: any) {
          if (!isUniqueViolation(e)) throw e;
          const raced = await tx
            .select()
            .from(transferActions)
            .where(eq(transferActions.idempotencyKey, idemKey))
            .limit(1);
          if (raced.length === 0) throw e;
          if (raced[0].fingerprint !== fingerprint) {
            throw AppError.idempotency(
              `IDEMPOTENCY_CONFLICT: Key "${idemKey}" đã được sử dụng cho thao tác hủy phiếu khác.`
            );
          }
          return { shipmentId: cleanShipmentId, status: 'CANCELLED' as ShipmentStatus, isDuplicate: true as const };
        }

        return { shipmentId: cleanShipmentId, status: 'CANCELLED' as ShipmentStatus, isDuplicate: false as const };
      })
    );
  }

  /** Chi tiết phiếu + dòng hàng (cho UI biên bản giao nhận). */
  static async getShipment(shipmentId: string) {
    const ship = (
      await db.select().from(transferShipments).where(eq(transferShipments.id, shipmentId)).limit(1)
    )[0];
    if (!ship) throw AppError.invalid(`Không tìm thấy phiếu luân chuyển ${shipmentId}.`);
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
