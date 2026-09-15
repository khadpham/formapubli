/**
 * Bước 2 — Kiểm thử SPX & COD (DB cách ly).
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-shipments
 * 8 cases: push COD / push non-COD / carrier lạ / nhảy trạng thái bậy /
 * delivered không đụng kho / settle COD / cashier settle bị chặn / TAX bị chặn.
 */
import { db, orders, inventoryLedger } from '../src/db';
import { editions } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { OrderService } from '../src/services/order.service';
import { ShipmentService } from '../src/services/shipment.service';
import { InventoryService } from '../src/services/inventory.service';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-shipments');

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${seq++}-${Math.random().toString(36).substring(2, 6)}`;

async function makeCompleted(editionId: string, paymentMethod: 'COD' | 'BANK_TRANSFER' = 'COD') {
  return OrderService.createOrder({
    warehouseId: 'wh-au-co',
    channel: 'RETAIL_ONLINE_WEB',
    customerName: `Khách Ship Test ${seq}`,
    paymentMethod,
    fiscalScope: 'INTERNAL_MANAGEMENT',
    cashierId: 'webhook',
    idempotencyKey: uniq('idem-ship'),
    items: [{ editionId, quantity: 1 }],
  });
}

async function run() {
  console.log('🚚 KIỂM THỬ SPX & COD (DB cách ly)');
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

  // 1. PUSH đơn COD → cod = final, PENDING
  const o1 = await makeCompleted(edA, 'COD');
  const p1 = await ShipmentService.push(o1.orderId, 'SPX', 'SPX111TEST', 15000, 'ROLE_MANAGER');
  const db1 = await ShipmentService.getByOrder(o1.orderId);
  ok(
    '1. PUSH COD ghi phải thu SPX',
    p1.shippingStatus === 'CREATED' && db1.codAmount === o1.finalAmount && db1.codStatus === 'PENDING' && db1.shippingFee === 15000,
    `COD=${db1.codAmount}`
  );

  // 2. PUSH đơn không COD → cod NONE/0
  const o2 = await makeCompleted(edB, 'BANK_TRANSFER');
  await ShipmentService.push(o2.orderId, 'SPX', 'SPX222TEST', 0, 'ROLE_MANAGER');
  const db2 = await ShipmentService.getByOrder(o2.orderId);
  ok('2. Đơn không COD không sinh phải thu', db2.codAmount === 0 && db2.codStatus === 'NONE');

  // 3. Carrier lạ bị từ chối
  let badCarrier = false;
  try {
    await ShipmentService.push(o2.orderId, 'GHTK', 'X', 0, 'ROLE_MANAGER');
  } catch (e: any) {
    badCarrier = /chưa hỗ trợ/.test(e.message);
  }
  ok('3. Chặn carrier chưa hỗ trợ', badCarrier);

  // 4. Nhảy trạng thái bậy (NONE→DELIVERED... ở đây CREATED→DELIVERED) bị chặn
  let badJump = false;
  try {
    await ShipmentService.updateStatus(o1.orderId, 'DELIVERED', 'ROLE_MANAGER');
  } catch (e: any) {
    badJump = /không hợp lệ/.test(e.message);
  }
  ok('4. Chặn nhảy trạng thái', badJump);

  // 5. Full hành trình → DELIVERED, tồn kho + ledger nguyên vẹn
  const balBefore = await InventoryService.getBalance(edA, 'wh-au-co', 'NEW');
  const ledBefore = (await db.select().from(inventoryLedger)).length;
  await ShipmentService.updateStatus(o1.orderId, 'PICKED_UP', 'ROLE_MANAGER');
  await ShipmentService.updateStatus(o1.orderId, 'IN_TRANSIT', 'ROLE_MANAGER');
  await ShipmentService.updateStatus(o1.orderId, 'DELIVERED', 'ROLE_MANAGER');
  const balAfter = await InventoryService.getBalance(edA, 'wh-au-co', 'NEW');
  const ledAfter = (await db.select().from(inventoryLedger)).length;
  ok('5. DELIVERED không đụng kho/sổ', balAfter === balBefore && ledAfter === ledBefore);

  // 6. SETTLE_COD → RECEIVED (kèm mã NH)
  const s6 = await ShipmentService.settleCod(o1.orderId, 'ROLE_MANAGER', 'NH-SP X-001');
  const db6 = await ShipmentService.getByOrder(o1.orderId);
  ok('6. Tất toán COD về ngân hàng', s6.codStatus === 'RECEIVED' && db6.codStatus === 'RECEIVED');

  // 7. Cashier không được settle + settle sớm (chưa giao) bị chặn (P2-12)
  const o7 = await makeCompleted(edA, 'COD');
  await ShipmentService.push(o7.orderId, 'SPX', 'SPX333TEST', 0, 'ROLE_MANAGER');
  let cashierBlocked = false;
  try {
    await ShipmentService.settleCod(o7.orderId, 'ROLE_CASHIER', 'NH-X');
  } catch (e: any) {
    cashierBlocked = /Manager\/Owner/.test(e.message);
  }
  let earlyBlocked = false;
  try {
    await ShipmentService.settleCod(o7.orderId, 'ROLE_MANAGER', 'NH-X');
  } catch (e: any) {
    earlyBlocked = /giao thành công/.test(e.message);
  }
  await ShipmentService.updateStatus(o7.orderId, 'PICKED_UP', 'ROLE_MANAGER');
  await ShipmentService.updateStatus(o7.orderId, 'IN_TRANSIT', 'ROLE_MANAGER');
  await ShipmentService.updateStatus(o7.orderId, 'DELIVERED', 'ROLE_MANAGER');
  await ShipmentService.settleCod(o7.orderId, 'ROLE_MANAGER', 'NH-X');
  ok('7. Cashier + settle sớm bị chặn', cashierBlocked && earlyBlocked);

  // 8. TAX bị chặn mọi mutate
  let taxBlocked = 0;
  try {
    await ShipmentService.push(o2.orderId, 'SPX', 'TAX-TRY', 0, 'ROLE_TAX');
  } catch (e: any) {
    if (/Kế toán thuế/.test(e.message)) taxBlocked++;
  }
  try {
    await ShipmentService.updateStatus(o2.orderId, 'PICKED_UP', 'ROLE_TAX');
  } catch (e: any) {
    if (/Kế toán thuế/.test(e.message)) taxBlocked++;
  }
  ok('8. TAX read-only vận chuyển', taxBlocked === 2);

  console.log(`\n${passed === total ? '🎉' : '⚠️'} SPX & COD: ${passed}/${total} cases ${passed === total ? 'PASS 100%' : 'CÓ FAIL'}`);
  if (passed !== total) process.exit(1);
}

run().catch((err) => {
  console.error('❌ test-shipments thất bại:', err);
  process.exit(1);
});
