import { db, editions, orderItems, orders, works } from '../db';
import { and, eq, gte, sql } from 'drizzle-orm';
import { AppError } from './app-error';
import { OrderService } from './order.service';
import { WarehouseService } from './warehouse.service';

export interface PosCatalogLine {
  editionId: string;
  code: string;
  title: string;
  author: string;
  isbn: string;
  isbnLast4: string;
  coverPrice: number;
  atp: number;
  soldToday: number;
}

/**
 * V4.1 S2 — Danh mục POS theo kho: metadata + ATP khóa chốt + số bán hôm nay.
 * 1 request thay 81 request /api/atp. Sprint 3 tái dùng soldToday cho báo cáo ngày.
 */
export class PosCatalogService {
  static async getCatalog(warehouseId: string): Promise<{ warehouseId: string; generatedAt: string; items: PosCatalogLine[] }> {
    const wh = await WarehouseService.getWarehouse(warehouseId);
    if (!wh || wh.isActive !== true) {
      throw AppError.invalid(`Kho ${warehouseId} không tồn tại hoặc đã ngưng hoạt động.`);
    }

    // Đầu ngày VN (UTC+7) dạng ISO để lọc đơn hôm nay — đơn lưu createdAt UTC.
    // ponytail: hardcode +7, tham số hóa khi bán ngoài VN.
    const now = Date.now();
    const vn = new Date(now + 7 * 3600_000);
    const vnMidnightUtcMs = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) - 7 * 3600_000;
    const dayStartIso = new Date(vnMidnightUtcMs).toISOString();

    const soldRows = await db
      .select({ editionId: orderItems.editionId, qty: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)` })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(
        and(
          eq(orders.warehouseId, warehouseId),
          eq(orders.status, 'COMPLETED'),
          gte(orders.createdAt, dayStartIso)
        )
      )
      .groupBy(orderItems.editionId);
    const soldMap = new Map<string, number>();
    for (const r of soldRows) soldMap.set(r.editionId, Number(r.qty || 0));

    const all = await db
      .select({
        id: editions.id,
        code: editions.code,
        title: editions.title,
        isbn: editions.isbn,
        isbnLast4: editions.isbnLast4,
        coverPrice: editions.coverPrice,
        isActive: editions.isActive,
        author: works.author,
      })
      .from(editions)
      .innerJoin(works, eq(editions.workId, works.id));

    const items: PosCatalogLine[] = [];
    for (const e of all) {
      if (e.isActive === false) continue;
      items.push({
        editionId: e.id,
        code: e.code,
        title: e.title || e.code,
        author: e.author,
        isbn: e.isbn,
        isbnLast4: e.isbnLast4,
        coverPrice: e.coverPrice || 0,
        // getATP đã khóa chốt theo loại kho (fair = physical, chính trừ giữ chỗ).
        atp: await OrderService.getATP(e.id, warehouseId),
        soldToday: soldMap.get(e.id) || 0,
      });
    }
    return { warehouseId, generatedAt: new Date().toISOString(), items };
  }
}
