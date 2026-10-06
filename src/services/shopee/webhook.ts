import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, orders, orderItems } from '@/db';
import { withDbRetry } from '@/lib/db-retry';
import { InventoryService } from '../inventory.service';
import type { ShopeeSyncConfig } from './order-sync';
import { ingestShopeeOrderSns } from './order-sync';

/**
 * Xác minh chữ ký webhook Shopee: HMAC(url_đầy_đủ + '|' + rawBody).
 * Sai → 401, không xử lý gì thêm (chống tin giả).
 */
export function verifyShopeeWebhook(
  rawBody: string,
  signatureHeader: string,
  webhookUrl: string,
  partnerKey: string
): boolean {
  if (!signatureHeader || !partnerKey) return false;
  const expected = crypto.createHmac('sha256', partnerKey).update(`${webhookUrl}|${rawBody}`).digest('hex');
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export type PushOutcome = 'order-ingested' | 'order-cancelled' | 'tracking-updated' | 'ignored';

/**
 * Xử lý 1 gói tin push sau khi đã verify.
 * - code 1 + READY_TO_SHIP → kéo đơn + trừ kho (idempotent: bắn lại không trừ 2 lần).
 * - code 1 + CANCELLED → hủy đơn chưa giao + hoàn kho RETURN_INBOUND.
 * - code 2 → cập nhật tracking.
 */
export async function handleShopeePush(
  cfg: ShopeeSyncConfig,
  payload: { code?: number; data?: any }
): Promise<PushOutcome> {
  const { code, data } = payload;
  if (code === 1 && data?.status === 'READY_TO_SHIP' && data?.order_sn) {
    await ingestShopeeOrderSns(cfg, [String(data.order_sn)]);
    return 'order-ingested';
  }
  if (code === 1 && data?.status === 'CANCELLED' && data?.order_sn) {
    await cancelShopeeOrder(String(data.order_sn));
    return 'order-cancelled';
  }
  if (code === 2 && data?.order_sn && data?.tracking_number) {
    await db
      .update(orders)
      .set({ trackingCode: String(data.tracking_number) })
      .where(eq(orders.idempotencyKey, `shopee-${data.order_sn}`));
    return 'tracking-updated';
  }
  return 'ignored';
}

async function cancelShopeeOrder(orderSn: string): Promise<void> {
  const rows = await withDbRetry(async () =>
    db.select().from(orders).where(eq(orders.idempotencyKey, `shopee-${orderSn}`)).limit(1)
  );
  if (rows.length === 0) return; // Đơn chưa từng kéo về: không có gì để hoàn.
  const ord = rows[0];
  if (ord.shippingStatus !== 'CREATED') return; // Đã giao: không hoàn tự động.
  const lines = await withDbRetry(async () =>
    db.select().from(orderItems).where(eq(orderItems.orderId, ord.id))
  );
  await withDbRetry(async () =>
    db.transaction(async (tx) => {
      await tx.update(orders).set({ status: 'CANCELLED', shippingStatus: 'FAILED' }).where(eq(orders.id, ord.id));
      if (lines.length > 0) {
        await InventoryService.recordMovementsBatch(
          lines.map((l) => ({ editionId: l.editionId as string, quantityDelta: l.quantity })),
          {
            warehouseId: ord.warehouseId,
            eventType: 'RETURN_INBOUND',
            documentRef: `SHOPEE_CANCEL_${orderSn}`,
            note: `Hoàn kho đơn Shopee bị hủy #${orderSn}`,
            actorId: 'system-shopee-sync',
            correlationId: ord.id,
            idempotencyPrefix: `idem-shopee-cancel-${ord.id}`,
          },
          tx as any
        );
      }
    })
  );
}
