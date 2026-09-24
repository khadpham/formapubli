/**
 * S-01: lease một phiên cashier — giữ máy cũ, chặn máy mới.
 * S01 login A ok, B cùng staff -> 403 SESSION_ACTIVE_ELSEWHERE, A vẫn sống.
 * S02 A logout -> B login ok.
 * S03 lease hết TTL -> B login ok (tự nhả, không cần logout).
 * S04 hai login đồng thời -> đúng một thắng.
 * S05 heartbeat phiên cũ sau khi có phiên mới -> không hồi sinh, phiên mới nguyên.
 * S06 logout cũ không xóa lease phiên mới.
 * S07 force-release thu hồi cookie cũ (401), trả version mới.
 * S08 force-release lại với expected cũ khi đã có phiên mới -> 409, phiên mới nguyên.
 *
 * DB riêng formapubli_test_concurrent_session.db — KHÔNG chạm prod.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_concurrent_session.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

async function snapshotOrders(db: any, schema: any) {
  const orders = await db.select().from(schema.orders);
  const ledger = await db.select().from(schema.inventoryLedger);
  return { orders: orders.length, ledger: ledger.length };
}

async function run() {
  console.log('--- TEST S-01: CONCURRENT CASHIER SESSION ---');
  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-concurrent-session');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const { eq } = await import('drizzle-orm');
  const schema = await import('../src/db/schema');
  const { hashStaffPasscodeV2 } = await import('../src/lib/auth-session');
  const { POST: loginPOST } = await import('../src/app/api/auth/login/route');
  const { POST: logoutPOST } = await import('../src/app/api/auth/logout/route');
  const { GET: meGET } = await import('../src/app/api/auth/me/route');
  const { POST: heartbeatPOST } = await import('../src/app/api/auth/heartbeat/route');
  const { POST: releasePOST } = await import('../src/app/api/staff/[staffId]/release-session/route');

  const rawClient = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(rawClient);

  await db.insert(schema.warehouses).values([
    { id: 'wh-au-co', code: 'KHO_AU_CO', name: 'Kho Au Co', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
  ]);
  // S23 cần catalog tối thiểu (createOrder validate ấn bản trước khi tới B0c).
  await db.insert(schema.works).values([
    { id: 'work-h01', code: 'W-H01', title: 'Sach H01', author: 'TG' },
  ]);
  await db.insert(schema.editions).values([
    { id: 'ed-h01', code: 'H01', workId: 'work-h01', title: 'Sach H01', isbn: '9780000000001', isbnLast4: '0001', coverPrice: 150000, isActive: true },
  ]);
  const mkStaff = async (staffId: string, role: string) => {
    await db.insert(schema.staffAccounts).values({
      staffId, fullName: staffId, role, passcodeHash: await hashStaffPasscodeV2('1234', 'salt-' + staffId),
      salt: 'salt-' + staffId, isActive: true, sessionVersion: 1,
    });
  };
  await mkStaff('CASH-1', 'ROLE_CASHIER');
  await mkStaff('CASH-2', 'ROLE_CASHIER');
  await mkStaff('MGR-1', 'ROLE_MANAGER');

  const post = async (fn: any, url: string, body: any, cookie?: string) => {
    const headers: any = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    const res = await fn(new Request(url, { method: 'POST', headers, body: JSON.stringify(body) }) as any);
    let json: any = null;
    try { json = await res.json(); } catch { /* empty */ }
    const setCookie: string | null = res.headers.get('set-cookie');
    return { status: res.status, json, setCookie };
  };
  const login = (staffId: string, passcode = '1234', deviceLabel = 'may-1') =>
    post(loginPOST, 'http://localhost/api/auth/login', { staffId, passcode, deviceLabel });
  const cookieOf = (setCookie: string | null) => {
    if (!setCookie) return '';
    const m = `${setCookie}`.match(/formapubli_session=([^;]+)/);
    return m ? `formapubli_session=${m[1]}` : '';
  };
  // Logout route đọc req.cookies (NextRequest) — test gắn shim cookie.
  const logout = async (cookie: string) => {
    const r: any = new Request('http://localhost/api/auth/logout', {
      method: 'POST', headers: { Cookie: cookie },
    });
    const m = `${cookie}`.match(/formapubli_session=([^;]+)/);
    r.cookies = {
      get: (n: string) => (n === 'formapubli_session' && m ? { value: m[1] } : undefined),
    };
    const res = await logoutPOST(r);
    let json: any = null;
    try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, json };
  };
  const meJson = async (cookie: string) => {
    const res = await meGET(new Request('http://localhost/api/auth/me', { headers: { Cookie: cookie } }) as any);
    let json: any = null;
    try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, json };
  };
  const release = async (target: string, body: any, mgrCookie: string) => {
    const res = await releasePOST(
      new Request(`http://localhost/api/staff/${target}/release-session`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: mgrCookie },
        body: JSON.stringify(body),
      }) as any,
      { params: { staffId: target } } as any
    );
    let json: any = null;
    try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, json };
  };
  const heartbeat = async (cookie: string) => {
    const res = await heartbeatPOST(
      new Request('http://localhost/api/auth/heartbeat', { method: 'POST', headers: { Cookie: cookie } }) as any
    );
    return res.status;
  };

  // S01: A ok, B bị 403, A vẫn sống.
  console.log('\n[S01] Second concurrent login blocked, first stays alive');
  {
    const a = await login('CASH-1', '1234', 'may-A');
    assert.equal(a.status, 200, 'A login phải 200');
    const cookieA = cookieOf(a.setCookie);
    assert.ok(cookieA, 'A phải có cookie');
    const b = await login('CASH-1', '1234', 'may-B');
    assert.equal(b.status, 403, `B phải 403, thực tế ${b.status}`);
    assert.equal(b.json?.code, 'SESSION_ACTIVE_ELSEWHERE');
    assert.equal((await meJson(cookieA)).status, 200, 'Phiên A vẫn sống');
    console.log('✓ S01');
  }

  // S02: A logout -> B login ok.
  console.log('\n[S02] Logout releases, next login succeeds');
  {
    const a = await login('CASH-2', '1234', 'may-A');
    const cookieA = cookieOf(a.setCookie);
    assert.equal(a.status, 200);
    const lo = await logout(cookieA);
    assert.equal(lo.status, 200);
    const b = await login('CASH-2', '1234', 'may-B');
    assert.equal(b.status, 200, 'Sau logout máy B phải vào được');
    // Dọn: logout B để test sau sạch.
    await logout( cookieOf(b.setCookie));
    console.log('✓ S02');
  }

  // S03: lease hết TTL -> B login ok (tự nhả).
  console.log('\n[S03] Expired TTL auto-releases');
  {
    await rawClient.execute({ sql: `DELETE FROM active_sessions WHERE staff_id = 'CASH-1'`, args: [] });
    const a = await login('CASH-1', '1234', 'may-A');
    assert.equal(a.status, 200);
    await rawClient.execute({
      sql: `UPDATE active_sessions SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE staff_id = 'CASH-1'`,
      args: [],
    });
    const b = await login('CASH-1', '1234', 'may-B');
    assert.equal(b.status, 200, 'Hết TTL máy B phải vào được');
    await logout( cookieOf(b.setCookie));
    console.log('✓ S03');
  }

  // S04: hai login đồng thời -> đúng một thắng.
  console.log('\n[S04] Simultaneous logins -> exactly one wins');
  {
    // Dọn lease CASH-2 trước (S02 đã logout, nhưng chắc chắn).
    await rawClient.execute({ sql: `DELETE FROM active_sessions WHERE staff_id = 'CASH-2'`, args: [] });
    const results = await Promise.allSettled([
      login('CASH-2', '1234', 'may-X'),
      login('CASH-2', '1234', 'may-Y'),
    ]);
    const okCount = results.filter(
      (r) => r.status === 'fulfilled' && (r.value as any).status === 200
    ).length;
    assert.equal(okCount, 1, `Phải đúng 1 thắng, thực tế ${okCount}`);
    const winner = results.find((r) => r.status === 'fulfilled' && (r.value as any).status === 200) as any;
    await logout( cookieOf(winner.value.setCookie));
    console.log('✓ S04');
  }

  // S05: heartbeat phiên cũ sau khi có phiên mới -> không hồi sinh.
  console.log('\n[S05] Old heartbeat cannot resurrect after new session');
  {
    await rawClient.execute({ sql: `DELETE FROM active_sessions WHERE staff_id = 'CASH-1'`, args: [] });
    const a = await login('CASH-1', '1234', 'may-A');
    const cookieA = cookieOf(a.setCookie);
    const sessionA = (await meJson(cookieA)).json?.data?.sessionId;
    assert.ok(sessionA, 'A phải có sessionId');
    const mgr = await login('MGR-1', '1234', 'may-M');
    const mgrCookie = cookieOf(mgr.setCookie);
    const rel = await release('CASH-1', { reason: 'test S05', expectedSessionVersion: 1 }, mgrCookie);
    assert.equal(rel.status, 200, `Force-release phải 200, thực tế ${rel.status}`);
    const b = await login('CASH-1', '1234', 'may-B');
    assert.equal(b.status, 200, 'B login sau release phải 200');
    const cookieB = cookieOf(b.setCookie);
    // Heartbeat bằng cookie cũ (session A đã chết) -> 401, không hồi sinh.
    assert.equal(await heartbeat(cookieA), 401, 'Heartbeat phiên cũ phải 401');
    assert.equal((await meJson(cookieB)).status, 200, 'Phiên B nguyên vẹn');
    await logout( cookieB);
    await logout( mgrCookie);
    console.log('✓ S05');
  }

  // S06: logout cũ không xóa lease phiên mới.
  console.log('\n[S06] Old logout does not delete new lease');
  {
    await rawClient.execute({ sql: `DELETE FROM active_sessions WHERE staff_id = 'CASH-2'`, args: [] });
    const a = await login('CASH-2', '1234', 'may-A');
    const cookieA = cookieOf(a.setCookie);
    const mgr = await login('MGR-1', '1234', 'may-M');
    const mgrCookie = cookieOf(mgr.setCookie);
    await release('CASH-2', { reason: 'test S06' }, mgrCookie);
    const b = await login('CASH-2', '1234', 'may-B');
    const cookieB = cookieOf(b.setCookie);
    assert.equal(b.status, 200);
    // Logout bằng cookie cũ (đã chết) -> phiên B vẫn sống.
    await logout( cookieA);
    assert.equal((await meJson(cookieB)).status, 200, 'Phiên B nguyên vẹn sau logout cũ');
    await logout( cookieB);
    await logout( mgrCookie);
    console.log('✓ S06');
  }

  // S07: force-release thu hồi cookie cũ.
  console.log('\n[S07] Force-release revokes old cookie');
  {
    await rawClient.execute({ sql: `DELETE FROM active_sessions WHERE staff_id = 'CASH-1'`, args: [] });
    const a = await login('CASH-1', '1234', 'may-A');
    const cookieA = cookieOf(a.setCookie);
    assert.equal((await meJson(cookieA)).status, 200, 'A sống trước release');
    const mgr = await login('MGR-1', '1234', 'may-M');
    const mgrCookie = cookieOf(mgr.setCookie);
    const rel = await release('CASH-1', { reason: 'test S07' }, mgrCookie);
    assert.equal(rel.status, 200);
    assert.equal((await meJson(cookieA)).status, 401, 'Cookie cũ phải chết sau force-release');
    await logout( mgrCookie);
    console.log('✓ S07');
  }

  // S08: force-release lại với expected cũ khi đã có phiên mới -> 409.
  console.log('\n[S08] Stale force-release retry -> 409, new session intact');
  {
    await rawClient.execute({ sql: `DELETE FROM active_sessions WHERE staff_id = 'CASH-2'`, args: [] });
    // Reset version CASH-2 về 1 để expected khớp kịch bản.
    await rawClient.execute({ sql: `UPDATE staff_accounts SET session_version = 1 WHERE staff_id = 'CASH-2'`, args: [] });
    const a = await login('CASH-2', '1234', 'may-A');
    const cookieA = cookieOf(a.setCookie);
    const sessionA = (await meJson(cookieA)).json?.data?.sessionId;
    const mgr = await login('MGR-1', '1234', 'may-M');
    const mgrCookie = cookieOf(mgr.setCookie);
    const rel1 = await release('CASH-2', { reason: 'test S08-1', expectedSessionId: sessionA, expectedSessionVersion: 1 }, mgrCookie);
    assert.equal(rel1.status, 200, 'Release lần 1 phải 200');
    const b = await login('CASH-2', '1234', 'may-B');
    assert.equal(b.status, 200, 'B login sau release phải 200');
    const cookieB = cookieOf(b.setCookie);
    // Retry release với expected của phiên A đã chết -> 409, không hủy B.
    const rel2 = await release('CASH-2', { reason: 'test S08-retry', expectedSessionId: sessionA, expectedSessionVersion: 1 }, mgrCookie);
    assert.equal(rel2.status, 409, `Retry stale phải 409, thực tế ${rel2.status}`);
    assert.equal((await meJson(cookieB)).status, 200, 'Phiên B nguyên vẹn');
    await logout( cookieB);
    await logout( mgrCookie);
    console.log('✓ S08');
  }

  // S21: heartbeat sau khi đổi PIN/version -> 401, không giữ lease chặn login mới.
  console.log('\n[S21] Heartbeat after version bump -> 401');
  {
    await rawClient.execute({ sql: `DELETE FROM active_sessions WHERE staff_id = 'CASH-1'`, args: [] });
    const a = await login('CASH-1', '1234', 'may-A');
    const cookieA = cookieOf(a.setCookie);
    assert.equal(a.status, 200);
    assert.equal(await heartbeat(cookieA), 200, 'Heartbeat khi version khớp phải 200');
    // Giả lập đổi PIN (bump version) — token/heartbeat cũ phải chết.
    await rawClient.execute({ sql: `UPDATE staff_accounts SET session_version = session_version + 1 WHERE staff_id = 'CASH-1'`, args: [] });
    assert.equal(await heartbeat(cookieA), 401, 'Heartbeat sau đổi version phải 401');
    assert.equal((await meJson(cookieA)).status, 401, 'Me sau đổi version phải 401');
    const mgr = await login('MGR-1', '1234', 'may-M');
    const mgrCookie = cookieOf(mgr.setCookie);
    await post(logoutPOST, 'http://localhost/api/auth/logout', {}, mgrCookie).catch(() => {});
    console.log('✓ S21');
  }

  // S22: reset PIN xóa lease -> login mới bằng PIN mới không bị chặn oan.
  console.log('\n[S22] PIN reset clears lease for fresh login');
  {
    await rawClient.execute({ sql: `DELETE FROM active_sessions WHERE staff_id = 'CASH-2'`, args: [] });
    const a = await login('CASH-2', '1234', 'may-A');
    assert.equal(a.status, 200);
    const mgr = await login('MGR-1', '1234', 'may-M');
    const mgrCookie = cookieOf(mgr.setCookie);
    const { PATCH: patchStaff } = await import('../src/app/api/staff/[staffId]/route');
    const rp: any = await patchStaff(
      new Request('http://localhost/api/staff/CASH-2', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: mgrCookie },
        body: JSON.stringify({ passcode: '9999' }),
      }) as any,
      { params: { staffId: 'CASH-2' } } as any
    );
    assert.equal(rp.status, 200, 'Reset PIN phải 200');
    const b = await login('CASH-2', '9999', 'may-B');
    assert.equal(b.status, 200, 'Login PIN mới ngay sau reset phải 200 (không bị lease cũ chặn)');
    await logout(cookieOf(b.setCookie));
    // Khôi phục PIN 1234 để không ảnh hưởng thứ tự chạy khác (DB file riêng, nhưng gọn).
    const rp2: any = await patchStaff(
      new Request('http://localhost/api/staff/CASH-2', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: mgrCookie },
        body: JSON.stringify({ passcode: '1234' }),
      }) as any,
      { params: { staffId: 'CASH-2' } } as any
    );
    assert.equal(rp2.status, 200);
    await logout(mgrCookie);
    console.log('✓ S22');
  }

  // S23: đơn ghi khi lease đã chết giữa chừng -> FORBIDDEN, không ghi gì.
  console.log('\n[S23] Order blocked when lease dies before commit');
  {
    await rawClient.execute({ sql: `DELETE FROM active_sessions WHERE staff_id = 'CASH-2'`, args: [] });
    const a = await login('CASH-2', '1234', 'may-A');
    const cookieA = cookieOf(a.setCookie);
    const sessionA = (await meJson(cookieA)).json?.data?.sessionId;
    assert.ok(sessionA, 'A phải có sessionId');
    // Lease chết (TTL qua) nhưng token còn hạn -> guard/tx phải chặn ghi.
    await rawClient.execute({ sql: `UPDATE active_sessions SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE staff_id = 'CASH-2'`, args: [] });
    const { OrderService } = await import('../src/services/order.service');
    const before = await snapshotOrders(db, schema);
    let forbidden = false;
    try {
      await OrderService.createOrder({
        warehouseId: 'wh-au-co', channel: 'FAIR_EVENT',
        discountRate: 0, paymentMethod: 'CASH',
        cashierId: 'CASH-2',
        actorContext: { staffId: 'CASH-2', role: 'ROLE_CASHIER', sessionId: sessionA },
        idempotencyKey: 'idem-s23', items: [{ editionId: 'ed-h01', quantity: 1 }],
      } as any);
    } catch (err: any) {
      forbidden = err?.code === 'FORBIDDEN';
    }
    assert.ok(forbidden, 'Ghi đơn khi lease chết phải FORBIDDEN');
    const after = await snapshotOrders(db, schema);
    assert.deepEqual(after, before, 'Không ghi gì khi bị chặn');
    await post(logoutPOST, 'http://localhost/api/auth/logout', {}, cookieA).catch(() => {});
    console.log('✓ S23');
  }

  // S24: guard đã pass, lease bị thu hồi TRƯỚC khi tx commit -> B0c đọc
  // lại trong tx và chặn (không dùng kết quả guard cũ). Mô phỏng xác định
  // cho race "qua guard rồi chờ, bị force-release trước commit".
  console.log('\n[S24] Revoke between guard-pass and tx-commit blocks write');
  {
    await rawClient.execute({ sql: `DELETE FROM active_sessions WHERE staff_id = 'CASH-1'`, args: [] });
    const a = await login('CASH-1', '1234', 'may-A');
    const cookieA = cookieOf(a.setCookie);
    const sessionA = (await meJson(cookieA)).json?.data?.sessionId;
    assert.ok(sessionA, 'A phải có sessionId');
    assert.equal((await meJson(cookieA)).status, 200, 'Guard pass khi lease còn sống');
    // Thu hồi lease SAU khi guard đã pass, TRƯỚC khi tx ghi đơn chạy.
    await rawClient.execute({ sql: `DELETE FROM active_sessions WHERE staff_id = 'CASH-1'`, args: [] });
    const { OrderService } = await import('../src/services/order.service');
    const before = await snapshotOrders(db, schema);
    let forbidden = false;
    try {
      await OrderService.createOrder({
        warehouseId: 'wh-au-co', channel: 'FAIR_EVENT',
        discountRate: 0, paymentMethod: 'CASH',
        cashierId: 'CASH-1',
        actorContext: { staffId: 'CASH-1', role: 'ROLE_CASHIER', sessionId: sessionA },
        idempotencyKey: 'idem-s24', items: [{ editionId: 'ed-h01', quantity: 1 }],
      } as any);
    } catch (err: any) {
      forbidden = err?.code === 'FORBIDDEN';
    }
    assert.ok(forbidden, 'B0c phải đọc lại trong tx và chặn FORBIDDEN');
    const after = await snapshotOrders(db, schema);
    assert.deepEqual(after, before, 'Không ghi gì khi bị chặn giữa chừng');
    console.log('✓ S24');
  }

  // S25: cờ rollout + grace legacy.
  // - Tắt cờ: guard bỏ qua lease hoàn toàn (bước 1 triển khai).
  // - Bật cờ (mặc định): token CÓ sessionId nhưng không có lease row -> 401
  //   (đây mới là enforcement thật); token legacy KHÔNG sessionId được grace
  //   tới hết hạn tự nhiên (không miễn trừ vô thời hạn vì login mới luôn gắn
  //   sessionId và token cũ chết theo expiresAt ≤24h).
  console.log('\n[S25] Rollout flag gates enforcement');
  {
    const { signSession, SESSION_COOKIE_NAME } = await import('../src/lib/auth-session');
    const bare = await signSession({
      role: 'ROLE_CASHIER' as any, actorId: 'CASH-1',
      issuedAt: Date.now(), expiresAt: Date.now() + 3600000,
    });
    const bareCookie = `${SESSION_COOKIE_NAME}=${bare}`;
    const orphan = await signSession({
      role: 'ROLE_CASHIER' as any, actorId: 'CASH-1', sessionId: 'sess-khong-ton-tai',
      issuedAt: Date.now(), expiresAt: Date.now() + 3600000,
    });
    const orphanCookie = `${SESSION_COOKIE_NAME}=${orphan}`;
    await rawClient.execute({ sql: `DELETE FROM active_sessions WHERE staff_id = 'CASH-1'`, args: [] });
    process.env.SESSION_LEASE_ENFORCE = 'false';
    assert.equal((await meJson(orphanCookie)).status, 200, 'Tắt cờ: bỏ qua lease');
    delete process.env.SESSION_LEASE_ENFORCE;
    assert.equal((await meJson(orphanCookie)).status, 401, 'Bật cờ: sessionId không lease bị chặn');
    assert.equal((await meJson(bareCookie)).status, 200, 'Bật cờ: token legacy không sessionId được grace tới hết hạn');
    console.log('✓ S25');
  }

  rawClient.close();
  console.log('\n🎉 S-01: S01-S08 + S21 + S22 + S23 + S24 + S25 PASS!');
}

run().catch((err) => {
  console.error('❌ Test thất bại:', err);
  process.exit(1);
});
