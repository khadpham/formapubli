/**
 * BV-06 — Kiểm thử Phiếu Đổi/Trả sách (Return/RMA) trên DB cách ly.
 *
 * AN TOÀN: script TỪ CHỐI chạy nếu DATABASE_URL không trỏ vào
 * formapubli_test.db. Chạy: npx tsx scripts/run-isolated.ts --only=test-returns
 * 8 cases: request ok / guard vượt số bán / complete restock /
 * defective-hold quarantine+RMA / idempotency / gift guard /
 * exchange rollback / void reversal.
 */
import { db, inventoryLedger, rmaTickets } from '../src/db';
import { editions } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { OrderService } from '../src/services/order.service';
import { ReturnService } from '../src/services/return.service';
import { InventoryService } from '../src/services/inventory.service';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-returns');

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${seq++}-${Math.random().toString(36).substring(2, 6)}`;

async function makeSale(editionId: string, qty: number, extra: Record<string, any> = {}) {
  return OrderService.createOrder({
    warehouseId: 'wh-au-co',
    customerName: `Khách Test Return ${seq}`,
    discountRate: 0,
    fiscalScope: 'INTERNAL_MANAGEMENT',
    cashierId: 'test-return-bot',
    idempotencyKey: uniq('idem-sale'),
    items: [{ editionId, quantity: qty }],
    ...extra,
  });
}

async function run() {
  console.log('🔄 KIỂM THỬ PHIẾU ĐỔI/TRẢ BV-06 (DB cách ly)');
  const seeded = await db.select({ id: editions.id }).from(editions).limit(5);
  if (seeded.length < 3) throw new Error('Test DB chưa seed đủ (chạy setup-test-db trước).');
  const [edA, edB, edC] = seeded.map((s) => s.id);

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

  // 1. REQUEST phiếu REFUND/RESTOCK trong hạn → REQUESTED
  // (dùng đơn BANK_TRANSFER để không cần két ca; guard két được test ở service)
  const sale1 = await makeSale(edA, 2, { paymentMethod: 'BANK_TRANSFER' });
  const req1 = await ReturnService.createRequest({
    orderId: sale1.orderId,
    returnType: 'REFUND',
    reason: 'CUSTOMER_CHANGE_MIND',
    targetWarehouseId: 'wh-au-co',
    inventoryDisposition: 'RESTOCK',
    refundAmount: 10000,
    createdBy: 'test-return-bot',
    actorRole: 'ROLE_CASHIER',
    idempotencyKey: uniq('idem-ret'),
    items: [{ editionId: edA, quantity: 1 }],
  });
  ok('1. Lập phiếu REFUND trong hạn', req1.status === 'REQUESTED', req1.returnCode);

  // 2. Guard: trả vượt số đã bán (2 đã bán, 1 đã xin → xin thêm 2) bị từ chối
  let rejectedOver = false;
  try {
    await ReturnService.createRequest({
      orderId: sale1.orderId,
      returnType: 'REFUND',
      reason: 'CUSTOMER_CHANGE_MIND',
      targetWarehouseId: 'wh-au-co',
      inventoryDisposition: 'RESTOCK',
      createdBy: 'test-return-bot',
      actorRole: 'ROLE_CASHIER',
      idempotencyKey: uniq('idem-ret'),
      items: [{ editionId: edA, quantity: 2 }],
    });
  } catch (e: any) {
    rejectedOver = /Vượt số lượng đã bán/.test(e.message);
  }
  ok('2. Chặn hoàn vượt số đã bán', rejectedOver);

  // 3. APPROVE + COMPLETE → tồn NEW tăng đúng, ledger có RETURN_INBOUND
  const balBefore = await InventoryService.getBalance(edA, 'wh-au-co', 'NEW');
  await ReturnService.approve(req1.returnId, 'ROLE_MANAGER', 'manager-1');
  await ReturnService.complete(req1.returnId, 'ROLE_MANAGER');
  const balAfter = await InventoryService.getBalance(edA, 'wh-au-co', 'NEW');
  const inbound = await db.select().from(inventoryLedger).where(eq(inventoryLedger.correlationId, req1.returnId));
  ok(
    '3. Hoàn tất cộng kho NEW + bút toán RETURN_INBOUND',
    balAfter - balBefore === 1 && inbound.some((r) => r.eventType === 'RETURN_INBOUND' && r.quantityDelta === 1),
    `tồn +${balAfter - balBefore}`
  );

  // 4. DEFECTIVE_HOLD → vào QUARANTINE, ATP (NEW) không tăng, có ticket RMA
  const sale2 = await makeSale(edB, 1);
  const newBefore = await InventoryService.getBalance(edB, 'wh-au-co', 'NEW');
  const quarBefore = await InventoryService.getBalance(edB, 'wh-au-co', 'QUARANTINE');
  const req2 = await ReturnService.createRequest({
    orderId: sale2.orderId,
    returnType: 'DAMAGED_REPLACE',
    reason: 'PRINTING_DEFECT',
    targetWarehouseId: 'wh-au-co',
    inventoryDisposition: 'DEFECTIVE_HOLD',
    createdBy: 'test-return-bot',
    actorRole: 'ROLE_CASHIER',
    idempotencyKey: uniq('idem-ret'),
    items: [{ editionId: edB, quantity: 1 }],
  });
  await ReturnService.approve(req2.returnId, 'ROLE_MANAGER', 'manager-1');
  await ReturnService.complete(req2.returnId, 'ROLE_MANAGER');
  const newAfter = await InventoryService.getBalance(edB, 'wh-au-co', 'NEW');
  const quarAfter = await InventoryService.getBalance(edB, 'wh-au-co', 'QUARANTINE');
  const rma = await db.select().from(rmaTickets).where(eq(rmaTickets.orderId, sale2.orderId));
  ok(
    '4. Hàng lỗi vào QUARANTINE + RMA, ATP không phình',
    newAfter === newBefore && quarAfter - quarBefore === 1 && rma.length > 0,
    `NEW ${newBefore}→${newAfter}, Q ${quarBefore}→${quarAfter}`
  );

  // 5. Idempotency: gửi trùng key → phiếu cũ, không sinh phiếu thứ 2
  const sale5 = await makeSale(edC, 2);
  const dupKey = uniq('idem-ret');
  const dupBody = {
    orderId: sale5.orderId,
    returnType: 'REFUND' as const,
    reason: 'WRONG_ITEM' as const,
    targetWarehouseId: 'wh-au-co',
    inventoryDisposition: 'RESTOCK' as const,
    createdBy: 'test-return-bot',
    actorRole: 'ROLE_CASHIER',
    idempotencyKey: dupKey,
    items: [{ editionId: edC, quantity: 1 }],
  };
  const r5a = await ReturnService.createRequest(dupBody);
  const r5b = await ReturnService.createRequest(dupBody);
  ok('5. Idempotency key trùng trả về phiếu cũ', (r5a as any).isDuplicate !== true && (r5b as any).isDuplicate === true && r5a.returnId === r5b.returnId);

  // 6. Đơn quà tặng: refund > 0 và type REFUND đều bị chặn
  const gift = await makeSale(edC, 1, { discountRate: 1, isGift: true, giftReason: 'Test tang' });
  let giftBlocked = 0;
  try {
    await ReturnService.createRequest({
      orderId: gift.orderId,
      returnType: 'REFUND',
      reason: 'CUSTOMER_CHANGE_MIND',
      targetWarehouseId: 'wh-au-co',
      inventoryDisposition: 'RESTOCK',
      refundAmount: 5000,
      createdBy: 'test-return-bot',
      actorRole: 'ROLE_MANAGER',
      idempotencyKey: uniq('idem-ret'),
      items: [{ editionId: edC, quantity: 1 }],
    });
  } catch (e: any) {
    if (/quà tặng/i.test(e.message)) giftBlocked++;
  }
  try {
    await ReturnService.createRequest({
      orderId: gift.orderId,
      returnType: 'DAMAGED_REPLACE',
      reason: 'PRINTING_DEFECT',
      targetWarehouseId: 'wh-au-co',
      inventoryDisposition: 'DEFECTIVE_HOLD',
      createdBy: 'test-return-bot',
      actorRole: 'ROLE_MANAGER',
      idempotencyKey: uniq('idem-ret'),
      items: [{ editionId: edC, quantity: 1 }],
    });
    giftBlocked++; // DAMAGED_REPLACE refund 0 phải qua
  } catch {
    // không được fail ở đây
  }
  ok('6. Đơn tặng: chặn hoàn tiền + chỉ cho đổi bảo hành', giftBlocked === 2);

  // 7. EXCHANGE thiếu hàng thay thế → rollback (phiếu vẫn APPROVED, không ledger mới)
  const sale7 = await makeSale(edA, 1);
  const req7 = await ReturnService.createRequest({
    orderId: sale7.orderId,
    returnType: 'EXCHANGE',
    reason: 'WRONG_ITEM',
    targetWarehouseId: 'wh-au-co',
    inventoryDisposition: 'RESTOCK',
    createdBy: 'test-return-bot',
    actorRole: 'ROLE_CASHIER',
    idempotencyKey: uniq('idem-ret'),
    items: [{ editionId: edA, quantity: 1 }],
  });
  await ReturnService.approve(req7.returnId, 'ROLE_MANAGER', 'manager-1');
  const ledBefore = (await db.select().from(inventoryLedger).where(eq(inventoryLedger.correlationId, req7.returnId))).length;
  let rolledBack = false;
  try {
    await ReturnService.complete(req7.returnId, 'ROLE_MANAGER', [{ editionId: edB, quantity: 99999 }]);
  } catch (e: any) {
    rolledBack = /Không đủ tồn/.test(e.message);
  }
  const ledAfter = (await db.select().from(inventoryLedger).where(eq(inventoryLedger.correlationId, req7.returnId))).length;
  const st7 = await ReturnService.getById(req7.returnId);
  ok('7. EXCHANGE thiếu hàng rollback nguyên tử', rolledBack && ledAfter === ledBefore && st7.header.status === 'APPROVED');

  // 8. VOID phiếu COMPLETED → bút toán đảo, tồn về mức trước complete
  const sale8 = await makeSale(edC, 1);
  const preVoid = await InventoryService.getBalance(edC, 'wh-au-co', 'NEW');
  const req8 = await ReturnService.createRequest({
    orderId: sale8.orderId,
    returnType: 'REFUND',
    reason: 'CUSTOMER_CHANGE_MIND',
    targetWarehouseId: 'wh-au-co',
    inventoryDisposition: 'RESTOCK',
    createdBy: 'test-return-bot',
    actorRole: 'ROLE_CASHIER',
    idempotencyKey: uniq('idem-ret'),
    items: [{ editionId: edC, quantity: 1 }],
  });
  await ReturnService.approve(req8.returnId, 'ROLE_MANAGER', 'manager-1');
  await ReturnService.complete(req8.returnId, 'ROLE_MANAGER');
  await ReturnService.voidReturn(req8.returnId, 'ROLE_MANAGER', 'Test huy phieu');
  const postVoid = await InventoryService.getBalance(edC, 'wh-au-co', 'NEW');
  const st8 = await ReturnService.getById(req8.returnId);
  ok('8. VOID sinh bút toán đảo, tồn về đúng', st8.header.status === 'VOIDED' && postVoid === preVoid, `tồn ${preVoid}→${postVoid}`);

  console.log(`\n${passed === total ? '🎉' : '⚠️'} BV-06 RETURNS: ${passed}/${total} cases ${passed === total ? 'PASS 100%' : 'CÓ FAIL'}`);
  if (passed !== total) process.exit(1);
}

run().catch((err) => {
  console.error('❌ test-returns thất bại:', err);
  process.exit(1);
});
