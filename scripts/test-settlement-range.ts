/**
 * Báo cáo kỳ (preset tới 3 tháng, cả chiến dịch) — gom ở server, 1 request.
 * RED trước, GREEN sau (TDD).
 */
import assert from 'node:assert/strict';
import { aggregateRangeOrders } from '../src/services/daily-settlement.service';

const ords = [
  { createdAt: '2026-10-01T02:00:00.000Z', finalAmount: 100, subtotal: 100, discountAmount: 0, paymentMethod: 'CASH' },
  { createdAt: '2026-10-01T10:00:00.000Z', finalAmount: 200, subtotal: 250, discountAmount: 50, paymentMethod: 'BANK_TRANSFER' },
  { createdAt: '2026-10-03T01:00:00.000Z', finalAmount: 400, subtotal: 400, discountAmount: 0, paymentMethod: 'QR_CODE' },
];
const r = aggregateRangeOrders(ords as any, '2026-10-01', '2026-10-04');

// 02:00Z = 09:00 VN cùng ngày; 3 đơn vào đúng 2 bucket ngày
assert.equal(r.days.length, 4, 'đủ 4 mốc ngày 01→04');
assert.equal(r.days[0].orders, 2, 'ngày 01 có 2 đơn');
assert.equal(r.days[0].sales, 300, 'ngày 01 thu 300');
assert.equal(r.days[2].orders, 1, 'ngày 03 có 1 đơn');
assert.equal(r.totals.orders, 3, 'tổng 3 đơn');
assert.equal(r.totals.net, 700, 'tổng thu 700');
assert.equal(r.cash.sales, 100, 'tiền mặt 100');
assert.equal(r.qr.sales, 600, 'chuyển khoản/QR 600');
assert.equal(r.totals.discount, 50, 'chiết khấu 50');

console.log('\n=== SETTLEMENT RANGE (runtime): PASS ===\n');

import fs from 'node:fs';
import path from 'node:path';
// --- Task 3 (plan kỳ): modal Ngày/Kỳ + preset (dùng readSrc/ok ở trên) ---
const readSrc = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');
let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; assert.ok(cond, msg); };

const settleRoute = readSrc('src/app/api/pos/daily-settlement/route.ts');
ok(/mode: 'range'/.test(settleRoute), 'API trả mode range');
ok(/inferCampaignRange/.test(settleRoute), 'API suy kỳ chiến dịch');
ok(/campaign/.test(settleRoute), 'API có tham số campaign');
ok(/\?date=/.test(settleRoute) || /searchParams\.get\('date'\)/.test(settleRoute), 'chế độ ngày cũ còn nguyên');
console.log(`=== SETTLEMENT RANGE (Task 2 API): PASS — ${checks} assertions ===\n`);

// --- Task 3 (plan kỳ): modal Ngày/Kỳ + preset ---
const settleModal = readSrc('src/components/pos/DailyFairSettlementModal.tsx');
ok(/Cả chiến dịch/.test(settleModal), 'có nút Cả chiến dịch');
ok(/1 tuần/.test(settleModal) && /3 tháng/.test(settleModal), 'đủ preset tới 3 tháng');
ok(/mode === 'range'|rangeMode/.test(settleModal), 'toggle Ngày/Kỳ');
ok(/reportStartDate/.test(settleModal), 'modal đọc kỳ từ payload');
// --- Task 4 (plan kỳ): bản in kỳ ---
const printModal = settleModal;
ok(/Tồn kho hiện tại|TỒN SÁCH HIỆN TẠI/.test(printModal), 'in kỳ ghi rõ tồn hiện tại, không bịa tồn cuối kỳ');
ok(/Doanh thu theo ngày/.test(printModal), 'in/màn kỳ có dải theo ngày');
ok(/BB-.*reportStartDate|reportStartDate.*BB-|kỳ \$\{/.test(printModal), 'bản in ghi rõ kỳ');
console.log(`=== SETTLEMENT RANGE (Task 4 print): PASS ===\n`);
import { db } from '../src/db';
import { DailySettlementService } from '../src/services/daily-settlement.service';

async function dbPart() {
  const { orders, warehouses } = await import('../src/db');
  const { eq } = await import('drizzle-orm');
  const wh = (await db.select().from(warehouses))[0];
  assert.ok(wh, 'DB cách ly phải có kho');
  const stamp = Date.now();
  const mk = (n: number, iso: string, amt: number) => ({
    id: `ord-range-${stamp}-${n}`,
    orderCode: `RNG${stamp}${n}`,
    idempotencyKey: `idem-range-${stamp}-${n}`,
    warehouseId: wh.id,
    customerName: 'Khách kỳ',
    subtotal: amt,
    finalAmount: amt,
    paymentMethod: n === 1 ? 'BANK_TRANSFER' : 'CASH',
    status: 'COMPLETED',
    cashierId: 'staff-admin',
    createdAt: iso,
  });
  await db.insert(orders).values([
    mk(1, '2026-09-20T02:00:00.000Z', 100),
    mk(2, '2026-09-22T02:00:00.000Z', 300),
  ] as any);
  try {
    const r: any = await DailySettlementService.getSettlementRange(
      { warehouseId: wh.id, startDate: '2026-09-19', endDate: '2026-09-23' }
    );
    assert.equal(r.mode, 'range', 'mode range');
    assert.equal(r.days.length, 5, 'đủ 5 mốc ngày');
    assert.equal(r.financials.totalOrdersCount, 2, '2 đơn trong kỳ');
    assert.equal(r.financials.netSales, 400, 'thu 400');
    assert.equal(r.paymentBreakdown.qrTransfer.sales, 100, 'CK 100');
    assert.equal(r.paymentBreakdown.cash.sales, 300, 'tiền mặt 300');
    assert.ok(r.stockNote.includes('hiện tại'), 'nhãn tồn hiện tại bắt buộc');
    assert.equal(r.peakDay.date, '2026-09-22', 'đỉnh kỳ đúng ngày');

    const camp = await DailySettlementService.inferCampaignRange(wh.id);
    assert.ok(camp && camp.startDate <= '2026-09-20' && camp.endDate >= '2026-09-22', 'suy kỳ chứa đơn vừa tạo');

    await assert.rejects(
      DailySettlementService.getSettlementRange({ warehouseId: wh.id, startDate: '2026-09-23', endDate: '2026-09-19' }),
      'đảo ngày bị từ chối'
    );
    await assert.rejects(
      DailySettlementService.getSettlementRange({ warehouseId: wh.id, startDate: '2026-01-01', endDate: '2026-12-31' }),
      'kỳ quá 3 tháng bị từ chối'
    );
    await assert.rejects(
      DailySettlementService.getSettlementRange({ warehouseId: 'wh-khong-ton-tai', startDate: '2026-09-19', endDate: '2026-09-23' }),
      'kho lạ bị từ chối'
    );
    console.log('=== SETTLEMENT RANGE (DB cách ly): PASS ===\n');
  } finally {
    // Dọn đơn giả để không làm lệch tổng các suite khác.
    const { sql } = await import('drizzle-orm');
    await db.run(sql`DELETE FROM orders WHERE id LIKE 'ord-range-${stamp}-%'`);
  }
}

if ((process.env.DATABASE_URL || '').includes('formapubli_test')) {
  main().catch((e) => {
    console.error('SETTLEMENT RANGE DB FAIL:', e?.message || e);
    process.exit(1);
  });
} else {
  console.log('(bỏ qua phần DB: chỉ chạy trên DB cách ly qua run-isolated)');
}
async function main() {
  await dbPart();
}
