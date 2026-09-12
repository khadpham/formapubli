/**
 * Kiểm thử Server-enforce Discount Hard-cap 15% + Manager PIN.
 *
 * AN TOÀN: script này TỪ CHỐI chạy nếu DATABASE_URL không trỏ vào
 * formapubli_test.db — để không bao giờ ghi đơn test vào DB production.
 * Chạy cách ly: DATABASE_URL=file:formapubli_test.db npx tsx scripts/test-discount-guard.ts
 * (hoặc qua npm run test:isolated).
 */
import { db, auditLogs } from '../src/db';
import { POST } from '../src/app/api/orders/route';
import { desc, eq } from 'drizzle-orm';

const dbUrl = process.env.DATABASE_URL || '';
if (!dbUrl.includes('formapubli_test')) {
  console.error(
    `⛔ REFUSED: test-discount-guard chỉ chạy trên formapubli_test.db (DATABASE_URL hiện tại: '${dbUrl || '(trống -> formapubli.db production)'}').`
  );
  process.exit(2);
}

let seq = 0;
function baseBody(overrides: Record<string, any> = {}) {
  seq++;
  return {
    warehouseId: 'wh-au-co',
    channel: 'FAIR_EVENT',
    customerName: `Khách Test Guard ${Date.now()}-${seq}`,
    cashierId: 'test-cashier-guard',
    paymentMethod: 'CASH',
    fiscalScope: 'INTERNAL_MANAGEMENT',
    items: [{ editionId: 'ed-t01', quantity: 1 }],
    ...overrides,
  };
}

async function postOrder(body: Record<string, any>, role: string, actor = 'test-cashier-guard') {
  const req = new Request('http://localhost/api/orders', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-formapubli-role': role,
      'x-formapubli-actor': actor,
    },
    body: JSON.stringify(body),
  });
  const res: any = await POST(req as any);
  const json = await res.json();
  return { status: res.status as number, json };
}

async function run() {
  console.log('🛡️ KIỂM THỬ SERVER-ENFORCE DISCOUNT HARD-CAP 15% (DB cách ly)');
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

  // 1. Cashier CK 10% -> cho qua.
  let r = await postOrder(baseBody({ discountRate: 0.1 }), 'ROLE_CASHIER');
  ok('Cashier CK 10% được chấp nhận', r.status === 200 && r.json?.success === true, `status=${r.status}`);

  // 2. Cashier đúng trần 15% -> cho qua (boundary).
  r = await postOrder(baseBody({ discountRate: 0.15 }), 'ROLE_CASHIER');
  ok('Cashier đúng trần 15% được chấp nhận', r.status === 200 && r.json?.success === true, `status=${r.status}`);

  // 3. Cashier 35% không PIN -> 403.
  r = await postOrder(baseBody({ discountRate: 0.35 }), 'ROLE_CASHIER');
  ok('Cashier 35% thiếu PIN bị chặn 403', r.status === 403 && /PIN/.test(r.json?.error || ''), `status=${r.status}`);

  // 4. Cashier 35% PIN sai -> 403.
  r = await postOrder(baseBody({ discountRate: 0.35, managerPin: '0000' }), 'ROLE_CASHIER');
  ok('Cashier 35% PIN sai bị chặn 403', r.status === 403, `status=${r.status}`);

  // 5. Cashier 35% PIN đúng -> cho qua + audit MANAGER_DISCOUNT_APPROVED.
  r = await postOrder(baseBody({ discountRate: 0.35, managerPin: '9999' }), 'ROLE_CASHIER');
  const approvedCode = r.json?.data?.orderCode || '';
  const audits = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.action, 'MANAGER_DISCOUNT_APPROVED'))
    .orderBy(desc(auditLogs.createdAt))
    .limit(5);
  const auditHit = audits.some((a) => (a.details || '').includes(approvedCode));
  const pinLeaked = audits.some((a) => /9999|1234|8888/.test(a.details || ''));
  ok(
    'Cashier 35% + PIN đúng được duyệt và ghi audit (không lộ PIN)',
    r.status === 200 && r.json?.success === true && auditHit && !pinLeaked,
    `status=${r.status}`
  );

  // 6. Lách qua line item 40% (tổng 0%) không PIN -> 403.
  r = await postOrder(
    baseBody({ discountRate: 0, items: [{ editionId: 'ed-t01', quantity: 1, unitDiscountRate: 0.4 }] }),
    'ROLE_CASHIER'
  );
  ok('Lách line-item 40% không PIN bị chặn 403', r.status === 403, `status=${r.status}`);

  // 7. Line item 40% + PIN 8888 -> cho qua.
  r = await postOrder(
    baseBody({ discountRate: 0, managerPin: '8888', items: [{ editionId: 'ed-t01', quantity: 1, unitDiscountRate: 0.4 }] }),
    'ROLE_CASHIER'
  );
  ok('Line-item 40% + PIN 8888 được duyệt', r.status === 200 && r.json?.success === true, `status=${r.status}`);

  // 8. Manager 40% không PIN -> cho qua (miễn trừ theo vai trò).
  r = await postOrder(baseBody({ discountRate: 0.4 }), 'ROLE_MANAGER', 'test-manager-guard');
  ok('Manager 40% không PIN được chấp nhận', r.status === 200 && r.json?.success === true, `status=${r.status}`);

  console.log(`\n🎉 HOÀN TẤT: ${passed}/${total} BÀI TEST DISCOUNT GUARD ${passed === total ? 'ĐẠT 100%' : 'CÓ LỖI'}!`);
  if (passed !== total) process.exit(1);
}

run().catch((err) => {
  console.error('❌ test-discount-guard thất bại:', err);
  process.exit(1);
});
