import { sql } from 'drizzle-orm';
import { db, shopeeReturns } from '@/db';
import { withDbRetry } from '@/lib/db-retry';
import { generateShopeeSign } from './sign';
import { TursoTokenStorage } from './token-store';
import { refreshShopeeTokenOnce } from './auth';
import type { ShopeeSyncConfig } from './order-sync';

async function shopeeGet(
  cfg: ShopeeSyncConfig,
  apiPath: string,
  query: Record<string, string>
): Promise<any> {
  const store = new TursoTokenStorage(cfg.shopId);
  let token = await store.get();
  if (!token || token.expired_at <= Date.now() + 5 * 60 * 1000) {
    token = await refreshShopeeTokenOnce(cfg);
  }
  const { timestamp, sign } = generateShopeeSign({
    partnerId: cfg.partnerId,
    partnerKey: cfg.partnerKey,
    apiPath,
    accessToken: token.access_token,
    shopId: cfg.shopId,
  });
  const qs = new URLSearchParams({
    ...query,
    partner_id: String(cfg.partnerId),
    timestamp: String(timestamp),
    access_token: token.access_token,
    shop_id: String(cfg.shopId),
    sign,
  });
  const res = await fetch(`${cfg.baseUrl}${apiPath}?${qs.toString()}`, { method: 'GET' });
  const data = (await res.json()) as any;
  if (data?.error) throw new Error(`Shopee API lỗi: ${data.error} - ${data.message || ''}`);
  return data.response;
}

export interface ReturnPullResult {
  pulled: number;
  updated: number;
}

/**
 * Kéo danh sách trả hàng/hoàn tiền từ Shopee về DB.
 * Idempotent theo return_sn: đã có thì cập nhật trạng thái.
 */
export async function pullShopeeReturns(
  cfg: ShopeeSyncConfig,
  timeFrom: number,
  timeTo: number
): Promise<ReturnPullResult> {
  const result: ReturnPullResult = { pulled: 0, updated: 0 };
  let pageNo = 1;
  for (;;) {
    const page = await shopeeGet(cfg, '/api/v2/returns/get_return_list', {
      page_no: String(pageNo),
      page_size: '100',
      create_time_from: String(timeFrom),
      create_time_to: String(timeTo),
    });
    const list: Array<{
      return_sn: string;
      order_sn: string;
      status: string;
      reason?: string;
      refund_amount?: number;
      user?: { username?: string };
      return_seller_due_date?: number;
    }> = page.return ?? [];
    for (const r of list) {
      const existing = await withDbRetry(async () =>
        db.select({ returnSn: shopeeReturns.returnSn }).from(shopeeReturns)
          .where(sql`${shopeeReturns.returnSn} = ${r.return_sn}`).limit(1)
      );
      if (existing.length > 0) {
        await withDbRetry(async () =>
          db.update(shopeeReturns)
            .set({ status: r.status, updatedAt: new Date().toISOString() })
            .where(sql`${shopeeReturns.returnSn} = ${r.return_sn}`)
        );
        result.updated += 1;
      } else {
        await withDbRetry(async () =>
          db.insert(shopeeReturns).values({
            returnSn: r.return_sn,
            orderSn: r.order_sn,
            status: r.status,
            reason: r.reason || null,
            refundAmount: Number(r.refund_amount || 0),
            buyerUsername: r.user?.username || null,
            sellerDueDate: r.return_seller_due_date || null,
          })
        );
        result.pulled += 1;
      }
    }
    if (!page.more) break;
    pageNo += 1;
    if (pageNo > 20) break; // chặn vòng lặp vô hạn
  }
  return result;
}
