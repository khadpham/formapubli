/**
 * scripts/test-shopee-stock-push.ts — đẩy tồn lên sàn, trừ buffer an toàn (Task 6).
 *
 * VÌ SAO CẦN: hết hàng mà sàn vẫn hiện "còn hàng" → khách mua → hủy đơn →
 * Shopee phạt Sao Quả Tạ, mất Shop Yêu Thích. Khóa 3 điều:
 * 1. Số đẩy = tồn Âu Cơ − 2 (buffer giữ bán quầy/POS).
 * 2. Tồn ≤ 2 → đẩy 0 (sàn hiện hết hàng).
 * 3. Ấn bản chưa map item_id sàn → không gọi API (im lặng, không crash).
 *
 * Mạng Shopee MOCK 100% — không internet.
 *
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-shopee-stock-push
 */
import { assertIsolatedTestDb } from './test-guard';
import { eq, and } from 'drizzle-orm';
import { db, editions, shopeeItemMap, stockBalances } from '../src/db';
import { createFakeShopeeFetch } from './shopee-fake-api';
import { pushStockToShopee } from '../src/services/shopee/stock-push';
import { TursoTokenStorage } from '../src/services/shopee/token-store';

assertIsolatedTestDb('test-shopee-stock-push');

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

const SHOP = 777004;
const CFG = {
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
  return rows[0]?.physicalQuantity ?? 0;
}

async function main() {
  const TAG = Date.now().toString(36).toUpperCase();
  await new TursoTokenStorage(SHOP).store({
    access_token: 'acc-stock-test',
    refresh_token: 'ref-stock-test',
    expired_at: Date.now() + 4 * 3600 * 1000,
    shop_id: SHOP,
  });
  const eds = await db.select({ id: editions.id }).from(editions).limit(2);
  eq2('DB test có ít nhất 2 ấn bản', eds.length >= 2, true);
  const [A, B] = eds;

  // Map A với item sàn (upsert để chạy lại an toàn); B cố tình chưa map.
  await db.insert(shopeeItemMap).values({ shopId: SHOP, editionId: A.id, itemId: 1982736451, modelId: 0 })
    .onConflictDoUpdate({
      target: [shopeeItemMap.shopId, shopeeItemMap.editionId],
      set: { itemId: 1982736451, modelId: 0 },
    });
  void TAG;

  const fake = createFakeShopeeFetch({ orders: [] });
  const cfg = { ...CFG, fetchFn: fake.fn };

  // Kỳ vọng tính từ tồn HIỆN TẠI (suite chạy lại trên DB bẩn vẫn đúng).
  const balA = await stockOf(A.id);
  const expectA = Math.max(0, balA - 2);
  const r1 = await pushStockToShopee(cfg, A.id);
  eq2('đẩy tồn A = tồn hiện tại − buffer 2', r1.pushed, expectA);
  eq2('gọi đúng item_id sàn', r1.itemId, 1982736451);
  const stockCalls = fake.calls.filter((c) => c.includes('update_stock'));
  eq2('đã gọi API update_stock', stockCalls.length >= 1, true);

  // B chưa map → không gọi thêm.
  const before = fake.calls.length;
  const r2 = await pushStockToShopee(cfg, B.id);
  eq2('ấn bản chưa map → skipped', r2.skipped, true);
  eq2('không gọi API cho hàng chưa map', fake.calls.length, before);

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error('\n❌ test-shopee-stock-push thất bại.');
    process.exit(1);
  }
  console.log('\n✅ ĐẨY TỒN SHOPEE ĐÚNG.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ test-shopee-stock-push crash:', err);
  process.exit(1);
});
