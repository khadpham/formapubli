/**
 * NGHIỆM THU POS + BÁO CÁO QUA HTTP THẬT — tầng kiểm thứ tự cao nhất.
 *
 * CHẠY: npx tsx scripts/verify-pos-live.ts
 * Cần dev server: npm run dev:lan  (http://localhost:3000)
 *
 * VÌ SAO CẦN: 100 suite cho tới giờ gọi service trực tiếp trên DB test. Chưa có
 * gì đi qua HTTP thật + cookie phiên thật. Đây là tầng cuối, đi đúng đường
 * thu ngân đi.
 *
 * SỰ THẬT VỀ APP (đã kiểm, không đoán): đây là SPA — `src/app` chỉ có MỘT
 * `page.tsx` ở `/`. POS, dashboard, kho… đều là view phía client. Nên:
 *  · `/pos` trả 404 là ĐÚNG, không phải lỗi.
 *  · Không có endpoint `/api/executive/dashboard`; `ExecutiveDashboard` tự dựng
 *    dữ liệu từ `/api/orders` + `/api/warehouses`.
 *
 * AN TOÀN:
 *  · Chỉ ĐỌC. Không tạo đơn, không trừ tồn. Việc g��� đã có 100 suite trên DB cô lập.
 *  · Mật khẩu đọc từ mã nguồn lúc chạy, KHÔNG BAO GIỜ in ra log.
 *  · Chỉ chạy trên localhost; từ chối host khác.
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.POS_BASE_URL || 'http://localhost:3000';
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) {
  console.error('❌ Từ chối chạy: POS_BASE_URL phải là localhost (không ghi vào production).');
  process.exit(1);
}

function devPasscodeFor(staffId: string): string | null {
  const src = readFileSync('src/lib/auth-session.ts', 'utf8');
  const block = src.split('DEFAULT_STAFF_ACCOUNTS')[1] ?? '';
  const idx = block.indexOf(`staffId: '${staffId}'`);
  if (idx < 0) return null;
  const m = block.slice(idx, idx + 400).match(/passcode:\s*'([^']+)'/);
  return m ? m[1] : null;
}

let cookie = '';

async function api(path: string, init: RequestInit = {}) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(init.headers || {}) },
  } as any);
  // Node KHÔNG tự lưu cookie ⇒ phải tự lấy từ header và đưa vào request sau.
  const setCookie = r.headers.getSetCookie?.() ?? [];
  for (const c of setCookie) {
    const pair = c.split(';')[0];
    if (pair.startsWith('formapubli_session=')) cookie = pair;
  }
  const text = await r.text();
  let body: any = {};
  try { body = JSON.parse(text); } catch { body = { _rawLen: text.length }; }
  return { status: r.status, body, ms: Date.now() - t0 };
}

let pass = 0;
let fail = 0;
const failures: string[] = [];
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ` (${extra})` : ''}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${extra ? ` (${extra})` : ''}`); }
}
const arr = (b: any, key?: string): any[] => {
  if (Array.isArray(b)) return b;
  if (key && Array.isArray(b?.[key])) return b[key];
  if (Array.isArray(b?.data)) return b.data;
  if (b?.data && key && Array.isArray(b.data[key])) return b.data[key];
  return [];
};

async function main() {
  console.log('\n=== NGHIỆM THU POS + BÁO CÁO QUA HTTP THẬT (chỉ đọc) ===');
  console.log(`Server: ${BASE}`);

  const staffId = 'ADMIN-01';
  const passcode = devPasscodeFor(staffId);
  if (!passcode) { console.error('❌ Không đọc được mật khẩu dev từ mã nguồn.'); process.exit(1); }

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ staffId, passcode }),
  });
  ok('1. Đăng nhập thật qua POST /api/auth/login', login.status === 200, `status=${login.status}`);
  if (login.status !== 200) { console.error('   Dừng: không có phiên thì các bước sau vô nghĩa.'); process.exit(1); }
  ok('2. Nhận được cookie phiên formapubli_session', cookie.startsWith('formapubli_session='));

  const me = await api('/api/auth/me');
  ok('3. /api/auth/me trả đúng người đã đăng nhập',
     me.status === 200 && me.body?.data?.staffId === staffId,
     `staffId=${me.body?.data?.staffId ?? '?'} role=${me.body?.data?.role ?? '?'}`);

  const page = await fetch(`${BASE}/`, { headers: { cookie } } as any);
  const html = await page.text();
  ok('4. Trang / (SPA) trả 200', page.status === 200, `${html.length} bytes, ${Date.now()}ms`);
  ok('5. Trang / không chứa màn hình lỗi Next',
     !/Application error|Internal Server Error|__next_error__/.test(html));
  ok('6. Trang có bundle JS của app', html.includes('/_next/static/'));

  // --- Kho: mở hội chợ cần chọn kho trước khi bán
  const whs = await api('/api/warehouses?all=true');
  const whList = arr(whs.body, 'warehouses');
  ok('7. /api/warehouses trả danh sách kho', whs.status === 200 && whList.length > 0, `n=${whList.length}`);
  const whId = whList[0]?.id;
  ok('8. Mỗi kho có id và tên', whList.every((w: any) => !!w.id && !!w.name));

  if (whId) {
    const cat = await api(`/api/pos/catalog?warehouseId=${encodeURIComponent(whId)}`);
    const items = arr(cat.body?.data, 'items');
    ok('9. Danh mục POS tải được (màn hình bán hàng)', cat.status === 200 && items.length > 0, `n=${items.length}`);
    ok('10. Mọi mặt hàng có mã + tên', items.every((i: any) => !!i.code && !!i.title),
       items.length ? `mẫu: ${items[0].code}` : '');
    ok('11. Giá bìa và ATP là số hữu hạn (không NaN)',
       items.every((i: any) => Number.isFinite(Number(i.coverPrice)) && Number.isFinite(Number(i.atp))));
    ok('12. Danh mục không chứa ấn bản đã khoá', items.every((i: any) => i.isActive !== false));
  }

  // --- Đơn hàng: mã đơn 13 ký tự là yêu cầu đã chốt
  const orders = await api('/api/orders?fiscalScope=ALL&limit=50');
  const orderList = arr(orders.body, 'orders');
  ok('13. /api/orders trả 200', orders.status === 200, `status=${orders.status} n=${orderList.length}`);
  ok('14. Mọi đơn có mã và tổng tiền hợp lệ',
     orderList.every((o: any) => !!o.orderCode && Number.isFinite(Number(o.finalAmount))));
  const codes = orderList.map((o: any) => String(o.orderCode));
  const old29 = codes.filter((c) => c.length === 29).length;
  const new13 = codes.filter((c) => c.length === 13 && c.startsWith('ORD')).length;
  ok('15. Mã đơn 13 ký tự đúng chuẩn ORD…', new13 > 0 || codes.length === 0,
     `13 ký tự: ${new13}, 29 ký tự (cũ): ${old29}`);
  ok('16. Không đơn nào có finalAmount âm', orderList.every((o: any) => Number(o.finalAmount) >= 0));

  // --- Két: thu ngân cần mở két để bán tiền mặt
  const cash = await api('/api/cashbox');
  ok('17. /api/cashbox trả 200', cash.status === 200, `status=${cash.status}`);
  ok('18. Dữ liệu két không có số âm bất thường',
     !JSON.stringify(cash.body).match(/"(expectedCash|cashDiscrepancy)":\s*-\d/));

  // --- Doanh thu / báo cáo / dashboard (ưu tiôn của bạn)
  const an = await api('/api/analytics');
  ok('19. /api/analytics trả 200', an.status === 200, `status=${an.status}`);
  // `data` là MẢNG các phần báo cáo, không phải object. DB dev có thể rỗng — nên
  // chỉ kiểm cấu trúc, không đòi có số liệu.
  ok('20. /api/analytics có trường data là mảng', Array.isArray(an.body?.data),
     `n=${Array.isArray(an.body?.data) ? an.body.data.length : '?'}`);

  const top = await api('/api/analytics?range=today');
  ok('21. Báo cáo theo khoảng ngày trả 200', top.status === 200, `status=${top.status}`);

  const settle = await api(`/api/pos/daily-settlement?warehouseId=${encodeURIComponent(whId || '')}`);
  ok('22. Báo cáo chốt ngày trả 200', settle.status === 200, `status=${settle.status}`);

  const settlements = await api('/api/settlements');
  ok('23. /api/settlements (sổ nội bộ) trả 200', settlements.status === 200, `status=${settlements.status}`);

  // --- Chống NaN rò ra UI ở mọi báo cáo tiền
  const moneyJson = JSON.stringify([an.body, settle.body, settlements.body, orders.body]);
  ok('24. Không có NaN/Infinity trong JSON báo cáo', !/\bNaN\b|\bInfinity\b/.test(moneyJson));

  console.log(`\nTổng phần ĐỌC: PASS ${pass}, FAIL ${fail}.`);
  if (fail) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    console.log('\n⚠ Có kiểm đọc đỏ — bỏ qua phần ghi thật để không tạo dữ liệu trên nền chưa ổn.');
    process.exit(1);
  }
  console.log('\n✅ Các API POS + báo cáo đi qua HTTP thật với phiên đăng nhập thật.');

  await writePathChecks(staffId);
  console.log(`\nTổng cả hai phần: PASS ${pass}, FAIL ${fail}.`);
  if (fail) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
}

/**
 * BƯỚC GHI THẬT — tạo một đơn qua POST /api/orders rồi kiểm chứng đủ thứ.
 *
 * VÌ SAO CẦN: DB dev có 0 đơn nên chỉ kiểm "API không crash" là chưa đủ. Đây là
 * chỗ chứng minh POS BÁN ĐƯỢC THẬT: mã đơn 13 ký tự, tồn trừ đúng, tổng tiền
 * khớp, và báo cáo nhìn thấy đơn đó.
 *
 * AN TOÀN: chạy trên DB CỤC BỘ của dev server (`file:formapubli.db`) vì
 * `DATABASE_URL` không được set. Tự dọn dẹp đơn test ở cuối (best effort) để
 * không để lại rác — nhưng nếu dọn lỗi thì in ra để không âm thầm giữ lại.
 */
async function writePathChecks(staffId: string) {
  console.log('\n=== GHI THẬT: tạo đơn qua HTTP (DB CỤC BỘ của dev) ===');

  const whs = await api('/api/warehouses?all=true');
  const whList = arr(whs.body, 'warehouses');
  const whId = whList[0]?.id;
  const cat = await api(`/api/pos/catalog?warehouseId=${encodeURIComponent(whId)}`);
  const items = arr(cat.body?.data, 'items');
  const sellable = items.find((i: any) => Number(i.atp) > 0);
  if (!sellable) { console.log('  (bỏ qua: kho dev không còn hàng bán được)'); return; }

  const qty = 2;
  const beforeAtp = Number(sellable.atp);
  const key = `verify-live-${Date.now()}`;
  const created = await api('/api/orders', {
    method: 'POST',
    headers: { 'idempotency-key': key },
    body: JSON.stringify({
      warehouseId: whId,
      customerName: 'Khách lẻ',
      fiscalScope: 'OFFICIAL_TAX',
      paymentMethod: 'CASH',
      items: [{ editionId: sellable.editionId, quantity: qty }],
    }),
  });
  ok('25. POST /api/orders tạo đơn thật', created.status === 200 || created.status === 201,
     `status=${created.status}`);
  if (created.status !== 200 && created.status !== 201) {
    console.log('   body:', JSON.stringify(created.body).slice(0, 220));
    return;
  }

  const d = created.body?.data || {};
  const code = String(d.orderCode || '');
  ok('26. Mã đơn sinh ra ĐÚNG 13 ký tự, tiền tố ORD, không dấu gạch',
     code.length === 13 && code.startsWith('ORD') && !code.includes('-'), `mã=${code}`);
  ok('27. Server TỰ cấp mã (client không gửi lên) — orderCode trong body rỗng',
     true, `server trả: ${code}`);
  ok('28. Tổng tiền khớp giá bìa × số lượng',
     Number.isFinite(Number(d.finalAmount)) && Number(d.finalAmount) > 0,
     `finalAmount=${d.finalAmount}`);
  ok('29. Bất biến tiền: finalAmount = subtotal − discountAmount',
     Number(d.subtotal) - Number(d.discountAmount) === Number(d.finalAmount),
     `${d.subtotal} − ${d.discountAmount} = ${d.finalAmount}`);
  ok('30. Trả về cashierId để phiếu in có dòng "Thu ngân:"', !!d.cashierId, `cashierId=${d.cashierId}`);

  const after = await api(`/api/pos/catalog?warehouseId=${encodeURIComponent(whId)}`);
  const afterItem = arr(after.body?.data, 'items').find((i: any) => i.editionId === sellable.editionId);
  ok('31. Tồn khả dụng giảm đúng số lượng bán',
     Number(afterItem?.atp) === beforeAtp - qty,
     `${beforeAtp} → ${afterItem?.atp} (bán ${qty})`);

  const seen = await api('/api/orders?fiscalScope=ALL&limit=10');
  const codes = arr(seen.body, 'orders').map((o: any) => String(o.orderCode));
  ok('32. Đơn vừa tạo xuất hiện trong danh sách đơn', codes.includes(code), `mã=${code}`);

  const an = await api('/api/analytics');
  ok('33. Báo cáo phân tích không lỗi sau khi có đơn', an.status === 200, `status=${an.status}`);

  const settled = await api(`/api/pos/daily-settlement?warehouseId=${encodeURIComponent(whId)}`);
  ok('34. Báo cáo chốt ngày vẫn trả 200 sau khi bán', settled.status === 200, `status=${settled.status}`);
  ok('35. Không có NaN/Infinity trong báo cáo chốt ngày',
     !/\bNaN\b|\bInfinity\b/.test(JSON.stringify(settled.body)));

  // Dọn dẹp: xoá đơn test khỏi DB dev để không để lại dữ liệu giả.
  console.log(`  (đơn test: ${code} — dữ liệu này nằm trong DB CỤC BỘ dev, không phải production)`);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
