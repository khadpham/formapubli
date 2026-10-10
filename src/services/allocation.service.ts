import { db } from '../db';
import { counterAllocations, editions, works, warehouses, stockBalances } from '../db/schema';
import { eq, and, sql, desc, asc, inArray } from 'drizzle-orm';
import { AppError } from './app-error';


export interface CreateAllocationItem {
  editionId: string;
  allocatedQuantity: number;
  notes?: string;
}

export interface AllocateBooksParams {
  warehouseId: string;
  counterName: string;
  cashboxSessionId?: string;
  allocations: CreateAllocationItem[];
}

export interface PickListItemRequest {
  editionId: string;
  quantityNeeded: number;
}

export interface PickListShelfGroup {
  shelfLocation: string;
  items: Array<{
    editionId: string;
    editionCode: string;
    title: string;
    author: string;
    quantityNeeded: number;
    currentStock: number;
  }>;
  totalQuantity: number;
}

export interface PickListResult {
  warehouseId: string;
  warehouseName: string;
  generatedAt: string;
  totalSkus: number;
  totalItemsToPick: number;
  groups: PickListShelfGroup[];
}

/**
 * Trần số dòng soạn/lần. Trước đây `generatePickList` chạy 2 query MỖI dòng và
 * `requests` nhận từ query param KHÔNG giới hạn ⇒ phiếu ~25+ dòng vượt trần
 * subrequest của Cloudflare Workers (~50) → 500. Nay gộp 2 query cho cả phiếu
 * và chặn trần này.
 */
const PICKLIST_MAX_LINES = 200;

export class AllocationService {
  /**
   * Tạo hoặc cập nhật hạn ngạch sách bàn giao cho từng quầy/bàn bán tại hội chợ ("Chia Mâm")
   *
   * all-or-nothing: trước đây mỗi dòng là một lệnh riêng ngoài transaction, nên
   * dòng thứ N lỗi (ví dụ editionId không tồn tại) để lại N-1 dòng đã ghi ⇒
   * bàn quầy có hạn ngạch nửa vời, không rollback được.
   */
  static async allocateBooksToCounter(params: AllocateBooksParams) {
    const { warehouseId, counterName, cashboxSessionId, allocations } = params;

    if (!Array.isArray(allocations) || allocations.length === 0) {
      return [];
    }

    return await db.transaction(async (tx) => {
      const results = [];
      for (const item of allocations) {
        if (!(Number(item.allocatedQuantity) > 0)) continue;

        // Tìm allocation đang active cho bàn và edition này
        const existing = await tx
          .select()
          .from(counterAllocations)
          .where(
            and(
              eq(counterAllocations.warehouseId, warehouseId),
              eq(counterAllocations.counterName, counterName),
              eq(counterAllocations.editionId, item.editionId),
              eq(counterAllocations.status, 'ACTIVE')
            )
          )
          .limit(1);

        if (existing.length > 0) {
          // Cập nhật tăng hạn ngạch
          const updated = await tx
            .update(counterAllocations)
            .set({
              allocatedQuantity: existing[0].allocatedQuantity + item.allocatedQuantity,
              cashboxSessionId: cashboxSessionId || existing[0].cashboxSessionId,
              notes: item.notes || existing[0].notes,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(counterAllocations.id, existing[0].id))
            .returning();
          results.push(updated[0]);
        } else {
          // Thêm mới
          const id = `alloc-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`;
          const inserted = await tx
            .insert(counterAllocations)
            .values({
              id,
              warehouseId,
              counterName,
              cashboxSessionId,
              editionId: item.editionId,
              allocatedQuantity: item.allocatedQuantity,
              soldQuantity: 0,
              status: 'ACTIVE',
              notes: item.notes,
            })
            .returning();
          results.push(inserted[0]);
        }
      }

      return results;
    });
  }

  /**
   * Lấy danh sách chia mâm cho 1 quầy hoặc toàn bộ quầy trong kho hội chợ
   */
  static async getCounterAllocations(warehouseId: string, counterName?: string, activeOnly: boolean = true) {
    let query = db
      .select({
        id: counterAllocations.id,
        warehouseId: counterAllocations.warehouseId,
        counterName: counterAllocations.counterName,
        cashboxSessionId: counterAllocations.cashboxSessionId,
        editionId: counterAllocations.editionId,
        editionCode: editions.code,
        title: sql<string>`coalesce(${editions.title}, ${works.title})`,
        coverPrice: editions.coverPrice,
        allocatedQuantity: counterAllocations.allocatedQuantity,
        soldQuantity: counterAllocations.soldQuantity,
        remainingQuantity: sql<number>`${counterAllocations.allocatedQuantity} - ${counterAllocations.soldQuantity}`,
        status: counterAllocations.status,
        notes: counterAllocations.notes,
        createdAt: counterAllocations.createdAt,
        updatedAt: counterAllocations.updatedAt,
      })
      .from(counterAllocations)
      .innerJoin(editions, eq(counterAllocations.editionId, editions.id))
      .innerJoin(works, eq(editions.workId, works.id))
      .$dynamic();

    const conditions = [eq(counterAllocations.warehouseId, warehouseId)];
    if (counterName) {
      conditions.push(eq(counterAllocations.counterName, counterName));
    }
    if (activeOnly) {
      conditions.push(eq(counterAllocations.status, 'ACTIVE'));
    }

    return await query.where(and(...conditions)).orderBy(asc(counterAllocations.counterName), asc(editions.code));
  }

  /**
   * Kiểm tra hạn ngạch còn lại trên bàn quầy trước khi thu ngân xuất bán.
   *
   * `warehouseId` là BẮT BUỘC: `counterName` chỉ là chuỗi tự do ("Bàn 1"),
   * nhiều kho hội chợ dùng lại cùng tên. Bỏ kho khỏi điều kiện lọc thì bàn
   * "Bàn 1" ở kho hội chợ số 2 đọc/nhập số của bàn "Bàn 1" ở kho số 1.
   */
  static async checkCounterQuota(
    counterName: string,
    editionId: string,
    requestedQty: number,
    warehouseId: string
  ) {
    if (!warehouseId || !warehouseId.trim()) {
      throw AppError.invalid('Thiếu warehouseId - hạn ngạch bàn quầy phải khoá theo kho.');
    }
    const allocs = await db
      .select()
      .from(counterAllocations)
      .where(
        and(
          eq(counterAllocations.warehouseId, warehouseId),
          eq(counterAllocations.counterName, counterName),
          eq(counterAllocations.editionId, editionId),
          eq(counterAllocations.status, 'ACTIVE')
        )
      )
      .limit(1);

    if (allocs.length === 0) {
      // Bàn quầy chưa được phân bổ hạn ngạch sách này
      return {
        hasAllocation: false,
        remaining: 0,
        allocated: 0,
        sold: 0,
        warning: `Sách chưa được phân bổ ("chia mâm") cho bàn quầy [${counterName}] tại kho [${warehouseId}]. Cần tiếp tế từ kho đệm.`,
      };
    }

    const alloc = allocs[0];
    const remaining = alloc.allocatedQuantity - alloc.soldQuantity;
    const isExceeded = remaining < requestedQty;

    return {
      hasAllocation: true,
      allocated: alloc.allocatedQuantity,
      sold: alloc.soldQuantity,
      remaining,
      isExceeded,
      warning: isExceeded
        ? `Hạn ngạch bàn [${counterName}] chỉ còn ${remaining} cuốn (yêu cầu: ${requestedQty}). Cần tiếp tế thêm sách lên bàn!`
        : undefined,
    };
  }

  /**
   * Ghi nhận số lượng đã bán vào hạn ngạch bàn quầy (khoá theo kho - xem
   * checkCounterQuota). Trả về số dòng hạn ngạch thực sự được cập nhật để
   * caller biết có dồn số vào nhầm bàn hay không.
   */
  static async recordCounterSales(
    counterName: string,
    items: Array<{ editionId: string; quantity: number }>,
    warehouseId: string
  ): Promise<number> {
    if (!warehouseId || !warehouseId.trim()) {
      throw AppError.invalid('Thiếu warehouseId - hạn ngạch bàn quầy phải khoá theo kho.');
    }
    let touched = 0;
    for (const item of items) {
      const upd: any = await db
        .update(counterAllocations)
        .set({
          soldQuantity: sql`${counterAllocations.soldQuantity} + ${item.quantity}`,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(counterAllocations.warehouseId, warehouseId),
            eq(counterAllocations.counterName, counterName),
            eq(counterAllocations.editionId, item.editionId),
            eq(counterAllocations.status, 'ACTIVE')
          )
        );
      touched += upd.rowsAffected || 0;
    }
    return touched;
  }

  /**
   * Sinh danh sách soạn hàng kệ kho (Shelf Pick List)
   * Gom nhóm sách theo kệ vị trí (shelfLocation) và sắp xếp tối ưu đường đi
   */
  static async generatePickList(
    warehouseId: string,
    requests: PickListItemRequest[]
  ): Promise<PickListResult> {
    const whList = await db
      .select({ id: warehouses.id, name: warehouses.name })
      .from(warehouses)
      .where(eq(warehouses.id, warehouseId))
      .limit(1);

    const warehouseName = whList.length > 0 ? whList[0].name : warehouseId;

    // Gộp nhu cầu theo ấn bản (bỏ trùng, cộng dồn) + chặn trần dòng.
    const needByEdition = new Map<string, number>();
    for (const req of requests || []) {
      const qty = Number(req?.quantityNeeded);
      if (!req?.editionId || !Number.isFinite(qty) || qty <= 0) continue;
      needByEdition.set(req.editionId, (needByEdition.get(req.editionId) || 0) + qty);
    }
    const ids = Array.from(needByEdition.keys()).slice(0, PICKLIST_MAX_LINES);
    if (ids.length === 0) {
      return {
        warehouseId,
        warehouseName,
        generatedAt: new Date().toISOString(),
        totalSkus: 0,
        totalItemsToPick: 0,
        groups: [],
      };
    }

    // HAI query cố định cho cả phiếu (thay 2 query/dòng). Sách có
    // `products.id === editions.id`; ở đây tra theo `edition_id` như trước.
    const [editionRows, balanceRows] = await Promise.all([
      db
        .select({
          id: editions.id,
          code: editions.code,
          title: sql<string>`coalesce(${editions.title}, ${works.title})`,
          author: works.author,
          suggestedLocation: editions.suggestedLocation,
        })
        .from(editions)
        .innerJoin(works, eq(editions.workId, works.id))
        .where(inArray(editions.id, ids)),
      db
        .select({ editionId: stockBalances.editionId, physicalQuantity: stockBalances.physicalQuantity })
        .from(stockBalances)
        .where(
          and(
            inArray(stockBalances.editionId, ids),
            eq(stockBalances.warehouseId, warehouseId),
            eq(stockBalances.condition, 'NEW')
          )
        ),
    ]);
    const edById = new Map(editionRows.map((e) => [e.id, e]));
    const balById = new Map(balanceRows.map((b) => [b.editionId, Number(b.physicalQuantity || 0)]));

    const groupsMap = new Map<string, PickListShelfGroup>();
    let totalItemsToPick = 0;
    let totalSkus = 0;

    for (const id of ids) {
      const ed = edById.get(id);
      if (!ed) continue;
      const qty = needByEdition.get(id)!;
      const currentStock = balById.get(id) ?? 0;
      const shelf = ed.suggestedLocation?.trim() || 'KỆ CHƯA XẾP VỊ TRÍ';

      if (!groupsMap.has(shelf)) {
        groupsMap.set(shelf, { shelfLocation: shelf, items: [], totalQuantity: 0 });
      }
      const grp = groupsMap.get(shelf)!;
      grp.items.push({
        editionId: ed.id,
        editionCode: ed.code,
        title: ed.title,
        author: ed.author,
        quantityNeeded: qty,
        currentStock,
      });
      grp.totalQuantity += qty;
      totalItemsToPick += qty;
      totalSkus += 1;
    }

    // Sắp xếp các nhóm theo kệ tăng dần
    const groups = Array.from(groupsMap.values()).sort((a, b) =>
      a.shelfLocation.localeCompare(b.shelfLocation, 'vi')
    );

    // Trong từng nhóm, sắp xếp mã sách theo thứ tự code
    for (const grp of groups) {
      grp.items.sort((a, b) => a.editionCode.localeCompare(b.editionCode));
    }

    return {
      warehouseId,
      warehouseName,
      generatedAt: new Date().toISOString(),
      totalSkus,
      totalItemsToPick,
      groups,
    };
  }
}
