/**
 * Nhịp Bán — insight thuần túy từ buckets + events (không AI, quy tắc cố định).
 * RED trước, GREEN sau (TDD).
 */
import assert from 'node:assert/strict';
import { buildFlowInsights } from '../src/lib/product-flow';

const buckets = [
  { date: '2026-10-01', qty: 0, revenue: 0, orders: 0 },
  { date: '2026-10-02', qty: 10, revenue: 500, orders: 2 },
  { date: '2026-10-03', qty: 30, revenue: 1500, orders: 5 },
  { date: '2026-10-04', qty: 0, revenue: 0, orders: 0 },
];
const events = [
  { createdAt: '2026-10-03T03:00:00.000Z', qty: 20, orderId: 'a', orderCode: 'X', warehouseId: 'wh-fair', channel: 'FAIR_EVENT' },
  { createdAt: '2026-10-03T04:00:00.000Z', qty: 10, orderId: 'b', orderCode: 'Y', warehouseId: 'wh-main', channel: 'RETAIL_OFFICE' },
];
const ins = buildFlowInsights(buckets as any, events as any, 'wh-fair');
assert.equal(ins.peakDay?.date, '2026-10-03', 'đỉnh đúng ngày bán nhiều nhất');
assert.equal(ins.totalQty, 40, 'tổng cuốn');
assert.equal(ins.fairShare, 0.5, '50% bán ở kho hội chợ đang xem (20/40)');
assert.equal(ins.topChannel, 'FAIR_EVENT', 'kênh mạnh nhất');
assert.equal(ins.activeDays, 2, '2 ngày có bán');
assert.equal(ins.quietDays, 2, '2 ngày im ắng');

console.log('\n=== PRODUCT FLOW (runtime): PASS ===\n');

// --- Service trên DB cách ly ---
import { db } from '../src/db';
import { AnalyticsService } from '../src/services/analytics.service';

async function dbPart() {
  const { orders, orderItems, products, warehouses } = await import('../src/db');
  const { eq } = await import('drizzle-orm');
  const whList: any[] = await db.select().from(warehouses);
  const wh = whList.find((w) => w.isActive !== false) || whList[0];
  assert.ok(wh, 'DB cách ly phải có kho');
  const stamp = Date.now();
  const pid = `prod-flow-${stamp}`;
  await db.insert(products).values({ id: pid, code: 'SP-FLOW', name: 'Món flow', productKind: 'GOODS', sellingPrice: 10000 } as any);
  const mkOrder = (n: number, iso: string) => ({
    id: `ord-flow-${stamp}-${n}`, orderCode: `FLW${stamp}${n}`, idempotencyKey: `idem-flow-${stamp}-${n}`,
    warehouseId: wh.id, customerName: 'Khách flow', subtotal: 20000, finalAmount: 20000,
    paymentMethod: 'CASH', status: 'COMPLETED', cashierId: 'staff-admin', createdAt: iso,
  });
  await db.insert(orders).values([mkOrder(1, '2026-09-20T02:00:00.000Z'), mkOrder(2, '2026-09-22T02:00:00.000Z')] as any);
  await db.insert(orderItems).values([
    { id: `oi-flow-${stamp}-1`, orderId: `ord-flow-${stamp}-1`, productId: pid, quantity: 2, unitCoverPrice: 10000, unitSellingPrice: 10000, totalAmount: 20000 },
    { id: `oi-flow-${stamp}-2`, orderId: `ord-flow-${stamp}-2`, productId: pid, quantity: 1, unitCoverPrice: 10000, unitSellingPrice: 10000, totalAmount: 10000 },
  ] as any);
  try {
    const tl: any = await AnalyticsService.productTimeline(pid, { startDate: '2026-09-19', endDate: '2026-09-23' }, wh.id);
    assert.ok(tl, 'timeline trả về');
    assert.equal(tl.buckets.length, 2, '2 ngày có bán');
    assert.equal(tl.totals.qty, 3, 'tổng 3 cuốn');
    assert.equal(tl.totals.revenue, 30000, 'doanh thu 30000');
    assert.equal(tl.events.length, 2, '2 sự kiện');
    assert.equal(tl.events[0].orderCode, `FLW${stamp}2`, 'sự kiện mới nhất trước');
    assert.equal(tl.product.code, 'SP-FLOW', 'meta món');
    const empty: any = await AnalyticsService.productTimeline('prod-khong-ton-tai', { startDate: '2026-09-19', endDate: '2026-09-23' });
    assert.equal(empty.totals.qty, 0, 'món không bán ra 0');
    console.log('=== PRODUCT FLOW (DB cách ly): PASS ===\n');
  } finally {
    const { sql } = await import('drizzle-orm');
    await db.run(sql`DELETE FROM order_items WHERE id LIKE ${`oi-flow-${stamp}-%`}`);
    await db.run(sql`DELETE FROM orders WHERE id LIKE ${`ord-flow-${stamp}-%`}`);
    await db.delete(products).where(eq(products.id, pid));
  }
}

if ((process.env.DATABASE_URL || '').includes('formapubli_test')) {
  mainFlow().catch((e) => {
    console.error('PRODUCT FLOW DB FAIL:', e?.message || e);
    process.exit(1);
  });
} else {
  console.log('(bỏ qua phần DB: chỉ chạy trên DB cách ly qua run-isolated)');
}
async function mainFlow() {
  await dbPart();
}
