/**
 * scripts/test-shopee-order-pull.ts — kéo đơn Shopee + trừ kho Âu Cơ (Task 3).
 *
 * VÌ SAO CẦN: đơn Shopee về mà trừ nhầm kho / trừ 2 lần / trừ sách không khớp
 * SKU là mất tiền thật + Shopee phạt Sao Quả Tạ. Test này khóa 4 bất biến:
 * 1. SKU khớp ISBN mới trừ kho; SKU lạ → cách ly, không crash, không trừ.
 * 2. Kéo lại cùng đơn → bỏ qua (idempotency `shopee-+order_sn`).
 * 3. Trả trước → BANK_TRANSFER, COD → COD (+codAmount).
 * 4. Ledger và balance song hành (bài học 02/10: nạp tồn phải ghi cả ledger).
 *
 * Mạng Shopee MOCK 100% qua scripts/shopee-fake-api.ts — không internet.
 *
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-shopee-order-pull
 */
import { assertIsolatedTestDb } from './test-guard';
import { eq, and } from 'drizzle-orm';
import { db } from '../src/db';
import { editions, orders, orderItems, inventoryLedger, stockBalances } from '../src/db/schema';
import { createFakeShopeeFetch } from './shopee-fake-api';
import { pullShopeeOrders } from '../src/services/shopee/order-sync';
import { TursoTokenStorage } from '../src/services/shopee/token-store';

assertIsolatedTestDb('test-shopee-order-pull');

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

const SHOP = 777002;
const WAREHOUSE = 'wh-au-co';
const CFG = {
  shopId: SHOP,
  partnerId: 1000,
  partnerKey: 'test-partner-key',
  baseUrl: 'https://partner.test-stable.shopeemobile.com',
  warehouseId: WAREHOUSE,
};

async function stockOf(editionId: string): Promise<number> {
  const rows = await db
    .select()
    .from(stockBalances)
    .where(
      and(eq(stockBalances.productId, editionId), eq(stockBalances.warehouseId, WAREHOUSE))
    )
    .limit(1);
  return rows[0]?.physicalQuantity ?? -999;
}

async function main() {
  // Seed token còn hạn để luồng sync không phải refresh.
  await new TursoTokenStorage(SHOP).store({
    access_token: 'acc-sync-test',
    refresh_token: 'ref-sync-test',
    expired_at: Date.now() + 4 * 3600 * 1000,
    shop_id: SHOP,
  });

  // Lấy 2 ấn bản thật trong DB test (không ghi cứng mã).
  const eds = await db.select({ id: editions.id, isbn: editions.isbn }).from(editions).limit(2);
  eq2('DB test có ít nhất 2 ấn bản', eds.length >= 2, true);
  const [A, B] = eds;
  const skuA = A.isbn as string;
  const skuB = B.isbn as string;
  const beforeA = await stockOf(A.id);
  const beforeB = await stockOf(B.id);

  const fake = createFakeShopeeFetch({
    orders: [
      {
        order_sn: 'SN-READY-1',
        order_status: 'READY_TO_SHIP',
        payment_method: 'PREPAID',
        recipient: { name: 'Khách Một', phone: '0901', address: 'Hà Nội' },
        item_list: [
          { item_sku: skuA, model_quantity_purchased: 2, model_original_price: 100000, model_discounted_price: 90000 },
          { item_sku: skuB, model_quantity_purchased: 1, model_original_price: 50000, model_discounted_price: 50000 },
        ],
      },
      {
        order_sn: 'SN-READY-2',
        order_status: 'READY_TO_SHIP',
        payment_method: 'COD',
        recipient: { name: 'Khách Hai', phone: '0902', address: 'Huế' },
        item_list: [
          { item_sku: skuB, model_quantity_purchased: 3, model_original_price: 50000, model_discounted_price: 45000 },
        ],
      },
      {
        order_sn: 'SN-WEIRD-1',
        order_status: 'READY_TO_SHIP',
        payment_method: 'PREPAID',
        recipient: { name: 'Khách Lạ', phone: '0903', address: 'Đà Nẵng' },
        item_list: [
          { item_sku: 'ISBN-KHONG-TON-TAI-0000', model_quantity_purchased: 1, model_original_price: 10000, model_discounted_price: 10000 },
        ],
      },
      {
        order_sn: 'SN-UNPAID-1',
        order_status: 'UNPAID',
        payment_method: 'PREPAID',
        recipient: { name: 'Khách Treo', phone: '0904', address: 'SG' },
        item_list: [
          { item_sku: skuA, model_quantity_purchased: 1, model_original_price: 100000, model_discounted_price: 100000 },
        ],
      },
    ],
  });

  const r1 = await pullShopeeOrders({ ...CFG, fetchFn: fake.fn }, 1700000000, 1700086400);
  eq2('kéo được 2 đơn hợp lệ', r1.pulled, 2);
  eq2('1 đơn SKU lạ vào cách ly', r1.quarantined.length, 1);
  eq2('ghi đúng mã đơn lạ', r1.quarantined[0]?.orderSn, 'SN-WEIRD-1');

  // Tồn trừ đúng tại Âu Cơ.
  eq2('sách A trừ 2', await stockOf(A.id), beforeA - 2);
  eq2('sách B trừ 1+3', await stockOf(B.id), beforeB - 4);

  // Đơn lưu đúng kênh + thanh toán.
  const o1 = await db.select().from(orders).where(eq(orders.idempotencyKey, 'shopee-SN-READY-1')).limit(1);
  eq2('đơn 1 kênh SHOPEE', o1[0]?.channel, 'SHOPEE');
  eq2('đơn trả trước → BANK_TRANSFER', o1[0]?.paymentMethod, 'BANK_TRANSFER');
  eq2('đơn trả trước shipping CREATED', o1[0]?.shippingStatus, 'CREATED');
  const o2 = await db.select().from(orders).where(eq(orders.idempotencyKey, 'shopee-SN-READY-2')).limit(1);
  eq2('đơn COD → COD', o2[0]?.paymentMethod, 'COD');
  eq2('đơn COD có codAmount', o2[0]?.codAmount, 3 * 45000);
  eq2('đơn COD codStatus PENDING', o2[0]?.codStatus, 'PENDING');

  // Ledger DISPATCH_SALE song hành.
  const led = await db
    .select()
    .from(inventoryLedger)
    .where(eq(inventoryLedger.documentRef, 'SHOPEE_SN-READY-1'));
  eq2('có bút toán DISPATCH_SALE đơn 1', led.length > 0, true);
  eq2(
    'tổng xuất đơn 1 = 3 cuốn',
    led.reduce((s, r) => s + (r.quantityDelta as number), 0),
    -3
  );

  // Kéo lại: idempotent tuyệt đối.
  const r2 = await pullShopeeOrders({ ...CFG, fetchFn: fake.fn }, 1700000000, 1700086400);
  eq2('kéo lại không tạo thêm đơn', r2.pulled, 0);
  eq2('kéo lại tồn A không đổi', await stockOf(A.id), beforeA - 2);

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error('\n❌ test-shopee-order-pull thất bại.');
    process.exit(1);
  }
  console.log('\n✅ KÉO ĐƠN SHOPEE + TRỪ KHO ĐÚNG.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ test-shopee-order-pull crash:', err);
  process.exit(1);
});
