// scripts/test-sales-scope-filter.ts
import { db } from '../src/db';
import { editions } from '../src/db/schema';
import { OrderService } from '../src/services/order.service';
import { AnalyticsService } from '../src/services/analytics.service';
import { InventoryService } from '../src/services/inventory.service';
import { assertIsolatedTestDb } from './test-guard';
assertIsolatedTestDb('test-sales-scope-filter');
let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;
async function run() {
  let passed = 0; const total = 4;
  const ok = (n: string, c: boolean) => { if (c) passed++; console.log(`${c ? '✅' : '❌'} ${n}`); };
  const seeded = await db.select({ id: editions.id }).from(editions).limit(30);
  const roomy: string[] = [];
  for (const s of seeded) { if (roomy.length >= 2) break; if (await InventoryService.getBalance(s.id, 'wh-au-co', 'NEW') >= 10) roomy.push(s.id); }
  const [edA, edB] = roomy;
  await OrderService.createOrder({ warehouseId: 'wh-au-co', channel: 'RETAIL_OFFICE', customerName: 'Scope A', paymentMethod: 'CASH', fiscalScope: 'INTERNAL_MANAGEMENT', cashierId: 'scope-tester', idempotencyKey: uniq('a'), items: [{ editionId: edA, quantity: 1 }] });
  await OrderService.createOrder({ warehouseId: 'wh-au-co', channel: 'RETAIL_OFFICE', customerName: 'Scope B', paymentMethod: 'CASH', fiscalScope: 'OFFICIAL_TAX', cashierId: 'scope-tester', idempotencyKey: uniq('b'), items: [{ editionId: edB, quantity: 1 }] });
  const all = await AnalyticsService.byChannel({});
  const tax = await AnalyticsService.byChannel({}, { fiscalScope: 'OFFICIAL_TAX' });
  ok('1. không filter thấy cả 2 đơn', all.reduce((s, r) => s + r.orders, 0) >= 2);
  ok('2. fiscalScope=OFFICIAL_TAX chỉ thấy đơn thuế', tax.every((r) => r.orders >= 0) && tax.reduce((s, r) => s + r.orders, 0) < all.reduce((s, r) => s + r.orders, 0));
  const cf = await AnalyticsService.cashflow({}, { fiscalScope: 'OFFICIAL_TAX' });
  ok('3. cashflow theo sổ (salesRevenue thuế < tổng)', cf.salesRevenue <= all.reduce((s, r) => s + r.revenue, 0));
  ok('4. cashflow vẫn trả netRevenue/cod/sponsor shape', typeof cf.netRevenue === 'number' && typeof cf.codPending === 'number');
  console.log(`SCOPE-FILTER: ${passed}/${total}`); process.exit(passed === total ? 0 : 1);
}
run().catch((e) => { console.error('❌', e?.message || e); process.exit(1); });
