/**
 * Bước 1 — Kiểm thử Đơn Online PENDING + ATP Soft Reserve (DB cách ly).
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-online-orders
 * 8 cases: tạo pending / ATP giữ chỗ / chặn bán lẹm / confirm trừ kho /
 * cancel nhả chỗ / cashier bị chặn / TTL tự hủy / summary loại pending.
 */
import { db, orders, inventoryLedger } from '../src/db';
import { editions } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { OrderService, PENDING_TTL_HOURS } from '../src/services/order.service';
import { InventoryService } from '../src/services/inventory.service';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-online-orders');

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${seq++}-${Math.random().toString(36).substring(2, 6)}`;

async function run() {
  console.log('🌐 KIỂM THỬ ĐƠN ONLINE PENDING + ATP (DB cách ly)');
  const seeded = await db.select({ id: editions.id }).from(editions).limit(30);
  if (seeded.length === 0) throw new Error('Test DB chưa seed.');
  // Chọn edition còn tồn dày (>= 20) để không phụ thuộc thứ tự suite chạy trước
  const roomy: string[] = [];
  for (const s of seeded) {
    if (roomy.length >= 4) break;
    const bal = await InventoryService.getBalance(s.id, 'wh-au-co', 'NEW');
    if (bal >= 20) roomy.push(s.id);
  }
  if (roomy.length < 4) throw new Error('Không đủ edition tồn dày cho test.');
  const [edA, edB, edC, edD] = roomy;

  let passed = 0;
  const total = 9;
  const ok = (name: string, cond: boolean, extra = '') => {
    if (cond) {
      passed++;
      console.log(`✅ PASS: ${name}${extra ? ` (${extra})` : ''}`);
    } else {
      console.log(`❌ FAIL: ${name}${extra ? ` (${extra})` : ''}`);
    }
  };

  // 1. Tạo đơn PENDING web: status đúng, không bút toán kho, tồn vật lý nguyên
  const physBefore = await InventoryService.getBalance(edA, 'wh-au-co', 'NEW');
  const pend1 = await OrderService.createOrder({
    warehouseId: 'wh-au-co',
    channel: 'RETAIL_ONLINE_WEB',
    customerName: 'Khách Web Test',
    paymentMethod: 'COD',
    fiscalScope: 'INTERNAL_MANAGEMENT',
    cashierId: 'webhook',
    confirmImmediately: false,
    idempotencyKey: uniq('idem-web'),
    note: '[WEB] test',
    items: [{ editionId: edA, quantity: 3 }],
  });
  const ledRows = await db.select().from(inventoryLedger).where(eq(inventoryLedger.correlationId, pend1.orderId));
  const physAfter = await InventoryService.getBalance(edA, 'wh-au-co', 'NEW');
  ok(
    '1. PENDING không đụng ledger, tồn vật lý nguyên',
    (pend1 as any).status === 'PENDING_CONFIRMATION' && ledRows.length === 0 && physAfter === physBefore,
    `tồn ${physBefore}→${physAfter}`
  );

  // 2. ATP = physical − phần giữ chỗ
  const atp = await OrderService.getATP(edA, 'wh-au-co');
  ok('2. ATP trừ đúng phần giữ chỗ', atp === physBefore - 3, `ATP=${atp}`);

  // 3. Đơn pending thứ 2 vượt ATP bị từ chối (chống bán lẹm)
  let blocked = false;
  try {
    await OrderService.createOrder({
      warehouseId: 'wh-au-co',
      channel: 'RETAIL_ONLINE_SOCIAL',
      customerName: 'Khách FB Test',
      cashierId: 'fb-parser',
      confirmImmediately: false,
      idempotencyKey: uniq('idem-fb'),
      note: '[FB] test',
      items: [{ editionId: edA, quantity: atp + 1 }],
    });
  } catch (e: any) {
    blocked = /KHẢ DỤNG \(ATP\)/.test(e.message);
  }
  ok('3. Chặn bán lẹm hàng đã giữ chỗ', blocked);

  // 4. CONFIRM → COMPLETED + trừ kho thật
  const conf = await OrderService.confirmOrder(pend1.orderId, 'ROLE_MANAGER', 'manager-1');
  const physConf = await InventoryService.getBalance(edA, 'wh-au-co', 'NEW');
  const confLedger = await db.select().from(inventoryLedger).where(eq(inventoryLedger.correlationId, pend1.orderId));
  ok(
    '4. Duyệt đơn trừ kho nguyên tử',
    conf.status === 'COMPLETED' && physConf === physBefore - 3 &&
      confLedger.some((r) => r.eventType === 'DISPATCH_SALE' && r.quantityDelta === -3),
    `tồn ${physBefore}→${physConf}`
  );

  // 5. CANCEL nhả giữ chỗ ATP
  const pend5 = await OrderService.createOrder({
    warehouseId: 'wh-au-co',
    channel: 'RETAIL_ONLINE_SOCIAL',
    customerName: 'Khách Hủy Test',
    cashierId: 'fb-parser',
    confirmImmediately: false,
    idempotencyKey: uniq('idem-fb'),
    items: [{ editionId: edB, quantity: 4 }],
  });
  const atpHeld = await OrderService.getATP(edB, 'wh-au-co');
  await OrderService.cancelOrder(pend5.orderId, 'ROLE_MANAGER', 'Khách đổi ý');
  const atpFreed = await OrderService.getATP(edB, 'wh-au-co');
  ok('5. Hủy đơn nhả ATP', atpFreed - atpHeld === 4, `ATP ${atpHeld}→${atpFreed}`);

  // 6. Cashier không được CONFIRM/CANCEL
  const pend6 = await OrderService.createOrder({
    warehouseId: 'wh-au-co',
    channel: 'RETAIL_ONLINE_WEB',
    customerName: 'Khách Phân Quyền',
    cashierId: 'webhook',
    confirmImmediately: false,
    idempotencyKey: uniq('idem-web'),
    items: [{ editionId: edC, quantity: 1 }],
  });
  let roleBlocked = 0;
  try {
    await OrderService.confirmOrder(pend6.orderId, 'ROLE_CASHIER', 'cashier-1');
  } catch (e: any) {
    if (/chính mình/.test(e.message)) roleBlocked++;
  }
  try {
    await OrderService.cancelOrder(pend6.orderId, 'ROLE_CASHIER', 'tự hủy');
  } catch (e: any) {
    if (/chính mình/.test(e.message)) roleBlocked++;
  }
  await OrderService.cancelOrder(pend6.orderId, 'ROLE_MANAGER', 'dọn test');
  ok('6. Cashier bị chặn duyệt/hủy đơn người khác', roleBlocked === 2);

  // 6b. Cashier tự duyệt được đơn tại quầy (PENDING) của chính mình, có proof
  // (schema không có channel RETAIL_POS; kênh bán tại quầy là RETAIL_OFFICE)
  const pend6b = await OrderService.createOrder({
    warehouseId: 'wh-au-co',
    channel: 'RETAIL_OFFICE',
    customerName: 'Khách Tự Duyệt',
    paymentMethod: 'BANK_TRANSFER',
    cashierId: 'cashier-1',
    confirmImmediately: false,
    idempotencyKey: uniq('idem-pos-self'),
    items: [{ editionId: edC, quantity: 1 }],
  });
  const selfProof = { id: 'proof-cashier-1', capturedAt: new Date().toISOString() };
  const selfConfirmed = await OrderService.confirmOrder(pend6b.orderId, 'ROLE_CASHIER', 'cashier-1', undefined, selfProof);
  const selfRetry = await OrderService.confirmOrder(pend6b.orderId, 'ROLE_CASHIER', 'cashier-1', undefined, selfProof);
  ok(
    '6b. Cashier tự duyệt được đơn của mình (retry idempotent)',
    selfConfirmed.status === 'COMPLETED' && (selfRetry as any).isIdempotent === true
  );

  // 7. Quá TTL: confirm tự hủy + cleanup dọn
  const oldTs = new Date(Date.now() - (PENDING_TTL_HOURS + 1) * 3600000).toISOString();
  const pend7 = await OrderService.createOrder({
    warehouseId: 'wh-au-co',
    channel: 'RETAIL_ONLINE_WEB',
    customerName: 'Khách Quá Hạn',
    cashierId: 'webhook',
    confirmImmediately: false,
    createdAt: oldTs,
    idempotencyKey: uniq('idem-web'),
    items: [{ editionId: edD, quantity: 1 }],
  });
  let autoCancelled = false;
  try {
    await OrderService.confirmOrder(pend7.orderId, 'ROLE_MANAGER', 'manager-1');
  } catch (e: any) {
    autoCancelled = /tự động hủy/.test(e.message);
  }
  const st7 = await db.select().from(orders).where(eq(orders.id, pend7.orderId)).limit(1);
  const pend7b = await OrderService.createOrder({
    warehouseId: 'wh-au-co',
    channel: 'RETAIL_ONLINE_WEB',
    customerName: 'Khách Quá Hạn 2',
    cashierId: 'webhook',
    confirmImmediately: false,
    createdAt: oldTs,
    idempotencyKey: uniq('idem-web'),
    items: [{ editionId: edD, quantity: 1 }],
  });
  const cleaned = await OrderService.cleanupExpiredPending();
  const st7b = await db.select().from(orders).where(eq(orders.id, pend7b.orderId)).limit(1);
  ok('7. TTL tự hủy + job dọn', autoCancelled && st7[0].status === 'CANCELLED' && cleaned >= 1 && st7b[0].status === 'CANCELLED');

  // 8. Summary loại PENDING + validate channel + nhận COD
  const sumBefore: any = await OrderService.getSalesSummary({ warehouseId: 'wh-au-co' });
  const pend8 = await OrderService.createOrder({
    warehouseId: 'wh-au-co',
    channel: 'RETAIL_ONLINE_WEB',
    customerName: 'Khách Summary',
    paymentMethod: 'COD',
    cashierId: 'webhook',
    confirmImmediately: false,
    idempotencyKey: uniq('idem-web'),
    items: [{ editionId: edD, quantity: 2 }],
  });
  const sumAfter: any = await OrderService.getSalesSummary({ warehouseId: 'wh-au-co' });
  const pendingExcluded = sumAfter.totalRevenue === sumBefore.totalRevenue && sumAfter.totalOrders === sumBefore.totalOrders;
  let badChannel = false;
  try {
    await OrderService.createOrder({
      warehouseId: 'wh-au-co',
      channel: 'SHOPEE_LIVE' as any,
      customerName: 'Kênh Bậy',
      cashierId: 'webhook',
      idempotencyKey: uniq('idem-web'),
      items: [{ editionId: edD, quantity: 1 }],
    });
  } catch (e: any) {
    badChannel = /Kênh bán không hợp lệ/.test(e.message);
  }
  const listed = await OrderService.getOrders({ warehouseId: 'wh-au-co', status: 'PENDING_CONFIRMATION' });
  await OrderService.cancelOrder(pend8.orderId, 'ROLE_MANAGER', 'dọn test');
  ok(
    '8. Summary loại pending + chặn kênh bậy + COD qua',
    pendingExcluded && badChannel && listed.some((o) => o.id === pend8.orderId),
    `pending list=${listed.length}`
  );

  console.log(`\n${passed === total ? '🎉' : '⚠️'} ONLINE ORDERS: ${passed}/${total} cases ${passed === total ? 'PASS 100%' : 'CÓ FAIL'}`);
  if (passed !== total) process.exit(1);
}

run().catch((err) => {
  console.error('❌ test-online-orders thất bại:', err);
  process.exit(1);
});
