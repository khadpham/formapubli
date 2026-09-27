/**
 * Vòng đời kho (PATCH/DELETE /api/warehouses/[id]) — RBAC + validate + audit + lọc POS.
 *
 * L01: không phiên / phiên giả / CASHIER / WAREHOUSE đều không xoá hay ngưng được kho.
 * L02: id rỗng hoặc toàn khoảng trắng bị từ chối (400).
 * L03: isActive bị ép về boolean thật, không nhận "true"/1 như chuỗi/số.
 * L04: ngưng rồi mở lại đều được ghi nhật ký (WAREHOUSE_DEACTIVATED / WAREHOUSE_ACTIVATED).
 * L05: kho đã ngưng biến mất khỏi list của thu ngân, vẫn thấy với quản lý all=true.
 * L06: xoá kho còn tồn -> 409 kèm hướng dẫn "Ngưng hoạt động", kho vẫn còn, không ghi log xoá.
 * L07: xoá kho rỗng chưa phát sinh nghiệp vụ -> 200, biến mất, có log WAREHOUSE_DELETED.
 *
 * DB riêng formapubli_test_warehouse_lifecycle.db — KHÔNG chạm prod.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';
import { eq } from 'drizzle-orm';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_warehouse_lifecycle.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

const CASHIER = { staffId: 'staff-tn', fullName: 'Thu Ngan', passcode: '1234', role: 'ROLE_CASHIER' } as const;
const KEEPER = { staffId: 'staff-kho', fullName: 'Thu Kho', passcode: '1234', role: 'ROLE_WAREHOUSE' } as const;
const MGR = { staffId: 'staff-la', fullName: 'Lan Anh', passcode: '1234', role: 'ROLE_MANAGER' } as const;

async function run() {
  console.log('--- TEST: WAREHOUSE LIFECYCLE (RBAC / VALIDATE / AUDIT / POS LIST) ---');
  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-warehouse-lifecycle');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL!, expectTables: ['warehouses', 'audit_logs'] });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../src/db/schema');
  const { PATCH: patchWh, DELETE: deleteWh } = await import('../src/app/api/warehouses/[id]/route');
  const { GET: listWh } = await import('../src/app/api/warehouses/route');
  const { POST: postLogin } = await import('../src/app/api/auth/login/route');
  const { hashStaffPasscodeV2 } = await import('../src/lib/auth-session');

  const rawClient = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(rawClient);

  await db.insert(schema.warehouses).values([
    { id: 'wh-co', code: 'KHO_CO', name: 'Kho Co', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
    { id: 'wh-rong', code: 'KHO_RONG', name: 'Kho Rong', isActive: true, isSellableOnPos: true, warehouseType: 'FAIR_EVENT' },
    { id: 'wh-tam', code: 'KHO_TAM', name: 'Kho Tam', isActive: true, isSellableOnPos: true, warehouseType: 'FAIR_EVENT' },
  ]);
  await db.insert(schema.works).values([{ id: 'work-w01', code: 'W-01', title: 'Sach', author: 'TG' }]);
  await db.insert(schema.editions).values([
    { id: 'ed-h01', code: 'H01', workId: 'work-w01', title: 'Sach H01', isbn: '9780000000001', isbnLast4: '0001', coverPrice: 150000, isActive: true },
  ]);
  await db.insert(schema.stockBalances).values([
    { id: 'sb-h01', editionId: 'ed-h01', warehouseId: 'wh-co', condition: 'NEW', physicalQuantity: 42 },
  ]);
  for (const s of [CASHIER, KEEPER, MGR]) {
    await db.insert(schema.staffAccounts).values({
      staffId: s.staffId, fullName: s.fullName, role: s.role,
      passcodeHash: await hashStaffPasscodeV2(s.passcode, `salt-${s.staffId}`), salt: `salt-${s.staffId}`,
      isActive: true, sessionVersion: 1,
    });
  }

  const loginCookie = async (staffId: string, passcode: string) => {
    const res: any = await postLogin(new Request('http://localhost/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staffId, passcode }),
    }) as any);
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

  const patchWith = async (cookie: string | null, id: string, body: any, method: 'PATCH' | 'DELETE' = 'PATCH') => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    const fn = method === 'PATCH' ? patchWh : deleteWh;
    const res: any = await fn(
      new Request(`http://localhost/api/warehouses/${encodeURIComponent(id)}`, {
        method, headers, ...(method === 'PATCH' ? { body: JSON.stringify(body) } : {}),
      }) as any,
      { params: { id } } as any
    );
    return { status: res.status, json: await res.json() };
  };

  const auditRows = async (action: string, code?: string) => {
    const rows = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, action));
    return code ? rows.filter((r: any) => `${r.details}`.includes(code)) : rows;
  };
  const whRow = async (id: string) =>
    (await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, id)).limit(1))[0];

  // ---------------------------------------------------------------- L01
  console.log('\n[L01] Cashier / thu kho / phiên giả không xoá hay ngưng được kho');
  {
    const cashier = await loginCookie(CASHIER.staffId, CASHIER.passcode);
    assert.equal(cashier.status, 200, 'Login thu ngân');
    const keeper = await loginCookie(KEEPER.staffId, KEEPER.passcode);
    assert.equal(keeper.status, 200, 'Login thủ kho');
    const forged = 'formapubli_session=bm90LWEtdmFsaWQtdG9rZW4.bm90LWEtc2lnbmF0dXJl';

    const cases: Array<[string, string | null, 'PATCH' | 'DELETE']> = [
      ['không cookie PATCH', null, 'PATCH'],
      ['không cookie DELETE', null, 'DELETE'],
      ['cookie giả PATCH', forged, 'PATCH'],
      ['cookie giả DELETE', forged, 'DELETE'],
    ];
    for (const [label, cookie, method] of cases) {
      const r = await patchWith(cookie, 'wh-rong', { isActive: false }, method);
      assert.equal(r.status, 401, `${label} phải 401 (thiếu phiên), thực tế ${r.status}`);
      assert.equal(r.json?.code, 'AUTH_REQUIRED', `${label} phải AUTH_REQUIRED`);
    }
    // Với phiên hợp lệ nhưng thiếu quyền -> 403.
    for (const [label, cookie] of [['thu ngân', cashier.cookie], ['thủ kho', keeper.cookie]] as const) {
      const rDeact = await patchWith(cookie, 'wh-rong', { isActive: false });
      assert.equal(rDeact.status, 403, `${label} ngưng kho phải 403, thực tế ${rDeact.status}`);
      assert.equal(rDeact.json?.code, 'FORBIDDEN', `${label} phải FORBIDDEN`);
      const rDelete = await patchWith(cookie, 'wh-rong', undefined, 'DELETE');
      assert.equal(rDelete.status, 403, `${label} xoá kho phải 403, thực tế ${rDelete.status}`);
      assert.equal(rDelete.json?.code, 'FORBIDDEN', `${label} phải FORBIDDEN`);
    }
    const row = await whRow('wh-rong');
    assert.ok(row, 'Kho phải còn nguyên');
    assert.equal(row!.isActive, true, 'Kho KHÔNG được phép bị ngưng bởi cashier/thủ kho');
    assert.equal((await auditRows('WAREHOUSE_DELETED', 'KHO_RONG')).length, 0, 'Không ghi log xoá kho');
    assert.equal((await auditRows('WAREHOUSE_DEACTIVATED', 'KHO_RONG')).length, 0, 'Không ghi log ngưng kho');
    await logoutCookie(cashier.cookie);
    await logoutCookie(keeper.cookie);
    console.log('✓ L01');
  }

  // ---------------------------------------------------------------- L02
  console.log('\n[L02] id rỗng / toàn khoảng trắng bị từ chối');
  {
    const mgr = await loginCookie(MGR.staffId, MGR.passcode);
    assert.equal(mgr.status, 200, 'Login quản lý');
    for (const [label, id] of [['rỗng', ''], ['khoảng trắng', '   '], ['khoảng trắng mã hoá', '%20%20%20']] as const) {
      const p = await patchWith(mgr.cookie, id, { name: 'X' });
      assert.equal(p.status, 400, `PATCH id ${label} phải 400, thực tế ${p.status}`);
      const d = await patchWith(mgr.cookie, id, undefined, 'DELETE');
      assert.equal(d.status, 400, `DELETE id ${label} phải 400, thực tế ${d.status}`);
    }
    await logoutCookie(mgr.cookie);
    console.log('✓ L02');
  }

  // ---------------------------------------------------------------- L03
  console.log('\n[L03] isActive luôn là boolean thật, không nhận chuỗi/số như true');
  {
    const mgr = await loginCookie(MGR.staffId, MGR.passcode);
    for (const [label, raw] of [['chuỗi "true"', 'true'], ['số 1', 1], ['chuỗi "yes"', 'yes']] as const) {
      const r = await patchWith(mgr.cookie, 'wh-tam', { isActive: raw });
      assert.equal(r.status, 200, `PATCH isActive=${label} phải 200, thực tế ${r.status}`);
      const row = await whRow('wh-tam');
      assert.equal(typeof row!.isActive, 'boolean', `isActive phải là boolean, thực tế ${typeof row!.isActive}`);
      assert.equal(row!.isActive, false, `isActive=${label} không được bật kho lên (chỉ boolean true mới bật)`);
      assert.equal(r.json?.data?.isActive, false, 'Response cũng phải là boolean false');
    }
    // boolean thật thì vẫn bật/tắt được.
    const on = await patchWith(mgr.cookie, 'wh-tam', { isActive: true });
    assert.equal(on.json?.data?.isActive, true, 'isActive: true phải bật được');
    await logoutCookie(mgr.cookie);
    console.log('✓ L03');
  }

  // ---------------------------------------------------------------- L04
  console.log('\n[L04] Ngưng rồi mở lại đều được ghi nhật ký (có mã + tên kho)');
  {
    const mgr = await loginCookie(MGR.staffId, MGR.passcode);
    const off = await patchWith(mgr.cookie, 'wh-rong', { isActive: false });
    assert.equal(off.status, 200, `Ngưng kho phải 200, thực tế ${off.status}`);
    assert.equal((await whRow('wh-rong'))!.isActive, false, 'Kho phải được ngưng');
    const deact = await auditRows('WAREHOUSE_DEACTIVATED', 'KHO_RONG');
    assert.equal(deact.length, 1, `Phải có đúng 1 log WAREHOUSE_DEACTIVATED, thực tế ${deact.length}`);
    assert.equal(deact[0].actorId, MGR.staffId, 'Log phải ghi ai đã ngưng');
    assert.equal(deact[0].actorRole, MGR.role);
    assert.match(`${deact[0].details}`, /KHO_RONG/, 'Log phải có mã kho');
    assert.match(`${deact[0].details}`, /Kho Rong/, 'Log phải có tên kho');

    const on = await patchWith(mgr.cookie, 'wh-rong', { isActive: true });
    assert.equal(on.status, 200, `Mở lại kho phải 200, thực tế ${on.status}`);
    assert.equal((await whRow('wh-rong'))!.isActive, true, 'Kho phải hoạt động lại');
    const act = await auditRows('WAREHOUSE_ACTIVATED', 'KHO_RONG');
    assert.equal(act.length, 1, `Phải có đúng 1 log WAREHOUSE_ACTIVATED, thực tế ${act.length}`);
    assert.equal(act[0].actorId, MGR.staffId, 'Log phải ghi ai đã mở lại');
    assert.match(`${act[0].details}`, /KHO_RONG/, 'Log phải có mã kho');
    assert.match(`${act[0].details}`, /Kho Rong/, 'Log phải có tên kho');
    await logoutCookie(mgr.cookie);
    console.log('✓ L04');
  }

  // ---------------------------------------------------------------- L05
  console.log('\n[L05] Kho đã ngưng: thu ngân không thấy, quản lý (all=true) vẫn thấy');
  {
    const mgr = await loginCookie(MGR.staffId, MGR.passcode);
    const off = await patchWith(mgr.cookie, 'wh-rong', { isActive: false });
    assert.equal(off.status, 200, 'Ngưng kho phục vụ kiểm tra list');

    const cashier = await loginCookie(CASHIER.staffId, CASHIER.passcode);
    assert.equal(cashier.status, 200, 'Login thu ngân');
    const posList: any = await listWh(
      new Request('http://localhost/api/warehouses', { headers: { Cookie: cashier.cookie } }) as any
    );
    const posData = (await posList.json())?.data || [];
    assert.ok(!posData.some((w: any) => w.id === 'wh-rong'), 'Thu ngân KHÔNG thấy kho đã ngưng');
    assert.ok(posData.some((w: any) => w.id === 'wh-co'), 'Thu ngân vẫn thấy kho đang hoạt động');
    await logoutCookie(cashier.cookie);

    const mgrAll: any = await listWh(
      new Request('http://localhost/api/warehouses?all=true', { headers: { Cookie: mgr.cookie } }) as any
    );
    const mgrData = (await mgrAll.json())?.data || [];
    const found = mgrData.find((w: any) => w.id === 'wh-rong');
    assert.ok(found, 'Quản lý phải thấy kho đã ngưng qua all=true để mở lại được');
    assert.equal(found.isActive, false, 'Quản lý thấy isActive=false');
    assert.equal(mgrData.length, 3, 'all=true trả về cả kho đã ngưng');
    await logoutCookie(mgr.cookie);
    console.log('✓ L05');
  }

  // ---------------------------------------------------------------- L06
  console.log('\n[L06] Xoá kho còn tồn -> 409, kho còn nguyên, hướng dẫn Ngưng hoạt động');
  {
    const mgr = await loginCookie(MGR.staffId, MGR.passcode);
    const r = await patchWith(mgr.cookie, 'wh-co', undefined, 'DELETE');
    assert.equal(r.status, 409, `Kho còn tồn phải 409, thực tế ${r.status}`);
    assert.equal(r.json?.code, 'STATE_CONFLICT', 'Code phải là STATE_CONFLICT');
    assert.match(`${r.json?.error}`, /Ngưng hoạt động/, 'Lỗi phải chỉ đường dẫn "Ngưng hoạt động" cho UI');
    assert.ok(!/select|sqlite|stack|at Object/i.test(`${r.json?.error}`), 'Lỗi không được lộ chi tiết DB/ stack');
    assert.ok(!JSON.stringify(r.json).match(/passcode|hash|salt|password/i), 'Lỗi không được lộ bí mật');
    assert.ok(await whRow('wh-co'), 'Kho còn tồn phải tồn tại sau khi DELETE bị từ chối');
    assert.equal((await auditRows('WAREHOUSE_DELETED', 'KHO_RONG')).length, 0, 'DELETE bị từ chối thì không ghi log xoá');
    await logoutCookie(mgr.cookie);
    console.log('✓ L06');
  }

  // ---------------------------------------------------------------- L07
  console.log('\n[L07] Xoá kho rỗng chưa phát sinh nghiệp vụ -> 200 + ghi log');
  {
    const mgr = await loginCookie(MGR.staffId, MGR.passcode);
    const r = await patchWith(mgr.cookie, 'wh-rong', undefined, 'DELETE');
    assert.equal(r.status, 200, `Xoá kho rỗng phải 200, thực tế ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`);
    assert.equal(r.json?.success, true);
    assert.ok(!(await whRow('wh-rong')), 'Kho phải biến mất khỏi DB');
    const del = await auditRows('WAREHOUSE_DELETED', 'KHO_RONG');
    assert.equal(del.length, 1, `Phải có đúng 1 log WAREHOUSE_DELETED, thực tế ${del.length}`);
    assert.equal(del[0].actorId, MGR.staffId, 'Log phải ghi ai đã xoá');
    assert.match(`${del[0].details}`, /KHO_RONG/, 'Log phải có mã kho');
    assert.match(`${del[0].details}`, /Kho Rong/, 'Log phải có tên kho');
    const again = await patchWith(mgr.cookie, 'wh-rong', undefined, 'DELETE');
    assert.equal(again.status, 404, `Xoá lần hai phải 404, thực tế ${again.status}`);
    await logoutCookie(mgr.cookie);
    console.log('✓ L07');
  }

  rawClient.close();
  console.log('\n🎉 WAREHOUSE LIFECYCLE: L01-L07 PASS!');
}

run().catch((err) => {
  console.error('❌ Test thất bại:', err);
  process.exit(1);
});
