import { db, documentSequences, warehouses, bankAccounts } from '../db';
import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { AppError } from './app-error';

export type WarehouseRow = typeof warehouses.$inferSelect;
export type BankAccountRow = typeof bankAccounts.$inferSelect;

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

  /** Danh sách tất cả các kho (kể cả đã ngưng) — màn hình quản trị cần thấy
   * kho đã ngưng để bật lại được. */
  static async listAll(txOrDb: any = db): Promise<WarehouseRow[]> {
    return await txOrDb.select().from(warehouses);
  }

  /** VietQR offline: list TK active + default của kho (1 TK dùng N kho, 1 kho đổi TK tay lúc bán). */
  static async listBankAccounts(txOrDb: any = db) {
    return await txOrDb.select().from(bankAccounts).where(eq(bankAccounts.isActive, true));
  }

  static async getDefaultBankAccount(warehouseId: string, txOrDb: any = db) {
    const wh = await this.getWarehouse(warehouseId, txOrDb);
    const list: BankAccountRow[] = await this.listBankAccounts(txOrDb);
    const def = list.find((b) => b.id === wh?.defaultBankAccountId) || list[0];
    return { default: def, list };
  }

  /** Gán TK mặc định cho kho (Owner/Manager). */
  static async setDefaultBankAccount(warehouseId: string, bankAccountId: string | null, txOrDb: any = db) {
    const wh = await this.getWarehouse(warehouseId, txOrDb);
    if (!wh) throw AppError.invalid('Kho không tồn tại.');
    if (bankAccountId) {
      const acc = await txOrDb.select().from(bankAccounts).where(eq(bankAccounts.id, bankAccountId)).limit(1);
      if (!acc[0] || acc[0].isActive !== true) throw AppError.invalid('Tài khoản nhận tiền không tồn tại hoặc đã ngưng.');
    }
    await txOrDb.update(warehouses).set({ defaultBankAccountId: bankAccountId }).where(eq(warehouses.id, warehouseId));
    return await this.getWarehouse(warehouseId, txOrDb);
  }

  /**
   * Sửa thông tin kho (Owner/Manager). KHÔNG cho đổi `code`/`id` vì đó là
   * khoá nghiệp vụ đã gắn vào đơn, phiếu và sổ kho.
   */
  static async updateWarehouse(
    warehouseId: string,
    patch: { name?: string; address?: string | null; isSellableOnPos?: boolean; isActive?: boolean },
    txOrDb: any = db
  ): Promise<WarehouseRow> {
    const wh = await this.getWarehouse(warehouseId, txOrDb);
    if (!wh) throw AppError.invalid('Kho không tồn tại.');
    const set: Partial<typeof warehouses.$inferInsert> = {};
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw AppError.invalid('Tên kho không được để trống.');
      set.name = name;
    }
    if (patch.address !== undefined) set.address = patch.address?.trim() || null;
    if (patch.isSellableOnPos !== undefined) set.isSellableOnPos = patch.isSellableOnPos === true;
    if (patch.isActive !== undefined) set.isActive = patch.isActive === true;
    if (Object.keys(set).length === 0) throw AppError.invalid('Không có gì để cập nhật.');
    await txOrDb.update(warehouses).set(set).where(eq(warehouses.id, warehouseId));
    return (await this.getWarehouse(warehouseId, txOrDb))!;
  }

  /**
   * Xóa kho chỉ khi RỖNG và chưa từng phát sinh nghiệp vụ. Kho còn tồn hoặc đã
   * có đơn/phiếu → ném 409 kèm lý do cụ thể để người dùng chuyển sang "Ngưng
   * hoạt động" (isActive=false) thay vì xóa cứng, tránh mất dữ liệu.
   */
  static async deleteWarehouse(warehouseId: string, txOrDb: any = db): Promise<{ id: string; name: string }> {
    const wh = await this.getWarehouse(warehouseId, txOrDb);
    if (!wh) throw AppError.invalid('Kho không tồn tại.');

    const { stockBalances, orders, inventoryLedger } = await import('../db/schema');
    const stock = await txOrDb
      .select()
      .from(stockBalances)
      .where(eq(stockBalances.warehouseId, warehouseId));
    const withStock = stock.filter((s: any) => Number(s.physicalQuantity || 0) !== 0);
    if (withStock.length > 0) {
      const total = withStock.reduce((acc: number, s: any) => acc + Number(s.physicalQuantity || 0), 0);
      throw AppError.conflict(
        `Kho [${wh.code}] còn ${total} cuốn tồn nên không xóa được. Hãy dùng "Ngưng hoạt động" thay cho xóa.`
      );
    }
    const usedByOrders = await txOrDb
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.warehouseId, warehouseId))
      .limit(1);
    if (usedByOrders.length > 0) {
      throw AppError.conflict(
        `Kho [${wh.code}] đã có đơn hàng nên không xóa được (giữ lịch sử). Hãy dùng "Ngưng hoạt động".`
      );
    }
    const usedByLedger = await txOrDb
      .select({ id: inventoryLedger.id })
      .from(inventoryLedger)
      .where(eq(inventoryLedger.warehouseId, warehouseId))
      .limit(1);
    if (usedByLedger.length > 0) {
      throw AppError.conflict(
        `Kho [${wh.code}] đã có biến động kho trong sổ kho nên không xóa được. Hãy dùng "Ngưng hoạt động".`
      );
    }

    // Dọn "bucket rỗng" (tồn = 0) trước khi xóa kho: stock_balances có khóa
    // ngoại tới warehouses, giữ lại sẽ khiến DELETE ném lỗi FK (500) thay vì
    // thông báo rõ ràng. Bucket tồn = 0 không mang dữ liệu nào.
    await txOrDb.delete(stockBalances).where(eq(stockBalances.warehouseId, warehouseId));

    await txOrDb.delete(warehouses).where(eq(warehouses.id, warehouseId));
    return { id: wh.id, name: wh.name };
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
