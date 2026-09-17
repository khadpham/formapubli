/**
 * 1.2 — Màn Pending: API list/duyệt/hủy/dọn (DB cách ly).
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-pending-view
 * 5 cases: list filter / confirm phân quyền / cancel phân quyền /
 * cleanup phân quyền + dọn hết hạn / TAX bị chặn.
 */
import { db } from '../src/db';
import { editions } from '../src/db/schema';
import { OrderService } from '../src/services/order.service';
import { InventoryService } from '../src/services/inventory.service';
import { GET as getOrders, POST as postOrders } from '../src/app/api/orders/route';
import { signSession, SESSION_COOKIE_NAME } from '../src/lib/auth-session';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-pending-view');

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;

async function roomyEdition(): Promise<string> {
  const seeded = await db.select({ id: editions.id }).from(editions).limit(30);
  for (const s of seeded) {
    if ((await InventoryService.getBalance(s.id, 'wh-au-co', 'NEW')) >= 20) return s.id;
  }
  throw new Error('Không đủ edition tồn dày.');
}

// P1b: route orders bắt buộc session cookie — ký session test thay cho header mock.
async function authHeaders(role?: string, actor = 'test-pending'): Promise<Record<string, string>> {
  if (!role) return {};
  const token = await signSession({
    role: role as any,
    actorId: actor,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 3600 * 1000,
  });
  return {
    'x-formapubli-role': role,
    'x-formapubli-actor': actor,
    Cookie: `${SESSION_COOKIE_NAME}=${token}`,
  };
}

const get = async (qs: string, role?: string) =>
  getOrders(new Request(`http://localhost/api/orders${qs}`, {
    headers: { ...(await authHeaders(role)) },
  }) as any).then(async (r: any) => ({ status: r.status, body: await r.json() }));

const post = async (body: any, role?: string, actor = 'test-pending') =>
  postOrders(new Request('http://localhost/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders(role, actor)) },
    body: JSON.stringify(body),
  }) as any).then(async (r: any) => ({ status: r.status, body: await r.json() }));

async function run() {
  console.log('⏳ MÀN PENDING API (DB cách ly)');
  let passed = 0;
  const total = 5;
  const ok = (name: string, cond: boolean, extra = '') => {
    if (cond) {
      passed++;
      console.log(`✅ PASS: ${name}${extra ? ` (${extra})` : ''}`);
    } else {
      console.log(`❌ FAIL: ${name}${extra ? ` (${extra})` : ''}`);
    }
  };
  const ed = await roomyEdition();

  // 1. List filter status
  const p1 = await OrderService.createOrder({
    warehouseId: 'wh-au-co', channel: 'RETAIL_ONLINE_SOCIAL', customerName: 'FB Test',
    cashierId: 't', confirmImmediately: false, idempotencyKey: uniq('i'),
    items: [{ editionId: ed, quantity: 1 }],
  });
  const listed: any = await get('?status=PENDING_CONFIRMATION', 'ROLE_MANAGER');
  const completed: any = await get('?status=COMPLETED', 'ROLE_MANAGER');
  ok(
    '1. List lọc đúng trạng thái',
    listed.status === 200 && listed.body.orders.some((o: any) => o.id === p1.orderId) &&
      !completed.body.orders.some((o: any) => o.id === p1.orderId),
    `pending=${listed.body.orders.length}`
  );

  // 2. CONFIRM phân quyền
  const cCash: any = await post({ action: 'CONFIRM', orderId: p1.orderId }, 'ROLE_CASHIER');
  const cMgr: any = await post({ action: 'CONFIRM', orderId: p1.orderId }, 'ROLE_MANAGER');
  ok('2. CONFIRM cashier 403, manager 200', cCash.status === 403 && cMgr.status === 200 && cMgr.body.data.status === 'COMPLETED');

  // 3. CANCEL phân quyền
  const p3 = await OrderService.createOrder({
    warehouseId: 'wh-au-co', channel: 'RETAIL_ONLINE_WEB', customerName: 'Web Test',
    cashierId: 't', confirmImmediately: false, idempotencyKey: uniq('i'),
    items: [{ editionId: ed, quantity: 1 }],
  });
  const xCash: any = await post({ action: 'CANCEL', orderId: p3.orderId }, 'ROLE_CASHIER');
  const xMgr: any = await post({ action: 'CANCEL', orderId: p3.orderId, reason: 'test' }, 'ROLE_MANAGER');
  ok('3. CANCEL cashier 403, manager 200', xCash.status === 403 && xMgr.status === 200);

  // 4. CLEANUP phân quyền + dọn hết hạn
  await OrderService.createOrder({
    warehouseId: 'wh-au-co', channel: 'RETAIL_ONLINE_WEB', customerName: 'Hết hạn',
    cashierId: 't', confirmImmediately: false, createdAt: new Date(Date.now() - 49 * 3600000).toISOString(),
    idempotencyKey: uniq('i'), items: [{ editionId: ed, quantity: 1 }],
  });
  const clCash: any = await post({ action: 'CLEANUP' }, 'ROLE_CASHIER');
  const clMgr: any = await post({ action: 'CLEANUP' }, 'ROLE_MANAGER');
  ok('4. CLEANUP cashier 403, manager dọn ≥1', clCash.status === 403 && clMgr.status === 200 && clMgr.body.data.cleaned >= 1, `cleaned=${clMgr.body.data?.cleaned}`);

  // 5. TAX bị chặn mọi mutate pending
  const p5 = await OrderService.createOrder({
    warehouseId: 'wh-au-co', channel: 'RETAIL_ONLINE_WEB', customerName: 'Tax Test',
    cashierId: 't', confirmImmediately: false, idempotencyKey: uniq('i'),
    items: [{ editionId: ed, quantity: 1 }],
  });
  const tConf: any = await post({ action: 'CONFIRM', orderId: p5.orderId }, 'ROLE_TAX');
  const tClean: any = await post({ action: 'CLEANUP' }, 'ROLE_TAX');
  await OrderService.cancelOrder(p5.orderId, 'ROLE_MANAGER', 'dọn test');
  ok('5. TAX 403 confirm + cleanup', tConf.status === 403 && tClean.status === 403);

  console.log(`\n${passed === total ? '🎉' : '⚠️'} PENDING VIEW: ${passed}/${total} cases ${passed === total ? 'PASS 100%' : 'CÓ FAIL'}`);
  if (passed !== total) process.exit(1);
}

run().catch((err) => {
  console.error('❌ test-pending-view thất bại:', err);
  process.exit(1);
});
