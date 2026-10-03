/**
 * scripts/test-shopee-escrow.ts — đối soát escrow về tab Chủ (Task 8).
 *
 * VÌ SAO CẦN: tiền Shopee giữ khác tiền khách trả (trừ phí sàn). Không bóc
 * phí thì tab Chủ tưởng lãi to. Khóa 3 điều:
 * 1. Chỉ đơn DELIVERED mới đối soát (chưa giao → từ chối).
 * 2. Phí bóc đúng từng loại theo tên trường thật của Shopee.
 * 3. netProfit = escrow − COGS (giá vốn products.cost_price); thiếu giá vốn
 *    → null trung thực, không bịa số 0.
 *
 * Mạng Shopee MOCK 100% — không internet.
 *
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-shopee-escrow
 */
import { randomUUID } from 'node:crypto';
import { assertIsolatedTestDb } from './test-guard';
import { eq } from 'drizzle-orm';
import { db, editions, orders, orderItems, products, shopeeOrderFinance } from '../src/db';
import { AppError } from '../src/services/app-error';
import { createFakeShopeeFetch } from './shopee-fake-api';
import { syncEscrow } from '../src/services/shopee/escrow-sync';
import { TursoTokenStorage } from '../src/services/shopee/token-store';

assertIsolatedTestDb('test-shopee-escrow');

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

const SHOP = 777006;
const CFG = {
  shopId: SHOP,
  partnerId: 1000,
  partnerKey: 'test-partner-key',
  baseUrl: 'https://partner.test-stable.shopeemobile.com',
  warehouseId: 'wh-au-co',
};

async function seedDeliveredShopeeOrder(): Promise<{ editionId: string }> {
  const eds = await db.select({ id: editions.id }).from(editions).limit(1);
  const editionId = eds[0].id;
  // Giá vốn 60k cho cuốn giá bìa 96k.
  await db.update(products).set({ costPrice: 60000 }).where(eq(products.id, editionId));
  const orderId = randomUUID();
  await db.insert(orders).values({
    id: orderId,
    orderCode: 'ORD261004E001',
    warehouseId: 'wh-au-co',
    channel: 'SHOPEE',
    customerName: 'Test Escrow',
    subtotal: 192000,
    finalAmount: 192000,
    paymentMethod: 'BANK_TRANSFER',
    status: 'COMPLETED',
    shippingStatus: 'DELIVERED',
    cashierId: 'test-escrow',
    idempotencyKey: 'shopee-SN-ESCROW-1',
    createdAt: new Date().toISOString(),
  });
  await db.insert(orderItems).values({
    id: randomUUID(),
    orderId,
    editionId,
    productId: editionId,
    quantity: 2,
    unitCoverPrice: 120000,
    unitDiscountRate: 0.2,
    unitSellingPrice: 96000,
    totalAmount: 192000,
  });
  return { editionId };
}

async function main() {
  await new TursoTokenStorage(SHOP).store({
    access_token: 'acc-escrow-test',
    refresh_token: 'ref-escrow-test',
    expired_at: Date.now() + 4 * 3600 * 1000,
    shop_id: SHOP,
  });
  await seedDeliveredShopeeOrder();

  const fake = createFakeShopeeFetch({ orders: [] });
  const cfg = { ...CFG, fetchFn: fake.fn };

  const r = await syncEscrow(cfg, 'SN-ESCROW-1');
  eq2('tiền khách trả', r.buyerTotal, 192000);
  eq2('tiền thực về', r.escrowAmount, 179360);
  eq2('phí hoa hồng', r.commissionFee, 15360);
  eq2('phí thanh toán', r.transactionFee, 7680);
  eq2('phí dịch vụ', r.serviceFee, 9600);
  eq2('COGS 2 cuốn × 60k', r.cogs, 120000);
  eq2('lợi nhuận ròng = 179360 − 120000', r.netProfit, 59360);

  const rows = await db
    .select()
    .from(shopeeOrderFinance)
    .where(eq(shopeeOrderFinance.orderSn, 'SN-ESCROW-1'))
    .limit(1);
  eq2('lưu bảng đối soát', rows.length, 1);
  eq2('bảng ghi đúng escrow', rows[0]?.escrowAmount, 179360);

  // Đơn chưa giao → từ chối đối soát.
  await db.insert(orders).values({
    id: randomUUID(),
    orderCode: 'ORD261004E002',
    warehouseId: 'wh-au-co',
    channel: 'SHOPEE',
    customerName: 'Test Escrow 2',
    subtotal: 50000,
    finalAmount: 50000,
    paymentMethod: 'BANK_TRANSFER',
    status: 'COMPLETED',
    shippingStatus: 'CREATED',
    cashierId: 'test-escrow',
    idempotencyKey: 'shopee-SN-ESCROW-2',
    createdAt: new Date().toISOString(),
  });
  let code = '';
  try {
    await syncEscrow(cfg, 'SN-ESCROW-2');
  } catch (e) {
    code = e instanceof AppError ? e.code : `NOT_APP_ERROR:${String(e)}`;
  }
  eq2('đơn chưa giao bị từ chối', code, 'INVALID_INPUT');

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error('\n❌ test-shopee-escrow thất bại.');
    process.exit(1);
  }
  console.log('\n✅ ĐỐI SOÁT ESCROW ĐÚNG.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ test-shopee-escrow crash:', err);
  process.exit(1);
});
