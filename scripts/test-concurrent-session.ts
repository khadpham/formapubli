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

  rawClient.close();
  console.log('\n🎉 S-01: S01-S08 PASS!');
}

run().catch((err) => {
  console.error('❌ Test thất bại:', err);
  process.exit(1);
});
