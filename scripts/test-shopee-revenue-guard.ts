/**
 * scripts/test-shopee-revenue-guard.ts — đơn Shopee chỉ tính doanh thu khi DELIVERED (Task 4).
 *
 * VÌ SAO CẦN: báo cáo đếm mọi `status='COMPLETED'` mà không nhìn shippingStatus.
 * Đơn Shopee vừa đóng gói (CREATED) mà chui vào doanh thu là phồng số — đúng
 * lớp bug "test xanh số sai" từng lọt production 02/10.
 *
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-shopee-revenue-guard
 */
import { randomUUID } from 'node:crypto';
import { assertIsolatedTestDb } from './test-guard';
import { db, orders } from '../src/db';
import { OrderService } from '../src/services/order.service';
import { AnalyticsService } from '../src/services/analytics.service';
import { DailySettlementService } from '../src/services/daily-settlement.service';
import { isCountedRevenue } from '../src/services/shopee/revenue-guard';

assertIsolatedTestDb('test-shopee-revenue-guard');

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

async function seedOrder(opts: {
  code: string;
  channel: string;
  shipping: string;
  amount: number;
}) {
  await db.insert(orders).values({
    id: randomUUID(),
    orderCode: opts.code,
    warehouseId: 'wh-au-co',
    channel: opts.channel,
    customerName: 'Test Guard',
    subtotal: opts.amount,
    finalAmount: opts.amount,
    paymentMethod: 'BANK_TRANSFER',
    status: 'COMPLETED',
    shippingStatus: opts.shipping,
    cashierId: 'test-guard',
    idempotencyKey: `guard-${opts.code}`,
    createdAt: new Date().toISOString(),
  });
}

async function main() {
  // DB chung có đơn SHOPEE của suite khác → đo chênh lệch trước/sau seed,
  // tuyệt đối chính xác và không phụ thuộc thứ tự chạy.
  const beforeSummary = await OrderService.getSalesSummary({ channel: 'SHOPEE' } as any);
  const beforeChannels = await AnalyticsService.byChannel({});
  const beforeShopee = beforeChannels.find((c) => c.channel === 'SHOPEE')?.revenue ?? 0;

  const tag = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
  await seedOrder({ code: `ORD261004G${tag}`, channel: 'FAIR_EVENT', shipping: 'NONE', amount: 100000 });
  await seedOrder({ code: `ORD261004H${tag}`, channel: 'SHOPEE', shipping: 'CREATED', amount: 200000 });
  await seedOrder({ code: `ORD261004K${tag}`, channel: 'SHOPEE', shipping: 'DELIVERED', amount: 300000 });

  // Mức unit của guard.
  eq2('quầy COMPLETED được tính', isCountedRevenue({ channel: 'FAIR_EVENT', shippingStatus: 'NONE' }), true);
  eq2('Shopee CREATED không tính', isCountedRevenue({ channel: 'SHOPEE', shippingStatus: 'CREATED' }), false);
  eq2('Shopee DELIVERED được tính', isCountedRevenue({ channel: 'SHOPEE', shippingStatus: 'DELIVERED' }), true);

  // Mức service: lọc đúng kênh SHOPEE — tuyệt đối chính xác kể cả khi DB
  // chung có đơn của suite khác (không suite nào tạo kênh SHOPEE).
  const summary = await OrderService.getSalesSummary({ channel: 'SHOPEE' } as any);
  eq2('getSalesSummary kênh SHOPEE chỉ tính đơn DELIVERED', summary.totalRevenue - beforeSummary.totalRevenue, 300000);

  const channels = await AnalyticsService.byChannel({});
  const shopee = channels.find((c) => c.channel === 'SHOPEE');
  eq2('byChannel: doanh thu SHOPEE chỉ tính đơn DELIVERED', (shopee?.revenue ?? 0) - beforeShopee, 300000);

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error('\n❌ test-shopee-revenue-guard thất bại.');
    process.exit(1);
  }
  console.log('\n✅ GUARD DOANH THU SHOPEE ĐÚNG.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ test-shopee-revenue-guard crash:', err);
  process.exit(1);
});
