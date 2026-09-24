/**
 * A1-H + A1-F: phê duyệt chiết khấu + tạo đơn NGUYÊN TỬ (bug #1).
 * D01 giỏ đúng -> 200. D02 giỏ tráo sau duyệt -> 403, không ghi đơn.
 * D03 sai kho / sai thu ngân -> 403. D04 giá client bị bỏ qua (giá = DB).
 * D05 expired/rejected/superseded -> 403. D06 hai request tranh approval -> 1 đơn.
 * D07 retry cùng key -> trả đơn cũ. D07b replay route sau consume -> đơn cũ.
 * D08 cùng key khác payload -> 409 IDEMPOTENCY_CONFLICT.
 * D09 lỗi sau consume -> rollback. D10 gift cần PIN; DP1a line-discount tráo -> 403.
 * D11 duyệt sau consume -> conflict. A1.7 cashier không xem/xóa duyệt người khác.
 * CANCEL: chủ hủy -> SUPERSEDED, checkout sau đó 403; hủy sau consume -> 409.
 *
 * DB riêng formapubli_test_discount_atomic.db — KHÔNG chạm prod.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';
import { eq, like } from 'drizzle-orm';

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
    { id: 'wh-quynh-mai', code: 'KHO_QUYNH_MAI', name: 'Kho Quynh Mai', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
  ]);
  // Route-level tests (D07b/DP1a/D03b...) cần staff + login thật lấy cookie.
  const CASHIER2 = { staffId: 'staff-tn2', role: 'ROLE_CASHIER', fullName: 'Thu Ngan 2' } as const;
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
    {
      staffId: CASHIER2.staffId, fullName: CASHIER2.fullName, role: CASHIER2.role,
      passcodeHash: await hashStaffPasscodeV2('1234', 'salt-tn2'), salt: 'salt-tn2',
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
    { id: 'sb-h01', editionId: 'ed-h01', warehouseId: 'wh-au-co', condition: 'NEW', physicalQuantity: 100 },
    { id: 'sb-h21', editionId: 'ed-h21', warehouseId: 'wh-au-co', condition: 'NEW', physicalQuantity: 100 },
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

  // Shared route helpers: login cookie (S-01 claim), POST orders, logout.
  const loginCookie = async (staffId: string, passcode: string) => {
    const res: any = await postLogin(
      new Request('http://localhost/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId, passcode }),
      }) as any
    );
    const m = `${res.headers.get('set-cookie') || ''}`.match(/formapubli_session=([^;]+)/);
    return { status: res.status, cookie: m ? `formapubli_session=${m[1]}` : '' };
  };
  const logoutCookie = async (cookie: string) => {
    const m = `${cookie}`.match(/formapubli_session=([^;]+)/);
    const r: any = new Request('http://localhost/api/auth/logout', { method: 'POST' });
    r.cookies = { get: (n: string) => (n === 'formapubli_session' && m ? { value: m[1] } : undefined) };
    const { POST: loPOST } = await import('../src/app/api/auth/logout/route');
    await loPOST(r);
  };
  const postOrdersWith = async (cookie: string, body: any) => {
    const res: any = await postOrders(
      new Request('http://localhost/api/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify(body),
      }) as any
    );
    return { status: res.status, json: await res.json() };
  };
  const postApprovalWith = async (cookie: string, id: string, body: any) => {
    const { POST: idPOST } = await import('../src/app/api/pos/discount-approvals/[id]/route');
    const res: any = await idPOST(
      new Request(`http://localhost/api/pos/discount-approvals/${id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify(body),
      }) as any,
      { params: { id } } as any
    );
    return { status: res.status, json: await res.json() };
  };
  const getApprovalWith = async (cookie: string, id: string) => {
    const { GET: idGET } = await import('../src/app/api/pos/discount-approvals/[id]/route');
    const res: any = await idGET(
      new Request(`http://localhost/api/pos/discount-approvals/${id}`, {
        headers: { Cookie: cookie },
      }) as any,
      { params: { id } } as any
    );
    return { status: res.status, json: await res.json() };
  };

  // D01: giỏ đúng -> 200 (service-level happy path).
  console.log('\n[D01] Valid approved cart creates order');
  {
    const appr = await approvedRequest('ORD-D01-0001');
    const r: any = await OrderService.createOrder({
      warehouseId: 'wh-au-co', channel: 'FAIR_EVENT',
      discountRate: 0.25, paymentMethod: 'CASH',
      cashierId: CASHIER.staffId, actorContext: { ...actorContext },
      idempotencyKey: 'idem-d01', discountApprovalId: appr.id,
      items: baseItems.map((i) => ({ editionId: i.editionId, quantity: i.quantity })),
    });
    assert.equal(r.finalAmount, 375000, 'Thực thu = 500000 * (1 - 25%) theo giá DB');
    const apprAfter = await DiscountApprovalService.getRequest(appr.id);
    assert.equal(apprAfter.status, 'CONSUMED');
    console.log('✓ D01');
  }

  // D03a: approval thuộc kho khác -> 403.
  console.log('\n[D03] Wrong warehouse / wrong cashier rejected');
  {
    const appr = await approvedRequest('ORD-D03-0001');
    let whForbidden = false;
    try {
      await DiscountApprovalService.assertValidForCheckout({
        requestId: appr.id, items: baseItems, discountRate: 0.25,
        warehouseId: 'wh-quynh-mai', actorId: CASHIER.staffId,
      });
    } catch (err: any) {
      whForbidden = err?.code === 'FORBIDDEN';
    }
    assert.ok(whForbidden, 'Kho khác phải FORBIDDEN');
    // D03b: thu ngân khác mượn approval của người khác (route-level).
    const c2 = await loginCookie(CASHIER2.staffId, '1234');
    assert.equal(c2.status, 200);
    const res = await postOrdersWith(c2.cookie, {
      warehouseId: 'wh-au-co', channel: 'FAIR_EVENT', customerName: 'D03b',
      discountRate: 0.25, paymentMethod: 'CASH',
      idempotencyKey: 'idem-d03b', discountApprovalId: appr.id,
      items: baseItems.map((i) => ({ editionId: i.editionId, quantity: i.quantity })),
    });
    assert.equal(res.status, 403, `Thu ngân khác mượn approval phải 403, thực tế ${res.status}`);
    assert.ok(/thu ngân khác/i.test(res.json?.error || ''), 'Lỗi phải nêu đúng người sở hữu');
    await logoutCookie(c2.cookie);
    console.log('✓ D03 (kho khác + thu ngân khác)');
  }

  // D04: client khai giá bừa -> server dùng giá DB, đơn vẫn khớp approval.
  console.log('\n[D04] Client-declared prices are ignored (DB prices win)');
  {
    const c1 = await loginCookie(CASHIER.staffId, '1234');
    assert.equal(c1.status, 200);
    const appr = await approvedRequest('ORD-D04-0001');
    const res = await postOrdersWith(c1.cookie, {
      warehouseId: 'wh-au-co', channel: 'FAIR_EVENT', customerName: 'D04',
      discountRate: 0.25, paymentMethod: 'CASH',
      idempotencyKey: 'idem-d04', discountApprovalId: appr.id,
      items: [
        { editionId: 'ed-h01', quantity: 2, unitPrice: 1 },
        { editionId: 'ed-h21', quantity: 1, unitPrice: 1 },
      ],
    });
    assert.equal(res.status, 200, `Giá client sai vẫn phải 200 (server tra DB), thực tế ${res.status}`);
    assert.equal(res.json?.data?.finalAmount, 375000, 'Tính tiền theo giá bìa DB');
    await logoutCookie(c1.cookie);
    console.log('✓ D04');
  }

  // D05: expired / rejected / superseded -> checkout 403 (rẽ PIN, không PIN).
  console.log('\n[D05] Expired / Rejected / Superseded approvals unusable');
  {
    const c1 = await loginCookie(CASHIER.staffId, '1234');
    const mkBody = (id: string, key: string) => ({
      warehouseId: 'wh-au-co', channel: 'FAIR_EVENT', customerName: 'D05',
      discountRate: 0.25, paymentMethod: 'CASH',
      idempotencyKey: key, discountApprovalId: id,
      items: baseItems.map((i) => ({ editionId: i.editionId, quantity: i.quantity })),
    });
    // a) Expired: hết hạn 5 phút.
    const apprA = await approvedRequest('ORD-D05A-0001');
    await db.update(schema.discountApprovalRequests)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(schema.discountApprovalRequests.id, apprA.id));
    const rA = await postOrdersWith(c1.cookie, mkBody(apprA.id, 'idem-d05a'));
    assert.equal(rA.status, 403, `Expired phải 403, thực tế ${rA.status}`);
    // b) Rejected.
    const reqB = await DiscountApprovalService.createRequest({
      orderCode: 'ORD-D05B-0001', warehouseId: 'wh-au-co', cashierId: CASHIER.staffId,
      items: baseItems, requestedDiscountRate: 0.25, actorContext: { ...actorContext },
    });
    await DiscountApprovalService.rejectRequest({
      requestId: reqB.id, rejectedReason: 'D05 test', actorContext: { ...MGR } as any,
    });
    const rB = await postOrdersWith(c1.cookie, mkBody(reqB.id, 'idem-d05b'));
    assert.equal(rB.status, 403, `Rejected phải 403, thực tế ${rB.status}`);
    // c) Superseded: xin lại MỨC KHÁC cùng orderCode -> tự hủy cái cũ.
    // (Giỏ giống hệp sẽ bị createRequest dedup trả lại request cũ — phải
    // đổi nội dung thì mới chuyển SUPERSEDED.)
    const reqC = await DiscountApprovalService.createRequest({
      orderCode: 'ORD-D05C-0001', warehouseId: 'wh-au-co', cashierId: CASHIER.staffId,
      items: baseItems, requestedDiscountRate: 0.25, actorContext: { ...actorContext },
    });
    const approvedC = await DiscountApprovalService.approveRequest({
      requestId: reqC.id, method: 'SHORTCODE_BOUND',
      shortCode: reqC.orderCode.slice(-4).toUpperCase(), actorContext: { ...MGR } as any,
    });
    await DiscountApprovalService.createRequest({
      orderCode: 'ORD-D05C-0001', warehouseId: 'wh-au-co', cashierId: CASHIER.staffId,
      items: baseItems, requestedDiscountRate: 0.30, actorContext: { ...actorContext },
    });
    const rC = await postOrdersWith(c1.cookie, mkBody(approvedC.id, 'idem-d05c'));
    assert.equal(rC.status, 403, `Superseded phải 403, thực tế ${rC.status}`);
    await logoutCookie(c1.cookie);
    console.log('✓ D05 (expired + rejected + superseded)');
  }

  // D08: cùng key nhưng payload khác -> 409 IDEMPOTENCY_CONFLICT.
  console.log('\n[D08] Same key different payload -> IDEMPOTENCY_CONFLICT');
  {
    const c1 = await loginCookie(CASHIER.staffId, '1234');
    const appr = await approvedRequest('ORD-D08-0001');
    const first = await postOrdersWith(c1.cookie, {
      warehouseId: 'wh-au-co', channel: 'FAIR_EVENT', customerName: 'D08',
      discountRate: 0.25, paymentMethod: 'CASH',
      idempotencyKey: 'idem-d08', discountApprovalId: appr.id,
      items: baseItems.map((i) => ({ editionId: i.editionId, quantity: i.quantity })),
    });
    assert.equal(first.status, 200, 'Lần đầu 200');
    const tampered = await postOrdersWith(c1.cookie, {
      warehouseId: 'wh-au-co', channel: 'FAIR_EVENT', customerName: 'D08-GIẢ',
      discountRate: 0.25, paymentMethod: 'CASH',
      idempotencyKey: 'idem-d08', discountApprovalId: appr.id,
      items: [{ editionId: 'ed-h01', quantity: 1 }],
    });
    assert.equal(tampered.status, 409, `Khác payload cùng key phải 409, thực tế ${tampered.status}`);
    assert.equal(tampered.json?.code, 'IDEMPOTENCY_CONFLICT');
    await logoutCookie(c1.cookie);
    console.log('✓ D08');
  }

  // D10: đơn Tặng 100% của cashier vẫn phải qua PIN (không đường bypass).
  console.log('\n[D10] Gift orders require manager PIN');
  {
    const c1 = await loginCookie(CASHIER.staffId, '1234');
    const giftBody = (pin?: string) => ({
      warehouseId: 'wh-au-co', channel: 'FAIR_EVENT', customerName: 'D10',
      discountRate: 1, paymentMethod: 'CASH', isGift: true, giftReason: 'Tặng đối tác D10',
      ...(pin ? { managerPin: pin } : {}),
      items: [{ editionId: 'ed-h01', quantity: 1 }],
    });
    const noPin = await postOrdersWith(c1.cookie, giftBody());
    assert.equal(noPin.status, 403, `Gift không PIN phải 403, thực tế ${noPin.status}`);
    const withPin = await postOrdersWith(c1.cookie, giftBody('9999'));
    assert.equal(withPin.status, 200, `Gift + PIN đúng phải 200, thực tế ${withPin.status}`);
    await logoutCookie(c1.cookie);
    console.log('✓ D10');
  }

  // D11: duyệt lại sau khi đã consume -> conflict (callback muộn không hồi sinh).
  console.log('\n[D11] Late approve after consume -> conflict');
  {
    const appr = await approvedRequest('ORD-D11-0001');
    await OrderService.createOrder({
      warehouseId: 'wh-au-co', channel: 'FAIR_EVENT',
      discountRate: 0.25, paymentMethod: 'CASH',
      cashierId: CASHIER.staffId, actorContext: { ...actorContext },
      idempotencyKey: 'idem-d11', discountApprovalId: appr.id,
      items: baseItems.map((i) => ({ editionId: i.editionId, quantity: i.quantity })),
    });
    let conflict = false;
    try {
      await DiscountApprovalService.approveRequest({
        requestId: appr.id, method: 'ONE_TOUCH', actorContext: { ...MGR } as any,
      });
    } catch (err: any) {
      conflict = err?.code === 'STATE_CONFLICT';
    }
    assert.ok(conflict, 'Duyệt sau consume phải STATE_CONFLICT');
    console.log('✓ D11');
  }

  // A1.7: cashier không xem/hủy duyệt của người khác; list chỉ thấy của mình.
  console.log('\n[A1.7] Cashier cannot read or cancel others\' approvals');
  {
    const c1 = await loginCookie(CASHIER.staffId, '1234');
    const c2 = await loginCookie(CASHIER2.staffId, '1234');
    const pending = await DiscountApprovalService.createRequest({
      orderCode: 'ORD-A17-0001', warehouseId: 'wh-au-co', cashierId: CASHIER.staffId,
      items: baseItems, requestedDiscountRate: 0.25, actorContext: { ...actorContext },
    });
    // GET của người khác -> 403; của mình -> 200.
    const asOther = await getApprovalWith(c2.cookie, pending.id);
    assert.equal(asOther.status, 403, `Xem duyệt người khác phải 403, thực tế ${asOther.status}`);
    const asOwner = await getApprovalWith(c1.cookie, pending.id);
    assert.equal(asOwner.status, 200, 'Chủ yêu cầu xem được của mình');
    // CANCEL của người khác -> 403.
    const cancelOther = await postApprovalWith(c2.cookie, pending.id, { action: 'CANCEL' });
    assert.equal(cancelOther.status, 403, `Hủy duyệt người khác phải 403, thực tế ${cancelOther.status}`);
    // List: cashier2 không thấy pending của cashier1.
    const { GET: listGET } = await import('../src/app/api/pos/discount-approvals/route');
    const list2: any = await listGET(
      new Request('http://localhost/api/pos/discount-approvals', { headers: { Cookie: c2.cookie } }) as any
    );
    const list2Data = (await list2.json())?.data || [];
    assert.equal(list2Data.length, 0, 'Cashier2 không thấy pending của Cashier1');
    const list1: any = await listGET(
      new Request('http://localhost/api/pos/discount-approvals', { headers: { Cookie: c1.cookie } }) as any
    );
    const list1Data = (await list1.json())?.data || [];
    assert.ok(list1Data.some((x: any) => x.id === pending.id), 'Cashier1 thấy pending của mình');
    await logoutCookie(c2.cookie);
    // CANCEL bởi chủ -> SUPERSEDED; checkout sau đó -> 403.
    const cancelOwn = await postApprovalWith(c1.cookie, pending.id, { action: 'CANCEL' });
    assert.equal(cancelOwn.status, 200, `Chủ hủy phải 200, thực tế ${cancelOwn.status}`);
    assert.equal(cancelOwn.json?.data?.status, 'SUPERSEDED');
    const rAfter = await postOrdersWith(c1.cookie, {
      warehouseId: 'wh-au-co', channel: 'FAIR_EVENT', customerName: 'A17',
      discountRate: 0.25, paymentMethod: 'CASH',
      idempotencyKey: 'idem-a17', discountApprovalId: pending.id,
      items: baseItems.map((i) => ({ editionId: i.editionId, quantity: i.quantity })),
    });
    assert.equal(rAfter.status, 403, 'Checkout với approval đã hủy phải 403');
    // CANCEL lần nữa -> 409 (không hủy hai lần).
    const cancelTwice = await postApprovalWith(c1.cookie, pending.id, { action: 'CANCEL' });
    assert.equal(cancelTwice.status, 409, `Hủy hai lần phải 409, thực tế ${cancelTwice.status}`);
    await logoutCookie(c1.cookie);
    console.log('✓ A1.7 + CANCEL flow');
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
    // Đếm đúng đơn của case này (các case trước đã ghi đơn trong cùng DB).
    const mine = await db
      .select()
      .from(schema.orders)
      .where(like(schema.orders.idempotencyKey, 'idem-d06-%'));
    assert.equal(mine.length, 1, 'Chỉ một đơn D06 được ghi');
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
    // Nhả lease D07b để DP1a login lại không bị 403 oan (S-01 hygiene).
    {
      const { POST: logoutPOST } = await import('../src/app/api/auth/logout/route');
      const mm = `${loginRes.headers.get('set-cookie') || ''}`.match(/formapubli_session=([^;]+)/);
      const lr: any = new Request('http://localhost/api/auth/logout', { method: 'POST' });
      lr.cookies = { get: (n: string) => (n === 'formapubli_session' && mm ? { value: mm[1] } : undefined) };
      await logoutPOST(lr);
    }
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
  console.log('\n🎉 A1-H + A1-F ATOMIC: D01-D11 + DP1a + A1.7/CANCEL PASS!');
}

run().catch((err) => {
  console.error('❌ Test thất bại:', err);
  process.exit(1);
});
