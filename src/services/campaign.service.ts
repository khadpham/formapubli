import { db, campaigns, stockBalances, products } from '../db';
import { eq, and, gt, sql } from 'drizzle-orm';
import { AppError } from './app-error';
import { WarehouseService } from './warehouse.service';
import { InventoryService } from './inventory.service';
import type { ActorContext } from './actor-context';

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
    await WarehouseService.updateWarehouse((c as any).warehouseId, { isActive: false });
    await db
      .update(campaigns)
      .set({ status: 'ENDED', endedAt: new Date().toISOString() })
      .where(and(eq(campaigns.id, (c as any).id), eq(campaigns.status, 'ACTIVE')));
    return { campaignId: (c as any).id };
  }
}
