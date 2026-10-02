// scripts/test-sales-scope-filter.ts
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { db } from '../src/db';
import { editions, warehouses, stockBalances, returnOrders } from '../src/db/schema';
import { OrderService } from '../src/services/order.service';
import { AnalyticsService } from '../src/services/analytics.service';
import { InventoryService } from '../src/services/inventory.service';
import { ShipmentService } from '../src/services/shipment.service';
import { assertIsolatedTestDb } from './test-guard';
assertIsolatedTestDb('test-sales-scope-filter');
let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;
// SQL gốc: đọc thẳng libsql để so sánh với kết quả service (bằng chứng tầng
// dữ liệu, không phải regex mã nguồn).
const raw = createClient({ url: process.env.DATABASE_URL! });
const q1 = async (sqlText: string): Promise<number> => Number((await raw.execute(sqlText)).rows[0].n);
async function run() {
  let passed = 0; const total = 7;
  // `detail` tùy chọn: in số thật để khi đỏ nhìn thấy ngay lệch bao nhiêu.
  const ok = (n: string, c: boolean, detail = '') => {
    if (c) passed++;
    console.log(`${c ? '✅' : '❌'} ${n}${detail ? ` — ${detail}` : ''}`);
  };
  const seeded = await db.select({ id: editions.id }).from(editions).limit(30);
  const roomy: string[] = [];
  for (const s of seeded) { if (roomy.length >= 2) break; if (await InventoryService.getBalance(s.id, 'wh-au-co', 'NEW') >= 10) roomy.push(s.id); }
  const [edA, edB] = roomy;
  const ordA = await OrderService.createOrder({ warehouseId: 'wh-au-co', channel: 'RETAIL_OFFICE', customerName: 'Scope A', paymentMethod: 'CASH', fiscalScope: 'INTERNAL_MANAGEMENT', cashierId: 'scope-tester', idempotencyKey: uniq('a'), items: [{ editionId: edA, quantity: 1 }] });
  await OrderService.createOrder({ warehouseId: 'wh-au-co', channel: 'RETAIL_OFFICE', customerName: 'Scope B', paymentMethod: 'CASH', fiscalScope: 'OFFICIAL_TAX', cashierId: 'scope-tester', idempotencyKey: uniq('b'), items: [{ editionId: edB, quantity: 1 }] });
  // Đơn thứ 3 ở KHO KHÁC: seed chỉ nạp tồn mở đầu 50/ấn bản tại Âu Cơ, nên phải
  // tự nạp tồn cho kho thứ hai trước khi bán (OrderService chặn bán quá ATP).
  const WH2 = 'wh-quynh-mai';
  // `wh-quynh-mai` đã có sẵn trong seed 3 kho vật lý — không tạo kho mới.
  const wh2Row = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.id, WH2)).limit(1);
  if (wh2Row.length === 0) throw new Error(`Thiếu kho ${WH2} trong DB test — không đổi sang tự seed.`);
  await db.insert(stockBalances).values({
    id: `scope-sb-${WH2}-${edA}`, productId: edA, editionId: edA,
    warehouseId: WH2, condition: 'NEW', physicalQuantity: 5,
  }).onConflictDoNothing();
  const ordC = await OrderService.createOrder({ warehouseId: WH2, channel: 'RETAIL_ONLINE_WEB', customerName: 'Scope C', paymentMethod: 'COD', fiscalScope: 'OFFICIAL_TAX', cashierId: 'scope-tester', idempotencyKey: uniq('c'), items: [{ editionId: edA, quantity: 1 }] });
  // COD chỉ có `cod_amount`/`cod_status = PENDING` SAU khi đẩy vận chuyển
  // (ShipmentService.push, shipment.service.ts:46-53). Bỏ bước này thì
  // codPending = 0 và assertion 6 xanh một cách giả.
  await ShipmentService.push(ordC.orderId, 'SPX', `SCOPE${Date.now() % 100000}`, 0, 'ROLE_OWNER');
  const all = await AnalyticsService.byChannel({});
  const tax = await AnalyticsService.byChannel({}, { fiscalScope: 'OFFICIAL_TAX' });
  ok('1. không filter thấy cả 2 đơn', all.reduce((s, r) => s + r.orders, 0) >= 2);
  ok('2. fiscalScope=OFFICIAL_TAX chỉ thấy đơn thuế', tax.every((r) => r.orders >= 0) && tax.reduce((s, r) => s + r.orders, 0) < all.reduce((s, r) => s + r.orders, 0));
  const cf = await AnalyticsService.cashflow({}, { fiscalScope: 'OFFICIAL_TAX' });
  ok('3. cashflow theo sổ (salesRevenue thuế < tổng)', cf.salesRevenue <= all.reduce((s, r) => s + r.revenue, 0));
  ok('4. cashflow vẫn trả netRevenue/cod/sponsor shape', typeof cf.netRevenue === 'number' && typeof cf.codPending === 'number');
  // 5. Lọc KHO: chỉ thấy đơn của kho đang xem, đơn kho khác phải biến mất.
  //    So sánh với SQL gốc (không chỉ "< tổng") để bắt được cả lỗi lọc quá mức.
  const whAuCo = await AnalyticsService.byChannel({}, { warehouseId: 'wh-au-co' });
  const whOther = await AnalyticsService.byChannel({}, { warehouseId: WH2 });
  const nAuCo = whAuCo.reduce((s, r) => s + r.orders, 0);
  const nOther = whOther.reduce((s, r) => s + r.orders, 0);
  const nAll = all.reduce((s, r) => s + r.orders, 0);
  const rows = await raw.execute(
    `SELECT warehouse_id w, COUNT(*) n FROM orders WHERE status='COMPLETED'
      AND (warehouse_id='wh-au-co' OR warehouse_id='${WH2}') GROUP BY warehouse_id`
  );
  const truth: Record<string, number> = {};
  for (const r of rows.rows) truth[String((r as any).w)] = Number((r as any).n);
  ok(
    '5. byChannel lọc theo kho: đúng số đơn từng kho (SQL gốc), không lẫn kho',
    nAuCo === (truth['wh-au-co'] ?? 0) && nOther === (truth[WH2] ?? 0) &&
      nAuCo + nOther <= nAll && nOther > 0,
    `Âu Cơ=${nAuCo} (SQL ${truth['wh-au-co'] ?? 0}), ${WH2}=${nOther} (SQL ${truth[WH2] ?? 0}), tổng không filter=${nAll}`
  );
  // 6. COD cũng theo kho: kho lạ (không có đơn) ⇒ không có COD phải thu.
  const cfWh2 = await AnalyticsService.cashflow({}, { warehouseId: WH2 });
  const cfGhost = await AnalyticsService.cashflow({}, { warehouseId: 'wh-khong-ton-tai' });
  ok(
    '6. cashflow lọc COD theo kho: kho thật thấy COD, kho không tồn tại trả 0',
    cfWh2.codPending > 0 && cfGhost.codPending === 0 && cfGhost.salesRevenue === 0 &&
      cfWh2.channels.reduce((s, r) => s + r.orders, 0) === nOther,
    `COD ${WH2}=${cfWh2.codPending}, COD kho ma=0 (salesRevenue=${cfGhost.salesRevenue}), đơn ${WH2} trong cashflow=${cfWh2.channels.reduce((s, r) => s + r.orders, 0)}`
  );
  // 7. CHÂN HOÀN TIỀN phải theo cùng filter (lỗi reviewer: netRevenue cộng
  //    doanh thu đã lọc với tiền hoàn chưa lọc). So với SQL gốc join thẳng.
  await db.insert(returnOrders).values({
    id: `scope-ret-${Date.now()}`, orderId: ordA.orderId, returnCode: `SCOPERET${Date.now() % 100000}`,
    returnType: 'REFUND', reason: 'CUSTOMER_CHANGE_MIND', status: 'COMPLETED',
    refundAmount: 111000, targetWarehouseId: 'wh-au-co', inventoryDisposition: 'RESTOCK',
    createdBy: 'scope-tester', idempotencyKey: uniq('ret'),
  } as any);
  const cfInt = await AnalyticsService.cashflow({}, { fiscalScope: 'INTERNAL_MANAGEMENT' });
  const cfTax2 = await AnalyticsService.cashflow({}, { fiscalScope: 'OFFICIAL_TAX' });
  const refundInt = await q1(
    `SELECT COALESCE(SUM(r.refund_amount),0) n FROM return_orders r JOIN orders o ON o.id=r.order_id
      WHERE r.status='COMPLETED' AND o.fiscal_scope='INTERNAL_MANAGEMENT'`
  );
  const refundTax = await q1(
    `SELECT COALESCE(SUM(r.refund_amount),0) n FROM return_orders r JOIN orders o ON o.id=r.order_id
      WHERE r.status='COMPLETED' AND o.fiscal_scope='OFFICIAL_TAX'`
  );
  //    Kho không tồn tại ⇒ không đơn nào khớp ⇒ không có tiền hoàn nào được trừ:
  //    netRevenue PHẢI bằng salesRevenue (trước đây vẫn trừ hoàn của mọi kho).
  const cfGhostNet = await AnalyticsService.cashflow({}, { warehouseId: 'wh-khong-ton-tai' });
  ok(
    '7. netRevenue trừ tiền hoàn theo CÙNG bộ lọc (không trộn hoàn của sổ/kho khác)',
    refundInt >= 111000 &&
      cfInt.netRevenue === cfInt.salesRevenue - refundInt &&
      cfTax2.netRevenue === cfTax2.salesRevenue - refundTax &&
      cfGhostNet.netRevenue === cfGhostNet.salesRevenue,
    `hoàn nội bộ=${refundInt} (netRevenue ${cfInt.netRevenue} = ${cfInt.salesRevenue} - ${refundInt}); ` +
    `hoàn thuế=${refundTax} (netRevenue ${cfTax2.netRevenue} = ${cfTax2.salesRevenue} - ${refundTax}); ` +
    `kho ma: netRevenue=${cfGhostNet.netRevenue} = salesRevenue=${cfGhostNet.salesRevenue}`
  );
  console.log(`SCOPE-FILTER: ${passed}/${total}`); process.exit(passed === total ? 0 : 1);
}
run().catch((e) => { console.error('❌', e?.message || e); process.exit(1); });
