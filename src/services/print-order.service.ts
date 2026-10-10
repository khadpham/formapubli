import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db, printOrders, products, editions } from '@/db';
import { AppError } from './app-error';
import { withDbRetry } from '../lib/db-retry';
import { recordAuditLog } from '../lib/rbac-guard';
import type { UserRole } from '../lib/roles';

const STATUSES = ['DRAFT', 'CONFIRMED', 'RECEIVING', 'DONE', 'CANCELLED'] as const;

function assertOwner(role: UserRole) {
  if (role !== 'ROLE_OWNER') throw AppError.forbidden('Chỉ chủ mới được quản lý lệnh in và giá vốn.');
}

/**
 * Lệnh in mang giá vốn (GĐ3-P2). Toàn bộ service chặn ở tầng service theo
 * role - route cũng chặn requireSessionRole, double-guard như expense.service.
 */
export class PrintOrderService {
  static async create(params: {
    editionId?: string;
    productId: string;
    quantityPlanned: number;
    unitCostAgreed: number;
    note?: string;
    actorRole: UserRole;
    actorId: string;
  }) {
    assertOwner(params.actorRole);
    const productId = `${params.productId || ''}`.trim();
    if (!productId) throw AppError.invalid('Thiếu sản phẩm/ấn bản.');
    const qty = Math.trunc(Number(params.quantityPlanned));
    if (!Number.isInteger(qty) || qty <= 0) throw AppError.invalid('Số lượng đặt in phải là số nguyên > 0.');
    const cost = Number(params.unitCostAgreed);
    if (!Number.isFinite(cost) || cost < 0) throw AppError.invalid('Đơn giá vốn thỏa thuận phải là số không âm.');
    const [prod] = await db.select({ id: products.id }).from(products).where(eq(products.id, productId)).limit(1);
    if (!prod) throw AppError.invalid(`Sản phẩm ${productId} không tồn tại.`);
    if (params.editionId) {
      const [ed] = await db.select({ id: editions.id }).from(editions).where(eq(editions.id, params.editionId)).limit(1);
      if (!ed) throw AppError.invalid(`Ấn bản ${params.editionId} không tồn tại.`);
    }
    const id = `po-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const code = `LIN-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    const [row] = await withDbRetry(async () =>
      db.insert(printOrders).values({
        id,
        code,
        editionId: params.editionId || null,
        productId,
        quantityPlanned: qty,
        quantityReceived: 0,
        unitCostAgreed: cost,
        status: 'CONFIRMED',
        note: `${params.note || ''}`.trim() || null,
        createdBy: params.actorId,
      }).returning()
    );
    await recordAuditLog({
      action: 'PRINT_ORDER' as any,
      actorRole: params.actorRole,
      actorId: params.actorId,
      resource: '/api/owner/print-orders',
      details: `Tạo lệnh in ${code}: ${qty} cuốn, giá vốn ${cost}/cuốn.`,
    });
    return row;
  }

  static async list(filter: { status?: string; actorRole: UserRole }) {
    assertOwner(filter.actorRole);
    const conds: any[] = [];
    if (filter.status) {
      if (!(STATUSES as readonly string[]).includes(filter.status)) throw AppError.invalid('Trạng thái không hợp lệ.');
      conds.push(eq(printOrders.status, filter.status));
    }
    return db.select().from(printOrders)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(printOrders.createdAt));
  }

  static async getById(id: string, actorRole: UserRole) {
    assertOwner(actorRole);
    const [row] = await db.select().from(printOrders).where(eq(printOrders.id, id)).limit(1);
    if (!row) throw AppError.invalid(`Không tìm thấy lệnh in ${id}.`);
    return row;
  }

  /** Chủ sửa giá vốn/số lượng khi phát hiện sai - ghi audit cũ → mới. */
  static async update(id: string, patch: { unitCostAgreed?: number; quantityPlanned?: number; note?: string; status?: string }, actorRole: UserRole, actorId: string) {
    assertOwner(actorRole);
    const cur = await this.getById(id, actorRole);
    const changes: string[] = [];
    const set: Record<string, any> = { updatedAt: new Date().toISOString() };
    if (patch.unitCostAgreed !== undefined) {
      const cost = Number(patch.unitCostAgreed);
      if (!Number.isFinite(cost) || cost < 0) throw AppError.invalid('Đơn giá vốn phải là số không âm.');
      if (cost !== Number(cur.unitCostAgreed)) {
        changes.push(`giá vốn ${Number(cur.unitCostAgreed)} → ${cost}`);
        set.unitCostAgreed = cost;
      }
    }
    if (patch.quantityPlanned !== undefined) {
      const qty = Math.trunc(Number(patch.quantityPlanned));
      if (!Number.isInteger(qty) || qty <= 0) throw AppError.invalid('Số lượng phải là số nguyên > 0.');
      if (qty < Number(cur.quantityReceived)) throw AppError.invalid('Số lượng đặt không được nhỏ hơn số đã nhận.');
      set.quantityPlanned = qty;
    }
    if (patch.note !== undefined) set.note = `${patch.note || ''}`.trim() || null;
    if (patch.status !== undefined) {
      if (!(STATUSES as readonly string[]).includes(patch.status)) throw AppError.invalid('Trạng thái không hợp lệ.');
      set.status = patch.status;
    }
    if (Object.keys(set).length <= 1) throw AppError.invalid('Không có gì để cập nhật.');
    await withDbRetry(async () =>
      db.update(printOrders).set(set).where(eq(printOrders.id, id))
    );
    if (changes.length) {
      await recordAuditLog({
        action: 'PRINT_ORDER' as any,
        actorRole,
        actorId,
        resource: '/api/owner/print-orders',
        details: `Sửa lệnh in ${cur.code}: ${changes.join('; ')}.`,
      });
    }
    const [after] = await db.select().from(printOrders).where(eq(printOrders.id, id)).limit(1);
    return after;
  }

  /** Lấy thông tin lô cho luồng nhập kho - CHỈ dùng server-side, không trả về client. */
  static async getLotInfo(id: string) {
    const [row] = await db.select().from(printOrders).where(eq(printOrders.id, id)).limit(1);
    if (!row) throw AppError.invalid(`Không tìm thấy lệnh in ${id}.`);
    if (row.status === 'CANCELLED') throw AppError.invalid(`Lệnh in ${row.code} đã hủy.`);
    return { id: row.id, code: row.code, unitCostAgreed: Number(row.unitCostAgreed) };
  }

  /** Ghi nhận đã nhận hàng theo lệnh in - gọi từ luồng nhập kho (server-side). */
  static async addReceived(id: string, qty: number, tx: any) {
    const [cur] = await tx.select().from(printOrders).where(eq(printOrders.id, id)).limit(1);
    if (!cur) throw AppError.invalid(`Không tìm thấy lệnh in ${id}.`);
    if (cur.status === 'CANCELLED') throw AppError.invalid(`Lệnh in ${cur.code} đã hủy.`);
    const received = Number(cur.quantityReceived) + qty;
    await tx.update(printOrders).set({
      quantityReceived: received,
      status: received >= Number(cur.quantityPlanned) ? 'DONE' : 'RECEIVING',
      updatedAt: new Date().toISOString(),
    }).where(eq(printOrders.id, id));
    return { ...cur, quantityReceived: received, unitCostAgreed: Number(cur.unitCostAgreed) };
  }
}
