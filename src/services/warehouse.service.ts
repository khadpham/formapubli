import { db, documentSequences, warehouses } from '../db';
import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { AppError } from './app-error';

export type WarehouseRow = typeof warehouses.$inferSelect;

/**
 * V4.1 S1.2 — Single Source of Truth thay hardcode SELLABLE_WAREHOUSE_IDS.
 * Quy tắc bán: kho phải tồn tại + is_active + is_sellable_on_pos.
 * Mọi call site (order/sponsorship/return) dùng chung guard này.
 */
export class WarehouseService {
  static async getWarehouse(warehouseId: string, txOrDb: any = db): Promise<WarehouseRow | undefined> {
    const rows = await txOrDb.select().from(warehouses).where(eq(warehouses.id, warehouseId)).limit(1);
    return rows[0];
  }

  static isSellable(row: WarehouseRow | undefined): boolean {
    return !!row && row.isActive === true && row.isSellableOnPos === true;
  }

  /** Ném AppError.invalid khi kho không được phép xuất bán trực tiếp. */
  static async assertSellable(warehouseId: string, txOrDb: any = db): Promise<WarehouseRow> {
    const row = await this.getWarehouse(warehouseId, txOrDb);
    if (!this.isSellable(row)) {
      throw AppError.invalid(
        `Kho ${warehouseId} không được phép bán trực tiếp (kho không tồn tại, đã ngưng hoạt động hoặc chưa bật bán trên POS).`
      );
    }
    return row!;
  }

  /** Danh sách kho POS được phép chọn (màn hình chọn kho ca làm việc — Sprint 2 dùng). */
  static async listSellable(txOrDb: any = db): Promise<WarehouseRow[]> {
    return await txOrDb
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.isActive, true), eq(warehouses.isSellableOnPos, true)));
  }

  /**
   * V4.1 S1.3 — Cấp số chứng từ liên tục (PCK/PXK/PXK_R).
   * BẮT BUỘC gọi trong cùng tx với INSERT phiếu (cùng commit/rollback → không nhảy số).
   */
  static async getNextDocumentCode(
    docType: 'PCK' | 'PXK' | 'PXK_R' | 'ORD',
    tx: any
  ): Promise<string> {
    const year = new Date().getFullYear();
    const id = `seq-${docType}-${year}`;
    await tx.run(sql`
      INSERT INTO document_sequences (id, doc_type, fiscal_year, current_val, updated_at)
      VALUES (${id}, ${docType}, ${year}, 1, CURRENT_TIMESTAMP)
      ON CONFLICT (doc_type, fiscal_year) DO UPDATE
      SET current_val = document_sequences.current_val + 1,
          updated_at = CURRENT_TIMESTAMP
    `);
    const rows = await tx.select().from(documentSequences).where(eq(documentSequences.id, id)).limit(1);
    const seq = rows[0]?.currentVal ?? 1;
    return `${docType}-${year}-${String(seq).padStart(4, '0')}`;
  }
}
