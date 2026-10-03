/**
 * scripts/test-shopee-cod-flag.ts — công tắc COD (Task 9).
 *
 * VÌ SAO CẦN: Anh chốt COD đang TẮT. Đơn COD lọt vào kho khi chưa cho phép là
 * tiền thu hộ không ai theo dõi. Quy tắc: tắt → cách ly có lý do; bật → chạy
 * luồng COD chuẩn (codAmount + codStatus PENDING).
 *
 * Mạng Shopee MOCK 100% — không internet.
 *
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-shopee-cod-flag
 */
import { assertIsolatedTestDb } from './test-guard';
import { eq, and } from 'drizzle-orm';
import { db, editions, stockBalances } from '../src/db';
import { createFakeShopeeFetch } from './shopee-fake-api';
import { pullShopeeOrders } from '../src/services/shopee/order-sync';
import { TursoTokenStorage } from '../src/services/shopee/token-store';

assertIsolatedTestDb('test-shopee-cod-flag');

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

const SHOP = 777007;
const BASE = {
  shopId: SHOP,
  partnerId: 1000,
  partnerKey: 'test-partner-key',
  baseUrl: 'https://partner.test-stable.shopeemobile.com',
  warehouseId: 'wh-au-co',
};

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
    access_token: 'acc-cod-test',
    refresh_token: 'ref-cod-test',
    expired_at: Date.now() + 4 * 3600 * 1000,
    shop_id: SHOP,
  });
  const eds = await db.select({ id: editions.id, isbn: editions.isbn }).from(editions).limit(1);
  eq2('DB test có ít nhất 1 ấn bản', eds.length >= 1, true);
  const E = eds[0];
  const before = await stockOf(E.id);

  const fake = createFakeShopeeFetch({
    orders: [
      {
        order_sn: 'SN-COD-1',
        order_status: 'READY_TO_SHIP',
        payment_method: 'COD',
        recipient: { name: 'Khách COD', phone: '0906', address: 'HN' },
        item_list: [
          { item_sku: E.isbn as string, model_quantity_purchased: 1, model_original_price: 70000, model_discounted_price: 70000 },
        ],
      },
    ],
  });

  // Cờ tắt (mặc định): đơn COD vào cách ly, tồn nguyên.
  const rOff = await pullShopeeOrders({ ...BASE, fetchFn: fake.fn }, 1700000000, 1700086400);
  eq2('cờ tắt → không kéo đơn COD', rOff.pulled, 0);
  eq2('cờ tắt → cách ly có lý do', rOff.quarantined[0]?.reason, 'COD đang tắt — bật cờ mới xử lý');
  eq2('cờ tắt → tồn không đổi', await stockOf(E.id), before);

  // Bật cờ: chạy luồng COD chuẩn.
  const rOn = await pullShopeeOrders({ ...BASE, codEnabled: true, fetchFn: fake.fn }, 1700000000, 1700086400);
  eq2('bật cờ → kéo được đơn COD', rOn.pulled, 1);
  eq2('bật cờ → trừ kho 1', await stockOf(E.id), before - 1);

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error('\n❌ test-shopee-cod-flag thất bại.');
    process.exit(1);
  }
  console.log('\n✅ CÔNG TẮC COD ĐÚNG.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ test-shopee-cod-flag crash:', err);
  process.exit(1);
});
