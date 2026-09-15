/**
 * Lane A — Hồi quy FIX-01/02/03/08/09/10 (DB cách ly).
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-order-guards
 * 7 cases: giáDB / API strip giá / số lẻ / trần CK service /
 * forecast loại gift / két trừ refund / bundle đủ tổng.
 */
import { db } from '../src/db';
import { editions } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { OrderService, CashboxService } from '../src/services/order.service';
import { ReturnService } from '../src/services/return.service';
import { BundleService } from '../src/services/bundle.service';
import { ForecastService } from '../src/services/forecast.service';
import { InventoryService } from '../src/services/inventory.service';
import { POST as postOrder } from '../src/app/api/orders/route';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-order-guards');

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;

async function run() {
  console.log('🛡️ HỒI QUY LANE A (DB cách ly)');
  const seeded = await db.select({ id: editions.id }).from(editions).limit(30);
  const roomy: string[] = [];
  for (const s of seeded) {
    if (roomy.length >= 3) break;
    if ((await InventoryService.getBalance(s.id, 'wh-au-co', 'NEW')) >= 20) roomy.push(s.id);
  }
  if (roomy.length < 3) throw new Error('Không đủ edition tồn dày.');
  const [edA, edB, edC] = roomy;

  let passed = 0;
  const total = 7;
  const ok = (name: string, cond: boolean, extra = '') => {
    if (cond) {
      passed++;
      console.log(`✅ PASS: ${name}${extra ? ` (${extra})` : ''}`);
    } else {
      console.log(`❌ FAIL: ${name}${extra ? ` (${extra})` : ''}`);
    }
  };

  // 1. FIX-01: giá client gửi bị lờ, luôn tính giá bìa DB
  const r1 = await OrderService.createOrder({
    warehouseId: 'wh-au-co', customerName: 'Guard 1', cashierId: 't',
    idempotencyKey: uniq('idem-g'), items: [{ editionId: edA, quantity: 1, unitCoverPrice: 1 }],
  });
  const coverRows = await db.select().from(editions).where(eq(editions.id, edA));
  void coverRows;
  ok('1. FIX-01 service bỏ giá lậu', r1.subtotal > 1 && r1.finalAmount === r1.subtotal, `subtotal=${r1.subtotal}`);

  // 2. FIX-01 API: cashier POST unitCoverPrice:1 → vẫn giá bìa
  const req2 = new Request('http://localhost/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-formapubli-role': 'ROLE_CASHIER', 'x-formapubli-actor': 't' },
    body: JSON.stringify({ warehouseId: 'wh-au-co', items: [{ editionId: edB, quantity: 1, unitCoverPrice: 1 }] }),
  });
  const res2: any = await postOrder(req2 as any);
  const j2 = await res2.json();
  ok('2. FIX-01 API strip giá', res2.status === 200 && j2.success && j2.data.finalAmount > 1, `final=${j2.data?.finalAmount}`);

  // 3. FIX-02: số lẻ + bundle lẻ bị từ chối
  let badQty = 0;
  for (const body of [
    { items: [{ editionId: edA, quantity: 1.5 }] },
    { items: [{ editionId: edA, quantity: 1 }], bundles: [{ bundleId: 'NOPE', quantity: 1.5 }] },
  ]) {
    try {
      await OrderService.createOrder({ warehouseId: 'wh-au-co', customerName: 't', cashierId: 't', idempotencyKey: uniq('idem-g'), ...(body as any) });
    } catch (e: any) {
      if (/nguyên/.test(e.message)) badQty++;
    }
  }
  ok('3. FIX-02 chặn số lượng lẻ', badQty === 2);

  // 4. FIX-03: trần CK tầng service
  let badDisc = 0;
  for (const body of [
    { items: [{ editionId: edA, quantity: 1, unitDiscountRate: 2 }] },
    { discountRate: 1.5, items: [{ editionId: edA, quantity: 1 }] },
    { discountRate: -0.2, items: [{ editionId: edA, quantity: 1 }] },
  ]) {
    try {
      await OrderService.createOrder({ warehouseId: 'wh-au-co', customerName: 't', cashierId: 't', idempotencyKey: uniq('idem-g'), ...(body as any) });
    } catch (e: any) {
      if (/0 - 100%/.test(e.message)) badDisc++;
    }
  }
  ok('4. FIX-03 chặn CK vượt 100%/âm', badDisc === 3);

  // 5. FIX-08: gift không vào velocity
  const base = (await ForecastService.salesByEdition()).get(edC) || 0;
  await OrderService.createOrder({
    warehouseId: 'wh-au-co', customerName: 't', cashierId: 't', idempotencyKey: uniq('idem-g'),
    items: [{ editionId: edC, quantity: 2 }],
  });
  await OrderService.createOrder({
    warehouseId: 'wh-au-co', customerName: 't', cashierId: 't', discountRate: 1,
    isGift: true, giftReason: 'guard', idempotencyKey: uniq('idem-g'),
    items: [{ editionId: edC, quantity: 3 }],
  });
  const after = (await ForecastService.salesByEdition()).get(edC) || 0;
  ok('5. FIX-08 gift loại khỏi forecast', after === base + 2, `${base}→${after}`);

  // 6. FIX-09: két trừ tiền hoàn
  const sess = await CashboxService.openSession({ warehouseId: 'wh-au-co', cashierId: `guard-${Date.now()}`, openingCash: 0 });
  const sale = await OrderService.createOrder({
    warehouseId: 'wh-au-co', customerName: 't', paymentMethod: 'CASH', cashierId: 't',
    cashboxSessionId: sess.session.id, idempotencyKey: uniq('idem-g'),
    items: [{ editionId: edA, quantity: 1 }],
  });
  const ret = await ReturnService.createRequest({
    orderId: sale.orderId, returnType: 'REFUND', reason: 'WRONG_ITEM', targetWarehouseId: 'wh-au-co',
    inventoryDisposition: 'RESTOCK', refundAmount: sale.finalAmount, cashboxSessionId: sess.session.id,
    createdBy: 't', actorRole: 'ROLE_CASHIER', idempotencyKey: uniq('idem-g'),
    items: [{ editionId: edA, quantity: 1 }],
  });
  await ReturnService.approve(ret.returnId, 'ROLE_MANAGER', 'm');
  await ReturnService.complete(ret.returnId, 'ROLE_MANAGER');
  const stats: any = await CashboxService.calculateSessionStats(sess.session.id);
  ok('6. FIX-09 két net = bán − hoàn', stats.totalCashSales === 0 && stats.totalRefunds === sale.finalAmount, `net=${stats.totalCashSales}`);

  // 7. FIX-10: bundle req>1 tổng khớp comboPrice
  const bun = await BundleService.createBundle({
    code: `GUARD-${Date.now()}`, seasonName: 'Guard', releaseDate: '2026-09-15', comboPrice: 300000,
    items: [{ editionId: edA, quantityInBundle: 2 }, { editionId: edB, quantityInBundle: 1 }],
  });
  const lines1 = await BundleService.priceLines(bun.bundleId, 1);
  const lines2 = await BundleService.priceLines(bun.bundleId, 2);
  const sum1 = lines1.reduce((s, l) => s + l.totalAmount, 0);
  const sum2 = lines2.reduce((s, l) => s + l.totalAmount, 0);
  ok('7. FIX-10 bundle đủ tổng mọi số bộ', sum1 === 300000 && sum2 === 600000, `${sum1}/${sum2}`);

  console.log(`\n${passed === total ? '🎉' : '⚠️'} ORDER GUARDS: ${passed}/${total} cases ${passed === total ? 'PASS 100%' : 'CÓ FAIL'}`);
  if (passed !== total) process.exit(1);
}

run().catch((err) => {
  console.error('❌ test-order-guards thất bại:', err);
  process.exit(1);
});
