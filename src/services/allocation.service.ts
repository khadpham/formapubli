import { db } from '../db';
import { counterAllocations, editions, works, warehouses, stockBalances } from '../db/schema';
import { eq, and, sql, desc, asc } from 'drizzle-orm';


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

export class AllocationService {
  /**
   * Tạo hoặc cập nhật hạn ngạch sách bàn giao cho từng quầy/bàn bán tại hội chợ ("Chia Mâm")
   */
  static async allocateBooksToCounter(params: AllocateBooksParams) {
    const { warehouseId, counterName, cashboxSessionId, allocations } = params;

    const results = [];
    for (const item of allocations) {
      if (item.allocatedQuantity <= 0) continue;

      // Tìm allocation đang active cho bàn và edition này
      const existing = await db
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
        const updated = await db
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
        const inserted = await db
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
   * Kiểm tra hạn ngạch còn lại trên bàn quầy trước khi thu ngân xuất bán
   */
  static async checkCounterQuota(counterName: string, editionId: string, requestedQty: number) {
    const allocs = await db
      .select()
      .from(counterAllocations)
      .where(
        and(
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
        warning: `Sách chưa được phân bổ ("chia mâm") cho bàn quầy [${counterName}]. Cần tiếp tế từ kho đệm.`,
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
   * Ghi nhận số lượng đã bán vào hạn ngạch bàn quầy
   */
  static async recordCounterSales(
    counterName: string,
    items: Array<{ editionId: string; quantity: number }>
  ) {
    for (const item of items) {
      await db
        .update(counterAllocations)
        .set({
          soldQuantity: sql`${counterAllocations.soldQuantity} + ${item.quantity}`,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(counterAllocations.counterName, counterName),
            eq(counterAllocations.editionId, item.editionId),
            eq(counterAllocations.status, 'ACTIVE')
          )
        );
    }
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

    const groupsMap = new Map<string, PickListShelfGroup>();
    let totalItemsToPick = 0;
    let totalSkus = 0;

    for (const req of requests) {
      if (req.quantityNeeded <= 0) continue;

      const editionRows = await db
        .select({
          id: editions.id,
          code: editions.code,
          title: sql<string>`coalesce(${editions.title}, ${works.title})`,
          author: works.author,
          suggestedLocation: editions.suggestedLocation,
        })
        .from(editions)
        .innerJoin(works, eq(editions.workId, works.id))
        .where(eq(editions.id, req.editionId))
        .limit(1);

      if (editionRows.length === 0) continue;
      const ed = editionRows[0];

      // Lấy tồn kho thực tế hiện tại ở kho này
      const balanceRows = await db
        .select({ physicalQuantity: stockBalances.physicalQuantity })
        .from(stockBalances)
        .where(
          and(
            eq(stockBalances.editionId, req.editionId),
            eq(stockBalances.warehouseId, warehouseId),
            eq(stockBalances.condition, 'NEW')
          )
        )
        .limit(1);

      const currentStock = balanceRows.length > 0 ? balanceRows[0].physicalQuantity : 0;
      const shelf = ed.suggestedLocation?.trim() || 'KỆ CHƯA XẾP VỊ TRÍ';

      if (!groupsMap.has(shelf)) {
        groupsMap.set(shelf, {
          shelfLocation: shelf,
          items: [],
          totalQuantity: 0,
        });
      }

      const grp = groupsMap.get(shelf)!;
      grp.items.push({
        editionId: ed.id,
        editionCode: ed.code,
        title: ed.title,
        author: ed.author,
        quantityNeeded: req.quantityNeeded,
        currentStock,
      });
      grp.totalQuantity += req.quantityNeeded;

      totalItemsToPick += req.quantityNeeded;
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
