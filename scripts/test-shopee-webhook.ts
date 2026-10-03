/**
 * scripts/test-shopee-webhook.ts — webhook push realtime (Task 7).
 *
 * VÌ SAO CẦN: Shopee bắn lại gói tin 3–5 lần nếu ta quá 3s. Không idempotent
 * là trừ kho 3 lần cho 1 đơn. Khóa 4 điều:
 * 1. Sai chữ ký → từ chối (verify false).
 * 2. Push đơn mới 2 lần → chỉ trừ kho 1 lần.
 * 3. Push hủy đơn chưa giao → CANCELLED + hoàn kho đủ số lượng.
 * 4. Push tracking → cập nhật mã vận đơn.
 *
 * Chữ ký HMAC tính bằng node:crypto trong test (độc lập với service).
 *
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-shopee-webhook
 */
import crypto from 'node:crypto';
import { assertIsolatedTestDb } from './test-guard';
import { eq, and } from 'drizzle-orm';
import { db, editions, orders, stockBalances } from '../src/db';
import { createFakeShopeeFetch } from './shopee-fake-api';
import { verifyShopeeWebhook, handleShopeePush } from '../src/services/shopee/webhook';
import { TursoTokenStorage } from '../src/services/shopee/token-store';

assertIsolatedTestDb('test-shopee-webhook');

let pass = 0;
let fail = 0;
function eq2(label: string, actual: unknown, expected: unknown) {
  if (Object.is(actual, expected)) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ FAIL: ${label} — nhận ${String(actual)}, cần ${String(expected)}`);
  }
}

const SHOP = 777005;
const PARTNER_KEY = 'test-partner-key';
const URL = 'https://formapubli.vn/api/shopee/push';
const CFG = {
  shopId: SHOP,
  partnerId: 1000,
  partnerKey: PARTNER_KEY,
  baseUrl: 'https://partner.test-stable.shopeemobile.com',
  warehouseId: 'wh-au-co',
};

function signBody(raw: string): string {
  return crypto.createHmac('sha256', PARTNER_KEY).update(`${URL}|${raw}`).digest('hex');
}

async function stockOf(editionId: string): Promise<number> {
  const rows = await db
    .select()
    .from(stockBalances)
    .where(
      and(eq(stockBalances.productId, editionId), eq(stockBalances.warehouseId, 'wh-au-co'))
    )
    .limit(1);
  return rows[0]?.physicalQuantity ?? -999;
}

async function main() {
  await new TursoTokenStorage(SHOP).store({
    access_token: 'acc-push-test',
    refresh_token: 'ref-push-test',
    expired_at: Date.now() + 4 * 3600 * 1000,
    shop_id: SHOP,
  });
  const eds = await db.select({ id: editions.id, isbn: editions.isbn }).from(editions).limit(1);
  eq2('DB test có ít nhất 1 ấn bản', eds.length >= 1, true);
  const E = eds[0];
  const before = await stockOf(E.id);

  // 1. Verify chữ ký.
  const rawNew = JSON.stringify({ code: 1, shop_id: SHOP, data: { order_sn: 'SN-PUSH-1', status: 'READY_TO_SHIP' } });
  eq2('chữ ký đúng → true', verifyShopeeWebhook(rawNew, signBody(rawNew), URL, PARTNER_KEY), true);
  eq2('chữ ký sai → false', verifyShopeeWebhook(rawNew, 'deadbeef', URL, PARTNER_KEY), false);
  eq2('thiếu key → false', verifyShopeeWebhook(rawNew, signBody(rawNew), URL, ''), false);

  const fake = createFakeShopeeFetch({
    orders: [
      {
        order_sn: 'SN-PUSH-1',
        order_status: 'READY_TO_SHIP',
        payment_method: 'PREPAID',
        recipient: { name: 'Khách Push', phone: '0905', address: 'HN' },
        item_list: [
          { item_sku: E.isbn as string, model_quantity_purchased: 2, model_original_price: 80000, model_discounted_price: 80000 },
        ],
      },
    ],
  });
  const cfg = { ...CFG, fetchFn: fake.fn };

  // 2. Push đơn mới 2 lần → trừ 1 lần.
  const out1 = await handleShopeePush(cfg, JSON.parse(rawNew));
  eq2('push đơn mới → ingested', out1, 'order-ingested');
  eq2('trừ kho 2 cuốn', await stockOf(E.id), before - 2);
  await handleShopeePush(cfg, JSON.parse(rawNew));
  eq2('push lại không trừ thêm', await stockOf(E.id), before - 2);

  // 3. Push hủy → hoàn kho + CANCELLED.
  const rawCancel = JSON.stringify({ code: 1, shop_id: SHOP, data: { order_sn: 'SN-PUSH-1', status: 'CANCELLED' } });
  const outC = await handleShopeePush(cfg, JSON.parse(rawCancel));
  eq2('push hủy → cancelled', outC, 'order-cancelled');
  eq2('hoàn kho đủ 2 cuốn', await stockOf(E.id), before);
  const ord = await db.select().from(orders).where(eq(orders.idempotencyKey, 'shopee-SN-PUSH-1')).limit(1);
  eq2('đơn chuyển CANCELLED', ord[0]?.status, 'CANCELLED');

  // 4. Push tracking.
  const rawTrack = JSON.stringify({ code: 2, shop_id: SHOP, data: { order_sn: 'SN-PUSH-1', tracking_number: 'SPXVN999' } });
  const outT = await handleShopeePush(cfg, JSON.parse(rawTrack));
  eq2('push tracking → updated', outT, 'tracking-updated');
  const ord2 = await db.select().from(orders).where(eq(orders.idempotencyKey, 'shopee-SN-PUSH-1')).limit(1);
  eq2('tracking cập nhật', ord2[0]?.trackingCode, 'SPXVN999');

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error('\n❌ test-shopee-webhook thất bại.');
    process.exit(1);
  }
  console.log('\n✅ WEBHOOK SHOPEE ĐÚNG.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ test-shopee-webhook crash:', err);
  process.exit(1);
});
