// scripts/test-gift-completed-only.ts
import { db, orders, orderItems, products } from '../src/db';
import { sql } from 'drizzle-orm';
import { GiftReportService } from '../src/services/gift-report.service';
import { assertIsolatedTestDb } from './test-guard';
assertIsolatedTestDb('test-gift-completed-only');
const uid = () => `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
// Số cuốn của từng fixture: quà còn tồn, quà của đơn CANCELLED (phải bị loại),
// quà hết tồn. Ba số khác nhau để rò 1 dòng nào cũng làm lệch ít nhất 1 assertion.
const QTY = 2;
const QTY_CANCELLED = 2;
const QTY_SHORTFALL = 3;
async function run() {
  let passed = 0; const total = 4;
  const ok = (n: string, c: boolean) => { if (c) passed++; console.log(`${c ? '✅' : '❌'} ${n}`); };
  const [p] = await db.select({ id: products.id }).from(products).limit(1);
  // SO TRƯỚC: các suite quà chạy trước trong ALL_SUITES (test-gift-forgery…)
  // để lại dòng quà trong DB test chung, nên assert DELTA chứ không phải số
  // tuyệt đối — cùng một luật (COMPLETED có, CANCELLED không) nhưng không phụ
  // thuộc thứ tự chạy.
  const before = await GiftReportService.summary();
  const made: { orderId: string; lineId: string }[] = [];
  const mkOrder = async (status: string, isGiftShortfall: boolean, quantity: number) => {
    const id = `ord-gc-${uid()}`;
    const lineId = `oi-gc-${uid()}`;
    await db.insert(orders).values({ id, orderCode: `GC${uid()}`, warehouseId: 'wh-au-co', subtotal: 100000, finalAmount: 100000, idempotencyKey: `gc-${uid()}`, status } as any);
    // `isGiftShortfall` set TƯỜNG MINH (schema mặc định false) — đây là cột
    // khóa luật "quà hết tồn tách khỏi quà đã phát", không được dựa vào default.
    await db.insert(orderItems).values({ id: lineId, orderId: id, productId: p.id, quantity, unitCoverPrice: 50000, unitSellingPrice: 50000, totalAmount: 100000, isGiftLine: true, isGiftShortfall } as any);
    made.push({ orderId: id, lineId });
  };
  try {
    await mkOrder('COMPLETED', false, QTY);
    await mkOrder('CANCELLED', false, QTY_CANCELLED);
    await mkOrder('COMPLETED', true, QTY_SHORTFALL);
    const s = await GiftReportService.summary();
    // totalQty phải bằng đúng 2 fixture COMPLETED (2 + 3); nếu đơn CANCELLED lọt
    // vào thì ra 7 ⇒ đỏ.
    ok('1. chỉ đếm quà đơn COMPLETED', s.totalQty - before.totalQty === QTY + QTY_SHORTFALL);
    ok('2. totalDelivered = quà đã phát', s.totalDelivered - before.totalDelivered === QTY);
    ok('3. totalShortfall = quà hết tồn tách riêng', s.totalShortfall - before.totalShortfall === QTY_SHORTFALL);
    ok('4. mảng shortfall trả về đúng kiểu mảng', Array.isArray(s.shortfall));
  } finally {
    // Dọn dẹn BẮT BUỘC (kể cả khi assert/insert lỗi giữa chừng): để lại đơn
    // COMPLETED có dòng quà sẽ làm ĐỎ assertion 3.6 của test-analytics-doanhso
    // (SQL gốc của nó không loại is_gift_line) và làm sai số liệu mọi suite đọc
    // orders/order_items sau này.
    if (made.length > 0) {
      await db.delete(orderItems).where(sql`${orderItems.id} IN (${sql.join(made.map((m) => sql`${m.lineId}`), sql`, `)})`);
      await db.delete(orders).where(sql`${orders.id} IN (${sql.join(made.map((m) => sql`${m.orderId}`), sql`, `)})`);
    }
  }
  console.log(`GIFT-COMPLETED: ${passed}/${total}`); process.exit(passed === total ? 0 : 1);
}
run().catch((e) => { console.error('❌', e?.message || e); process.exit(1); });
