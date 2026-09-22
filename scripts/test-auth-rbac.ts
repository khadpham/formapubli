/**
 * Bước 3 — Cookie-first + requireRole (DB cách ly).
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-auth-rbac
 * Bật AUTH_STRICT trong tiến trình (suite chạy process riêng, không lan).
 * 7 cases: 401 thiếu cookie / chặn giả mạo / header tự xưng vô hiệu /
 * login cấp cookie đúng / cashier 403 movement / legacy khi tắt strict /
 * returns REQUEST cashier qua, APPROVE chặn.
 */
import { db, works, editions } from '../src/db';
import { InventoryService } from '../src/services/inventory.service';
import { hashString } from '../src/lib/export-hash';
import { POST as postMovement } from '../src/app/api/inventory/movement/route';
import { POST as postReturns } from '../src/app/api/returns/route';
import { POST as postRma } from '../src/app/api/rma/route';
import { POST as postLogin } from '../src/app/api/auth/login/route';
import { OrderService } from '../src/services/order.service';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-auth-rbac');

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;
const J = (o: any) => JSON.stringify(o);

const SALT = 'formapubli-auth-passcode-salt-2026';
process.env.AUTH_SECRET = 'test-auth-secret-32-chars-minimum!';
process.env.AUTH_ROLE_PASSCODES = J({
  ROLE_OWNER: hashString(`9999${SALT}`),
  ROLE_MANAGER: hashString(`8888${SALT}`),
  ROLE_CASHIER: hashString(`1234${SALT}`),
  ROLE_WAREHOUSE: hashString(`5678${SALT}`),
  ROLE_TAX: hashString(`7890${SALT}`),
});
process.env.AUTH_STRICT = 'true';

const post = (fn: any, body: any, headers: Record<string, string> = {}) =>
  fn(new Request('http://localhost/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: J(body),
  }) as any).then(async (r: any) => ({ status: r.status, body: await r.json(), headers: r.headers }));

function sessionCookie(setCookie: string | null): string {
  const m = `${setCookie || ''}`.match(/formapubli_session=([^;]+)/);
  return m ? `formapubli_session=${m[1]}` : '';
}

async function loginAs(role: string, actor: string, passcode: string) {
  const roleToStaff: Record<string, string> = {
    ROLE_OWNER: 'ADMIN-01',
    ROLE_MANAGER: 'QL-01',
    ROLE_CASHIER: 'NV-01',
    ROLE_WAREHOUSE: 'KHO-01',
    ROLE_TAX: 'THUE-01',
  };
  const staffId = roleToStaff[role] || actor;
  const r: any = await post(postLogin, { role, actorId: actor, staffId, passcode });
  return { status: r.status, body: r.body, cookie: sessionCookie(r.headers.get('set-cookie')) };
}


async function run() {
  console.log('🔐 BƯỚC 3 COOKIE-FIRST (DB cách ly, AUTH_STRICT=true)');
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

  // 1. Strict thiếu cookie → 401
  const r1: any = await post(postMovement, { editionId: 'x', warehouseId: 'y', eventType: 'RECEIPT', quantityDelta: 1, documentRef: 't', idempotencyKey: uniq('i') });
  ok('1. Strict thiếu cookie 401', r1.status === 401);

  // 2. Giả mạo: header OWNER nhưng không cookie → 401 (header vô hiệu ở strict)
  const r2: any = await post(postMovement, { editionId: 'x', warehouseId: 'y', eventType: 'RECEIPT', quantityDelta: 1, documentRef: 't', idempotencyKey: uniq('i') }, { 'x-formapubli-role': 'ROLE_OWNER' });
  ok('2. Header tự xưng OWNER vô hiệu', r2.status === 401);

  // 3. Cookie sửa payload (đổi role lậu) → 401
  const owner = await loginAs('ROLE_OWNER', `step3-owner-${Date.now()}`, '9999');
  const tampered = owner.cookie.replace(/formapubli_session=([^.]+)\.(.+)/, (_m: string, p: string, s: string) => {
    const forged = Buffer.from(JSON.stringify({ role: 'ROLE_OWNER', actorId: 'mallory', issuedAt: 1, expiresAt: Date.now() + 3600000 })).toString('base64url');
    void p;
    return `formapubli_session=${forged}.${s}`;
  });
  const r3: any = await post(postMovement, { editionId: 'x', warehouseId: 'y', eventType: 'RECEIPT', quantityDelta: 1, documentRef: 't', idempotencyKey: uniq('i') }, { Cookie: tampered });
  ok('3. Giả payload bị chặn', owner.status === 200 && !!owner.cookie && r3.status === 401, `login=${owner.status}`);

  // 4. Login đúng → cookie dùng được cho movement (cần edition/kho thật)
  const eid = `s3-${Date.now()}`;
  await db.insert(works).values({ id: eid, code: eid, title: eid, author: 'S3' }).catch(() => {});
  await db.insert(editions).values({ id: eid, code: eid, workId: eid, isbn: '9786040000000', isbnLast4: '0000', coverPrice: 10000 }).catch(() => {});
  await InventoryService.recordMovement({ editionId: eid, warehouseId: 'wh-au-co', eventType: 'OPENING_BALANCE', quantityDelta: 10, documentRef: 'S3', idempotencyKey: uniq('i') });
  const r4: any = await post(postMovement, {
    editionId: eid, warehouseId: 'wh-au-co', eventType: 'ADJUSTMENT', quantityDelta: 1,
    documentRef: 'S3-OK', idempotencyKey: uniq('i'),
  }, { Cookie: owner.cookie });
  ok('4. Cookie OWNER ghi bút toán', r4.status === 200 && r4.body?.success === true);

  // 5. Cashier session vào movement → 403
  const cash = await loginAs('ROLE_CASHIER', `step3-cash-${Date.now()}`, '1234');
  const r5: any = await post(postMovement, {
    editionId: eid, warehouseId: 'wh-au-co', eventType: 'ADJUSTMENT', quantityDelta: 1,
    documentRef: 'S3-NO', idempotencyKey: uniq('i'),
  }, { Cookie: cash.cookie });
  ok('5. Cashier 403 movement', cash.status === 200 && r5.status === 403);

  // 6. [P1b - 2026-09-17] Legacy header fallback bị khai tử theo phê chuẩn Ban Điều Phối.
  // Cũ (CP3): Tắt strict -> legacy header x-formapubli-role chạy (kỳ vọng 200).
  // /*
  // process.env.AUTH_STRICT = '';
  // const r6Legacy: any = await post(postMovement, {
  //   editionId: eid, warehouseId: 'wh-au-co', eventType: 'ADJUSTMENT', quantityDelta: 1,
  //   documentRef: 'S3-LEGACY', idempotencyKey: uniq('i'),
  // }, { 'x-formapubli-role': 'ROLE_OWNER' });
  // process.env.AUTH_STRICT = 'true';
  // ok('6. Tắt strict giữ legacy', r6Legacy.status === 200);
  // */
  // Mới (P1b Default-Deny): Thiếu session cookie hợp lệ -> 401 AUTH_REQUIRED dù tắt strict.
  process.env.AUTH_STRICT = '';
  const r6: any = await post(postMovement, {
    editionId: eid, warehouseId: 'wh-au-co', eventType: 'ADJUSTMENT', quantityDelta: 1,
    documentRef: 'S3-LEGACY', idempotencyKey: uniq('i'),
  }, { 'x-formapubli-role': 'ROLE_OWNER' });
  process.env.AUTH_STRICT = 'true';
  ok('6. Thiếu session cookie 401 dù tắt strict', r6.status === 401 && (r6.body?.code === 'AUTH_REQUIRED' || r6.body?.error));

  // 7. Returns: cashier session REQUEST qua, APPROVE chặn
  const sale = await OrderService.createOrder({
    warehouseId: 'wh-au-co', customerName: 't', cashierId: 't', paymentMethod: 'BANK_TRANSFER', idempotencyKey: uniq('i'),
    items: [{ editionId: eid, quantity: 1 }],
  });
  const cash2 = await loginAs('ROLE_CASHIER', `step3-cash2-${Date.now()}`, '1234');
  const q7a: any = await post(postReturns, {
    action: 'REQUEST', orderId: sale.orderId, returnType: 'REFUND', reason: 'WRONG_ITEM',
    targetWarehouseId: 'wh-au-co', inventoryDisposition: 'RESTOCK',
    items: [{ editionId: eid, quantity: 1 }], idempotencyKey: uniq('i'),
  }, { Cookie: cash2.cookie });
  const q7b: any = await post(postReturns, { action: 'APPROVE', returnId: q7a.body?.data?.returnId || 'nope' }, { Cookie: cash2.cookie });
  ok('7. Returns theo action', q7a.status === 200 && q7b.status === 403, `req=${q7a.status} appr=${q7b.status}`);

  // 8. RMA strict: warehouse qua, cashier chặn (khóa lỗi ReferenceError param)
  const wh = await loginAs('ROLE_WAREHOUSE', `step3-wh-${Date.now()}`, '5678');
  const q8a: any = await post(postRma, {
    warehouseId: 'wh-au-co', editionId: eid, quantity: 1, defectReason: 'PRINT_DEFECT',
  }, { Cookie: wh.cookie });
  const q8b: any = await post(postRma, {
    warehouseId: 'wh-au-co', editionId: eid, quantity: 1, defectReason: 'PRINT_DEFECT',
  }, { Cookie: cash2.cookie });
  ok('8. RMA strict warehouse qua/cashier chặn', q8a.status === 200 && q8b.status === 403, `${q8a.status}/${q8b.status}`);

  delete process.env.AUTH_STRICT;
  console.log(`\n${passed === total ? '🎉' : '⚠️'} AUTH RBAC: ${passed}/${total} cases ${passed === total ? 'PASS 100%' : 'CÓ FAIL'}`);
  if (passed !== total) process.exit(1);
}

run().catch((err) => {
  delete process.env.AUTH_STRICT;
  console.error('❌ test-auth-rbac thất bại:', err);
  process.exit(1);
});
