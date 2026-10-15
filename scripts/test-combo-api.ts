/**
 * scripts/test-combo-api.ts - API combo qua HTTP that (handler that + Request that).
 *
 * Khoa loi:
 * 1. GET /api/combos khong cookie -> 401; manager -> 200 co ton dong.
 * 2. GET /api/inventory/combo-stock/[id] -> 200 { ok, stock, components }.
 * 3. POST /api/combos cashier -> 403; manager tao moi -> 200; component ao -> 400.
 * 4. PUT /api/combos/[id]/components thay the toan bo.
 *
 * Chay: DATABASE_URL=file:formapubli_test.db npx tsx scripts/test-combo-api.ts
 */
import fs from 'node:fs';
import { createClient } from '@libsql/client';
import { assertIsolatedTestDb } from './test-guard';
import { db, activeSessions, loginAttemptBuckets } from '../src/db';
import { POST as postLogin } from '../src/app/api/auth/login/route';
import { GET as listCombos, POST as createCombo } from '../src/app/api/combos/route';
import { PUT as replaceComponents } from '../src/app/api/combos/[id]/components/route';
import { GET as comboStock } from '../src/app/api/inventory/combo-stock/[comboId]/route';

assertIsolatedTestDb('test-combo-api');
process.env.AUTH_SECRET = 'test-combo-api-secret-key-32-chars!!!';
process.env.AUTH_STRICT = 'true';

const raw = createClient({ url: process.env.DATABASE_URL || 'file:formapubli_test.db' });

const COMBO_ID = 'cb-test-api-01';
const BOOK_A = 'ed-test-api-a';
const BOOK_B = 'ed-test-api-b';

let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass++;
    console.log(`  PASS: ${name}${extra ? ` (${extra})` : ''}`);
  } else {
    fails.push(name);
    console.log(`  FAIL: ${name}${extra ? ` (${extra})` : ''}`);
  }
}

const mkReq = (url: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  return new Request(url, {
    method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  }) as any;
};

const call = async (fn: any, url: string, opts: any = {}, params?: any) => {
  const res: any = await fn(mkReq(url, opts), { params: Promise.resolve(params || {}) });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
};

function cookieOf(setCookie: string | null): string {
  const m = `${setCookie || ''}`.match(/formapubli_session=([^;]+)/);
  return m ? `formapubli_session=${m[1]}` : '';
}

async function loginAs(staffId: string, passcode: string): Promise<string> {
  const r: any = await postLogin(mkReq('http://x/api/auth/login', { body: { staffId, passcode } }) as any);
  if (r.status !== 200) throw new Error(`login ${staffId} that bai: ${r.status}`);
  return cookieOf(r.headers.get('set-cookie'));
}

async function setup(): Promise<string> {
  const mig = fs.readFileSync('src/db/migrations/0064_combo_components.sql', 'utf8');
  for (const stmt of mig.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) {
    try {
      await raw.execute(stmt);
    } catch (e: any) {
      if (!String(e?.message || e).includes('already exists')) throw e;
    }
  }
  await db.delete(activeSessions);
  await db.delete(loginAttemptBuckets);
  await raw.execute({
    sql: 'INSERT OR IGNORE INTO products (id, code, name, product_kind, selling_price) VALUES (?, ?, ?, ?, ?)',
    args: [COMBO_ID, 'COMBO-TEST-API', 'Combo Test API', 'BOOK', 100000],
  });
  await raw.execute({
    sql: 'INSERT OR IGNORE INTO products (id, name, product_kind, selling_price) VALUES (?, ?, ?, ?)',
    args: [BOOK_A, 'Sach API A', 'BOOK', 50000],
  });
  await raw.execute({
    sql: 'INSERT OR IGNORE INTO products (id, name, product_kind, selling_price) VALUES (?, ?, ?, ?)',
    args: [BOOK_B, 'Sach API B', 'BOOK', 60000],
  });
  await raw.execute({
    sql: 'INSERT OR IGNORE INTO combo_components (id, combo_product_id, component_product_id, quantity) VALUES (?, ?, ?, ?)',
    args: ['cc-test-api-1', COMBO_ID, BOOK_A, 1],
  });
  await raw.execute({
    sql: 'INSERT OR IGNORE INTO combo_components (id, combo_product_id, component_product_id, quantity) VALUES (?, ?, ?, ?)',
    args: ['cc-test-api-2', COMBO_ID, BOOK_B, 1],
  });
  const wh = await raw.execute('SELECT id FROM warehouses LIMIT 1');
  const warehouseId = (wh.rows[0] as any).id as string;
  await raw.execute({
    sql: `INSERT OR REPLACE INTO stock_balances (id, product_id, warehouse_id, condition, physical_quantity)
          VALUES ('sb-test-api-a', ?, ?, 'NEW', 4)`,
    args: [BOOK_A, warehouseId],
  });
  await raw.execute({
    sql: `INSERT OR REPLACE INTO stock_balances (id, product_id, warehouse_id, condition, physical_quantity)
          VALUES ('sb-test-api-b', ?, ?, 'NEW', 7)`,
    args: [BOOK_B, warehouseId],
  });
  return warehouseId;
}

async function cleanup() {
  await raw.execute({ sql: 'DELETE FROM combo_components WHERE combo_product_id LIKE ?', args: ['cb-test-api%'] });
  await raw.execute({ sql: "DELETE FROM stock_balances WHERE id LIKE 'sb-test-api%'", args: [] });
  await raw.execute({ sql: 'DELETE FROM products WHERE id LIKE ? OR id LIKE ?', args: ['cb-test-api%', 'ed-test-api%'] });
}

async function main() {
  console.log('=== TEST: API COMBO (HTTP THAT) ===\n');
  const warehouseId = await setup();
  try {
    const cashierCk = { Cookie: await loginAs('NV-01', '1234') };
    const managerCk = { Cookie: await loginAs('QL-01', '8888') };

    // 1. GET list
    const anon = await call(listCombos, 'http://x/api/combos');
    ok('GET combos khong cookie -> 401', anon.status === 401);
    const list = await call(listCombos, `http://x/api/combos?warehouseId=${warehouseId}`, { headers: managerCk });
    ok('GET combos manager -> 200', list.status === 200);
    const found = (list.body?.combos || []).find((c: any) => c.id === COMBO_ID);
    ok('combo co ton min (4)', found && found.stock === 4);

    // 2. GET stock
    const st = await call(comboStock, `http://x/api/inventory/combo-stock/${COMBO_ID}?warehouseId=${warehouseId}`, { headers: managerCk }, { comboId: COMBO_ID });
    ok('GET combo-stock -> 200 { ok, stock, components }', st.status === 200 && st.body?.ok === true && st.body?.stock === 4 && st.body?.components?.length === 2);

    // 3. POST
    const denied = await call(createCombo, 'http://x/api/combos', {
      headers: cashierCk,
      body: { code: 'X', name: 'X', sellingPrice: 1, components: [] },
    });
    ok('POST combos cashier -> 403', denied.status === 403);
    const badComp = await call(createCombo, 'http://x/api/combos', {
      headers: managerCk,
      body: { code: 'COMBO-TEST-NEW', name: 'Moi', sellingPrice: 50000, components: [{ productId: 'no-such', quantity: 1 }] },
    });
    ok('POST component ao -> 400', badComp.status === 400);
    const created = await call(createCombo, 'http://x/api/combos', {
      headers: managerCk,
      body: { code: 'COMBO-TEST-NEW', name: 'Combo Moi', sellingPrice: 90000, components: [{ productId: BOOK_A, quantity: 2 }] },
    });
    ok('POST tao combo -> 200', created.status === 200 && !!created.body?.id);
    const newId = created.body?.id as string;

    // 4. PUT replace
    const replaced = await call(
      replaceComponents,
      `http://x/api/combos/${newId}/components`,
      { method: 'PUT', headers: managerCk, body: { components: [{ productId: BOOK_B, quantity: 3 }] } },
      { id: newId }
    );
    ok('PUT thay the components -> 200', replaced.status === 200);
    const st2 = await call(comboStock, `http://x/api/inventory/combo-stock/${newId}?warehouseId=${warehouseId}`, { headers: managerCk }, { comboId: newId });
    ok('sau PUT chi con B x3 (7/3=2)', st2.body?.stock === 2 && st2.body?.components?.length === 1);

    await raw.execute({ sql: 'DELETE FROM combo_components WHERE combo_product_id = ?', args: [newId] });
    await raw.execute({ sql: 'DELETE FROM products WHERE id = ?', args: [newId] });

    console.log(`\nCombo API test: ${pass} xanh.`);
  } finally {
    await cleanup();
  }
  if (fails.length > 0) {
    console.error(`Combo API test: ${fails.length} DO.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
