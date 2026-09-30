/**
 * ĐO THẬT — vì sao chốt đơn chậm, và gộp lệnh tra ATP giúp được bao nhiêu.
 *
 * CHẠY: npx tsx scripts/measure-checkout-stock-probe.ts
 *
 * BỐI CẢNH (người dùng hỏi 30/09): sau khi chụp ảnh xác nhận chuyển khoản phải
 * chờ khá lâu mới có đơn. Truy ra nguyên nhân: POS gọi `/api/atp` MỘT LẦN CHO
 * TỪNG CUỐN, nối tiếp (PosCheckoutTerminal.tsx, vòng `for (const item of cart)`).
 * Mỗi lần gọi lại vài câu DB xa. Đơn 12 cuốn = 12 vòng mạng.
 *
 * File này đo đúng phần tốn nhất: số câu DB và thời gian cho
 *   CŨ  = N lần getATP + N lần getBalance  (N = số cuốn trong giỏ)
 *   MỚI = 1 lần getBatchATP + 1 lần getBatchBalance
 * Phần vòng mạng giảm đúng N→1 nên không cần đo: đó là số học.
 */
import { db } from '../src/db';
import { OrderService } from '../src/services/order.service';
import { InventoryService } from '../src/services/inventory.service';
import { stockBalances, editions } from '../src/db/schema';
import { asc } from 'drizzle-orm';

const WAREHOUSE = process.env.PROBE_WAREHOUSE_ID || 'wh-quynh-mai';
const SIZES = [1, 5, 10, 20];

async function pickEditions(n: number): Promise<string[]> {
  const rows = await db
    .select({ id: editions.id })
    .from(editions)
    .orderBy(asc(editions.id))
    .limit(n);
  if (rows.length === 0) throw new Error('DB chưa có ấn bản nào để đo.');
  return rows.map((r) => r.id);
}

async function time<T>(label: string, fn: () => Promise<T>): Promise<number> {
  const t0 = Date.now();
  await fn();
  const ms = Date.now() - t0;
  console.log(`    ${label}: ${ms} ms`);
  return ms;
}

async function main() {
  console.log(`\n=== ĐO CHỐT ĐƠN: TRA TỒN CỦA CẢ GIỎ (kho ${WAREHOUSE}) ===\n`);

  console.log('Cũ — gọi từng cuốn một, nối tiếp (đúng như POS đang làm):');
  let oldTotal = 0;
  for (const n of SIZES) {
    const ids = await pickEditions(n);
    console.log(`  Giỏ ${n} cuốn → ${n} vòng mạng /api/atp`);
    oldTotal += await time('tra tồn', async () => {
      for (const id of ids) {
        await InventoryService.getBalance(id, WAREHOUSE, 'NEW');
        await OrderService.getATP(id, WAREHOUSE);
      }
    });
  }

  console.log('\nMỚI — 1 vòng cho cả giỏ (`editionIds`):');
  let newTotal = 0;
  for (const n of SIZES) {
    const ids = await pickEditions(n);
    console.log(`  Giỏ ${n} cuốn → 1 vòng mạng /api/atp?editionIds=...`);
    newTotal += await time('tra tồn', async () => {
      await InventoryService.getBatchBalance(ids, WAREHOUSE, 'NEW');
      await OrderService.getBatchATP(ids, WAREHOUSE);
    });
  }

  console.log('\n=== KẾT QUẢ ===');
  console.log(`  Cũ  tổng 4 lần đo: ${oldTotal} ms`);
  console.log(`  MỚI tổng 4 lần đo: ${newTotal} ms`);
  if (oldTotal > 0) {
    console.log(`  Nhanh hơn: ${(oldTotal / Math.max(newTotal, 1)).toFixed(1)}× (tiết kiệm ${oldTotal - newTotal} ms)`);
  }
  console.log('\n  Vòng mạng: từ N xuống 1 ⇒ đơn 20 cuốn bớt 19 chuyến gọi.');
  console.log('  (Chưa tính thời gian POST /api/orders — phần đó chưa thay đổi.)');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('LỖI ĐO:', e?.message || e);
    process.exit(1);
  });
