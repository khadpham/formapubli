/**
 * Smoke check - bo kiem tra khoi sau deploy cho ERP formapubli.
 *
 * Muc dich: 1 lenh duy nhat kiem tra suc khoe cac luong quan trong
 * (dang nhap, hoa don, don hang, kho, Shopee, chot ngay, hang doi D1)
 * sau moi lan deploy, thay cho kiem tra tay rai rac.
 *
 * Cach dung:
 *   npx tsx scripts/smoke-check.ts
 *   npx tsx scripts/smoke-check.ts --base=https://dev.formapubli.vn
 *   SMOKE_STAFF=ADMIN-01 SMOKE_PASS=xxxx npx tsx scripts/smoke-check.ts --base=https://app.formapubli.vn
 *
 * Tham so:
 *   --base=<url>    Mac dinh https://dev.formapubli.vn
 *   --staff=<maNV>  Mac dinh ADMIN-01 (hoac env SMOKE_STAFF)
 *   --pass=<pin>    Mac dinh 9999 (hoac env SMOKE_PASS)
 *
 * LUU Y BAO MAT: passcode mac dinh 9999 la PIN dev cong khai noi bo,
 * CHI dung cho moi truong dev. Khi chay tren production phai truyen
 * thong tin dang nhap that qua env/CLI, khong ghi cung vao file.
 * Script khong bao gio in passcode/cookie/token ra man hinh.
 *
 * Tat ca kiem tra deu CHI DOC (GET + dang nhap), an toan chay ca
 * tren production. Exit code: 0 khi khong co FAIL, 1 khi co FAIL.
 */

const args = process.argv.slice(2);
function argVal(name: string): string | undefined {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const BASE = (argVal('base') || 'https://dev.formapubli.vn').replace(/\/+$/, '');
const STAFF = argVal('staff') || process.env.SMOKE_STAFF || 'ADMIN-01';
const PASS = argVal('pass') || process.env.SMOKE_PASS || '9999';
// Passcode sai co y cho kiem tra so 2 (dang nhap sai phai bi tu choi).
const WRONG_PASS = PASS !== '0000' ? '0000' : '1111';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

type Res = { status: number; json: any; isJson: boolean };

async function req(method: string, path: string, opts: { cookie?: string; body?: any } = {}): Promise<Res> {
  const headers: Record<string, string> = { 'User-Agent': UA, Accept: 'application/json' };
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(30000),
    redirect: 'manual',
  });
  const text = await r.text();
  let json: any = null;
  let isJson = false;
  try {
    json = JSON.parse(text);
    isJson = true;
  } catch {
    /* phan hoi khong phai JSON - cac kiem tra se danh FAIL */
  }
  return { status: r.status, json, isJson };
}

async function login(staffId: string, passcode: string): Promise<{ res: Res; cookie: string }> {
  const headers: Record<string, string> = {
    'User-Agent': UA,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ staffId, passcode }),
    signal: AbortSignal.timeout(30000),
    redirect: 'manual',
  });
  const text = await r.text();
  let json: any = null;
  let isJson = false;
  try {
    json = JSON.parse(text);
    isJson = true;
  } catch {
    /* giu nguyen */
  }
  const raw =
    (typeof (r.headers as any).getSetCookie === 'function' ? (r.headers as any).getSetCookie() : null) ||
    (r.headers.get('set-cookie') ? [r.headers.get('set-cookie') as string] : []);
  const cookie = raw.map((c: string) => c.split(';')[0]).filter(Boolean).join('; ');
  return { res: { status: r.status, json, isJson }, cookie };
}

function okFlag(json: any): boolean {
  return !!json && (json.ok === true || json.success === true);
}

type Line = { n: number; name: string; result: 'PASS' | 'FAIL' | 'SKIP'; http: number | string; note?: string };
const lines: Line[] = [];
function report(n: number, name: string, result: 'PASS' | 'FAIL' | 'SKIP', http: number | string, note?: string) {
  lines.push({ n, name, result, http, note });
  console.log(`[${result}] ${n}. ${name} (HTTP ${http})${note ? ` - ${note}` : ''}`);
}

async function main() {
  console.log(`Smoke check: ${BASE} | staff=${STAFF}`);

  // 1. Chua dang nhap goi /api/invoices -> phai 401
  try {
    const r = await req('GET', '/api/invoices');
    report(1, 'Chua dang nhap goi /api/invoices bi chan 401', r.status === 401 ? 'PASS' : 'FAIL', r.status);
  } catch (e: any) {
    report(1, 'Chua dang nhap goi /api/invoices bi chan 401', 'FAIL', '-', `loi mang: ${e?.message || e}`);
  }

  // 2. Dang nhap sai passcode -> phai bi tu choi
  try {
    const { res } = await login(STAFF, WRONG_PASS);
    const rejected = !(res.status === 200 && okFlag(res.json));
    report(2, 'Dang nhap sai passcode bi tu choi', rejected ? 'PASS' : 'FAIL', res.status);
  } catch (e: any) {
    report(2, 'Dang nhap sai passcode bi tu choi', 'FAIL', '-', `loi mang: ${e?.message || e}`);
  }

  // 3. Dang nhap dung -> 200 va co role
  let cookie = '';
  try {
    const { res, cookie: c } = await login(STAFF, PASS);
    cookie = c;
    const role = res.json?.data?.role;
    const pass = res.status === 200 && okFlag(res.json) && typeof role === 'string' && role.length > 0 && cookie.length > 0;
    report(3, 'Dang nhap dung, co role va cookie phien', pass ? 'PASS' : 'FAIL', res.status, role ? `role=${role}` : undefined);
  } catch (e: any) {
    report(3, 'Dang nhap dung, co role va cookie phien', 'FAIL', '-', `loi mang: ${e?.message || e}`);
  }

  const authed = cookie.length > 0;
  const needAuth = (n: number, name: string) => report(n, name, 'FAIL', '-', 'khong co phien dang nhap (kiem tra 3 da FAIL)');

  // 4. GET /api/invoices?limit=2
  if (!authed) needAuth(4, 'GET /api/invoices?limit=2 hop le');
  else {
    try {
      const r = await req('GET', '/api/invoices?limit=2', { cookie });
      report(4, 'GET /api/invoices?limit=2 hop le', r.status === 200 && okFlag(r.json) ? 'PASS' : 'FAIL', r.status);
    } catch (e: any) {
      report(4, 'GET /api/invoices?limit=2 hop le', 'FAIL', '-', `loi mang: ${e?.message || e}`);
    }
  }

  // 5. GET /api/invoices/ms-list -> khong loi 5xx, cau truc hop le
  if (!authed) needAuth(5, 'GET /api/invoices/ms-list khong loi 5xx, cau truc hop le');
  else {
    try {
      const r = await req('GET', '/api/invoices/ms-list', { cookie });
      const shapeOk = r.isJson && r.json && typeof r.json === 'object' && ('ok' in r.json || 'success' in r.json);
      report(5, 'GET /api/invoices/ms-list khong loi 5xx, cau truc hop le', r.status < 500 && shapeOk ? 'PASS' : 'FAIL', r.status);
    } catch (e: any) {
      report(5, 'GET /api/invoices/ms-list khong loi 5xx, cau truc hop le', 'FAIL', '-', `loi mang: ${e?.message || e}`);
    }
  }

  // 6. GET /api/orders?limit=2
  if (!authed) needAuth(6, 'GET /api/orders?limit=2 hop le');
  else {
    try {
      const r = await req('GET', '/api/orders?limit=2', { cookie });
      report(6, 'GET /api/orders?limit=2 hop le', r.status === 200 && okFlag(r.json) ? 'PASS' : 'FAIL', r.status);
    } catch (e: any) {
      report(6, 'GET /api/orders?limit=2 hop le', 'FAIL', '-', `loi mang: ${e?.message || e}`);
    }
  }

  // 7. GET /api/warehouses -> co it nhat 1 kho vat ly
  let firstPhysicalId: string | null = null;
  if (!authed) needAuth(7, 'GET /api/warehouses co it nhat 1 kho vat ly');
  else {
    try {
      const r = await req('GET', '/api/warehouses?all=true', { cookie });
      const list: any[] = Array.isArray(r.json?.data) ? r.json.data : [];
      const isPhysical = (w: any) => w?.warehouseType === 'PHYSICAL_MAIN' || w?.warehouseType === 'FAIR_EVENT';
      const physical = list.filter(isPhysical);
      const main = physical.find((w: any) => w.warehouseType === 'PHYSICAL_MAIN');
      firstPhysicalId = (main || physical[0])?.id || null;
      const pass = r.status === 200 && okFlag(r.json) && physical.length >= 1;
      report(7, 'GET /api/warehouses co it nhat 1 kho vat ly', pass ? 'PASS' : 'FAIL', r.status, `${physical.length} kho vat ly / ${list.length} kho`);
    } catch (e: any) {
      report(7, 'GET /api/warehouses co it nhat 1 kho vat ly', 'FAIL', '-', `loi mang: ${e?.message || e}`);
    }
  }

  // 8. GET /api/shopee/status -> cau truc dung (connected true/false deu dat)
  if (!authed) needAuth(8, 'GET /api/shopee/status cau truc dung');
  else {
    try {
      const r = await req('GET', '/api/shopee/status', { cookie });
      const shapeOk = okFlag(r.json) && r.json?.data && typeof r.json.data.connected === 'boolean';
      report(8, 'GET /api/shopee/status cau truc dung', r.status === 200 && shapeOk ? 'PASS' : 'FAIL', r.status, shapeOk ? `connected=${r.json.data.connected}` : undefined);
    } catch (e: any) {
      report(8, 'GET /api/shopee/status cau truc dung', 'FAIL', '-', `loi mang: ${e?.message || e}`);
    }
  }

  // 9. GET /api/pos/daily-settlement?warehouseId=<kho vat ly dau tien>
  if (!authed) needAuth(9, 'GET /api/pos/daily-settlement theo kho vat ly hop le');
  else if (!firstPhysicalId) report(9, 'GET /api/pos/daily-settlement theo kho vat ly hop le', 'SKIP', '-', 'khong tim thay kho vat ly o kiem tra 7');
  else {
    try {
      const r = await req('GET', `/api/pos/daily-settlement?warehouseId=${encodeURIComponent(firstPhysicalId)}`, { cookie });
      report(9, 'GET /api/pos/daily-settlement theo kho vat ly hop le', r.status === 200 && okFlag(r.json) ? 'PASS' : 'FAIL', r.status);
    } catch (e: any) {
      report(9, 'GET /api/pos/daily-settlement theo kho vat ly hop le', 'FAIL', '-', `loi mang: ${e?.message || e}`);
    }
  }

  // 10. GET /api/invoices/online-queue (endpoint D1; 404 thi SKIP)
  if (!authed) needAuth(10, 'GET /api/invoices/online-queue hop le (D1)');
  else {
    try {
      const r = await req('GET', '/api/invoices/online-queue', { cookie });
      if (r.status === 404) {
        report(10, 'GET /api/invoices/online-queue hop le (D1)', 'SKIP', 404, 'moi truong chua co D1');
      } else {
        report(10, 'GET /api/invoices/online-queue hop le (D1)', r.status === 200 && okFlag(r.json) ? 'PASS' : 'FAIL', r.status);
      }
    } catch (e: any) {
      report(10, 'GET /api/invoices/online-queue hop le (D1)', 'FAIL', '-', `loi mang: ${e?.message || e}`);
    }
  }

  const pass = lines.filter((l) => l.result === 'PASS').length;
  const fail = lines.filter((l) => l.result === 'FAIL').length;
  const skip = lines.filter((l) => l.result === 'SKIP').length;
  console.log(`\nTong ket: ${pass} PASS, ${fail} FAIL, ${skip} SKIP (tong ${lines.length} kiem tra)`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e: any) => {
  console.error(`Smoke check loi khong xu ly duoc: ${e?.message || e}`);
  process.exit(1);
});
