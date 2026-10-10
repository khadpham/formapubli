import { db, editions, inventoryLedger, orders, stockBalances, warehouses } from '../db';
import { AppError } from './app-error';
import { eq, and, or, sql, inArray, isNull } from 'drizzle-orm';

/**
 * ĐỘNG CƠ DỰ BÁO TÁI BẢN (REPRINT RUNOUT FORECASTING) - stateless, không migration.
 *
 * - V_sale: tổng cuốn xuất bán (DISPATCH_SALE + CONSIGNMENT_SOLD) trong N ngày
 *   gần nhất / N. Nguồn ledger (sự thật vật lý), mốc recordedAt.
 * - Tồn khả dụng: tổng NEW trên mọi kho TRỪ trạm transit (hàng đi đường
 *   chưa chắc chắn) và TRỪ hàng cách ly/hỏng (không bán được).
 * - DoI = tồn / V (V = 0 -> vô cùng). Phân cấp RED <= 30, YELLOW <= 45.
 * - Số lượng in đề xuất = CEIL(V × (lead 30 + buffer 15 + an toàn 60)).
 *   Đây là chính sách bù tồn 105 ngày, KHÔNG phải EOQ tối ưu kinh tế
 *   (Economic Order Quantity). Không gọi tắt là "EOQ" khi báo cáo lãnh đạo.
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

/**
 * Số lượng in đề xuất theo chính sách bù tồn 105 ngày
 * (Lead 30 + Buffer 15 + Safety 60). KHÔNG phải EOQ kinh tế tối ưu.
 */
export function computeReprintSuggestion(vSale: number): number {
  if (vSale <= 0) return 0;
  return Math.ceil(vSale * (LEAD_TIME_DAYS + BUFFER_DAYS + SAFETY_DAYS));
}

/**
 * @deprecated Giữ để tương thích ngược (test-forecast, script ngoài).
 * Dùng `computeReprintSuggestion` cho mọi code mới.
 */
export const computeEOQ = computeReprintSuggestion;

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
      // FIX-08 + P2-11: loại đơn tặng/tài trợ/0đ khỏi vận tốc bán (kẻo đề xuất in bị đặt dư).
      // Giữ lại bút toán không gắn đơn (ký gửi: correlationId là statementId).
      // P2-11: chặn lách bằng CK 100% cấp dòng (discount tổng = 0 nhưng final = 0).
      .leftJoin(orders, eq(inventoryLedger.correlationId, orders.id))
      .where(
        and(
          inArray(inventoryLedger.eventType, ['DISPATCH_SALE', 'CONSIGNMENT_SOLD']),
          // FIX-08b + P2-12 (KIỂM ĐỊNH 30/09): `recorded_at` tồn tại CẢ HAI họ -
          // SQLite CURRENT_TIMESTAMP 'YYYY-MM-DD HH:mm:ss' (mặc định CSDL) và ISO
          // 'YYYY-MM-DDTHH:mm:ss.sssZ' (app ghi tay ở delivery-order.service).
          // So CHUỖI THÔ giữa hai họ là vô nghĩa: ' ' (0x20) < 'T' (0x54) nên mọi
          // dòng ISO kể cả trước mốc đều ">= cutoff" ⇒ vận tốc bán thừa ⇒ DoI
          // sai ⇒ đề xuất in sai. `datetime()` của SQLite chuẩn hoá được cả hai.
          sql`datetime(${inventoryLedger.recordedAt}) >= datetime(${cutoff})`,
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
    return new Map(
      rows
        .filter((r): r is { editionId: string; qty: number } => r.editionId !== null)
        .map((r) => [r.editionId, Number(r.qty ?? 0)])
    );
  }

  /**
   * Tồn khả dụng: NEW mọi kho trừ transit (warehouseId lọc riêng nếu cần).
   *
   * Dùng `warehouseType = 'IN_TRANSIT'` thay vì so id cứng `wh-in-transit`:
   * kho trung chuyển mới tạo sau này cũng phải bị trừ, không thể chỉ trừ đúng
   * một id đã biết trước.
   */
  static async availableStockByEdition(warehouseId?: string): Promise<Map<string, number>> {
    const rows = await db
      .select({
        editionId: stockBalances.editionId,
        qty: sql<number>`COALESCE(SUM(${stockBalances.physicalQuantity}), 0)`,
      })
      .from(stockBalances)
      .innerJoin(warehouses, eq(stockBalances.warehouseId, warehouses.id))
      .where(
        and(
          eq(stockBalances.condition, 'NEW'),
          warehouseId
            ? eq(stockBalances.warehouseId, warehouseId)
            : sql`${warehouses.warehouseType} != 'IN_TRANSIT'`
        )
      )
      .groupBy(stockBalances.editionId);
    // 0032: dòng hàng hóa có `edition_id` NULL ⇒ bỏ, hàm này chỉ dành cho sách.
    return new Map(
      rows
        .filter((r): r is typeof r & { editionId: string } => r.editionId !== null)
        .map((r) => [r.editionId, Number(r.qty ?? 0)])
    );
  }

  /** Tồn khả dụng của MỘT ấn bản (vẫn 1 truy vấn, không vòng kho). */
  static async availableStock(editionId: string, warehouseId?: string): Promise<number> {
    return (await this.availableStockByEdition(warehouseId)).get(editionId) ?? 0;
  }

  static async forecastEdition(
    editionId: string,
    windowDays: number = DEFAULT_WINDOW_DAYS,
    warehouseId?: string
  ): Promise<ForecastItem> {
    const ed = (await db.select().from(editions).where(eq(editions.id, editionId)).limit(1))[0];
    if (!ed) throw AppError.invalid(`Không tìm thấy ấn bản ${editionId}.`);

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
      suggestedReprintQty: computeReprintSuggestion(vSale),
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
    // FIX-08c (KIỂM ĐỊNH 30/09): trước đây vòng từng ấn bản gọi availableStock,
    // mà availableStock lại vòng bảng `warehouses` + getBalance từng kho ⇒ 354
    // truy vấn cho 88 ấn bản × 4 kho (N+1 nặng, và `getStockMatrix` kiểu này đã
    // làm kho hội chợ "không bao giờ có số liệu" trong đợt trước). Nay gom
    // toàn bộ tồn trong MỘT truy vấn GROUP BY.
    const stock = await this.availableStockByEdition(warehouseId);

    const items: ForecastItem[] = [];
    for (const ed of allEditions) {
      const soldQty = sales.get(ed.id) ?? 0;
      const vSale = soldQty / windowDays;
      const totalStock = stock.get(ed.id) ?? 0;
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
        suggestedReprintQty: computeReprintSuggestion(vSale),
      };
      items.push(item);
    }

    items.sort((a, b) => (a.doi ?? Number.POSITIVE_INFINITY) - (b.doi ?? Number.POSITIVE_INFINITY));
    // Summary dem tren TOAN danh muc (truoc loc) - loc RED khong duoc lam mat so lieu tong.
    const summary: Record<RunoutLevel, number> = {
      RED_ALERT: 0,
      YELLOW_WARNING: 0,
      HEALTHY_NORMAL: 0,
    };
    for (const it of items) summary[it.level]++;
    const filtered = level ? items.filter((it) => it.level === level) : items;
    const sliced = filtered.slice(0, limit);

    return { items: sliced, summary };
  }
}
