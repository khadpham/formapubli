/**
 * Bước 4 — Kiểm thử Quỹ Tài trợ (DB cách ly).
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-sponsorships
 * 8 cases: mở quỹ / rút trừ balance+kho / vượt hạn mức / quỹ OPEN /
 * hết quỹ EXHAUSTED / đóng quỹ / đối soát / summary loại sponsorship.
 */
import { db, orders, inventoryLedger } from '../src/db';
import { editions } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { OrderService } from '../src/services/order.service';
import { SponsorshipService } from '../src/services/sponsorship.service';
import { InventoryService } from '../src/services/inventory.service';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-sponsorships');

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;

async function run() {
  console.log('💰 KIỂM THỬ QUỸ TÀI TRỢ (DB cách ly)');
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

  // 1. Mở quỹ CAPPED
  const f1 = await SponsorshipService.createFund({
    sponsorName: 'Mạnh Thường Quân Test',
    amountReceived: 10000000,
    quotaType: 'CAPPED',
    quotaLimit: 1000000,
    createdBy: 'owner-1',
    actorRole: 'ROLE_OWNER',
  });
  const fund1 = await SponsorshipService.getFund(f1.fundId);
  ok('1. Mở quỹ CAPPED', f1.status === 'ACTIVE' && fund1.balanceRemaining === 1000000, f1.fundCode);

  // 2. Rút sách: trừ balance + trừ kho thật + đơn final 0
  const balBefore = await InventoryService.getBalance(edA, 'wh-au-co', 'NEW');
  const d2 = await SponsorshipService.draw({
    fundId: f1.fundId, editionId: edA, warehouseId: 'wh-au-co', quantity: 2,
    drawnBy: 'staff-1', actorRole: 'ROLE_MANAGER', idempotencyKey: uniq('idem-spf'),
  });
  const fund2 = await SponsorshipService.getFund(f1.fundId);
  const balAfter = await InventoryService.getBalance(edA, 'wh-au-co', 'NEW');
  const ordRows = await db.select().from(orders).where(eq(orders.id, (d2 as any).orderId)).limit(1);
  const ledRows = await db.select().from(inventoryLedger).where(eq(inventoryLedger.correlationId, (d2 as any).orderId));
  ok(
    '2. Rút trừ balance + kho + đơn 0đ',
    fund2.totalDrawnQty === 2 && balAfter === balBefore - 2 &&
      ordRows[0].finalAmount === 0 && ordRows[0].channel === 'SPONSORSHIP' &&
      ledRows.some((r) => r.eventType === 'SPONSORSHIP_DRAWDOWN' && r.quantityDelta === -2),
    `rút ${(d2 as any).drawnValue}đ`
  );

  // 3. Vượt hạn mức bị chặn
  let overBlocked = false;
  try {
    await SponsorshipService.draw({
      fundId: f1.fundId, editionId: edA, warehouseId: 'wh-au-co', quantity: 999,
      drawnBy: 'staff-1', actorRole: 'ROLE_MANAGER', idempotencyKey: uniq('idem-spf'),
    });
  } catch (e: any) {
    overBlocked = /Vượt hạn mức/.test(e.message);
  }
  ok('3. Chặn rút vượt hạn mức', overBlocked);

  // 4. Quỹ OPEN rút tùy ý (chỉ đếm, không trừ balance)
  const f4 = await SponsorshipService.createFund({
    sponsorName: 'Quỹ Mở Test', amountReceived: 50000000, quotaType: 'OPEN',
    createdBy: 'owner-1', actorRole: 'ROLE_OWNER',
  });
  await SponsorshipService.draw({
    fundId: f4.fundId, editionId: edB, warehouseId: 'wh-au-co', quantity: 5,
    drawnBy: 'staff-1', actorRole: 'ROLE_CASHIER', idempotencyKey: uniq('idem-spf'),
  });
  const fund4 = await SponsorshipService.getFund(f4.fundId);
  ok('4. Quỹ OPEN rút tự do, cashier được rút', fund4.totalDrawnQty === 5 && fund4.status === 'ACTIVE');

  // 5. Balance trừ đúng trị giá bìa khi rút
  const f5 = await SponsorshipService.createFund({
    sponsorName: 'Quỹ Vừa Test', amountReceived: 5000000, quotaType: 'CAPPED',
    quotaLimit: 5000000, createdBy: 'owner-1', actorRole: 'ROLE_OWNER',
  });
  const before5 = (await SponsorshipService.getFund(f5.fundId)).balanceRemaining || 0;
  const d5: any = await SponsorshipService.draw({
    fundId: f5.fundId, editionId: edA, warehouseId: 'wh-au-co', quantity: 1,
    drawnBy: 'staff-1', actorRole: 'ROLE_MANAGER', idempotencyKey: uniq('idem-spf'),
  });
  const after5 = await SponsorshipService.getFund(f5.fundId);
  const pass5a = (after5.balanceRemaining || 0) === before5 - d5.drawnValue;
  // Rút cạn đúng hạn mức → EXHAUSTED
  const coverRows = await db.select().from(editions).where(eq(editions.id, edB)).limit(1);
  const oneCover = coverRows[0].coverPrice || 0;
  const f5b = await SponsorshipService.createFund({
    sponsorName: 'Quỹ Cạn Test', amountReceived: oneCover, quotaType: 'CAPPED',
    quotaLimit: oneCover, createdBy: 'owner-1', actorRole: 'ROLE_OWNER',
  });
  await SponsorshipService.draw({
    fundId: f5b.fundId, editionId: edB, warehouseId: 'wh-au-co', quantity: 1,
    drawnBy: 'staff-1', actorRole: 'ROLE_MANAGER', idempotencyKey: uniq('idem-spf'),
  });
  const after5b = await SponsorshipService.getFund(f5b.fundId);
  ok('5. Balance trừ đúng + cạn quỹ EXHAUSTED', pass5a && after5b.status === 'EXHAUSTED' && (after5b.balanceRemaining || 0) === 0, `-${d5.drawnValue}đ`);

  // 6. Đóng quỹ → không rút được nữa
  await SponsorshipService.closeFund(f5.fundId, 'ROLE_OWNER');
  let closedBlocked = false;
  try {
    await SponsorshipService.draw({
      fundId: f5.fundId, editionId: edA, warehouseId: 'wh-au-co', quantity: 1,
      drawnBy: 'staff-1', actorRole: 'ROLE_MANAGER', idempotencyKey: uniq('idem-spf'),
    });
  } catch (e: any) {
    closedBlocked = /CLOSED/.test(e.message);
  }
  ok('6. Đóng quỹ chặn rút', closedBlocked);

  // 7. Báo cáo đối soát quỹ
  const stmt: any = await SponsorshipService.getStatement(f1.fundId);
  ok(
    '7. Đối soát: tiền rót / đã rút / chi tiết',
    stmt.fund.amountReceived === 10000000 && stmt.fund.totalDrawnQty === 2 && stmt.drawCount === 1 && stmt.draws.length === 1,
    `${stmt.drawCount} đợt rút`
  );

  // 8. Summary doanh số loại đơn SPONSORSHIP
  const sumBefore: any = await OrderService.getSalesSummary({ warehouseId: 'wh-au-co' });
  await SponsorshipService.draw({
    fundId: f4.fundId, editionId: edB, warehouseId: 'wh-au-co', quantity: 1,
    drawnBy: 'staff-1', actorRole: 'ROLE_MANAGER', idempotencyKey: uniq('idem-spf'),
  });
  const sumAfter: any = await OrderService.getSalesSummary({ warehouseId: 'wh-au-co' });
  ok('8. Summary không tính đơn tài trợ', sumAfter.totalOrders === sumBefore.totalOrders && sumAfter.totalRevenue === sumBefore.totalRevenue);

  console.log(`\n${passed === total ? '🎉' : '⚠️'} SPONSORSHIP: ${passed}/${total} cases ${passed === total ? 'PASS 100%' : 'CÓ FAIL'}`);
  if (passed !== total) process.exit(1);
}

run().catch((err) => {
  console.error('❌ test-sponsorships thất bại:', err);
  process.exit(1);
});
