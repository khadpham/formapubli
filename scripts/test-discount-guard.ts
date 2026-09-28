/**
 * Kiểm thử Server-enforce Discount Hard-cap 20% + Manager PIN.
 *
 * AN TOÀN: script này TỪ CHỐI chạy nếu DATABASE_URL không trỏ vào
 * formapubli_test.db — để không bao giờ ghi đơn test vào DB production.
 * Chạy cách ly: DATABASE_URL=file:formapubli_test.db npx tsx scripts/test-discount-guard.ts
 * (hoặc qua npm run test:isolated).
 */
import { db, auditLogs } from '../src/db';
import { editions } from '../src/db/schema';
import { POST } from '../src/app/api/orders/route';
import { desc, eq } from 'drizzle-orm';
import { signSession, SESSION_COOKIE_NAME } from '../src/lib/auth-session';
import { POST as postLogin } from '../src/app/api/auth/login/route';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-discount-guard');

let seq = 0;
let guardEditionId = 'ed-h01'; // Seed full dùng ID ed-<code>; run() sẽ nạp ID thật từ DB.
function baseBody(overrides: Record<string, any> = {}) {
  seq++;
  return {
    warehouseId: 'wh-au-co',
    channel: 'FAIR_EVENT',
    customerName: `Khách Test Guard ${Date.now()}-${seq}`,
    cashierId: 'test-cashier-guard',
    paymentMethod: 'CASH',
    fiscalScope: 'INTERNAL_MANAGEMENT',
    items: [{ editionId: guardEditionId, quantity: 1 }],
    ...overrides,
  };
}

async function postOrder(body: Record<string, any>, role: string, actor = 'test-cashier-guard') {
  // S-01: session cashier phải có lease server (ký tay không còn qua guard) —
  // login 1 lần mỗi role rồi tái dùng cookie cho cả suite.
  const token = await leasedCookie(role);
  const req = new Request('http://localhost/api/orders', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-formapubli-role': role,
      'x-formapubli-actor': actor,
      Cookie: `${SESSION_COOKIE_NAME}=${token}`,
    },
    body: JSON.stringify(body),
  });
  const res: any = await POST(req as any);
  const json = await res.json();
  return { status: res.status as number, json };
}

// Cache cookie theo role: login thật qua route để nhận lease (S-01).
const leasedCookies: Record<string, string> = {};
async function leasedCookie(role: string): Promise<string> {
  if (!leasedCookies[role]) {
    const staffId = role === 'ROLE_MANAGER' ? 'QL-01' : 'NV-01';
    const passcode = role === 'ROLE_MANAGER' ? '8888' : '1234';
    const r: any = await postLogin(
      new Request('http://localhost/x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId, passcode }),
      }) as any
    );
    if (r.status !== 200) throw new Error(`Không login được ${staffId} cho test (status=${r.status})`);
    const setCookie = r.headers.get('set-cookie') || '';
    const m = `${setCookie}`.match(/formapubli_session=([^;]+)/);
    if (!m) throw new Error(`Login ${staffId} không trả cookie`);
    leasedCookies[role] = m[1];
  }
  return leasedCookies[role];
}

// Giữ signSession import cho tương thích (không dùng trực tiếp nữa).
void signSession;

async function run() {
  console.log('🛡️ KIỂM THỬ SERVER-ENFORCE DISCOUNT HARD-CAP 20% (DB cách ly)');
  const seeded = await db.select({ id: editions.id }).from(editions).limit(1);
  if (seeded.length === 0) throw new Error('Test DB chưa được seed (chạy setup-test-db trước).');
  const testEditionId = seeded[0].id;
  guardEditionId = testEditionId;
  let passed = 0;
  const total = 13;
  const ok = (name: string, cond: boolean, extra = '') => {
    if (cond) {
      passed++;
      console.log(`✅ PASS: ${name}${extra ? ` (${extra})` : ''}`);
    } else {
      console.log(`❌ FAIL: ${name}${extra ? ` (${extra})` : ''}`);
    }
  };

  // 1. Cashier CK 10% -> cho qua.
  let r = await postOrder(baseBody({ discountRate: 0.1 }), 'ROLE_CASHIER');
  ok('Cashier CK 10% được chấp nhận', r.status === 200 && r.json?.success === true, `status=${r.status}`);

  // 2. Cashier chạm trần 20% (>= 20%) thiếu duyệt -> bị chặn 403 (boundary).
  r = await postOrder(baseBody({ discountRate: 0.2 }), 'ROLE_CASHIER');
  ok('Cashier chạm trần 20% thiếu duyệt bị chặn 403', r.status === 403 && /Quản lý/i.test(r.json?.error || ''), `status=${r.status}`);
  // HỢP ĐỒNG MỚI 2026-09-29: lỗi KHÔNG được hứa "mã PIN" nữa — không có UI nhập
  // PIN, hứa vậy là chỉ tay vào ngõ cụt. Phải chỉ đường thoát thật: xin Quản lý duyệt.
  ok('Lỗi vượt trần KHÔNG còn hứa "mã PIN"', !/PIN/i.test(r.json?.error || ''), r.json?.error);

  // 3. Cashier 35% không duyệt -> 403, nói rõ cần Quản lý phê duyệt.
  r = await postOrder(baseBody({ discountRate: 0.35 }), 'ROLE_CASHIER');
  ok('Cashier 35% thiếu duyệt bị chặn 403', r.status === 403 && /Quản lý/i.test(r.json?.error || ''), `status=${r.status}`);

  // 4. PIN sai -> 403. GIỮ: vẫn phải chặn.
  r = await postOrder(baseBody({ discountRate: 0.35, managerPin: '0000' }), 'ROLE_CASHIER');
  ok('Cashier 35% PIN sai bị chặn 403', r.status === 403, `status=${r.status}`);

  // 5. PIN ĐÚNG cũng phải bị chặn — đường PIN đã bị gỡ khỏi đơn chiết khấu.
  // Trước đây case này đòi 200; nay đòi 403 + FORBIDDEN. Đây là hợp đồng MỚI.
  r = await postOrder(baseBody({ discountRate: 0.35, managerPin: '9999' }), 'ROLE_CASHIER');
  ok(
    'Cashier 35% + PIN đúng KHÔNG còn là đường thoát (403 FORBIDDEN)',
    r.status === 403 && r.json?.code === 'FORBIDDEN',
    `status=${r.status} code=${r.json?.code}`
  );
  // Phải ghi audit TỪ CHỐI, và audit KHÔNG được lộ giá trị PIN.
  const denyAudits = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.action, 'MANAGER_DISCOUNT_DENIED'))
    .orderBy(desc(auditLogs.createdAt))
    .limit(5);
  const pinLeaked = denyAudits.some((a) => /9999|1234|8888/.test(a.details || ''));
  ok('Audit từ chối được ghi và không lộ PIN', denyAudits.length > 0 && !pinLeaked, `rows=${denyAudits.length}`);

  // 6. Lách qua line item 40% (tổng 0%) không duyệt -> 403.
  r = await postOrder(
    baseBody({ discountRate: 0, items: [{ editionId: guardEditionId, quantity: 1, unitDiscountRate: 0.4 }] }),
    'ROLE_CASHIER'
  );
  ok('Lách line-item 40% không duyệt bị chặn 403', r.status === 403, `status=${r.status}`);

  // 7. Lách line item 40% + PIN -> 403. Đường lách qua PIN đã đóng.
  r = await postOrder(
    baseBody({ discountRate: 0, managerPin: '8888', items: [{ editionId: guardEditionId, quantity: 1, unitDiscountRate: 0.4 }] }),
    'ROLE_CASHIER'
  );
  ok('Line-item 40% + PIN 8888 cũng bị chặn (không lách được)', r.status === 403, `status=${r.status}`);

  r = await postOrder(
    baseBody({ isGift: true, discountRate: 0.1, giftReason: 'Quà tặng sự kiện' }),
    'ROLE_CASHIER'
  );
  ok('Gift spoof discount 10% vẫn bị chặn nếu thiếu duyệt', r.status === 403, `status=${r.status}`);

  // 8. Manager 40% không cần duyệt -> cho qua (miễn trừ theo vai trò), và audit
  // phải ghi đúng người duyệt mà KHÔNG lộ PIN.
  r = await postOrder(baseBody({ discountRate: 0.4 }), 'ROLE_MANAGER', 'test-manager-guard');
  const mgrCode = r.json?.data?.orderCode || '';
  const mgrAudits = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.action, 'MANAGER_DISCOUNT_APPROVED'))
    .orderBy(desc(auditLogs.createdAt))
    .limit(5);
  const mgrAuditHit = mgrAudits.some((a) => (a.details || '').includes(mgrCode));
  const mgrPinLeak = mgrAudits.some((a) => /9999|1234|8888|4321/.test(a.details || ''));
  ok(
    'Manager 40% không duyệt vẫn được chấp nhận + audit không lộ PIN',
    r.status === 200 && r.json?.success === true && mgrAuditHit && !mgrPinLeak,
    `status=${r.status} auditHit=${mgrAuditHit}`
  );

  // 9-10. Env MANAGER_PIN_HASHES KHÔNG còn là đường thoát cho đơn chiết khấu.
  // PIN vẫn còn dùng ở 2 cổng khác (đơn gõ bù >7 ngày, phiếu đổi/trả quá hạn),
  // nên lib/manager-pin.ts và env này GIỮ NGUYÊN — chỉ đường chiết khấu bị gỡ.
  const { hashPinForEnv } = await import('../src/lib/manager-pin');
  const prevEnv = process.env.MANAGER_PIN_HASHES;
  process.env.MANAGER_PIN_HASHES = await hashPinForEnv('4321');
  try {
    r = await postOrder(baseBody({ discountRate: 0.35, managerPin: '4321' }), 'ROLE_CASHIER');
    ok('PIN hợp lệ theo env vẫn bị chặn ở đơn chiết khấu', r.status === 403, `status=${r.status}`);

    r = await postOrder(baseBody({ discountRate: 0.35, managerPin: '9999' }), 'ROLE_CASHIER');
    ok('PIN legacy (9999) bị chặn', r.status === 403, `status=${r.status}`);
  } finally {
    if (prevEnv === undefined) delete process.env.MANAGER_PIN_HASHES;
    else process.env.MANAGER_PIN_HASHES = prevEnv;
  }

  console.log(`\n🎉 HOÀN TẤT: ${passed}/${total} BÀI TEST DISCOUNT GUARD ${passed === total ? 'ĐẠT 100%' : 'CÓ LỖI'}!`);
  if (passed !== total) process.exit(1);
}

run().catch((err) => {
  console.error('❌ test-discount-guard thất bại:', err);
  process.exit(1);
});
