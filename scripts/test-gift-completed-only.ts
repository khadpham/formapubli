// scripts/test-gift-completed-only.ts
import { db, orders, orderItems, products } from '../src/db';
import { sql } from 'drizzle-orm';
import { GiftReportService } from '../src/services/gift-report.service';
import { assertIsolatedTestDb } from './test-guard';
assertIsolatedTestDb('test-gift-completed-only');
const uid = () => `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
async function run() {
  let passed = 0; const total = 3;
  const ok = (n: string, c: boolean) => { if (c) passed++; console.log(`${c ? '✅' : '❌'} ${n}`); };
  const [p] = await db.select({ id: products.id }).from(products).limit(1);
  // SO TRƯỚC: các suite quà chạy trước trong ALL_SUITES (test-gift-forgery…)
  // để lại dòng quà trong DB test chung, nên assert DELTA chứ không phải số
  // tuyệt đối — cùng một luật (COMPLETED có, CANCELLED không) nhưng không phụ
  // thuộc thứ tự chạy.
  const before = await GiftReportService.summary();
  const made: { orderId: string; lineId: string }[] = [];
  const mkOrder = async (status: string) => {
    const id = `ord-gc-${uid()}`;
    const lineId = `oi-gc-${uid()}`;
    await db.insert(orders).values({ id, orderCode: `GC${uid()}`, warehouseId: 'wh-au-co', subtotal: 100000, finalAmount: 100000, idempotencyKey: `gc-${uid()}`, status } as any);
    await db.insert(orderItems).values({ id: lineId, orderId: id, productId: p.id, quantity: 2, unitCoverPrice: 50000, unitSellingPrice: 50000, totalAmount: 100000, isGiftLine: true } as any);
    made.push({ orderId: id, lineId });
  };
  await mkOrder('COMPLETED'); await mkOrder('CANCELLED');
  const s = await GiftReportService.summary();
  ok('1. chỉ đếm quà đơn COMPLETED', s.totalQty - before.totalQty === 2);
  ok('2. totalDelivered = quà đã phát', (s as any).totalDelivered - (before as any).totalDelivered === 2);
  ok('3. shortfall tách riêng', Array.isArray(s.shortfall));
  // Dọn dẹn BẮT BUỘC: để lại đơn COMPLETED có dòng quà sẽ làm ĐỎ assertion 3.6
  // của test-analytics-doanhso (SQL gốc của nó không loại is_gift_line) và làm
  // sai số liệu mọi suite đọc orders/order_items sau này.
  await db.delete(orderItems).where(sql`${orderItems.id} IN (${sql.join(made.map((m) => sql`${m.lineId}`), sql`, `)})`);
  await db.delete(orders).where(sql`${orders.id} IN (${sql.join(made.map((m) => sql`${m.orderId}`), sql`, `)})`);
  console.log(`GIFT-COMPLETED: ${passed}/${total}`); process.exit(passed === total ? 0 : 1);
}
run().catch((e) => { console.error('❌', e?.message || e); process.exit(1); });
