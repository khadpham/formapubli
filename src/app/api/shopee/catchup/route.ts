import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { generateShopeeSign } from '@/services/shopee/sign';
import { TursoTokenStorage } from '@/services/shopee/token-store';
import { refreshShopeeTokenOnce } from '@/services/shopee/auth';
import { handleShopeePush, type PushOutcome } from '@/services/shopee/webhook';
import { getShopeeConfig, resolveShopeeShopId } from '@/services/shopee/shop-config';

export const dynamic = 'force-dynamic';

/**
 * POST /api/shopee/catchup - bù tin push Shopee bị mất.
 *
 * Webhook làm kênh chính, nhưng tin push có thể mất khi server restart đúng
 * lúc Shopee gọi hoặc cấu hình push sai. Route này gọi
 * GET /api/v2/push/get_lost_push_message (tin mất trong 3 ngày gần nhất) rồi
 * chạy từng tin qua ĐÚNG handleShopeePush của webhook - nên idempotent y hệt:
 * tin đã xử lý rồi thì không trừ kho 2 lần.
 *
 * Xong mỗi trang thì POST confirm_consumed_lost_push_message để Shopee đánh
 * dấu đã nhận. Bù tối đa 5 trang (100 tin/trang) để 1 lần chạy không kéo dài.
 *
 * Vận hành: bấm tay khi nghi mất tin, hoặc cron mỗi 30 phút trên VPS
 * (xem scripts/shopee-catchup.sh). Cron không có phiên đăng nhập nên chấp
 * nhận Bearer CRON_SECRET thay cho session - cùng mẫu với các route /api/cron.
 */
async function authorized(req: NextRequest): Promise<boolean> {
  try {
    await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
      'ROLE_SHOPEE_OPS',
    ] as UserRole[]);
    return true;
  } catch {
    /* không có phiên - thử CRON_SECRET cho cron VPS */
  }
  const secret = `${process.env.CRON_SECRET || ''}`.trim();
  if (!secret) return false;
  const header = `${req.headers.get('authorization') || ''}`.trim();
  if (!header.toLowerCase().startsWith('bearer ')) return false;
  const given = header.slice(7).trim();
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface ShopeeCfg {
  shopId: number;
  partnerId: number;
  partnerKey: string;
  baseUrl: string;
  warehouseId: string;
  codEnabled: boolean;
}

async function signedGet(
  cfg: ShopeeCfg,
  accessToken: string,
  apiPath: string,
  query: Record<string, string>
): Promise<any> {
  const { timestamp, sign } = generateShopeeSign({
    partnerId: cfg.partnerId,
    partnerKey: cfg.partnerKey,
    apiPath,
    accessToken,
    shopId: cfg.shopId,
  });
  const qs = new URLSearchParams({
    ...query,
    partner_id: String(cfg.partnerId),
    timestamp: String(timestamp),
    access_token: accessToken,
    shop_id: String(cfg.shopId),
    sign,
  });
  const res = await fetch(`${cfg.baseUrl}${apiPath}?${qs.toString()}`, { method: 'GET' });
  const data = (await res.json()) as any;
  if (data?.error) throw new Error(`Shopee API lỗi: ${data.error} - ${data.message || ''}`);
  return data.response ?? {};
}

async function signedPost(
  cfg: ShopeeCfg,
  accessToken: string,
  apiPath: string,
  body: Record<string, unknown>
): Promise<any> {
  const { timestamp, sign } = generateShopeeSign({
    partnerId: cfg.partnerId,
    partnerKey: cfg.partnerKey,
    apiPath,
    accessToken,
    shopId: cfg.shopId,
  });
  const qs = new URLSearchParams({
    partner_id: String(cfg.partnerId),
    timestamp: String(timestamp),
    access_token: accessToken,
    shop_id: String(cfg.shopId),
    sign,
  });
  const res = await fetch(`${cfg.baseUrl}${apiPath}?${qs.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, partner_id: cfg.partnerId, shop_id: cfg.shopId }),
  });
  const data = (await res.json()) as any;
  if (data?.error) throw new Error(`Shopee API lỗi: ${data.error} - ${data.message || ''}`);
  return data.response ?? {};
}

export async function POST(req: NextRequest) {
  try {
    if (!(await authorized(req))) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const partnerId = Number(process.env.SHOPEE_PARTNER_ID || '0');
    const partnerKey = `${process.env.SHOPEE_PARTNER_KEY || ''}`;
    const baseUrl =
      `${process.env.SHOPEE_BASE_URL || 'https://partner.shopeemobile.com'}`.replace(/\/$/, '');
    const { shopId } = await resolveShopeeShopId();
    const shopCfg = await getShopeeConfig();
    if (!partnerId || !partnerKey || !shopId) {
      return NextResponse.json(
        { success: false, error: 'Chưa cấu hình Shopee (partner/shop).' },
        { status: 400 }
      );
    }
    const cfg: ShopeeCfg = {
      shopId,
      partnerId,
      partnerKey,
      baseUrl,
      warehouseId: shopCfg.warehouseId,
      codEnabled: shopCfg.codEnabled,
    };
    const store = new TursoTokenStorage(shopId);
    let token = await store.get();
    if (!token || token.expired_at <= Date.now() + 5 * 60 * 1000) {
      token = await refreshShopeeTokenOnce(cfg);
    }

    const outcomes: Record<PushOutcome, number> = {
      'order-ingested': 0,
      'order-cancelled': 0,
      'tracking-updated': 0,
      ignored: 0,
    };
    let fetched = 0;
    for (let page = 0; page < 5; page++) {
      const resp = await signedGet(cfg, token.access_token, '/api/v2/push/get_lost_push_message', {});
      const items: Array<{ code?: number; data?: any }> = resp?.list ?? resp?.messages ?? [];
      if (items.length === 0) break;
      fetched += items.length;
      for (const m of items) {
        const out = await handleShopeePush(cfg, { code: m.code, data: m.data });
        outcomes[out] += 1;
      }
      const lastId = resp?.last_message_id ?? resp?.lastMessageId;
      if (lastId) {
        await signedPost(cfg, token.access_token, '/api/v2/push/confirm_consumed_lost_push_message', {
          last_message_id: lastId,
        });
      }
      if (!resp?.has_next_page && !resp?.hasNextPage) break;
    }
    return NextResponse.json({ success: true, data: { fetched, outcomes } });
  } catch (error) {
    return handleApiError(error);
  }
}
