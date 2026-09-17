/**
 * Lane B patch-02 — Hồi quy P2-04/07/08/09/10/12/14 (DB cách ly).
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-patch02-laneB
 */
import { db, works, editions, warehouses, orders, orderItems, inventoryLedger } from '../src/db';
import { eq } from 'drizzle-orm';
import { InventoryService } from '../src/services/inventory.service';
import { OrderService, CashboxService } from '../src/services/order.service';
import { ShipmentService } from '../src/services/shipment.service';
import { POST as postTransfer } from '../src/app/api/inventory/transfer/route';
import { setDirectTransferAllowlist, resetDirectTransferAllowlist } from '../src/services/direct-transfer-policy';
import { POST as postOrder } from '../src/app/api/orders/route';
import { signSession, SESSION_COOKIE_NAME } from '../src/lib/auth-session';
import { UserRole } from '../src/lib/roles';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-patch02-laneB');

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;
const J = (o: any) => JSON.stringify(o);
let passed = 0;
let total = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) {
    passed++;
    console.log(`✅ PASS: ${name}${extra ? ` (${extra})` : ''}`);
  } else {
    console.log(`❌ FAIL: ${name}${extra ? ` (${extra})` : ''}`);
  }
};

async function fixture(stock = 20, wh = 'wh-au-co') {
  const id = `p2b-${Date.now()}-${seq++}`;
  await db.insert(works).values({ id, code: id, title: id, author: 'P2B' }).catch(() => {});
  await db.insert(editions).values({ id, code: id, workId: id, isbn: '9786040000000', isbnLast4: '0000', coverPrice: 40000 }).catch(() => {});
  await InventoryService.recordMovement({ editionId: id, warehouseId: wh, eventType: 'OPENING_BALANCE', quantityDelta: stock, documentRef: 'P2B', idempotencyKey: uniq('idem-open') });
  return { id, wh };
}
const post = async (fn: any, body: any, role?: string) => {
  let cookieHeader = '';
  if (role) {
    const token = await signSession({
      role: role as UserRole,
      actorId: `test-${role.toLowerCase()}`,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600 * 1000,
    });
    cookieHeader = `${SESSION_COOKIE_NAME}=${token}`;
  }
  const r: any = await fn(new Request('http://localhost/x', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...(role ? { 'x-formapubli-role': role } : {}),
    },
    body: J(body),
  }) as any);
  return { status: r.status, body: await r.json() };
};

async function run() {
  console.log('🛡️ HỒI QUY LANE B PATCH-02 (DB cách ly)');

  // ---- P2-04: transfer idempotency ----
  const f4 = await fixture(10);
  await db.insert(warehouses).values({ id: 'wh-p2b-dest', code: 'wh-p2b-dest', name: 'P2B dest' }).catch(() => {});
  // CP3-B1.2: cấu hình tường minh cặp test cho endpoint direct (strict);
  // dọn ngay sau khối P2-04. Không đổi assertion.
  setDirectTransferAllowlist([[f4.wh, 'wh-p2b-dest']]);
  const key4 = uniq('idem-trf');
  const tBody = { editionId: f4.id, fromWarehouseId: f4.wh, toWarehouseId: 'wh-p2b-dest', quantity: 2, documentRef: 'P2B', idempotencyKey: key4 };
  const t1: any = await post(postTransfer, tBody, 'ROLE_OWNER');
  const t2: any = await post(postTransfer, tBody, 'ROLE_OWNER');
  const destBal = await InventoryService.getBalance(f4.id, 'wh-p2b-dest');
  const srcBal = await InventoryService.getBalance(f4.id, f4.wh);
  ok('P2-04 replay cùng key không nhân đôi', t1.status === 200 && t2.status === 200 && (t2.body?.data as any)?.isDuplicate === true && destBal === 2 && srcBal === 8, `đích=${destBal} nguồn=${srcBal}`);
  const t3: any = await post(postTransfer, { ...tBody, quantity: 1.5, idempotencyKey: uniq('i') }, 'ROLE_OWNER');
  ok('P2-04 số lẻ bị chặn', t3.status === 400);
  const t4: any = await post(postTransfer, { ...tBody, idempotencyKey: uniq('i') }, 'ROLE_TAX');
  ok('P2-04 TAX bị chặn chuyển kho', t4.status === 403);
  resetDirectTransferAllowlist();

  // ---- P2-07: allowlist kho bán ----
  const f7 = await fixture(10);
  let virBlocked = false;
  try {
    await OrderService.createOrder({ warehouseId: 'wh-in-transit', customerName: 't', cashierId: 't', idempotencyKey: uniq('i'), items: [{ editionId: f7.id, quantity: 1 }] });
  } catch (e: any) {
    virBlocked = /không được phép bán/.test(e.message);
  }
  let conBlocked = false;
  try {
    await OrderService.createOrder({ warehouseId: 'wh-consign-ns-mao-dinh-le', customerName: 't', cashierId: 't', idempotencyKey: uniq('i'), items: [{ editionId: f7.id, quantity: 1 }] });
  } catch (e: any) {
    conBlocked = /không được phép bán/.test(e.message);
  }
  ok('P2-07 chặn bán từ kho transit/ký gửi', virBlocked && conBlocked);

  // ---- P2-08/09: két ca ----
  const sessB = await CashboxService.openSession({ warehouseId: 'wh-au-co', cashierId: 'p2b-A', openingCash: 0 });
  const mkSale = (cashierId: string, sessionId: string, editionId: string) =>
    OrderService.createOrder({ warehouseId: 'wh-au-co', customerName: 't', cashierId, cashboxSessionId: sessionId, idempotencyKey: uniq('i'), items: [{ editionId, quantity: 1 }] });
  let hijackBlocked = false;
  try {
    await mkSale('p2b-B', sessB.session.id, f7.id);
  } catch (e: any) {
    hijackBlocked = /không khớp người bán/.test(e.message);
  }
  ok('P2-08 chặn bán ké két người khác', hijackBlocked);
  await CashboxService.closeSession({ sessionId: sessB.session.id, closingCashActual: 0 });
  let closedBlocked = false;
  try {
    await mkSale('p2b-A', sessB.session.id, f7.id);
  } catch (e: any) {
    closedBlocked = /két đóng/.test(e.message);
  }
  const sessW = await CashboxService.openSession({ warehouseId: 'wh-quynh-mai', cashierId: 'p2b-A', openingCash: 0 });
  let whBlocked = false;
  try {
    await OrderService.createOrder({ warehouseId: 'wh-au-co', customerName: 't', cashierId: 'p2b-A', cashboxSessionId: sessW.session.id, idempotencyKey: uniq('i'), items: [{ editionId: f7.id, quantity: 1 }] });
  } catch (e: any) {
    whBlocked = /không khớp kho xuất/.test(e.message);
  }
  await CashboxService.closeSession({ sessionId: sessW.session.id, closingCashActual: 0 });
  ok('P2-09 chặn két đóng + két khác kho', closedBlocked && whBlocked);

  // ---- P2-10: kẹp ngày ----
  const f10 = await fixture(10);
  let futBlocked = false;
  try {
    await OrderService.createOrder({ warehouseId: 'wh-au-co', customerName: 't', cashierId: 't', createdAt: new Date(Date.now() + 3600000).toISOString(), idempotencyKey: uniq('i'), items: [{ editionId: f10.id, quantity: 1 }] });
  } catch (e: any) {
    futBlocked = /tương lai/.test(e.message);
  }
  const oldTs = new Date(Date.now() - 8 * 86400000).toISOString();
  let oldBlocked = false;
  try {
    await OrderService.createOrder({ warehouseId: 'wh-au-co', customerName: 't', cashierId: 't', createdAt: oldTs, idempotencyKey: uniq('i'), items: [{ editionId: f10.id, quantity: 1 }] });
  } catch (e: any) {
    oldBlocked = /PIN Quản lý/.test(e.message);
  }
  const oldOk = await OrderService.createOrder({ warehouseId: 'wh-au-co', customerName: 't', cashierId: 't', createdAt: oldTs, backdateApproved: true, idempotencyKey: uniq('i'), items: [{ editionId: f10.id, quantity: 1 }] });
  // API: cashier gõ bù thiếu PIN → 403, đủ PIN → qua
  // P1b: route orders bắt buộc session cookie — ký session test thay cho header mock.
  const p2bCashierToken = await signSession({
    role: 'ROLE_CASHIER',
    actorId: 't',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 3600 * 1000,
  });
  const apiOld = (pin?: string) =>
    postOrder(new Request('http://localhost/api/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-formapubli-role': 'ROLE_CASHIER',
        'x-formapubli-actor': 't',
        Cookie: `${SESSION_COOKIE_NAME}=${p2bCashierToken}`,
      },
      body: J({ warehouseId: 'wh-au-co', createdAt: oldTs, ...(pin ? { managerPin: pin } : {}), items: [{ editionId: f10.id, quantity: 1 }] }),
    }) as any).then(async (r: any) => ({ status: r.status, body: await r.json() }));
  const apiNoPin: any = await apiOld();
  const apiPin: any = await apiOld('9999');
  ok('P2-10 chặn tương lai + gõ bù cần PIN', futBlocked && oldBlocked && !!oldOk.orderId && apiNoPin.status === 403 && apiPin.status === 200, `api ${apiNoPin.status}/${apiPin.status}`);

  // ---- P2-12: settle bắt DELIVERED ----
  const f12 = await fixture(10);
  const o12: any = await OrderService.createOrder({ warehouseId: 'wh-au-co', customerName: 't', paymentMethod: 'COD', cashierId: 't', idempotencyKey: uniq('i'), items: [{ editionId: f12.id, quantity: 1 }] });
  await ShipmentService.push(o12.orderId, 'SPX', uniq('TRK'), 0, 'ROLE_MANAGER');
  let earlyBlocked = false;
  try {
    await ShipmentService.settleCod(o12.orderId, 'ROLE_MANAGER', 'NH-X');
  } catch (e: any) {
    earlyBlocked = /giao thành công/.test(e.message);
  }
  await ShipmentService.updateStatus(o12.orderId, 'PICKED_UP', 'ROLE_MANAGER');
  await ShipmentService.updateStatus(o12.orderId, 'IN_TRANSIT', 'ROLE_MANAGER');
  await ShipmentService.updateStatus(o12.orderId, 'DELIVERED', 'ROLE_MANAGER');
  const settled = await ShipmentService.settleCod(o12.orderId, 'ROLE_MANAGER', 'NH-X');
  ok('P2-12 settle bắt DELIVERED', earlyBlocked && (settled as any).codStatus === 'RECEIVED');

  // ---- Phase 0: overdraft đã bị LOẠI BỎ — mọi cờ allowOverdraft đều bị lờ, đơn vượt tồn luôn từ chối ----
  const eds: string[] = [];
  for (let k = 0; k < 2; k++) eds.push((await fixture(10)).id);
  let odRejected = false;
  try {
    await OrderService.createOrder({ warehouseId: 'wh-au-co', customerName: 't', cashierId: 't', allowOverdraft: true, idempotencyKey: uniq('i'), items: [{ editionId: eds[0], quantity: 35 }] });
  } catch (e: any) {
    odRejected = /HẾT HÀNG KHẢ DỤNG/.test(e.message);
  }
  // Đơn trong tồn + cờ overdraft vẫn qua bình thường (cờ bị lờ, không còn ý nghĩa)
  const odOk: any = await OrderService.createOrder({ warehouseId: 'wh-au-co', customerName: 't', cashierId: 't', allowOverdraft: true, idempotencyKey: uniq('i'), items: [{ editionId: eds[1], quantity: 5 }] });
  const odRow = (await db.select().from(orders).where(eq(orders.id, odOk.orderId)).limit(1))[0];
  ok('Phase0 overdraft fail-closed (vượt tồn từ chối, trong tồn qua)', odRejected && !/CẢNH BÁO/.test(odRow.note || ''), `note=${(odRow.note || '').slice(0, 40)}`);
  // ---- Idempotency contract assertions (không phụ thuộc câu chữ message) ----
  const dupKey = uniq('idem-contract');
  const payloadQty1 = {
    warehouseId: 'wh-au-co',
    customerName: 'Khách Test Idem',
    paymentMethod: 'CASH' as const,
    cashierId: 'cashier-idem',
    idempotencyKey: dupKey,
    items: [{ editionId: eds[1], quantity: 1 }],
  };
  const payloadQty2 = {
    ...payloadQty1,
    items: [{ editionId: eds[1], quantity: 2 }],
  };

  const first = await OrderService.createOrder(payloadQty1);

  let conflictCode: string | undefined;
  try {
    await OrderService.createOrder(payloadQty2);
  } catch (error: any) {
    conflictCode = error?.code;
  }

  const replay: any = await OrderService.createOrder(payloadQty1);

  // 1. Cùng key, khác quantity trả IDEMPOTENCY_CONFLICT
  ok('Idempotency: khác quantity trả code IDEMPOTENCY_CONFLICT', conflictCode === 'IDEMPOTENCY_CONFLICT');

  // 2. Cùng key, cùng payload trả isDuplicate === true
  ok('Idempotency: cùng payload trả isDuplicate === true', replay.isDuplicate === true);

  // 3. Replay trả đúng orderId ban đầu
  ok('Idempotency: replay trả đúng orderId ban đầu', replay.orderId === first.orderId);

  // 4. Database chỉ có đúng một order với key đó
  const ordersInDb = await db.select().from(orders).where(eq(orders.idempotencyKey, dupKey));
  ok('Idempotency: database chỉ có đúng 1 order với key đó', ordersInDb.length === 1);

  // 5. Dòng order item vẫn có quantity 1, không bị biến thành 2
  const itemsInDb = await db.select().from(orderItems).where(eq(orderItems.orderId, first.orderId));
  ok(
    'Idempotency: dòng order item giữ nguyên quantity 1 (không biến thành 2)',
    itemsInDb.length === 1 && itemsInDb[0].quantity === 1
  );

  // 6. Không sinh thêm ledger
  const ledgersInDb = await db
    .select()
    .from(inventoryLedger)
    .where(eq(inventoryLedger.correlationId, first.orderId));
  ok('Idempotency: không sinh thêm ledger từ replay hoặc request lỗi', ledgersInDb.length === 1);

  console.log(`\n${passed === total ? '🎉' : '⚠️'} PATCH02 LANE-B: ${passed}/${total} cases ${passed === total ? 'PASS 100%' : 'CÓ FAIL'}`);
  if (passed !== total) process.exit(1);
}

run().catch((err) => {
  console.error('❌ test-patch02-laneB thất bại:', err);
  process.exit(1);
});
