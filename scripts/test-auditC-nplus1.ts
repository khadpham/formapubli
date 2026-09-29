/**
 * AUDIT C (2/2) — N+1: đo số câu truy vấn thật mà `OrderService.createOrder` gửi
 * xuống DB theo số dòng đơn, bằng cách BỌC `client.execute` của @libsql/client
 * TRƯỚC khi `src/db` được nạp. Không đo bằng regex nguồn.
 *
 * VÌ SAO ĐÁNG ĐO: Cloudflare Workers (free plan) giới hạn 50 subrequest mỗi
 * lần gọi. Lỗi #4 production ("Too many subrequests") đã từng giết chức năng
 * Chuyển Hàng Loạt. `createOrder` có ATP 2 câu/dòng + insert 1 câu/dòng +
 * `recordMovement` ~N câu/dòng ⇒ một đơn nhiều dòng là con đường ngắn tới 500.
 *
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-auditC-nplus1
 */
import assert from 'node:assert/strict';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-auditC-nplus1');

// BỌC createClient TRƯỚC khi bất kỳ module nào nạp src/db.
const libsql = require('@libsql/client') as any;
const originalCreateClient = libsql.createClient;
let qCount = 0;
let counting = false;
libsql.createClient = (cfg: any) => {
  const client = originalCreateClient(cfg);
  const origExecute = client.execute.bind(client);
  const origTransaction = client.transaction.bind(client);
  client.execute = (...args: any[]) => {
    if (counting) qCount++;
    return origExecute(...args);
  };
  client.transaction = async (mode?: any) => {
    const tx = await origTransaction(mode);
    if (tx && typeof tx.execute === 'function') {
      const txExecute = tx.execute.bind(tx);
      tx.execute = (...args: any[]) => {
        if (counting) qCount++;
        return txExecute(...args);
      };
    }
    return tx;
  };
  return client;
};

let checks = 0;
function ok(label: string, cond: boolean, extra = '') {
  checks++;
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
  assert.ok(cond, `${label} ${extra}`);
}

async function run() {
  console.log('\n=== AUDIT C — N+1 (đo bằng bọc client.execute, dữ liệu thật) ===');
  const { db, editions } = await import('../src/db');
  const { OrderService } = await import('../src/services/order.service');
  const { InventoryService } = await import('../src/services/inventory.service');
  const { eq } = await import('drizzle-orm');
  const WH = 'wh-au-co';

  const all: any[] = await db.select({ id: editions.id, coverPrice: editions.coverPrice }).from(editions);
  const roomy: string[] = [];
  for (const e of all) {
    if (roomy.length >= 20) break;
    if ((await InventoryService.getBalance(e.id, WH, 'NEW')) >= 15) roomy.push(e.id);
  }
  assert.ok(roomy.length >= 12, `Cần ít nhất 12 ấn bản tồn dày, thực tế ${roomy.length}`);

  const measure = async (n: number) => {
    const before = await InventoryService.getBalance(roomy[0], WH, 'NEW');
    counting = true;
    qCount = 0;
    const o: any = await OrderService.createOrder({
      warehouseId: WH, channel: 'FAIR_EVENT', paymentMethod: 'CASH',
      cashierId: 'NV-01', items: roomy.slice(0, n).map((id) => ({ editionId: id, quantity: 1 })),
    });
    counting = false;
    return { n, queries: qCount, orderId: o.orderId, stockBefore: before };
  };

  const r1 = await measure(1);
  const r5 = await measure(5);
  const r10 = await measure(10);
  // CHI PHÍ BIÊN mỗi dòng = độ dốc, không phải tỉ lệ: trường hợp 1 dòng còn
  // mang phần cố định (đọc kho, phiên két, mã đơn, audit) nên per-line của nó
  // luôn cao hơn — đó không phải "vuột", đó là hằng số cộng vào.
  const slope5 = (r5.queries - r1.queries) / (5 - 1);
  const slope10 = (r10.queries - r1.queries) / (10 - 1);
  const fixed = r1.queries - slope10;
  const breakEven = Math.ceil((50 - fixed) / slope10);

  console.log(`đơn 1 dòng  -> ${r1.queries} câu`);
  console.log(`đơn 5 dòng  -> ${r5.queries} câu (biên ${slope5.toFixed(1)} câu/dòng)`);
  console.log(`đơn 10 dòng -> ${r10.queries} câu (biên ${slope10.toFixed(1)} câu/dòng)`);
  console.log(`mô hình: câu ≈ ${fixed.toFixed(1)} + ${slope10.toFixed(1)} × số dòng`);
  console.log(`NGƯỠNG VẬN HÀNH: Workers free plan = 50 subrequest/lần gọi ⇒ vượt từ đơn ${breakEven} dòng`);

  // 1. TăNG TUYẾN TÍNH theo số dòng ⇒ có N+1 thật (không phải hằng số).
  ok('N1 số câu truy vấn TĂNG theo số dòng (có N+1 thật)', r10.queries > r1.queries * 3, `1 dòng ${r1.queries} → 10 dòng ${r10.queries}`);
  // 2. Chi phí biên ổn định ⇒ đúng là O(N) chứ không O(N²).
  ok(
    'N2 chi phí biên mỗi dòng ổn định (tuyến tính, không vuột)',
    Math.abs(slope5 - slope10) / slope10 < 0.2,
    `biên ${slope5.toFixed(2)} vs ${slope10.toFixed(2)} câu/dòng`
  );
  // 3. Ngưỡng vận hành đo được: đơn N dòng vượt 50 subrequest.
  ok(
    'N3 GHI NHẬN: đơn nhiều dòng vượt 50 subrequest/lần gọi (Workers free plan)',
    breakEven >= 3 && breakEven <= 12,
    `≈ ${breakEven} dòng — đơn 10 dòng đã dùng ${r10.queries} subrequest`
  );
  // 3b. CHỐNG HỒI QUY: assertion này phải ĐỎ nếu ai đó trả về vòng lặp ATP
  // 2 câu/dòng và insert order_items 1 câu/dòng. Trước khi gom: 77 câu /
  // biên 7 / ngưỡng 7 dòng. Không có hai dòng này thì bản đo N+1 chỉ là trang trí.
  ok('N7 đơn 10 dòng ≤ 55 câu (ATP + insert dòng đã gom batch)', r10.queries <= 55, `${r10.queries} câu`);
  ok('N8 chi phí biên ≤ 5 câu/dòng', slope10 <= 5, `${slope10.toFixed(2)} câu/dòng`);
  ok('N4 giữ được bằng chứng N+1 sau khi sửa (đường dốc đo được > 2 câu/dòng)', slope10 > 2, `biên ${slope10.toFixed(2)} câu/dòng`);

  // 3. Bất biến tiền vẫn đúng ở đơn nhiều dòng (N+1 không được làm lệch tiền).
  const { orderItems, orders } = await import('../src/db');
  const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, r10.orderId));
  const sumTotal = lines.reduce((s, l: any) => s + l.totalAmount, 0);
  const sumCover = lines.reduce((s, l: any) => s + l.unitCoverPrice * l.quantity, 0);
  const o10: any = (await db.select().from(orders).where(eq(orders.id, r10.orderId)))[0];
  ok('N5 đơn 10 dòng: finalAmount khớp Σ dòng', o10.finalAmount === sumTotal, `${o10.finalAmount} vs ${sumTotal}`);
  ok('N6 đơn 10 dòng: subtotal khớp Σ (giá bìa × số lượng)', o10.subtotal === sumCover, `${o10.subtotal} vs ${sumCover}`);

  console.log(`\nAUDIT C — N+1: ${checks} assertions PASS`);
  process.exit(0);
}

run().catch((e) => {
  console.error('❌ test-auditC-nplus1 THẤT BẠI:', e?.message || e);
  process.exit(1);
});
