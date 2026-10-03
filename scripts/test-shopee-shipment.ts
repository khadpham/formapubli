/**
 * scripts/test-shopee-shipment.ts — giao hàng Shopee + in vận đơn A6 (Task 5).
 *
 * VÌ SAO CẦN: bấm "giao" nhầm đơn chưa đóng gói, hoặc thu ngân bấm được nút
 * của thủ kho, là mất kiểm soát kho. Khóa 3 điều:
 * 1. Chỉ đơn CREATED mới ship được (không ship đơn đã giao/hủy).
 * 2. Chỉ thủ kho + cấp trên (WAREHOUSE/MANAGER/OWNER) được bấm.
 * 3. Vận đơn A6 trả về đúng mã tracking của đơn.
 *
 * Mạng Shopee MOCK 100% — không internet.
 *
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-shopee-shipment
 */
import { randomUUID } from 'node:crypto';
import { assertIsolatedTestDb } from './test-guard';
import { eq } from 'drizzle-orm';
import { db, orders } from '../src/db';
import { AppError } from '../src/services/app-error';
import { createFakeShopeeFetch } from './shopee-fake-api';
import { getShippingParameter, shipShopeeOrder, getAwbPdf } from '../src/services/shopee/shipment';

assertIsolatedTestDb('test-shopee-shipment');

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

const SHOP = 777003;
const CFG = {
  shopId: SHOP,
  partnerId: 1000,
  partnerKey: 'test-partner-key',
  baseUrl: 'https://partner.test-stable.shopeemobile.com',
  warehouseId: 'wh-au-co',
};

async function seedShopeeOrder(sn: string, shipping: string) {
  const id = randomUUID();
  await db.insert(orders).values({
    id,
    orderCode: `ORD261004S${sn.slice(-3)}`,
    warehouseId: 'wh-au-co',
    channel: 'SHOPEE',
    customerName: 'Test Ship',
    subtotal: 100000,
    finalAmount: 100000,
    paymentMethod: 'BANK_TRANSFER',
    status: 'COMPLETED',
    shippingStatus: shipping,
    carrier: 'SPX',
    cashierId: 'test-ship',
    idempotencyKey: `shopee-${sn}`,
    createdAt: new Date().toISOString(),
  });
  return id;
}

async function main() {
  await new (await import('../src/services/shopee/token-store')).TursoTokenStorage(SHOP).store({
    access_token: 'acc-ship-test',
    refresh_token: 'ref-ship-test',
    expired_at: Date.now() + 4 * 3600 * 1000,
    shop_id: SHOP,
  });
  await seedShopeeOrder('SN-SHIP-1', 'CREATED');

  const fake = createFakeShopeeFetch({ orders: [] });
  const cfg = { ...CFG, fetchFn: fake.fn };

  // 1. Lấy tham số giao hàng.
  const param = await getShippingParameter(cfg, 'SN-SHIP-1');
  eq2('shipper tới lấy (pickup)', param.mode, 'pickup');
  eq2('có địa chỉ lấy hàng', param.addressId, 998877);

  // 2. Thu ngân KHÔNG được bấm giao.
  let code = '';
  try {
    await shipShopeeOrder(cfg, 'SN-SHIP-1', 'ROLE_CASHIER', 'cashier-1');
  } catch (e) {
    code = e instanceof AppError ? e.code : `NOT_APP_ERROR:${String(e)}`;
  }
  eq2('thu ngân bị chặn bấm giao', code, 'FORBIDDEN');

  // 3. Thủ kho bấm giao: trạng thái + tracking cập nhật.
  const shipped = await shipShopeeOrder(cfg, 'SN-SHIP-1', 'ROLE_WAREHOUSE', 'keeper-1');
  eq2('tracking khớp mã fake', shipped.trackingCode, 'SPXVN0123456789');
  const row = await db.select().from(orders).where(eq(orders.idempotencyKey, 'shopee-SN-SHIP-1')).limit(1);
  eq2('shipping chuyển PICKED_UP', row[0]?.shippingStatus, 'PICKED_UP');
  eq2('carrier lưu SPX', row[0]?.carrier, 'SPX');

  // 4. Ship lại đơn đã giao → từ chối (không gọi API lần 2).
  let code2 = '';
  try {
    await shipShopeeOrder(cfg, 'SN-SHIP-1', 'ROLE_WAREHOUSE', 'keeper-1');
  } catch (e) {
    code2 = e instanceof AppError ? e.code : `NOT_APP_ERROR:${String(e)}`;
  }
  eq2('đơn đã giao không ship lại', code2, 'STATE_CONFLICT');

  // 5. Vận đơn A6 đúng tracking.
  const pdf = await getAwbPdf(cfg, 'SN-SHIP-1');
  eq2('vận đơn có nội dung', pdf.byteLength > 0, true);
  eq2('vận đơn ghi đúng tracking', Buffer.from(pdf).toString('utf-8').includes('SPXVN0123456789'), true);

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error('\n❌ test-shopee-shipment thất bại.');
    process.exit(1);
  }
  console.log('\n✅ GIAO HÀNG + VẬN ĐƠN SHOPEE ĐÚNG.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ test-shopee-shipment crash:', err);
  process.exit(1);
});
