import { db, editions, inventoryLedger, orders, stockBalances, warehouses } from '../db';
import { InventoryService } from './inventory.service';
import { eq, and, or, sql, inArray, isNull } from 'drizzle-orm';

/**
 * ĐỘNG CƠ DỰ BÁO TÁI BẢN (REPRINT RUNOUT FORECASTING) — stateless, không migration.
 *
 * - V_sale: tổng cuốn xuất bán (DISPATCH_SALE + CONSIGNMENT_SOLD) trong N ngày
 *   gần nhất / N. Nguồn ledger (sự thật vật lý), mốc recordedAt.
 * - Tồn khả dụng: tổng NEW trên mọi kho TRỪ trạm transit (hàng đi đường
 *   chưa chắc chắn) và TRỪ hàng cách ly/hỏng (không bán được).
 * - DoI = tồn / V (V = 0 -> vô cùng). Phân cấp RED <= 30, YELLOW <= 45.
 * - Đề xuất in = CEIL(V × (lead 30 + buffer 15 + an toàn 60)).
 */
export const LEAD_TIME_DAYS = 30;
export const BUFFER_DAYS = 15;
export const SAFETY_DAYS = 60;
export const RED_DAYS = 30;
export const YELLOW_DAYS = 45;
export const DEFAULT_WINDOW_DAYS = 30;

export type RunoutLevel = 'RED_ALERT' | 'YELLOW_WARNING' | 'HEALTHY_NORMAL';

export interface ForecastItem {
  editionId: string;
  code: string;
  title: string | null;
  coverPrice: number;
  windowDays: number;
  soldQty: number;
  vSale: number;
  totalStock: number;
  doi: number | null;
  level: RunoutLevel;
  suggestedReprintQty: number;
}

export function classifyLevel(doi: number | null): RunoutLevel {
  if (doi === null) return 'HEALTHY_NORMAL';
  if (doi <= RED_DAYS) return 'RED_ALERT';
  if (doi <= YELLOW_DAYS) return 'YELLOW_WARNING';
  return 'HEALTHY_NORMAL';
}

export function computeDoI(totalStock: number, vSale: number): number | null {
  if (vSale <= 0) return null;
  return totalStock / vSale;
}

export function computeEOQ(vSale: number): number {
  if (vSale <= 0) return 0;
  return Math.ceil(vSale * (LEAD_TIME_DAYS + BUFFER_DAYS + SAFETY_DAYS));
}

function sqliteCutoff(windowDays: number): string {
  return new Date(Date.now() - windowDays * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

export class ForecastService {
  /** Tổng bán trong cửa sổ (mặc định 30 ngày) theo từng ấn bản. */
  static async salesByEdition(windowDays: number = DEFAULT_WINDOW_DAYS): Promise<Map<string, number>> {
    const cutoff = sqliteCutoff(windowDays);
    const rows = await db
      .select({
        editionId: inventoryLedger.editionId,
        qty: sql<number>`COALESCE(SUM(-${inventoryLedger.quantityDelta}), 0)`,
      })
      .from(inventoryLedger)
      // FIX-08 + P2-11: loại đơn tặng/tài trợ/0đ khỏi vận tốc bán (kẻo EOQ đặt dư).
      // Giữ lại bút toán không gắn đơn (ký gửi: correlationId là statementId).
      // P2-11: chặn lách bằng CK 100% cấp dòng (discount tổng = 0 nhưng final = 0).
      .leftJoin(orders, eq(inventoryLedger.correlationId, orders.id))
      .where(
        and(
          inArray(inventoryLedger.eventType, ['DISPATCH_SALE', 'CONSIGNMENT_SOLD']),
          sql`${inventoryLedger.recordedAt} >= ${cutoff}`,
          or(
            isNull(orders.id),
            and(
              sql`${orders.discountRate} < 1`,
              sql`${orders.channel} != 'SPONSORSHIP'`,
              sql`${orders.finalAmount} > 0`
            )
          )
        )
      )
      .groupBy(inventoryLedger.editionId);
    return new Map(rows.map((r) => [r.editionId, Number(r.qty ?? 0)]));
  }

  /** Tồn khả dụng: NEW mọi kho trừ transit (warehouseId lọc riêng nếu cần). */
  static async availableStock(editionId: string, warehouseId?: string): Promise<number> {
    if (warehouseId) {
      return InventoryService.getBalance(editionId, warehouseId, 'NEW');
    }
    const allWh = await db.select({ id: warehouses.id }).from(warehouses);
    let total = 0;
    for (const wh of allWh) {
      if (wh.id === 'wh-in-transit') continue;
      total += await InventoryService.getBalance(editionId, wh.id, 'NEW');
    }
    return total;
  }

  static async forecastEdition(
    editionId: string,
    windowDays: number = DEFAULT_WINDOW_DAYS,
    warehouseId?: string
  ): Promise<ForecastItem> {
    const ed = (await db.select().from(editions).where(eq(editions.id, editionId)).limit(1))[0];
    if (!ed) throw new Error(`Không tìm thấy ấn bản ${editionId}.`);

    const sales = await this.salesByEdition(windowDays);
    const soldQty = sales.get(editionId) ?? 0;
    const vSale = soldQty / windowDays;
    const totalStock = await this.availableStock(editionId, warehouseId);
    const doi = computeDoI(totalStock, vSale);

    return {
      editionId,
      code: ed.code,
      title: ed.title,
      coverPrice: ed.coverPrice ?? 0,
      windowDays,
      soldQty,
      vSale,
      totalStock,
      doi,
      level: classifyLevel(doi),
      suggestedReprintQty: computeEOQ(vSale),
    };
  }

  /** Toàn danh mục, sắp RED trước (DoI tăng dần, vô cùng cuối cùng). */
  static async forecastAll(
    windowDays: number = DEFAULT_WINDOW_DAYS,
    warehouseId?: string,
    level?: RunoutLevel,
    limit = 200
  ): Promise<{ items: ForecastItem[]; summary: Record<RunoutLevel, number> }> {
    const allEditions = await db.select().from(editions);
    const sales = await this.salesByEdition(windowDays);

    const items: ForecastItem[] = [];
    for (const ed of allEditions) {
      const soldQty = sales.get(ed.id) ?? 0;
      const vSale = soldQty / windowDays;
      const totalStock = await this.availableStock(ed.id, warehouseId);
      const doi = computeDoI(totalStock, vSale);
      const item: ForecastItem = {
        editionId: ed.id,
        code: ed.code,
        title: ed.title,
        coverPrice: ed.coverPrice ?? 0,
        windowDays,
        soldQty,
        vSale,
        totalStock,
        doi,
        level: classifyLevel(doi),
        suggestedReprintQty: computeEOQ(vSale),
      };
      if (!level || item.level === level) items.push(item);
    }

    items.sort((a, b) => (a.doi ?? Number.POSITIVE_INFINITY) - (b.doi ?? Number.POSITIVE_INFINITY));
    const sliced = items.slice(0, limit);
    const summary: Record<RunoutLevel, number> = {
      RED_ALERT: 0,
      YELLOW_WARNING: 0,
      HEALTHY_NORMAL: 0,
    };
    for (const it of items) summary[it.level]++;

    return { items: sliced, summary };
  }
}
