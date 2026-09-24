/**
 * Bug #2 (login 2 lần) + #4 (nút "Kiểm tra tồn kho" luôn lỗi) + #6 (CRUD kho).
 * Chạy: npx tsx scripts/test-ux-crud-fixes.ts   (DB riêng, tự dựng)
 */
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_ux_crud.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

const SALT = 'formapubli-ux-crud-salt-2026';
process.env.AUTH_SECRET = 'test-ux-crud-secret-32-chars-minimum!!';
process.env.AUTH_STRICT = 'true';
process.env.SESSION_LEASE_ENFORCE = 'true';
process.env.TRUST_PROXY = 'true';

const J = (o: any) => JSON.stringify(o);
let pass = 0; let fail = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
};

async function run() {
  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL });

  const { db } = await import('../src/db');
  const schema = await import('../src/db/schema');
  const { createClient } = await import('@libsql/client');
  const { eq, and, sql } = await import('drizzle-orm');
  const { hashStaffPasscodeV2 } = await import('../src/lib/auth-session');
  const { POST: postLogin } = await import('../src/app/api/auth/login/route');
  const { POST: postValidate } = await import('../src/app/api/inventory/transfer-batch/validate/route');
  // Route CRUD kho chưa tồn tại ở baseline → import lỗi phải thành FAIL case, không crash cả file.
  let patchWarehouse: any = null; let deleteWarehouse: any = null;
  try {
    ({ PATCH: patchWarehouse, DELETE: deleteWarehouse } = await import('../src/app/api/warehouses/[id]/route'));
  } catch { /* baseline chưa có route → các case CRUD sẽ FAIL đúng mục đích */ }

  const salt = 'salt-ux-cashier';
  await db.insert(schema.staffAccounts).values([
    { staffId: 'UX-NV', fullName: 'Thu Ngân UX', role: 'ROLE_CASHIER', passcodeHash: await hashStaffPasscodeV2('1234', salt), salt, isActive: true, sessionVersion: 1 },
    { staffId: 'UX-QL', fullName: 'Quản Lý UX', role: 'ROLE_MANAGER', passcodeHash: await hashStaffPasscodeV2('8888', 'salt-ux-mgr'), salt: 'salt-ux-mgr', isActive: true, sessionVersion: 1 },
  ]);
  await db.insert(schema.warehouses).values([
    { id: 'wh-ux-empty', code: 'UX_RONG', name: 'Kho rỗng UX', warehouseType: 'PHYSICAL_MAIN', isActive: true, isSellableOnPos: false },
    { id: 'wh-ux-stock', code: 'UX_CO', name: 'Kho có tồn UX', warehouseType: 'PHYSICAL_MAIN', isActive: true, isSellableOnPos: true },
  ]);
  const saltEd = 'salt-ux-ed';
  await db.insert(schema.works).values({ id: 'wk-ux', code: 'WK-UX', title: 'Sách UX', shortCode: 'UX', author: 'Tác giả UX' });
  await db.insert(schema.editions).values({
    id: 'ed-ux', code: 'UX01', workId: 'wk-ux', title: 'Sách UX', coverPrice: 50000, isbn: '9780000000001', isbnLast4: '0001',
  } as any);
  await db.insert(schema.stockBalances).values({
    id: 'sb-ux', editionId: 'ed-ux', warehouseId: 'wh-ux-stock', condition: 'NEW', physicalQuantity: 50,
  });

  const post = (fn: any, body: any, headers: Record<string, string> = {}) =>
    fn(new Request('http://localhost/x', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: J(body),
    }) as any).then(async (r: any) => ({ status: r.status, body: await r.json(), headers: r.headers }));
  const patchReq = (fn: any, id: string, body: any, headers: Record<string, string> = {}) => {
    if (!fn) return Promise.resolve({ status: 0, body: { error: 'route chưa tồn tại' } });
    return fn(new Request(`http://localhost/api/warehouses/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: J(body),
    }) as any, { params: { id } }).then(async (r: any) => ({ status: r.status, body: await r.json() }));
  };
  const delReq = (fn: any, id: string, headers: Record<string, string> = {}) => {
    if (!fn) return Promise.resolve({ status: 0, body: { error: 'route chưa tồn tại' } });
    return fn(new Request(`http://localhost/api/warehouses/${id}`, { method: 'DELETE', headers }) as any, { params: { id } })
      .then(async (r: any) => ({ status: r.status, body: await r.json() }));
  };

  const cookieOf = (setCookie: string | null) => {
    const m = `${setCookie || ''}`.match(/formapubli_session=([^;]+)/);
    return m ? `formapubli_session=${m[1]}` : '';
  };
  async function login(staffId: string, passcode: string) {
    const r: any = await post(postLogin, { staffId, passcode });
    return { status: r.status, body: r.body, cookie: cookieOf(r.headers.get('set-cookie')) };
  }

  console.log('\n[#2] Đăng nhập lại CÙNG máy phải tái dùng phiên (không tự khóa mình)');
  const l1 = await login('UX-NV', '1234');
  ok('login lần 1 = 200', l1.status === 200, `status=${l1.status} ${J(l1.body).slice(0, 120)}`);
  const l2 = await post(postLogin, { staffId: 'UX-NV', passcode: '1234' }, { Cookie: l1.cookie });
  ok('login lần 2 CÙNG cookie phiên = 200 (tái dùng phiên)', l2.status === 200,
    `status=${l2.status} code=${l2.body?.code} — bị tự chặn chính mình`);
  const leaseRows = await db.select().from(schema.activeSessions).where(eq(schema.activeSessions.staffId, 'UX-NV'));
  ok('vẫn đúng 1 lease sau 2 lần login', leaseRows.length === 1, `rows=${leaseRows.length}`);

  const lOther = await login('UX-NV', '1234'); // máy khác, KHÔNG cookie
  ok('máy khác (không cookie) vẫn bị chặn 403', lOther.status === 403 && lOther.body?.code === 'SESSION_ACTIVE_ELSEWHERE',
    `status=${lOther.status} — mất chống đăng nhập kép`);

  console.log('\n[#6] Sửa kho');
  const mgr = await login('UX-QL', '8888');
  ok('login manager = 200', mgr.status === 200, `status=${mgr.status}`);
  const ren = await patchReq(patchWarehouse, 'wh-ux-empty', { name: 'Kho rỗng đã đổi tên', address: 'Số 1 Đường Nguyễn Huệ' }, { Cookie: mgr.cookie });
  ok('PATCH đổi tên kho = 200', ren.status === 200, `status=${ren.status} ${J(ren.body).slice(0, 140)}`);
  const after = await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, 'wh-ux-empty'));
  ok('tên kho đã đổi trong DB', after[0]?.name === 'Kho rỗng đã đổi tên', `name=${after[0]?.name}`);
  const renCashier = await patchReq(patchWarehouse, 'wh-ux-empty', { name: 'hacked' }, { Cookie: l1.cookie });
  ok('cashier KHÔNG sửa được kho (403)', renCashier.status === 403, `status=${renCashier.status}`);
  const renEmpty = await patchReq(patchWarehouse, 'wh-ux-empty', { name: '   ' }, { Cookie: mgr.cookie });
  ok('tên rỗng bị chặn 400', renEmpty.status === 400, `status=${renEmpty.status}`);

  console.log('\n[#6] Xóa kho — chặn khi còn dữ liệu, cho khi rỗng');
  const delStock = await delReq(deleteWarehouse, 'wh-ux-stock', { Cookie: mgr.cookie });
  ok('xóa kho CÒN TỒN bị chặn (409)', delStock.status === 409, `status=${delStock.status} ${J(delStock.body).slice(0, 140)}`);
  const stillThere = await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, 'wh-ux-stock'));
  ok('kho còn tồn vẫn còn nguyên', stillThere.length === 1);
  const delEmpty = await delReq(deleteWarehouse, 'wh-ux-empty', { Cookie: mgr.cookie });
  ok('xóa kho RỖNG = 200', delEmpty.status === 200, `status=${delEmpty.status} ${J(delEmpty.body).slice(0, 140)}`);
  const gone = await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, 'wh-ux-empty'));
  ok('kho rỗng đã bị xóa', gone.length === 0);
  const delCashier = await delReq(deleteWarehouse, 'wh-ux-stock', { Cookie: l1.cookie });
  ok('cashier KHÔNG xóa được kho (403)', delCashier.status === 403, `status=${delCashier.status}`);
  const del404 = await delReq(deleteWarehouse, 'wh-khong-co', { Cookie: mgr.cookie });
  ok('xóa kho không tồn tại = 404', del404.status === 404, `status=${del404.status}`);

  console.log('\n[#4] Nút "Kiểm tra tồn kho": route trả data.ok, UI phải đọc đúng chỗ');
  await db.insert(schema.warehouses).values({
    id: 'wh-ux-dest', code: 'UX_DICH', name: 'Kho đích UX', warehouseType: 'PHYSICAL_MAIN', isActive: true, isSellableOnPos: false,
  });
  const v = await post(postValidate, { fromWarehouseId: 'wh-ux-stock', toWarehouseId: 'wh-ux-dest', items: [{ editionId: 'ed-ux', quantity: 1 }] }, { Cookie: mgr.cookie });
  ok('validate giỏ hợp lệ = 200', v.status === 200, `status=${v.status} ${J(v.body).slice(0, 160)}`);
  ok('validate trả ok=true trong data (route contract)', v.body?.data?.ok === true, `data=${J(v.body?.data)}`);

  const src = fs.readFileSync(path.resolve(process.cwd(), 'src/components/inventory/BatchTransferModal.tsx'), 'utf8');
  const readsResult = /const\s+result\s*=\s*data\?\.data\s*\?\?\s*data/.test(src);
  const usesResultOk = /result\?\.ok\s*===\s*false|!result\?\.ok|result\.ok/.test(src) && /result\s*\|\|/.test(src) || /result\?\.ok/.test(src);
  ok('BatchTransferModal đọc data.data.ok (route trả {success,data:{ok}})', readsResult,
    'UI đang đọc data.ok nên validate thành công vẫn báo lỗi');
  ok('BatchTransferModal dùng biến result cho cả nhánh lỗi stale', usesResultOk || /result\?\.ok/.test(src), 'chưa dùng result');

  console.log('\n[#2] Service worker không được phục vụ HTML cũ (stale) cho navigation');
  const sw = fs.readFileSync(path.resolve(process.cwd(), 'public/sw.js'), 'utf8');
  ok('sw.js ưu tiên mạng cho navigation', /request\.mode\s*===\s*['"]navigate['"]|mode\s*===\s*['"]navigate['"]/.test(sw),
    'navigation đang dùng cachedResponse trước → sau login vẫn thấy màn hình login');
  ok('sw.js không cache "/" trong precache', !/['"]\/['"]/.test(sw.split('PRECACHE_ASSETS')[1]?.split(']')[0] || '"/"'),
    'precache "/" giữ HTML trước-login');

  console.log(`\n${fail === 0 ? '🎉' : '💥'} UX/CRUD: ${pass}/${pass + fail} PASS`);
  assert.equal(fail, 0, `${fail} case FAIL`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => { console.error('💥 CRASH:', err); process.exit(1); });
