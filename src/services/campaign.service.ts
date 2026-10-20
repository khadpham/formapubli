import { db, campaigns, campaignReports, stockBalances, products, orders, orderItems } from '../db';
import { eq, and, gt, sql, lt } from 'drizzle-orm';
import { AppError } from './app-error';
import { WarehouseService } from './warehouse.service';
import { InventoryService } from './inventory.service';
import type { ActorContext } from './actor-context';
import { randomUUID } from 'crypto';

export type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'ENDED';

function slug(s: string): string {
  return (
    s.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/Đ/g, 'D').replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'CD'
  );
}

export class CampaignService {
  static async require(campaignId: string) {
    const rows = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
    if (rows.length === 0) throw AppError.invalid('Chiến dịch không tồn tại.');
    return rows[0];
  }

  static async create(params: {
    name: string;
    startDate: string;
    endDate: string;
    sourceWarehouseId: string;
    actorId: string;
  }): Promise<{ id: string }> {
    const name = `${params.name || ''}`.trim();
    if (!name) throw AppError.invalid('Tên chiến dịch không được để trống.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(params.endDate)) {
      throw AppError.invalid('Ngày phải dạng YYYY-MM-DD.');
    }
    if (params.endDate < params.startDate) throw AppError.invalid('Ngày kết thúc phải sau ngày bắt đầu.');
    const src = await WarehouseService.getWarehouse(params.sourceWarehouseId);
    if (!src || (src as any).isActive !== true) throw AppError.invalid('Kho nguồn không tồn tại hoặc đã ngưng.');
    const id = `cd-${Date.now().toString(36)}`;
    await db.insert(campaigns).values({
      id,
      name,
      startDate: params.startDate,
      endDate: params.endDate,
      status: 'DRAFT',
      sourceWarehouseId: params.sourceWarehouseId,
      createdBy: params.actorId,
    });
    return { id };
  }

  static async start(params: { campaignId: string; actor: ActorContext }): Promise<{ campaignId: string; warehouseId: string }> {
    const c = await this.require(params.campaignId);
    if ((c as any).status !== 'DRAFT') throw AppError.conflict('Chiến dịch đã bắt đầu hoặc đã kết thúc.');
    const wh = await WarehouseService.createWarehouse({
      code: `KHO_CD_${slug((c as any).name)}_${(c as any).startDate.replaceAll('-', '')}`,
      name: `Chiến dịch ${(c as any).name}`,
      warehouseType: 'FAIR_EVENT',
    });
    await db
      .update(campaigns)
      .set({ status: 'ACTIVE', warehouseId: wh.id })
      .where(and(eq(campaigns.id, (c as any).id), eq(campaigns.status, 'DRAFT')));
    // Chốt race 2 người bấm Bắt đầu đồng thời: đọc lại, thua thì dọn kho vừa tạo.
    const fresh = await this.require(params.campaignId);
    if ((fresh as any).warehouseId !== wh.id) {
      await WarehouseService.deleteWarehouse(wh.id).catch(() => null);
      throw AppError.conflict('Chiến dịch vừa được bắt đầu bởi người khác.');
    }
    return { campaignId: (c as any).id, warehouseId: wh.id };
  }

  static async getLeftover(params: { campaignId: string }): Promise<Array<{ editionId: string; name: string; quantity: number }>> {
    const c = await this.require(params.campaignId);
    if ((c as any).status !== 'ACTIVE' || !(c as any).warehouseId) {
      throw AppError.invalid('Chiến dịch chưa bắt đầu.');
    }
    const rows = await db
      .select({
        productId: stockBalances.productId,
        qty: sql<number>`SUM(${stockBalances.physicalQuantity})`,
        name: products.name,
      })
      .from(stockBalances)
      .leftJoin(products, eq(products.id, stockBalances.productId))
      .where(and(eq(stockBalances.warehouseId, (c as any).warehouseId), gt(stockBalances.physicalQuantity, 0)))
      .groupBy(stockBalances.productId);
    return rows.map((r) => ({ editionId: `${r.productId}`, name: `${r.name ?? r.productId}`, quantity: Number(r.qty) }));
  }

  static async end(params: {
    campaignId: string;
    items: Array<{ editionId: string; quantity: number }>;
    actor: ActorContext;
  }): Promise<{ campaignId: string }> {
    const c = await this.require(params.campaignId);
    if ((c as any).status !== 'ACTIVE' || !(c as any).warehouseId || !(c as any).sourceWarehouseId) {
      throw AppError.invalid('Chiến dịch chưa bắt đầu.');
    }
    const clean = (params.items ?? [])
      .filter((it) => it && Number(it.quantity) > 0)
      .map((it) => ({ editionId: `${it.editionId}`, quantity: Math.floor(Number(it.quantity)) }));
    if (clean.length > 0) {
      await InventoryService.transferBatch({
        fromWarehouseId: (c as any).warehouseId,
        toWarehouseId: (c as any).sourceWarehouseId,
        items: clean,
        note: `Kết thúc chiến dịch ${(c as any).name}`,
        actorContext: params.actor,
        idempotencyKey: `campaign-end-${(c as any).id}`,
      });
    }
    // Chốt race 2 người bấm Kết thúc đồng thời: đọc lại trước khi đổi trạng thái.
    const fresh = await this.require(params.campaignId);
    if ((fresh as any).status !== 'ACTIVE') throw AppError.conflict('Chiến dịch vừa được kết thúc bởi người khác.');
    // Ngưng kho tự gỡ nhân sự (detachStaffReferences trong updateWarehouse).
    await WarehouseService.updateWarehouse((c as any).warehouseId, { isActive: false, isSellableOnPos: false });
    await db
      .update(campaigns)
      .set({ status: 'ENDED', endedAt: new Date().toISOString() })
      .where(and(eq(campaigns.id, (c as any).id), eq(campaigns.status, 'ACTIVE')));
    // Tự sinh báo cáo kỳ cho chiến dịch vừa kết thúc (lỗi báo cáo không chặn kết thúc).
    try {
      await this.generateReport((c as any).id, params.actor?.staffId || 'system-auto', clean);
    } catch (e) {
      console.error(`[campaign] report failed for ${(c as any).id}:`, (e as Error).message);
    }
    return { campaignId: (c as any).id };
  }

  /**
   * Tự sinh báo cáo kỳ (báo cáo chiến dịch) sau khi chiến dịch kết thúc.
   * Tổng hợp: doanh thu, số đơn, số cuốn bán được, hàng thừa chuyển về.
   */
  static async generateReport(
    campaignId: string,
    generatedBy: string,
    leftover: Array<{ editionId: string; name?: string; quantity: number }>
  ) {
    const c: any = await this.require(campaignId);
    const whId = c.warehouseId;
    const periodEnd = c.endedAt || new Date().toISOString();
    const periodStart = `${c.startDate}T00:00:00`;

    let revenue = 0;
    let orderCount = 0;
    let itemsSold = 0;
    const soldItems: Array<{ editionId: string; name: string; quantity: number }> = [];

    if (whId) {
      // Đơn bán trong kỳ chiến dịch tại kho chiến dịch (giờ VN, trừ quà 100%).
      const ords = await db
        .select({ id: orders.id, finalAmount: orders.finalAmount })
        .from(orders)
        .where(
          and(
            eq(orders.warehouseId, whId),
            sql`${orders.createdAt} >= ${periodStart}`,
            sql`${orders.createdAt} <= ${periodEnd}`,
            sql`COALESCE(${orders.discountRate}, 0) < 1`
          )
        );
      orderCount = ords.length;
      revenue = ords.reduce((s, o: any) => s + Number(o.finalAmount || 0), 0);
      if (ords.length > 0) {
        const ids = ords.map((o: any) => o.id);
        const items = await db
          .select({
            editionId: orderItems.editionId,
            qty: sql<number>`SUM(${orderItems.quantity})`,
            name: products.name,
          })
          .from(orderItems)
          .leftJoin(products, eq(products.id, orderItems.productId))
          .where(sql`${orderItems.orderId} IN (${sql.join(ids.map((x: string) => sql`${x}`), sql`, `)})`)
          .groupBy(orderItems.editionId);
        for (const it of items) {
          const q = Number((it as any).qty || 0);
          itemsSold += q;
          soldItems.push({ editionId: `${(it as any).editionId}`, name: `${(it as any).name ?? (it as any).editionId}`, quantity: q });
        }
      }
    }

    const leftoverQuantity = leftover.reduce((s, it) => s + Number(it.quantity || 0), 0);

    await db.insert(campaignReports).values({
      id: randomUUID(),
      campaignId,
      generatedBy,
      periodStart,
      periodEnd,
      revenue,
      orderCount,
      itemsSold,
      leftoverQuantity,
      leftoverItems: JSON.stringify(leftover),
      soldItems: JSON.stringify(soldItems),
    });
  }

  /**
   * Tự động kết thúc các chiến dịch ACTIVE đã quá endDate (giờ VN).
   * Chạy bởi cron mỗi 30 phút. Idempotent: chiến dịch đã ENDED thì bỏ qua.
   */
  static async autoEndExpired(): Promise<Array<{ campaignId: string; name: string }>> {
    // Ngày hiện tại giờ VN (YYYY-MM-DD).
    const now = new Date(Date.now() + 7 * 3600 * 1000);
    const today = now.toISOString().slice(0, 10);
    const expired = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.status, 'ACTIVE'), lt(campaigns.endDate, today)));
    const done: Array<{ campaignId: string; name: string }> = [];
    const actor: ActorContext = { staffId: 'system-cron', role: 'ROLE_OWNER', fullName: 'Hệ thống tự động' };
    for (const c of expired as any[]) {
      try {
        // Lấy tồn thừa hiện tại và kết thúc toàn bộ (không cần người bấm).
        const leftover = await this.getLeftover({ campaignId: c.id });
        await this.end({
          campaignId: c.id,
          items: leftover.map((l) => ({ editionId: l.editionId, quantity: l.quantity })),
          actor,
        });
        done.push({ campaignId: c.id, name: c.name });
      } catch (e) {
        // Lỗi 1 chiến dịch không chặn các chiến dịch khác.
        console.error(`[campaign-auto-end] ${c.id}:`, (e as Error).message);
      }
    }
    return done;
  }
}
