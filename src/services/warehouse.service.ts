import { db, documentSequences, warehouses, bankAccounts } from '../db';
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

  /** Danh sách tất cả các kho đang hoạt động. */
  static async listAll(txOrDb: any = db): Promise<WarehouseRow[]> {
    return await txOrDb
      .select()
      .from(warehouses)
      .where(eq(warehouses.isActive, true));
  }

  /** VietQR offline: list TK active + default của kho (1 TK dùng N kho, 1 kho đổi TK tay lúc bán). */
  static async listBankAccounts(txOrDb: any = db) {
    return await txOrDb.select().from(bankAccounts).where(eq(bankAccounts.isActive, true));
  }

  static async getDefaultBankAccount(warehouseId: string, txOrDb: any = db) {
    const wh = await this.getWarehouse(warehouseId, txOrDb);
    const list = await this.listBankAccounts(txOrDb);
    const def = list.find((b: any) => b.id === (wh as any)?.defaultBankAccountId) || list[0];
    return { default: def, list };
  }

  /** Gán TK mặc định cho kho (Owner/Manager). */
  static async setDefaultBankAccount(warehouseId: string, bankAccountId: string | null, txOrDb: any = db) {
    if (bankAccountId) {
      const acc = await txOrDb.select().from(bankAccounts).where(eq(bankAccounts.id, bankAccountId)).limit(1);
      if (!acc[0] || acc[0].isActive !== true) throw AppError.invalid('Tài khoản nhận tiền không tồn tại hoặc đã ngưng.');
    }
    await txOrDb.update(warehouses).set({ defaultBankAccountId: bankAccountId }).where(eq(warehouses.id, warehouseId));
    return await this.getWarehouse(warehouseId, txOrDb);
  }

  /**
   * Tạo kho mới (Gian hàng hội chợ hoặc Kho vật lý) - Chỉ cấp Quản lý trở lên.
   */
  static async createWarehouse(
    params: {
      code?: string;
      name: string;
      address?: string;
      warehouseType?: 'PHYSICAL_MAIN' | 'FAIR_EVENT' | 'CONSIGNMENT' | 'IN_TRANSIT';
      isSellableOnPos?: boolean;
    },
    txOrDb: any = db
  ): Promise<WarehouseRow> {
    const name = params.name?.trim();
    if (!name) {
      throw AppError.invalid('Tên kho không được để trống.');
    }

    const rawCode = (params.code || name)
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/Đ/g, 'D')
      .replace(/[^A-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

    const code = rawCode.startsWith('KHO_') ? rawCode : `KHO_${rawCode}`;
    const id = `wh-${code.toLowerCase().replace(/_/g, '-')}`;

    // Kiểm tra trùng lặp mã kho hoặc id
    const existing = await txOrDb
      .select()
      .from(warehouses)
      .where(eq(warehouses.code, code))
      .limit(1);

    if (existing.length > 0) {
      throw AppError.conflict(`Mã kho '${code}' đã tồn tại.`);
    }

    const warehouseType = params.warehouseType || 'FAIR_EVENT';
    const isSellableOnPos =
      params.isSellableOnPos !== undefined
        ? params.isSellableOnPos
        : warehouseType === 'FAIR_EVENT' || warehouseType === 'PHYSICAL_MAIN';

    const newWarehouse = {
      id,
      code,
      name,
      address: params.address?.trim() || null,
      isActive: true,
      isSellableOnPos,
      warehouseType,
    };

    await txOrDb.insert(warehouses).values(newWarehouse);
    return newWarehouse as WarehouseRow;
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
