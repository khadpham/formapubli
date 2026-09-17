/**
 * Lane A patch-02 — Hồi quy P2-01/02/03/06/11/13 (DB cách ly).
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-patch02-laneA
 * 9 cases: movement key/role/event-dấu-số / RMA ép cách ly+phân quyền /
 * forecast loại CK-dòng-100% / analytics OWNER-only.
 */
import { db, works, editions, warehouses } from '../src/db';
import { eq } from 'drizzle-orm';
import { InventoryService } from '../src/services/inventory.service';
import { OrderService } from '../src/services/order.service';
import { ForecastService } from '../src/services/forecast.service';
import { POST as postMovement } from '../src/app/api/inventory/movement/route';
import { POST as postRma } from '../src/app/api/rma/route';
import { GET as getAnalytics } from '../src/app/api/analytics/route';
import { signSession, SESSION_COOKIE_NAME } from '../src/lib/auth-session';
import { UserRole } from '../src/lib/roles';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-patch02-laneA');

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;
const J = (o: any) => JSON.stringify(o);

async function fixture(stock = 20) {
  const id = `p2a-${Date.now()}-${seq++}`;
  const wh = 'wh-au-co';
  await db.insert(works).values({ id, code: id, title: id, author: 'P2A' }).catch(() => {});
  await db.insert(editions).values({ id, code: id, workId: id, isbn: '9786040000000', isbnLast4: '0000', coverPrice: 40000 }).catch(() => {});
  await InventoryService.recordMovement({ editionId: id, warehouseId: wh, eventType: 'OPENING_BALANCE', quantityDelta: stock, documentRef: 'P2A', idempotencyKey: uniq('idem-open') });
  return { id, wh };
}
const post = (fn: any, body: any, role?: string) =>
  fn(new Request('http://localhost/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(role ? { 'x-formapubli-role': role } : {}) },
    body: J(body),
  })).then(async (r: any) => ({ status: r.status, body: await r.json() }));

async function run() {
  console.log('🛡️ HỒI QUY LANE A PATCH-02 (DB cách ly)');
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

  // 1. Movement thiếu key → 400 (chặn đòn ẩn danh P2-01)
  const f1 = await fixture();
  const r1: any = await post(postMovement, { editionId: f1.id, warehouseId: f1.wh, eventType: 'RECEIPT', quantityDelta: 1000, documentRef: 'P2A' }, 'ROLE_OWNER');
  ok('1. Movement thiếu key bị chặn', r1.status === 400 && /idempotencyKey/.test(r1.body?.error || ''));

  // 2. Replay cùng key → lần 2 lỗi, kho chỉ +1 lần
  const key2 = uniq('idem-mv');
  const mvBody = { editionId: f1.id, warehouseId: f1.wh, eventType: 'RECEIPT', quantityDelta: 5, documentRef: 'P2A', idempotencyKey: key2 };
  const b0 = await InventoryService.getBalance(f1.id, f1.wh);
  await post(postMovement, mvBody, 'ROLE_OWNER');
  const r2b: any = await post(postMovement, mvBody, 'ROLE_OWNER');
  const b1 = await InventoryService.getBalance(f1.id, f1.wh);
  ok('2. Replay key bị chặn, kho +1 lần', r2b.status !== 200 && b1 - b0 === 5, `status2=${r2b.status}`);

  // 3. TAX/CASHIER tường minh → 403
  const r3a: any = await post(postMovement, { ...mvBody, idempotencyKey: uniq('idem-mv') }, 'ROLE_TAX');
  const r3b: any = await post(postMovement, { ...mvBody, idempotencyKey: uniq('idem-mv') }, 'ROLE_CASHIER');
  ok('3. TAX/CASHIER bị chặn bút toán', r3a.status === 403 && r3b.status === 403);

  // 4. Số lẻ/chuỗi rác/event lạ/dấu sai → 400
  let bad = 0;
  const probes: any[] = [
    { ...mvBody, quantityDelta: '1.5', idempotencyKey: uniq('i') },
    { ...mvBody, quantityDelta: 'abc', idempotencyKey: uniq('i') },
    { ...mvBody, eventType: 'DISPATCH_GIFT', idempotencyKey: uniq('i') },
    { ...mvBody, eventType: 'RECEIPT', quantityDelta: -5, idempotencyKey: uniq('i') },
    { ...mvBody, eventType: 'DISPATCH_SALE', quantityDelta: 5, idempotencyKey: uniq('i') },
  ];
  for (const p of probes) {
    const r: any = await post(postMovement, p, 'ROLE_OWNER');
    if (r.status === 400) bad++;
  }
  // luồng UI hợp lệ vẫn 200
  const rOk: any = await post(postMovement, { ...mvBody, idempotencyKey: uniq('i') }, 'ROLE_OWNER');
  ok('4. Validate event/dấu/số + luồng UI qua', bad === 5 && rOk.status === 200, `bad=${bad}`);

  // 5. RMA ép NEW → QUARANTINE
  const f5 = await fixture(10);
  const r5: any = await post(postRma, {
    warehouseId: f5.wh, editionId: f5.id, quantity: 2, defectReason: 'PRINT_DEFECT', targetCondition: 'NEW',
  }, 'ROLE_OWNER');
  const newBal = await InventoryService.getBalance(f5.id, f5.wh, 'NEW');
  const qBal = await InventoryService.getBalance(f5.id, f5.wh, 'QUARANTINE');
  ok(
    '5. RMA NEW bị ép cách ly',
    r5.status === 200 && r5.body?.data?.quarantineCondition === 'QUARANTINE' && newBal === 8 && qBal === 2,
    `NEW=${newBal} Q=${qBal}`
  );

  // 6. RMA resolve: cashier 403, action lạ 400
  const r6a: any = await post(postRma, { action: 'resolve', ticketId: r5.body.data.id, resolutionAction: 'WRITE_OFF_SCRAP' }, 'ROLE_CASHIER');
  const r6b: any = await post(postRma, { action: 'resolve', ticketId: r5.body.data.id, resolutionAction: 'BURN_IT' }, 'ROLE_OWNER');
  ok('6. Resolve phân quyền + allowlist', r6a.status === 403 && r6b.status === 400);

  // 7. RMA tạo: TAX 403, qty lẻ 400
  const r7a: any = await post(postRma, { warehouseId: f5.wh, editionId: f5.id, quantity: 1, defectReason: 'PRINT_DEFECT' }, 'ROLE_TAX');
  const r7b: any = await post(postRma, { warehouseId: f5.wh, editionId: f5.id, quantity: 1.5, defectReason: 'PRINT_DEFECT' }, 'ROLE_OWNER');
  ok('7. RMA tạo gate role + số nguyên', r7a.status === 403 && r7b.status === 400);

  // 8. Forecast loại CK 100% cấp dòng
  const f8 = await fixture(30);
  const base = (await ForecastService.salesByEdition()).get(f8.id) || 0;
  await OrderService.createOrder({ warehouseId: f8.wh, cashierId: 't', idempotencyKey: uniq('i'), items: [{ editionId: f8.id, quantity: 2 }] });
  await OrderService.createOrder({
    warehouseId: f8.wh, cashierId: 't', discountRate: 0, idempotencyKey: uniq('i'),
    items: [{ editionId: f8.id, quantity: 2, unitDiscountRate: 1 }],
  });
  const after = (await ForecastService.salesByEdition()).get(f8.id) || 0;
  ok('8. P2-11 forecast bỏ qua dòng 0đ', after === base + 2, `${base}→${after}`);

  // 9. Analytics chỉ OWNER/MANAGER (P1b default-deny: yêu cầu session cookie hợp lệ)
  const g = async (role?: string) => {
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
    const res: any = await getAnalytics(new Request('http://localhost/api/analytics?view=channels', {
      headers: cookieHeader ? { Cookie: cookieHeader } : {},
    }) as any);
    return res.status;
  };
  const sCash = await g('ROLE_CASHIER');
  const sWh = await g('ROLE_WAREHOUSE');
  const sTax = await g('ROLE_TAX');
  const sOwn = await g('ROLE_OWNER');
  const sMgr = await g('ROLE_MANAGER');
  ok('9. P2-13 analytics OWNER/MANAGER-only', sCash === 403 && sWh === 403 && sTax === 403 && sOwn === 200 && sMgr === 200);

  console.log(`\n${passed === total ? '🎉' : '⚠️'} PATCH02 LANE-A: ${passed}/${total} cases ${passed === total ? 'PASS 100%' : 'CÓ FAIL'}`);
  if (passed !== total) process.exit(1);
}

run().catch((err) => {
  console.error('❌ test-patch02-laneA thất bại:', err);
  process.exit(1);
});
