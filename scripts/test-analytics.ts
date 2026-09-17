/**
 * Bước 5 — Kiểm thử OLAP Analytics read-only (DB cách ly).
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-analytics
 * 7 cases: channels / date-range / trending / cashflow COD /
 * sponsorship trong cashflow / consignment shape / read-only (không ledger mới).
 */
import { db, inventoryLedger } from '../src/db';
import { editions } from '../src/db/schema';
import { OrderService } from '../src/services/order.service';
import { ShipmentService } from '../src/services/shipment.service';
import { SponsorshipService } from '../src/services/sponsorship.service';
import { AnalyticsService } from '../src/services/analytics.service';
import { InventoryService } from '../src/services/inventory.service';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-analytics');

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;

async function run() {
  console.log('📊 KIỂM THỬ OLAP ANALYTICS (DB cách ly)');
  const seeded = await db.select({ id: editions.id }).from(editions).limit(30);
  const roomy: string[] = [];
  for (const s of seeded) {
    if (roomy.length >= 2) break;
    if ((await InventoryService.getBalance(s.id, 'wh-au-co', 'NEW')) >= 20) roomy.push(s.id);
  }
  if (roomy.length < 2) throw new Error('Không đủ edition tồn dày.');
  const [edA, edB] = roomy;

  let passed = 0;
  const total = 8;
  const ok = (name: string, cond: boolean, extra = '') => {
    if (cond) {
      passed++;
      console.log(`✅ PASS: ${name}${extra ? ` (${extra})` : ''}`);
    } else {
      console.log(`❌ FAIL: ${name}${extra ? ` (${extra})` : ''}`);
    }
  };

  // Đơn kênh web (COD) + quầy để băm
  const web = await OrderService.createOrder({
    warehouseId: 'wh-au-co', channel: 'RETAIL_ONLINE_WEB', customerName: `OLAP Web ${seq}`,
    paymentMethod: 'COD', cashierId: 'webhook', idempotencyKey: uniq('idem-olap'),
    items: [{ editionId: edA, quantity: 2 }],
  });
  await OrderService.createOrder({
    warehouseId: 'wh-au-co', channel: 'FAIR_EVENT', customerName: `OLAP Fair ${seq}`,
    paymentMethod: 'CASH', cashierId: 'cashier-1', idempotencyKey: uniq('idem-olap'),
    items: [{ editionId: edB, quantity: 1 }],
  });
  await ShipmentService.push(web.orderId, 'SPX', `OLAP${Date.now()}`, 0, 'ROLE_MANAGER');

  // 1. Channels: có dòng web + fair, revenue web > 0
  const ch = await AnalyticsService.byChannel({});
  const webRow = ch.find((c) => c.channel === 'RETAIL_ONLINE_WEB');
  const fairRow = ch.find((c) => c.channel === 'FAIR_EVENT');
  ok('1. Băm doanh thu theo kênh', !!webRow && webRow.revenue > 0 && !!fairRow && fairRow.revenue > 0, `kênh=${ch.length}`);

  // 2. Date-range tương lai rỗng (không copy tay, lọc tức thời)
  const future = await AnalyticsService.byChannel({ startDate: '2999-01-01' });
  ok('2. Lọc ngày tức thời', future.every((c) => c.revenue === 0 && c.orders === 0));

  // 3. Trending chứa edA vừa bán
  const trend = await AnalyticsService.trending(20);
  const hitA = trend.find((t) => t.editionId === edA);
  ok('3. Trending bắt sách vừa bán', !!hitA && hitA.qtyThisWeek >= 2, `edA tuần này=${hitA?.qtyThisWeek}`);

  // 4. Cashflow: COD pending = final đơn web
  const cf = await AnalyticsService.cashflow({});
  ok('4. COD phải thu lên ma trận', cf.codPending >= (web as any).finalAmount && (web as any).finalAmount > 0, `pending=${cf.codPending}`);
  // P2-12: giao xong mới được tất toán
  await ShipmentService.updateStatus(web.orderId, 'PICKED_UP', 'ROLE_MANAGER');
  await ShipmentService.updateStatus(web.orderId, 'IN_TRANSIT', 'ROLE_MANAGER');
  await ShipmentService.updateStatus(web.orderId, 'DELIVERED', 'ROLE_MANAGER');
  await ShipmentService.settleCod(web.orderId, 'ROLE_MANAGER', 'NH-OLAP');
  const cf2 = await AnalyticsService.cashflow({});
  ok('4b. Tất toán COD chuyển sang đã về', cf2.codReceived >= (web as any).finalAmount);

  // 5. Sponsorship hiện trong cashflow
  const fund = await SponsorshipService.createFund({
    sponsorName: 'OLAP Sponsor', amountReceived: 2000000, quotaType: 'OPEN',
    createdBy: 'owner-1', actorRole: 'ROLE_OWNER',
  });
  await SponsorshipService.draw({
    fundId: fund.fundId, editionId: edB, warehouseId: 'wh-au-co', quantity: 1,
    drawnBy: 'staff-1', actorRole: 'ROLE_MANAGER', idempotencyKey: uniq('idem-spf'),
  });
  const cf3 = await AnalyticsService.cashflow({});
  ok('5. Tài trợ đã rút lên cashflow', cf3.sponsorshipDrawnQty >= 1 && cf3.sponsorshipDrawnValue > 0);

  // 6. Consignment trả đúng shape (mảng, có heldQty/heldValue/soldQty)
  const cons = await AnalyticsService.consignment({});
  ok('6. Báo cáo ký gửi đa điểm', Array.isArray(cons) && cons.every((c) => typeof c.heldQty === 'number' && typeof c.heldValue === 'number'), `điểm=${cons.length}`);

  // 7. Read-only: analytics không sinh bút toán
  const ledBefore = (await db.select().from(inventoryLedger)).length;
  await AnalyticsService.byChannel({});
  await AnalyticsService.trending(5);
  await AnalyticsService.consignment({});
  await AnalyticsService.cashflow({});
  const ledAfter = (await db.select().from(inventoryLedger)).length;
  ok('7. Analytics thuần đọc', ledAfter === ledBefore);

  console.log(`\n${passed === total ? '🎉' : '⚠️'} ANALYTICS: ${passed}/${total} cases ${passed === total ? 'PASS 100%' : 'CÓ FAIL'}`);
  if (passed !== total) process.exit(1);
}

run().catch((err) => {
  console.error('❌ test-analytics thất bại:', err);
  process.exit(1);
});
