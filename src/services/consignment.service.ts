import {
  db,
  partners,
  editions,
  consignmentStatements,
  consignmentStatementLines,
  inventoryLedger,
  stockBalances,
} from '../db';
import { AppError } from './app-error';
import { InventoryService } from './inventory.service';
import { TransferService } from './transfer.service';
import { withDbRetry } from '../lib/db-retry';
import { eq, and, desc, sql } from 'drizzle-orm';

/**
 * SỔ KÝ GỬI ĐẠI LÝ & CÔNG NỢ PHẢI THU (CONSIGNMENT LEDGER & AR).
 *
 * - Mỗi partner ký gửi có 1 kho ảo riêng wh-consign-<code> (vị trí vật lý),
 *   quyền sở hữu luôn là formapubli (ownerId part-formapubli).
 * - Gửi/nhận hàng TÁI DÙNG 100% T1 shipments (dispatch -> receive).
 * - Báo bán trừ kho quầy (CONSIGNMENT_SOLD), thu hồi về kho chỉ định
 *   (lành NEW / hỏng QUARANTINE nối RMA), chốt kỳ DRAFT -> CONFIRMED
 *   khóa sổ + snapshot AR = Σ(bán × giá bìa × (1 - chiết khấu)).
 */
export const OWNER_PARTNER_ID = 'part-formapubli';

export interface ConsignmentSendItem {
  editionId: string;
  quantity: number;
  notes?: string;
}

export interface CreateStatementParams {
  partnerId: string;
  periodStart: string;
  periodEnd: string;
  discountOverride?: number;
  fiscalScope?: 'OFFICIAL_TAX' | 'INTERNAL_MANAGEMENT';
  createdBy: string;
  notes?: string;
}

function statementCode(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `CS-${date}-${rand}`;
}

function sanitizeCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'partner';
}

export class ConsignmentService {
  /** Đảm bảo pháp nhân chủ sở hữu formapubli tồn tại (ownerId cho bút toán ký gửi). */
  static async ensureOwnerPartner(txOrDb: any = db) {
    await txOrDb
      .insert(partners)
      .values({
        id: OWNER_PARTNER_ID,
        code: 'FORMAPUBLI',
        name: 'Công ty formapubli (Chủ sở hữu)',
        type: 'INTERNAL',
        discountRate: 0.0,
        contactInfo: 'Pháp nhân sở hữu hàng ký gửi',
      })
      .onConflictDoNothing({ target: partners.id });
  }

  /** Kho ảo riêng của từng đại lý ký gửi (tự tạo lần đầu). */
  static async ensurePartnerWarehouse(partnerId: string, txOrDb: any = db): Promise<string> {
    const partner = (
      await txOrDb.select().from(partners).where(eq(partners.id, partnerId)).limit(1)
    )[0];
    if (!partner) throw AppError.invalid(`Không tìm thấy đối tác ${partnerId}.`);
    const warehouseId = `wh-consign-${sanitizeCode(partner.code)}`;
    const { warehouses } = await import('../db');
    await txOrDb
      .insert(warehouses)
      .values({
        id: warehouseId,
        code: `KHO_KY_GUI_${partner.code.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
        name: `Kho Ký gửi - ${partner.name}`,
        address: `Quầy ký gửi tại đối tác ${partner.name}`,
        isActive: true,
      })
      .onConflictDoNothing({ target: warehouses.id });
    return warehouseId;
  }

  static async partnerWarehouseId(partnerId: string): Promise<string> {
    return this.ensurePartnerWarehouse(partnerId, db);
  }

  /**
   * Gửi hàng ký gửi: dispatch T1 từ kho nội bộ tới kho ảo đại lý.
   * Nhận hàng do driver/manager xác nhận theo biên bản ký tay (confirmReceipt).
   */
  static async sendToConsignment(params: {
    partnerId: string;
    fromWarehouseId: string;
    actorContext: import('./actor-context').ActorContext;
    idempotencyKey: string;
    vehicleInfo?: string;
    notes?: string;
    items: ConsignmentSendItem[];
  }) {
    if (!params.actorContext?.staffId?.trim()) {
      throw AppError.invalid('Thiếu actorContext cho thao tác gửi ký gửi.');
    }
    if (!params.idempotencyKey?.trim()) {
      throw AppError.invalid('Bắt buộc cung cấp idempotencyKey cho thao tác gửi ký gửi.');
    }
    await this.ensureOwnerPartner(db);
    const partnerWh = await this.ensurePartnerWarehouse(params.partnerId, db);
    return await TransferService.dispatch({
      fromWarehouseId: params.fromWarehouseId,
      toWarehouseId: partnerWh,
      actorContext: params.actorContext,
      idempotencyKey: params.idempotencyKey.trim(),
      vehicleInfo: params.vehicleInfo,
      notes: params.notes ?? `Gửi ký gửi đại lý ${params.partnerId}`,
      items: params.items.map((i) => ({ editionId: i.editionId, quantity: i.quantity, notes: i.notes })),
    });
  }

  /** Xác nhận đại lý đã nhận đủ (theo biên bản ký tay) — receive toàn bộ. */
  static async confirmConsignmentReceipt(params: {
    shipmentId: string;
    actorContext: import('./actor-context').ActorContext;
    idempotencyKey: string;
  }) {
    if (!params.actorContext?.staffId?.trim()) {
      throw AppError.invalid('Thiếu actorContext cho thao tác xác nhận nhận ký gửi.');
    }
    if (!params.idempotencyKey?.trim()) {
      throw AppError.invalid('Bắt buộc cung cấp idempotencyKey cho thao tác xác nhận nhận ký gửi.');
    }
    const detail = await TransferService.getShipment(params.shipmentId);
    return await TransferService.receive({
      shipmentId: params.shipmentId,
      actorContext: params.actorContext,
      idempotencyKey: params.idempotencyKey.trim(),
      items: detail.items.map((l) => ({
        editionId: l.editionId,
        receivedQty: l.dispatchedQty,
        damagedQty: 0,
        lostQty: 0,
      })),
    });
  }

  /** Mở kỳ đối soát: snapshot tồn quầy đầu kỳ cho mọi ấn bản đang có hàng. */
  static async createStatement(params: CreateStatementParams) {
    const {
      partnerId,
      periodStart,
      periodEnd,
      discountOverride,
      fiscalScope = 'INTERNAL_MANAGEMENT',
      createdBy,
      notes,
    } = params;

    const partner = (await db.select().from(partners).where(eq(partners.id, partnerId)).limit(1))[0];
    if (!partner) throw AppError.invalid(`Không tìm thấy đối tác ${partnerId}.`);
    if (discountOverride !== undefined && (discountOverride < 0 || discountOverride > 1)) {
      throw AppError.invalid('Chiết khấu kỳ phải trong khoảng 0 - 1.');
    }

    const partnerWh = await this.ensurePartnerWarehouse(partnerId, db);
    const balances = await db
      .select()
      .from(stockBalances)
      .where(and(eq(stockBalances.warehouseId, partnerWh), eq(stockBalances.condition, 'NEW')));

    const id = statementCode();

    return await withDbRetry(async () =>
      db.transaction(async (tx) => {
        // Mốc ledger hiện tại: hàng gửi thêm trong kỳ = TRANSFER_IN có rowid > mốc.
        // (Không dùng timestamp vì CURRENT_TIMESTAMP chỉ chính xác tới giây.)
        const markerRows = await tx
          .select({ m: sql<number | null>`MAX(inventory_ledger.rowid)` })
          .from(inventoryLedger);
        const marker = Number(markerRows[0]?.m ?? 0);

        await tx.insert(consignmentStatements).values({
          id,
          partnerId,
          periodStart,
          periodEnd,
          discountOverride,
          fiscalScope,
          status: 'DRAFT',
          totalReceivable: 0,
          openingLedgerRowid: marker,
          notes,
          createdBy,
        });

        for (const bal of balances) {
          if (bal.physicalQuantity <= 0) continue;
          const ed = (
            await tx.select().from(editions).where(eq(editions.id, bal.editionId)).limit(1)
          )[0];
          await tx.insert(consignmentStatementLines).values({
            id: `csl-${id}-${bal.editionId}`,
            statementId: id,
            editionId: bal.editionId,
            openingQty: bal.physicalQuantity,
            unitCoverPrice: ed?.coverPrice ?? 0,
          });
        }

        return { statementId: id, status: 'DRAFT' as const, openingLines: balances.length };
      })
    );
  }

  /** Lấy discount hiệu lực của kỳ (override kỳ, nếu không dùng partner). */
  static async effectiveDiscount(statementId: string): Promise<number> {
    const stmt = (
      await db.select().from(consignmentStatements).where(eq(consignmentStatements.id, statementId)).limit(1)
    )[0];
    if (!stmt) throw AppError.invalid(`Không tìm thấy kỳ đối soát ${statementId}.`);
    if (stmt.discountOverride !== null && stmt.discountOverride !== undefined) {
      return stmt.discountOverride;
    }
    const partner = (
      await db.select().from(partners).where(eq(partners.id, stmt.partnerId)).limit(1)
    )[0];
    return partner?.discountRate ?? 0;
  }

  /** Đảm bảo dòng kỳ tồn tại (hàng gửi thêm giữa kỳ có opening 0). */
  static async ensureLine(tx: any, statementId: string, editionId: string) {
    const existing = (
      await tx
        .select()
        .from(consignmentStatementLines)
        .where(
          and(
            eq(consignmentStatementLines.statementId, statementId),
            eq(consignmentStatementLines.editionId, editionId)
          )
        )
        .limit(1)
    )[0];
    if (existing) return existing;
    const ed = (await tx.select().from(editions).where(eq(editions.id, editionId)).limit(1))[0];
    const row = {
      id: `csl-${statementId}-${editionId}`,
      statementId,
      editionId,
      openingQty: 0,
      unitCoverPrice: ed?.coverPrice ?? 0,
    };
    await tx.insert(consignmentStatementLines).values(row);
    return (
      await tx
        .select()
        .from(consignmentStatementLines)
        .where(
          and(
            eq(consignmentStatementLines.statementId, statementId),
            eq(consignmentStatementLines.editionId, editionId)
          )
        )
        .limit(1)
    )[0];
  }

  /** Đối tác báo bán: trừ kho quầy + cộng dồn AR vào dòng kỳ. */
  static async recordSale(params: {
    statementId: string;
    editionId: string;
    quantity: number;
    actorId: string;
  }) {
    const { statementId, editionId, quantity, actorId } = params;
    // CP3-B1.2 (mục 5): số lượng phải là số nguyên > 0 — "1.5" bị từ chối,
    // không cắt phần thập phân.
    if (!Number.isInteger(quantity) || quantity <= 0) throw AppError.invalid('Số lượng bán phải là số nguyên lớn hơn 0.');

    const stmt = (
      await db.select().from(consignmentStatements).where(eq(consignmentStatements.id, statementId)).limit(1)
    )[0];
    if (!stmt) throw AppError.invalid(`Không tìm thấy kỳ đối soát ${statementId}.`);
    if (stmt.status !== 'DRAFT') throw AppError.conflict(`Kỳ ${statementId} đã khóa (${stmt.status}), không ghi bán thêm.`);

    const partnerWh = await this.ensurePartnerWarehouse(stmt.partnerId, db);
    const discount = await this.effectiveDiscount(statementId);

    return await withDbRetry(async () =>
      db.transaction(async (tx) => {
        await this.ensureOwnerPartner(tx);
        await InventoryService.recordMovement({
          editionId,
          warehouseId: partnerWh,
          eventType: 'CONSIGNMENT_SOLD',
          quantityDelta: -quantity,
          condition: 'NEW',
          documentRef: statementId,
          correlationId: statementId,
          ownerId: OWNER_PARTNER_ID,
          note: `Đại lý báo bán ${quantity} cuốn (kỳ ${statementId}).`,
          actorId,
          idempotencyKey: `idem-consign-sold-${statementId}-${editionId}-${Date.now()}`,
          tx,
        });

        const line: any = await this.ensureLine(tx, statementId, editionId);
        const newSold = (line.reportedSoldQty ?? 0) + quantity;
        const lineAmount = Math.round(newSold * (line.unitCoverPrice ?? 0) * (1 - discount));
        await tx
          .update(consignmentStatementLines)
          .set({ reportedSoldQty: newSold, lineAmount })
          .where(eq(consignmentStatementLines.id, line.id));

        return { statementId, editionId, reportedSoldQty: newSold, lineAmount };
      })
    );
  }

  /** Thu hồi về kho chỉ định: lành NEW, hỏng QUARANTINE (nối RMA). */
  static async recordReturn(params: {
    statementId: string;
    toWarehouseId: string;
    editionId: string;
    newQty?: number;
    damagedQty?: number;
    actorId: string;
    notes?: string;
  }) {
    const { statementId, toWarehouseId, editionId, newQty = 0, damagedQty = 0, actorId, notes } = params;
    // CP3-B1.2 (mục 5): số lượng phải là số nguyên không âm — "1.5" bị từ chối.
    if (!Number.isInteger(newQty) || !Number.isInteger(damagedQty)) {
      throw AppError.invalid('Số lượng thu hồi phải là số nguyên không âm.');
    }
    if (newQty < 0 || damagedQty < 0 || newQty + damagedQty === 0) {
      throw AppError.invalid('Số lượng thu hồi phải lớn hơn 0.');
    }

    const stmt = (
      await db.select().from(consignmentStatements).where(eq(consignmentStatements.id, statementId)).limit(1)
    )[0];
    if (!stmt) throw AppError.invalid(`Không tìm thấy kỳ đối soát ${statementId}.`);
    if (stmt.status !== 'DRAFT') throw AppError.conflict(`Kỳ ${statementId} đã khóa (${stmt.status}), không thu hồi thêm.`);

    const partnerWh = await this.ensurePartnerWarehouse(stmt.partnerId, db);
    const total = newQty + damagedQty;

    return await withDbRetry(async () =>
      db.transaction(async (tx) => {
        await this.ensureOwnerPartner(tx);
        await InventoryService.recordMovement({
          editionId,
          warehouseId: partnerWh,
          eventType: 'TRANSFER_OUT',
          quantityDelta: -total,
          condition: 'NEW',
          documentRef: statementId,
          correlationId: statementId,
          ownerId: OWNER_PARTNER_ID,
          note: `Thu hồi từ quầy đại lý về kho [${toWarehouseId}]. ${notes || ''}`.trim(),
          actorId,
          idempotencyKey: `idem-consign-ret-out-${statementId}-${editionId}-${Date.now()}`,
          tx,
        });
        if (newQty > 0) {
          await InventoryService.recordMovement({
            editionId,
            warehouseId: toWarehouseId,
            eventType: 'TRANSFER_IN',
            quantityDelta: newQty,
            condition: 'NEW',
            documentRef: statementId,
            correlationId: statementId,
            ownerId: OWNER_PARTNER_ID,
            note: `Thu hồi lành từ đại lý ${stmt.partnerId}.`,
            actorId,
            idempotencyKey: `idem-consign-ret-new-${statementId}-${editionId}-${Date.now()}`,
            tx,
          });
        }
        if (damagedQty > 0) {
          await InventoryService.recordMovement({
            editionId,
            warehouseId: toWarehouseId,
            eventType: 'TRANSFER_IN',
            quantityDelta: damagedQty,
            condition: 'QUARANTINE',
            documentRef: statementId,
            correlationId: statementId,
            ownerId: OWNER_PARTNER_ID,
            note: `Thu hồi hỏng từ đại lý ${stmt.partnerId}, chờ thẩm định RMA.`,
            actorId,
            idempotencyKey: `idem-consign-ret-dam-${statementId}-${editionId}-${Date.now()}`,
            tx,
          });
        }

        const line: any = await this.ensureLine(tx, statementId, editionId);
        await tx
          .update(consignmentStatementLines)
          .set({
            returnedNewQty: (line.returnedNewQty ?? 0) + newQty,
            returnedDamagedQty: (line.returnedDamagedQty ?? 0) + damagedQty,
          })
          .where(eq(consignmentStatementLines.id, line.id));

        return { statementId, editionId, returnedNewQty: newQty, returnedDamagedQty: damagedQty };
      })
    );
  }

  /**
   * Chốt kỳ DRAFT -> CONFIRMED: tính gửi thêm trong kỳ (ledger TRANSFER_IN
   * từ lúc mở kỳ), tồn cuối, thất thoát = đầu + gửi - bán - thu hồi - cuối,
   * khóa sổ + snapshot tổng AR. Thặng dư (lost < 0) bị từ chối để điều tra.
   */
  static async confirm(statementId: string, actorId: string) {
    const stmt = (
      await db.select().from(consignmentStatements).where(eq(consignmentStatements.id, statementId)).limit(1)
    )[0];
    if (!stmt) throw AppError.invalid(`Không tìm thấy kỳ đối soát ${statementId}.`);
    if (stmt.status !== 'DRAFT') throw AppError.conflict(`Kỳ ${statementId} đã ở trạng thái ${stmt.status}.`);

    const partnerWh = await this.ensurePartnerWarehouse(stmt.partnerId, db);

    return await withDbRetry(async () =>
      db.transaction(async (tx) => {
        const lines = await tx
          .select()
          .from(consignmentStatementLines)
          .where(eq(consignmentStatementLines.statementId, statementId));

        let total = 0;
        for (const line of lines) {
          // Hàng gửi thêm trong kỳ = TRANSFER_IN tại kho quầy sau mốc mở kỳ.
          const sentRows = await tx
            .select({ qty: sql<number>`COALESCE(SUM(${inventoryLedger.quantityDelta}), 0)` })
            .from(inventoryLedger)
            .where(
              and(
                eq(inventoryLedger.editionId, line.editionId),
                eq(inventoryLedger.warehouseId, partnerWh),
                eq(inventoryLedger.eventType, 'TRANSFER_IN'),
                sql`inventory_ledger.rowid > ${stmt.openingLedgerRowid ?? 0}`
              )
            );
          const sent = Number(sentRows[0]?.qty ?? 0);

          const bal = (
            await tx
              .select()
              .from(stockBalances)
              .where(
                and(
                  eq(stockBalances.editionId, line.editionId),
                  eq(stockBalances.warehouseId, partnerWh),
                  eq(stockBalances.condition, 'NEW')
                )
              )
              .limit(1)
          )[0];
          const closing = bal?.physicalQuantity ?? 0;
          const lost =
            (line.openingQty ?? 0) +
            sent -
            (line.reportedSoldQty ?? 0) -
            (line.returnedNewQty ?? 0) -
            (line.returnedDamagedQty ?? 0) -
            closing;

          if (lost < 0) {
            throw AppError.conflict(
              `Ấn bản ${line.editionId} thặng dư ${-lost} cuốn so với sổ — dừng chốt để điều tra, không tự bù.`
            );
          }
          if (lost > 0) {
            await this.ensureOwnerPartner(tx);
            await InventoryService.recordMovement({
              editionId: line.editionId,
              warehouseId: partnerWh,
              eventType: 'CONSIGNMENT_LOSS',
              quantityDelta: -lost,
              condition: 'NEW',
              documentRef: statementId,
              correlationId: statementId,
              ownerId: OWNER_PARTNER_ID,
              note: `Thất thoát tại quầy đại lý chốt kỳ ${statementId}, lập biên bản bồi thường.`,
              actorId,
              idempotencyKey: `idem-consign-loss-${statementId}-${line.editionId}`,
              tx,
            });
          }

          await tx
            .update(consignmentStatementLines)
            .set({ sentQty: sent, lostQty: lost })
            .where(eq(consignmentStatementLines.id, line.id));

          // closing snapshot = tồn sau khi trừ thất thoát (nếu có).
          const finalBal = (
            await tx
              .select()
              .from(stockBalances)
              .where(
                and(
                  eq(stockBalances.editionId, line.editionId),
                  eq(stockBalances.warehouseId, partnerWh),
                  eq(stockBalances.condition, 'NEW')
                )
              )
              .limit(1)
          )[0];
          await tx
            .update(consignmentStatementLines)
            .set({ closingQty: finalBal?.physicalQuantity ?? 0 })
            .where(eq(consignmentStatementLines.id, line.id));

          total += line.lineAmount ?? 0;
        }

        await tx
          .update(consignmentStatements)
          .set({
            status: 'CONFIRMED',
            totalReceivable: total,
            confirmedAt: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(consignmentStatements.id, statementId));

        return { statementId, status: 'CONFIRMED' as const, totalReceivable: total, linesCount: lines.length };
      })
    );
  }

  static async getStatement(statementId: string) {
    const stmt = (
      await db.select().from(consignmentStatements).where(eq(consignmentStatements.id, statementId)).limit(1)
    )[0];
    if (!stmt) throw AppError.invalid(`Không tìm thấy kỳ đối soát ${statementId}.`);
    const lines = await db
      .select()
      .from(consignmentStatementLines)
      .where(eq(consignmentStatementLines.statementId, statementId));
    return { ...stmt, lines };
  }

  static async listStatements(partnerId?: string, status?: string, limit = 50) {
    const conds = [];
    if (partnerId) conds.push(eq(consignmentStatements.partnerId, partnerId));
    if (status) conds.push(eq(consignmentStatements.status, status));
    if (conds.length > 0) {
      return await db
        .select()
        .from(consignmentStatements)
        .where(and(...conds))
        .orderBy(desc(consignmentStatements.createdAt))
        .limit(limit);
    }
    return await db
      .select()
      .from(consignmentStatements)
      .orderBy(desc(consignmentStatements.createdAt))
      .limit(limit);
  }

  /** Tồn hiện tại tại quầy đại lý (cho UI đối soát + kiểm toán đích danh). */
  static async getPartnerStock(partnerId: string) {
    const partnerWh = await this.ensurePartnerWarehouse(partnerId, db);
    const { editions: edTable } = await import('../db');
    const rows = await db
      .select({
        editionId: stockBalances.editionId,
        code: edTable.code,
        title: edTable.title,
        condition: stockBalances.condition,
        quantity: stockBalances.physicalQuantity,
      })
      .from(stockBalances)
      .innerJoin(edTable, eq(stockBalances.editionId, edTable.id))
      .where(eq(stockBalances.warehouseId, partnerWh));
    return { partnerId, warehouseId: partnerWh, items: rows };
  }
}
