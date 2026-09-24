/**
 * A1-H: phê duyệt chiết khấu + tạo đơn NGUYÊN TỬ (bug #1 hotfix).
 * D02 giỏ tráo sau duyệt -> 403, không ghi đơn.
 * D06 hai request tranh một approval -> đúng một đơn.
 * D07 retry cùng idempotency key -> trả đơn cũ, không consume lại.
 * D07b retry qua POST /api/orders sau consume -> trả đơn cũ (P1b).
 * D09 lỗi sau consume (thiếu ATP) -> rollback cả đơn lẫn approval.
 * DP1a line-discount tráo sau duyệt (giữ tổng 25%, gắn 90% vào 1 dòng) -> 403.
 *
 * DB riêng formapubli_test_discount_atomic.db — KHÔNG chạm prod.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_discount_atomic.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

const CASHIER = { staffId: 'staff-tn', role: 'ROLE_CASHIER', fullName: 'Thu Ngan' } as const;
const MGR = { staffId: 'staff-la', role: 'ROLE_MANAGER', fullName: 'Lan Anh' } as const;

async function snapshot(db: any, schema: any) {
  const orders = await db.select().from(schema.orders);
  const ledger = await db.select().from(schema.inventoryLedger);
  const bals = await db.select().from(schema.stockBalances);
  return {
    orders: orders.length,
    ledger: ledger.length,
    bals: bals.map((b: any) => `${b.editionId}:${b.warehouseId}:${b.physicalQuantity}`).sort().join('|'),
  };
}

async function run() {
  console.log('--- TEST A1-H: DISCOUNT CHECKOUT ATOMIC ---');
  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-discount-checkout-atomic');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../src/db/schema');
  const { DiscountApprovalService } = await import('../src/services/discount-approval.service');
  const { OrderService } = await import('../src/services/order.service');
  const { POST: postOrders } = await import('../src/app/api/orders/route');
  const { POST: postLogin } = await import('../src/app/api/auth/login/route');
  const { hashStaffPasscodeV2 } = await import('../src/lib/auth-session');

  const rawClient = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(rawClient);

  await db.insert(schema.warehouses).values([
    { id: 'wh-au-co', code: 'KHO_AU_CO', name: 'Kho Au Co', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
  ]);
  // Route-level tests (D07b/DP1a) cần staff + login thật lấy cookie.
  await db.insert(schema.staffAccounts).values([
    {
      staffId: CASHIER.staffId, fullName: CASHIER.fullName, role: CASHIER.role,
      passcodeHash: await hashStaffPasscodeV2('1234', 'salt-tn'), salt: 'salt-tn',
      isActive: true, sessionVersion: 1,
    },
    {
      staffId: MGR.staffId, fullName: MGR.fullName, role: MGR.role,
      passcodeHash: await hashStaffPasscodeV2('8888', 'salt-la'), salt: 'salt-la',
      isActive: true, sessionVersion: 1,
    },
  ]);
  await db.insert(schema.works).values([
    { id: 'work-h01', code: 'W-H01', title: 'Sach H01', author: 'TG' },
    { id: 'work-h21', code: 'W-H21', title: 'Sach H21', author: 'TG' },
  ]);
  await db.insert(schema.editions).values([
    { id: 'ed-h01', code: 'H01', workId: 'work-h01', title: 'Sach H01', isbn: '9780000000001', isbnLast4: '0001', coverPrice: 150000, isActive: true },
    { id: 'ed-h21', code: 'H21', workId: 'work-h21', title: 'Sach H21', isbn: '9780000000002', isbnLast4: '0002', coverPrice: 200000, isActive: true },
  ]);
  await db.insert(schema.stockBalances).values([
    { id: 'sb-h01', editionId: 'ed-h01', warehouseId: 'wh-au-co', condition: 'NEW', physicalQuantity: 10 },
    { id: 'sb-h21', editionId: 'ed-h21', warehouseId: 'wh-au-co', condition: 'NEW', physicalQuantity: 10 },
  ]);

  const baseItems = [
    { editionId: 'ed-h01', quantity: 2, unitPrice: 150000 },
    { editionId: 'ed-h21', quantity: 1, unitPrice: 200000 },
  ];
  const actorContext: any = { staffId: CASHIER.staffId, role: CASHIER.role, fullName: CASHIER.fullName };

  async function approvedRequest(orderCode: string, rate = 0.25) {
    const req = await DiscountApprovalService.createRequest({
      orderCode, warehouseId: 'wh-au-co', cashierId: CASHIER.staffId,
      items: baseItems, requestedDiscountRate: rate, actorContext: { ...actorContext },
    });
    return DiscountApprovalService.approveRequest({
      requestId: req.id, method: 'SHORTCODE_BOUND',
      shortCode: req.orderCode.slice(-4).toUpperCase(), actorContext: { ...MGR } as any,
    });
  }

  // D02: giỏ tráo sau duyệt -> FORBIDDEN, không ghi đơn/không trừ kho.
  console.log('\n[D02] Tampered cart rejected, nothing written');
  {
    const appr = await approvedRequest('ORD-D02-0001');
    const before = await snapshot(db, schema);
    let forbidden = false;
    try {
      await DiscountApprovalService.assertValidForCheckout({
        requestId: appr.id,
        items: [{ editionId: 'ed-h01', quantity: 5 }, { editionId: 'ed-h21', quantity: 1 }],
        discountRate: 0.25, warehouseId: 'wh-au-co', actorId: CASHIER.staffId,
      });
    } catch (err: any) {
      forbidden = err?.code === 'FORBIDDEN';
    }
    assert.ok(forbidden, 'Tráo số lượng phải FORBIDDEN');
    const after = await snapshot(db, schema);
    assert.deepEqual(after, before, 'Không được ghi gì khi từ chối');
    console.log('✓ D02');
  }

  // D06: hai request đồng thời tranh một approval -> đúng một đơn.
  console.log('\n[D06] Concurrent double-spend -> exactly one order');
  {
    const appr = await approvedRequest('ORD-D06-0001');
    const mkOrder = (key: string) =>
      OrderService.createOrder({
        warehouseId: 'wh-au-co', channel: 'FAIR_EVENT',
        discountRate: 0.25, paymentMethod: 'CASH',
        cashierId: CASHIER.staffId, actorContext: { ...actorContext },
        idempotencyKey: key, discountApprovalId: appr.id,
        items: baseItems.map((i) => ({ editionId: i.editionId, quantity: i.quantity })),
      });
    const results = await Promise.allSettled([mkOrder('idem-d06-a'), mkOrder('idem-d06-b')]);
    const okCount = results.filter((r) => r.status === 'fulfilled').length;
    assert.equal(okCount, 1, `Phải đúng 1 request thắng, thực tế ${okCount}`);
    const orders = await db.select().from(schema.orders);
    assert.equal(orders.length, 1, 'Chỉ một đơn được ghi');
    const apprAfter = await DiscountApprovalService.getRequest(appr.id);
    assert.equal(apprAfter.status, 'CONSUMED');
    console.log('✓ D06');
  }

  // D07: retry cùng key -> trả đơn cũ, không consume lại, tồn không đổi.
  console.log('\n[D07] Idempotent replay returns same order');
  {
    const appr = await approvedRequest('ORD-D07-0001');
    const params: any = {
      warehouseId: 'wh-au-co', channel: 'FAIR_EVENT',
      discountRate: 0.25, paymentMethod: 'CASH',
      cashierId: CASHIER.staffId, actorContext: { ...actorContext },
      idempotencyKey: 'idem-d07', discountApprovalId: appr.id,
      items: baseItems.map((i) => ({ editionId: i.editionId, quantity: i.quantity })),
    };
    const first: any = await OrderService.createOrder(params);
    assert.ok(!first.isDuplicate, 'Lần đầu không phải duplicate');
    const mid = await snapshot(db, schema);
    const retry: any = await OrderService.createOrder(params);
    assert.ok(retry.isDuplicate, 'Retry phải là duplicate');
    assert.equal(retry.orderId, first.orderId, 'Retry trả đúng đơn cũ');
    const after = await snapshot(db, schema);
    assert.deepEqual(after, mid, 'Replay không ghi thêm gì');
    const apprAfter = await DiscountApprovalService.getRequest(appr.id);
    assert.equal(apprAfter.status, 'CONSUMED');
    console.log('✓ D07');
  }

  // D09: lỗi sau consume (thiếu ATP) -> rollback cả đơn lẫn approval.
  console.log('\n[D09] Post-consume fault rolls back order + approval');
  {
    const appr = await approvedRequest('ORD-D09-0001');
    const before = await snapshot(db, schema);
    let failed = false;
    try {
      await OrderService.createOrder({
        warehouseId: 'wh-au-co', channel: 'FAIR_EVENT',
        discountRate: 0.25, paymentMethod: 'CASH',
        cashierId: CASHIER.staffId, actorContext: { ...actorContext },
        idempotencyKey: 'idem-d09', discountApprovalId: appr.id,
        items: [{ editionId: 'ed-h01', quantity: 9999 }],
      } as any);
    } catch {
      failed = true;
    }
    assert.ok(failed, 'Thiếu ATP phải throw');
    const after = await snapshot(db, schema);
    assert.deepEqual(after, before, 'Rollback: không đơn, không ledger, không trừ kho');
    const apprAfter = await DiscountApprovalService.getRequest(appr.id);
    assert.equal(apprAfter.status, 'APPROVED', 'Approval phải quay về APPROVED sau rollback');
    console.log('✓ D09');
  }

  // D07b (P1b): retry qua POST /api/orders sau khi approval đã CONSUMED ->
  // trả đúng đơn cũ, không đòi PIN, không ghi thêm.
  console.log('\n[D07b] Route-level replay after consume returns original order');
  {
    const loginRes: any = await postLogin(
      new Request('http://localhost/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId: CASHIER.staffId, passcode: '1234' }),
      }) as any
    );
    assert.equal(loginRes.status, 200, 'Login cashier cho D07b');
    const m = `${loginRes.headers.get('set-cookie') || ''}`.match(/formapubli_session=([^;]+)/);
    assert.ok(m, 'Login phải trả cookie');
    const cookie = `formapubli_session=${m![1]}`;
    const postOrderRoute = async (body: any) => {
      const res: any = await postOrders(
        new Request('http://localhost/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify(body),
        }) as any
      );
      return { status: res.status, json: await res.json() };
    };
    const appr = await approvedRequest('ORD-D07B-0001');
    const payload = {
      warehouseId: 'wh-au-co', channel: 'FAIR_EVENT', customerName: 'Khach D07b',
      discountRate: 0.25, paymentMethod: 'CASH',
      idempotencyKey: 'idem-d07b', discountApprovalId: appr.id,
      items: baseItems.map((i) => ({ editionId: i.editionId, quantity: i.quantity })),
    };
    const first = await postOrderRoute(payload);
    assert.equal(first.status, 200, `Lần đầu phải 200, thực tế ${first.status}: ${JSON.stringify(first.json).slice(0, 160)}`);
    const firstId = first.json?.data?.orderId || first.json?.data?.id;
    assert.ok(firstId, 'Phải có orderId');
    const mid = await snapshot(db, schema);
    // Mất response -> retry y hệt (kể cả approval id đã CONSUMED).
    const retry = await postOrderRoute(payload);
    assert.equal(retry.status, 200, `Retry phải 200 (không đòi PIN), thực tế ${retry.status}`);
    const retryId = retry.json?.data?.orderId || retry.json?.data?.id;
    assert.equal(retryId, firstId, 'Retry trả đúng đơn cũ');
    const after = await snapshot(db, schema);
    assert.deepEqual(after, mid, 'Replay không ghi thêm gì');
    console.log('✓ D07b');
  }

  // DP1a (P1a): giữ tổng 25% đã duyệt, gắn unitDiscountRate 0.9 vào 1 dòng -> 403.
  console.log('\n[DP1a] Line-discount tamper rejected at route');
  {
    const loginRes: any = await postLogin(
      new Request('http://localhost/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId: CASHIER.staffId, passcode: '1234' }),
      }) as any
    );
    const m = `${loginRes.headers.get('set-cookie') || ''}`.match(/formapubli_session=([^;]+)/);
    const cookie = `formapubli_session=${m![1]}`;
    const appr = await approvedRequest('ORD-DP1A-0001', 0.25);
    const before = await snapshot(db, schema);
    const res: any = await postOrders(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          warehouseId: 'wh-au-co', channel: 'FAIR_EVENT', customerName: 'Khach DP1a',
          discountRate: 0.25, paymentMethod: 'CASH',
          idempotencyKey: 'idem-dp1a', discountApprovalId: appr.id,
          items: [
            { editionId: 'ed-h01', quantity: 2, unitDiscountRate: 0.9 },
            { editionId: 'ed-h21', quantity: 1 },
          ],
        }),
      }) as any
    );
    assert.equal(res.status, 403, `Line 90% phải 403, thực tế ${res.status}`);
    const after = await snapshot(db, schema);
    assert.deepEqual(after, before, 'Không ghi đơn/không trừ kho khi từ chối');
    console.log('✓ DP1a');
  }

  rawClient.close();
  console.log('\n🎉 A1-H ATOMIC: D02/D06/D07/D07b/D09/DP1a PASS!');
}

run().catch((err) => {
  console.error('❌ Test thất bại:', err);
  process.exit(1);
});
