/**
 * scripts/test-products-rbac.ts — phân quyền CỔNG DANH MỤC HÀNG HÓA Ở TẦNG HTTP.
 *
 * Chạy: DATABASE_URL=file:formapubli_test.db npx tsx scripts/test-products-rbac.ts
 *
 * VÌ SAO CẦN FILE NÀY: `scripts/test-products.ts` gọi `ProductService` TRỰC TIẾP,
 * không chạm route lần nào. Nghĩa là luật mấu chốt của cổng này — THU NGÂN KHÔNG
 * ĐƯỢC NHẬP HÀNG HÓA — chưa từng được khoá bằng test nào. Thêm route handler mà
 * quên `requireSessionRole` thì suite cũ vẫn xanh.
 *
 * NGUYÊN TẮC (giống test-rbac-audit.ts): mọi case gọi THẬT hàm `GET`/`POST`/
 * `PATCH` được export từ route với `Request` thật, và kiểm tra `Response` thật.
 * Phiên hợp lệ lấy bằng cách gọi THẬT `POST /api/auth/login` — không stub,
 * không monkey-patch `getSessionFromRequest`.
 */
import { createClient } from '@libsql/client';
import { assertIsolatedTestDb } from './test-guard';
import { db, activeSessions, loginAttemptBuckets } from '../src/db';
import { POST as postLogin } from '../src/app/api/auth/login/route';
import { GET as getProducts, POST as postProducts } from '../src/app/api/products/route';
import { PATCH as patchProduct } from '../src/app/api/products/[id]/route';
import { ProductService } from '../src/services/product.service';

assertIsolatedTestDb('test-products-rbac');

// Khóa dùng chung với test-rbac-audit: ký cookie xác định, không phụ thuộc
// AUTH_SECRET trong .env (có thể là giá trị production).
process.env.AUTH_SECRET = 'test-products-rbac-secret-key-32-chars!!';
// Bật strict để đo ĐÚNG đường bảo vệ của production (fail-closed khi tài
// khoản không tồn tại / bị khoá / đổi vai trò).
process.env.AUTH_STRICT = 'true';

const J = (o: unknown) => JSON.stringify(o);

const mkReq = (
  url: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };
  return new Request(url, {
    method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    ...(opts.body !== undefined ? { body: J(opts.body) } : {}),
  }) as any;
};

const call = async (fn: any, url: string, opts: any = {}, ctx?: any) => {
  const res: any = await fn(mkReq(url, opts), ctx ?? { params: Promise.resolve({}) });
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

/** Đăng nhập THẬT qua route auth/login, lấy cookie phiên thật. */
async function loginAs(staffId: string, passcode: string): Promise<string> {
  const r: any = await postLogin(
    mkReq('http://x/api/auth/login', { body: { staffId, passcode } }) as any
  );
  if (r.status !== 200) {
    throw new Error(`login ${staffId} thất bại: ${r.status}`);
  }
  const ck = cookieOf(r.headers.get('set-cookie'));
  if (!ck) throw new Error(`login ${staffId} không trả Set-Cookie phiên`);
  return ck;
}

let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}${extra ? ` (${extra})` : ''}`);
  } else {
    fails.push(name);
    console.log(`  ❌ FAIL: ${name}${extra ? ` (${extra})` : ''}`);
  }
}

async function main() {
  console.log('=== TEST: PHÂN QUYỀN DANH MỤC HÀNG HÓA (TẦNG HTTP) ===\n');

  // Dọn lease cashier + bucket brute-force sót từ lần chạy trước, nếu không
  // `claimCashierLease` chặn đăng nhập (SESSION_ACTIVE_ELSEWHERE 403).
  await db.delete(activeSessions);
  await db.delete(loginAttemptBuckets);

  const cashierCk = { Cookie: await loginAs('NV-01', '1234') };
  const managerCk = { Cookie: await loginAs('QL-01', '8888') };
  const ownerCk = { Cookie: await loginAs('ADMIN-01', '9999') };

  const suffix = String(Date.now()).slice(-7);
  const listUrl = 'http://x/api/products';

  // -------------------------------------------------------------------------
  console.log('--- 1. KHÔNG CÓ PHIÊN -> 401 ---');
  // -------------------------------------------------------------------------
  {
    const r = await call(getProducts, listUrl);
    ok('GET không cookie -> 401', r.status === 401, `status=${r.status}`);
    ok('GET không cookie -> code AUTH_REQUIRED', r.body?.code === 'AUTH_REQUIRED', `code=${r.body?.code}`);
    ok('GET không cookie không lộ danh sách', !r.body?.products, 'body.products undefined');

    const p = await call(postProducts, listUrl, {
      body: { code: `SP-ANON${suffix}`, name: 'Không được tạo', sellingPrice: 1000 },
    });
    ok('POST không cookie -> 401', p.status === 401, `status=${p.status}`);
    const leaked = await ProductService.listGoods({ search: `SP-ANON${suffix}` });
    ok('POST không cookie KHÔNG tạo ra sản phẩm nào', leaked.length === 0, `thấy ${leaked.length}`);
  }

  // -------------------------------------------------------------------------
  console.log('\n--- 2. THU NGÂN (ROLE_CASHIER) -> 403  [LUẬT MẤU CHỐT] ---');
  // -------------------------------------------------------------------------
  {
    const g = await call(getProducts, listUrl, { headers: cashierCk });
    ok('GET cashier -> 403', g.status === 403, `status=${g.status}`);
    ok('GET cashier -> code FORBIDDEN', g.body?.code === 'FORBIDDEN', `code=${g.body?.code}`);
    ok('GET cashier không lộ danh sách', !g.body?.products, 'body.products undefined');

    const p = await call(postProducts, listUrl, {
      headers: cashierCk,
      body: { code: `SP-CASH${suffix}`, name: 'Thu ngân cấm', sellingPrice: 1000 },
    });
    ok('POST cashier -> 403', p.status === 403, `status=${p.status}`);
    ok('POST cashier -> code FORBIDDEN', p.body?.code === 'FORBIDDEN', `code=${p.body?.code}`);

    const leaked = await ProductService.listGoods({ search: `SP-CASH${suffix}` });
    ok('POST cashier KHÔNG tạo ra sản phẩm nào', leaked.length === 0, `thấy ${leaked.length}`);
  }

  // -------------------------------------------------------------------------
  console.log('\n--- 3. PATCH: không phiên -> 401, thu ngân -> 403 ---');
  // -------------------------------------------------------------------------
  {
    const seed = await ProductService.create({
      code: `SP-P0${suffix}`,
      name: 'Sản phẩm nền PATCH',
      sellingPrice: 5000,
    });

    const anon = await call(
      patchProduct,
      `http://x/api/products/${seed.id}`,
      { method: 'PATCH', body: { name: 'Bị sửa bởi ẩn danh' } },
      { params: Promise.resolve({ id: seed.id }) }
    );
    ok('PATCH không cookie -> 401', anon.status === 401, `status=${anon.status}`);

    const cash = await call(
      patchProduct,
      `http://x/api/products/${seed.id}`,
      { method: 'PATCH', headers: cashierCk, body: { name: 'Bị sửa bởi thu ngân' } },
      { params: Promise.resolve({ id: seed.id }) }
    );
    ok('PATCH cashier -> 403', cash.status === 403, `status=${cash.status}`);

    const after = (await ProductService.listGoods({ search: `SP-P0${suffix}` }))[0];
    ok('tên sản phẩm KHÔNG đổi sau 2 lần PATCH bị chặn', after?.name === 'Sản phẩm nền PATCH', `name=${after?.name}`);

    // Manager/owner PATCH hợp lệ — chứng minh 403 ở trên là do phân quyền, không
    // phải do endpoint hỏng.
    const mgr = await call(
      patchProduct,
      `http://x/api/products/${seed.id}`,
      { method: 'PATCH', headers: managerCk, body: { name: 'Đã sửa bởi quản lý' } },
      { params: Promise.resolve({ id: seed.id }) }
    );
    ok('PATCH manager -> 200 (đường hợp lệ vẫn chạy)', mgr.status === 200, `status=${mgr.status}`);
  }

  // -------------------------------------------------------------------------
  console.log('\n--- 4. OWNER / MANAGER -> KHÔNG bị 401/403 ---');
  // -------------------------------------------------------------------------
  {
    const gOwner = await call(getProducts, listUrl, { headers: ownerCk });
    ok('GET owner không phải 401/403', gOwner.status !== 401 && gOwner.status !== 403, `status=${gOwner.status}`);
    ok('GET owner -> 200 + có mảng products', gOwner.status === 200 && Array.isArray(gOwner.body?.products), `status=${gOwner.status}`);

    const gMgr = await call(getProducts, listUrl, { headers: managerCk });
    ok('GET manager không phải 401/403', gMgr.status !== 401 && gMgr.status !== 403, `status=${gMgr.status}`);
    ok('GET manager -> 200 + có mảng products', gMgr.status === 200 && Array.isArray(gMgr.body?.products), `status=${gMgr.status}`);
  }

  // -------------------------------------------------------------------------
  console.log('\n--- 5. POST kind:"BOOK" KHÔNG được tạo sản phẩm biến mất khỏi listGoods ---');
  // `listGoods` lọc `product_kind = 'GOODS'`. Nếu route còn nhận thẳng
  // `body.kind`, client gửi `kind:"BOOK"` sẽ tạo ra sản phẩm KHÔNG xuất hiện
  // trên chính màn hình danh mục và không sửa/xoá được nữa.
  {
    const bookCode = `SP-BOOK${suffix}`;
    const r = await call(postProducts, listUrl, {
      headers: ownerCk,
      body: { code: bookCode, name: 'Sách gửi nhầm qua cổng hàng hóa', kind: 'BOOK', sellingPrice: 70000 },
    });
    ok('POST kind:BOOK của owner không lỗi 5xx', r.status < 500, `status=${r.status}`);

    const inList = await ProductService.listGoods({ search: bookCode });
    ok(
      'sản phẩm tạo ra PHẢI xuất hiện trong listGoods (không biến mất khỏi danh sách)',
      inList.length === 1,
      `listGoods thấy ${inList.length}`
    );
    ok('productKind lưu là GOODS', inList[0]?.productKind === 'GOODS', `kind=${inList[0]?.productKind}`);

    // Và endpoint GET (chính màn hình này) cũng phải thấy nó.
    const g = await call(getProducts, `${listUrl}?search=${bookCode}`, { headers: ownerCk });
    ok(
      'GET /api/products?search= thấy sản phẩm vừa tạo',
      (g.body?.products || []).some((p: any) => p.code === bookCode),
      `thấy ${(g.body?.products || []).length}`
    );
  }

  // -------------------------------------------------------------------------
  console.log('\n--- 6. PATCH gửi `code` -> 400 và mã KHÔNG đổi ---');
  // -------------------------------------------------------------------------
  {
    const keepCode = `SP-KEEP${suffix}`;
    const target = await ProductService.create({
      code: keepCode,
      name: 'Áo mưa (mã dán ngoài bao)',
      sellingPrice: 89000,
    });

    const r = await call(
      patchProduct,
      `http://x/api/products/${target.id}`,
      {
        method: 'PATCH',
        headers: ownerCk,
        body: { name: 'Áo mưa (đổi tên)', code: 'SP-DOI-MA-CHA' },
      },
      { params: Promise.resolve({ id: target.id }) }
    );
    ok('PATCH có code -> 400', r.status === 400, `status=${r.status}`);
    ok('PATCH có code -> success=false', r.body?.success === false, `success=${r.body?.success}`);

    const after = (await ProductService.listGoods({ search: keepCode }))[0];
    ok('mã sản phẩm KHÔNG đổi', after?.code === keepCode, `code=${after?.code}`);

    // Đọc thẳng tầng lưu trữ: `db` ở trên là drizzle, cần client thô cho SQL.
    const raw = createClient({ url: process.env.DATABASE_URL! });
    const row = await raw.execute({ sql: 'SELECT code FROM products WHERE id = ?', args: [target.id] });
    ok(
      'DB cũng KHÔNG đổi mã (thẳng tầng lưu trữ)',
      `${(row.rows[0] as any)?.code}` === keepCode,
      `code=${(row.rows[0] as any)?.code}`
    );
  }

  console.log(`\nKết quả: ${pass} pass / ${fails.length} fail`);
  if (fails.length > 0) {
    console.error(`\n❌ test-products-rbac thất bại:\n   - ${fails.join('\n   - ')}`);
    process.exit(1);
  }
  console.log('\n✅ DANH MỤC HÀNG HÓA: phân quyền tầng HTTP đã khoá (thu ngân bị chặn 401/403).');
  process.exit(0);
}

main().catch((e) => {
  console.error('\n❌', e?.message || e);
  process.exit(1);
});
