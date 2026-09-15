import { db, seasonalBundles, bundleItems, editions } from '../db';
import { InventoryService } from './inventory.service';
import { eq } from 'drizzle-orm';

/**
 * ĐỘNG CƠ COMBO / BOXSET (BUNDLE ENGINE).
 *
 * - 1 bundle = N linh kiện (sách + vỏ hộp pseudo-SKU), mỗi linh kiện có
 *   quantityInBundle (số lượng trong 1 bộ).
 * - Bottleneck realtime: available = MIN(stock_i / req_i) theo kho xuất.
 *   Thiếu 1 linh kiện -> chặn cứng cả combo (không bán thiếu bộ).
 * - Giá kế toán: phân bổ comboPrice theo tỉ trọng giá bìa (weighted
 *   proration), dồn phần lẻ làm tròn vào dòng cuối -> tổng khớp 100%.
 */
export interface BundleComponent {
  editionId: string;
  code: string;
  title: string | null;
  coverPrice: number;
  requiredPerBox: number;
  stock: number;
  possibleBoxes: number;
}

export interface BundleAvailability {
  bundleId: string;
  bundleCode: string;
  comboPrice: number;
  available: number;
  components: BundleComponent[];
}

export interface PricedBundleLine {
  editionId: string;
  quantity: number;
  unitCoverPrice: number;
  unitSellingPrice: number;
  totalAmount: number;
  bundleId: string;
  bundleQty: number;
}

export class BundleService {
  /** Bundle kèm linh kiện bắt buộc + thông tin ấn bản. */
  static async getBundle(bundleId: string) {
    const bundle = (
      await db.select().from(seasonalBundles).where(eq(seasonalBundles.id, bundleId)).limit(1)
    )[0];
    if (!bundle) throw new Error(`Không tìm thấy combo ${bundleId}.`);
    if (!bundle.isActive) throw new Error(`Combo ${bundle.code} đã ngừng bán.`);

    const items = await db
      .select({
        bundleItemId: bundleItems.id,
        editionId: bundleItems.editionId,
        quantityInBundle: bundleItems.quantityInBundle,
        isMandatory: bundleItems.isMandatory,
        code: editions.code,
        title: editions.title,
        coverPrice: editions.coverPrice,
      })
      .from(bundleItems)
      .innerJoin(editions, eq(bundleItems.editionId, editions.id))
      .where(eq(bundleItems.bundleId, bundleId));

    const mandatory = items.filter((i) => i.isMandatory);
    if (mandatory.length === 0) throw new Error(`Combo ${bundle.code} chưa có linh kiện bắt buộc.`);
    return { bundle, items: mandatory };
  }

  static async listBundles(activeOnly = true) {
    if (activeOnly) {
      return await db.select().from(seasonalBundles).where(eq(seasonalBundles.isActive, true));
    }
    return await db.select().from(seasonalBundles);
  }

  /** Số bộ bán được tại 1 kho = MIN(tồn_i / cần_i). Tính realtime, không lưu. */
  static async getAvailability(bundleId: string, warehouseId: string): Promise<BundleAvailability> {
    const { bundle, items } = await this.getBundle(bundleId);

    const components: BundleComponent[] = [];
    for (const it of items) {
      const req = it.quantityInBundle ?? 1;
      const stock = await InventoryService.getBalance(it.editionId, warehouseId, 'NEW');
      components.push({
        editionId: it.editionId,
        code: it.code,
        title: it.title,
        coverPrice: it.coverPrice ?? 0,
        requiredPerBox: req,
        stock,
        possibleBoxes: Math.floor(stock / req),
      });
    }

    return {
      bundleId,
      bundleCode: bundle.code,
      comboPrice: bundle.comboPrice,
      available: Math.min(...components.map((c) => c.possibleBoxes)),
      components,
    };
  }

  /** Chặn cứng khi thiếu linh kiện, nêu đích danh đầu sách cạn. */
  static async validateAvailability(bundleId: string, warehouseId: string, qty: number) {
    if (qty <= 0) throw new Error('Số lượng combo phải lớn hơn 0.');
    const avail = await this.getAvailability(bundleId, warehouseId);
    if (avail.available < qty) {
      const shorts = avail.components
        .filter((c) => c.possibleBoxes < qty)
        .map((c) => `[${c.code}] chỉ còn ${c.stock} cuốn (cần ${c.requiredPerBox * qty} cho ${qty} bộ)`);
      throw new Error(
        `Hộp sách không khả dụng: ${shorts.join('; ')} — không đủ đóng bộ!`
      );
    }
    return avail;
  }

  /**
   * Phân bổ comboPrice theo tỉ trọng giá bìa, dồn lẻ vào dòng cuối.
   * Tổng các dòng khớp 100% comboPrice × số bộ (chuẩn COGS/kê khai).
   * FIX-10: tính theo TỔNG DÒNG (cover×số lượng/bộ), không theo đơn giá —
   * bản cũ dồn dư sai khi linh kiện có quantityInBundle > 1 (300k thành 400k).
   */
  static async priceLines(bundleId: string, qty: number): Promise<PricedBundleLine[]> {
    const { bundle, items } = await this.getBundle(bundleId);
    const sumCover = items.reduce((s, i) => s + (i.coverPrice ?? 0) * (i.quantityInBundle ?? 1), 0);
    if (sumCover <= 0) throw new Error(`Combo ${bundle.code} có tổng giá bìa linh kiện bằng 0.`);

    const perBox = bundle.comboPrice;
    let allocatedBox = 0;
    return items.map((it, idx) => {
      const req = it.quantityInBundle ?? 1;
      const cover = it.coverPrice ?? 0;
      let lineTotal = Math.round((perBox * cover * req) / sumCover);
      if (idx === items.length - 1) {
        lineTotal = perBox - allocatedBox; // Dồn phần dư làm tròn vào TỔNG dòng cuối
      }
      allocatedBox += lineTotal;
      const unit = req > 0 ? Math.round(lineTotal / req) : lineTotal;
      // Giữ tổng dòng chuẩn tuyệt đối (unit hiển thị có thể lệch ±1 do làm tròn)
      return {
        editionId: it.editionId,
        quantity: req * qty,
        unitCoverPrice: cover,
        unitSellingPrice: unit,
        totalAmount: lineTotal * qty,
        bundleId,
        bundleQty: qty,
      };
    });
  }

  /** Tạo combo mới (quản lý định nghĩa bộ + linh kiện). */
  static async createBundle(params: {
    code: string;
    seasonName: string;
    releaseDate: string;
    comboPrice: number;
    totalCoverPrice?: number;
    items: Array<{ editionId: string; quantityInBundle?: number }>;
    createdId?: string;
  }) {
    const { code, seasonName, releaseDate, comboPrice, items } = params;
    if (!items || items.length === 0) throw new Error('Combo phải có ít nhất 1 linh kiện.');
    if (comboPrice <= 0) throw new Error('Giá combo phải lớn hơn 0.');

    const id = params.createdId || `bun-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const covers = await Promise.all(
      items.map(async (it) => {
        const ed = (await db.select().from(editions).where(eq(editions.id, it.editionId)).limit(1))[0];
        if (!ed) throw new Error(`Không tìm thấy linh kiện ${it.editionId}.`);
        return ed.coverPrice ?? 0;
      })
    );
    const sumCover = covers.reduce((s, c, i) => s + c * (items[i].quantityInBundle ?? 1), 0);

    await db.insert(seasonalBundles).values({
      id,
      code,
      seasonName,
      releaseDate,
      comboPrice,
      totalCoverPrice: params.totalCoverPrice ?? sumCover,
      isActive: true,
    });
    for (const it of items) {
      await db.insert(bundleItems).values({
        id: `bi-${id}-${it.editionId}`,
        bundleId: id,
        editionId: it.editionId,
        quantityInBundle: it.quantityInBundle ?? 1,
        isMandatory: true,
      });
    }
    return { bundleId: id, code, itemsCount: items.length };
  }

  static async setBundleActive(bundleId: string, isActive: boolean) {
    await db
      .update(seasonalBundles)
      .set({ isActive })
      .where(eq(seasonalBundles.id, bundleId));
    return { bundleId, isActive };
  }
}
