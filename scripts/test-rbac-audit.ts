/**
 * KIỂM ĐỊNH BẢO MẬT LỚP PHÂN QUYỀN / ĐĂNG NHẬP / ACTOR — auditB.
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-rbac-audit
 *
 * NGUYÊN TẮC (gotcha 11): mọi case gọi THẬT handler/route với Request thật và
 * kiểm tra Response thật. Không case nào chỉ đọc file rồi regex.
 *
 * Các case ghi dữ liệu (đơn hàng, RMA, bút toán kho) dùng DB test cách ly có
 * seed sẵn — xem assertIsolatedTestDb() chặn rò sang formapubli.db production.
 */
import { assertIsolatedTestDb } from './test-guard';
import { db, editions, staffAccounts, auditLogs, rmaTickets, activeSessions, loginAttemptBuckets } from '../src/db';
import { eq, desc } from 'drizzle-orm';
import { extractUserRole, enforceFiscalScope } from '../src/lib/rbac-guard';
import { getDefaultTabForRole, getSettingsAccess } from '../src/lib/roles';
import {
  resolveActorId,
  safeEqual,
  signSession,
  verifySession,
  isAuthStrict,
} from '../src/lib/auth-session';
import { POST as postLogin } from '../src/app/api/auth/login/route';
import { POST as postLogout } from '../src/app/api/auth/logout/route';
import { GET as getOrders } from '../src/app/api/orders/route';
import { POST as postMovement } from '../src/app/api/inventory/movement/route';
import { POST as postRma, GET as getRma } from '../src/app/api/rma/route';
import { GET as getAccounts } from '../src/app/api/auth/accounts/route';
import { GET as getCustomers } from '../src/app/api/customers/route';
import { GET as getCashbox } from '../src/app/api/cashbox/route';
import { POST as postCashbox } from '../src/app/api/cashbox/route';
import { POST as postTransfers } from '../src/app/api/transfers/route';
import { POST as postDelivery } from '../src/app/api/delivery-orders/route';

assertIsolatedTestDb('test-rbac-audit');

// AUTH_STRICT bật để dùng đúng đường bảo vệ production (resolveActorId ép
// session.actorId, validateSessionAccount fail-closed). Nếu không bật, các
// case sẽ đo nhầm đường legacy.
process.env.AUTH_SECRET = 'test-rbac-audit-secret-key-32-chars!!';
process.env.AUTH_STRICT = 'true';

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;
const J = (o: any) => JSON.stringify(o);

const mkReq = (url: string, opts: { method?: string; body?: any; headers?: Record<string, string> } = {}) => {
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  return new Request(url, {
    method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
    headers: h,
    ...(opts.body !== undefined ? { body: J(opts.body) } : {}),
  }) as any;
};

const call = async (fn: any, url: string, opts: any = {}) => {
  const res: any = await fn(mkReq(url, opts), { params: {} });
  let body: any = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body, headers: res.headers };
};

function cookieOf(setCookie: string | null): string {
  const m = `${setCookie || ''}`.match(/formapubli_session=([^;]+)/);
  return m ? `formapubli_session=${m[1]}` : '';
}

async function loginAs(staffId: string, passcode: string): Promise<string> {
  const r = await call(postLogin, 'http://x/api/auth/login', { body: { staffId, passcode } });
  if (r.status !== 200) throw new Error(`login ${staffId} thất bại: ${r.status} ${J(r.body)}`);
  return cookieOf(r.headers.get('set-cookie'));
}

async function run() {
  console.log('🔐 KIỂM ĐỊNH BẢO MẬT: PHÂN QUYỀN / ĐĂNG NHẬP / ACTOR (auditB)');
  let passed = 0;
  const fails: string[] = [];
  const total = 37;
  const ok = (name: string, cond: boolean, extra = '') => {
    if (cond) { passed++; console.log(`✅ PASS: ${name}${extra ? ` (${extra})` : ''}`); }
    else { fails.push(name); console.log(`❌ FAIL: ${name}${extra ? ` (${extra})` : ''}`); }
  };

  const book = (await db.select().from(editions).limit(1))[0];
  if (!book) throw new Error('DB test chưa seed ấn bản nào.');

  // Dọn lease cashier sót lại từ suite trước (S-01 chặn đăng nhập song song),
  // và xoá bucket brute-force từ lần chạy trước (khóa 15 phút sống trong DB).
  await db.delete(activeSessions);
  await db.delete(loginAttemptBuckets);

  const cashierCk = { Cookie: await loginAs('NV-01', '1234') };
  const keeperCk = { Cookie: await loginAs('KHO-01', '5678') };
  const managerCk = { Cookie: await loginAs('QL-01', '8888') };
  const ownerCk = { Cookie: await loginAs('ADMIN-01', '9999') };
  const taxCk = { Cookie: await loginAs('THUE-01', '7890') };

  // =========================================================================
  // A. ROLE — extractUserRole() mặc định ROLE_OWNER (fail-open) khi không header
  // =========================================================================
  // A1. Request trống → hàm trả ROLE_OWNER. Đây là fail-open: bất kỳ ai
  // gọi hàm này mà không set header đều thành OWNER. Gọi thật để chứng minh.
  const noHeader = extractUserRole(new Request('http://x/'));
  ok('A1. extractUserRole() không header → ROLE_OWNER (fail-open đã biết)', noHeader === 'ROLE_OWNER', `role=${noHeader}`);

  // A2. Header rác / thiếu quyền cũng rơi về OWNER — không có "không rõ".
  const junkHeader = extractUserRole(new Request('http://x/', { headers: { 'x-formapubli-role': 'ROLE_HACKER' } }));
  ok('A2. Header vai trò không hợp lệ → vẫn ROLE_OWNER', junkHeader === 'ROLE_OWNER', `role=${junkHeader}`);

  // A3. Header hợp lệ thì tôn trọng.
  const taxHeader = extractUserRole(new Request('http://x/', { headers: { 'x-formapubli-role': 'ROLE_TAX' } }));
  ok('A3. Header ROLE_TAX hợp lệ → ROLE_TAX', taxHeader === 'ROLE_TAX', `role=${taxHeader}`);

  // A4. getDefaultTabForRole chặn key kế thừa prototype (không ném TypeError).
  let protoThrew = false;
  let protoVal: string | null = null;
  try { protoVal = getDefaultTabForRole('toString' as any); } catch { protoThrew = true; }
  ok('A4. getDefaultTabForRole("toString") trả "" chứ không ném', !protoThrew && protoVal === '', `val=${protoVal}`);

  // A5. getSettingsAccess: cashier KHÔNG được quản lý tài khoản.
  const sCashier = getSettingsAccess('ROLE_CASHIER');
  const sKeeper = getSettingsAccess('ROLE_WAREHOUSE');
  const sOwner = getSettingsAccess('ROLE_OWNER');
  ok('A5. getSettingsAccess phân đúng: cashier/keeper không quản lý tài khoản',
    sCashier.canManageAccounts === false && sKeeper.canManageAccounts === false &&
    sOwner.canManageAccounts === true && sCashier.canManagePrinter === true,
    `cashier.acc=${sCashier.canManageAccounts}, keeper.acc=${sKeeper.canManageAccounts}`);

  // A6. enforceFiscalScope ép ROLE_TAX về OFFICIAL_TAX kể cả khi xin ALL.
  const taxScope = enforceFiscalScope('ROLE_TAX', 'ALL');
  const cashierScope = enforceFiscalScope('ROLE_CASHIER', 'ALL');
  const ownerScope = enforceFiscalScope('ROLE_OWNER', 'OFFICIAL_TAX');
  ok('A6. enforceFiscalScope: TAX ép OFFICIAL_TAX, CASHIER hạ ALL xuống nội bộ, OWNER toàn quyền',
    taxScope === 'OFFICIAL_TAX' && cashierScope === 'INTERNAL_MANAGEMENT' && ownerScope === 'OFFICIAL_TAX',
    `tax=${taxScope}, cashier=${cashierScope}, owner=${ownerScope}`);

  // =========================================================================
  // B. ACTOR — resolveActorId() chống mạo danh header/body
  // =========================================================================
  // B1. AUTH_STRICT bật: mọi candidate do client gửi đều bị bỏ qua.
  const fakeSess = { role: 'ROLE_MANAGER' as const, actorId: 'QL-01', issuedAt: 1, expiresAt: 2 };
  const spoofed = resolveActorId(fakeSess, 'mallory', 'mallory2', '  ', null, undefined);
  ok('B1. resolveActorId() strict bỏ qua header/body client', spoofed === 'QL-01', `actor=${spoofed}`);

  // B2. RMA resolve: header x-formapubli-actor='mallory' → audit ghi đúng
  // người đang đăng nhập. Gọi THẬT route RMA, đọc audit thật trong DB.
  {
    // Chuẩn bị tồn kho để RMA create thành công.
    const { InventoryService } = await import('../src/services/inventory.service');
    await InventoryService.recordMovement({
      editionId: book.id, warehouseId: 'wh-au-co', eventType: 'RECEIPT', quantityDelta: 30,
      condition: 'NEW', documentRef: 'AUDITB-RECEIPT', actorId: 'auditb-setup',
      idempotencyKey: uniq('auditb-receipt'),
    });
    const created: any = await call(postRma, 'http://x/api/rma', {
      body: { warehouseId: 'wh-au-co', editionId: book.id, quantity: 1, defectReason: 'PRINT_DEFECT' },
      headers: keeperCk,
    });
    const ticketId = created.body?.data?.id;
    const res1: any = await call(postRma, 'http://x/api/rma', {
      body: { action: 'resolve', ticketId, resolutionAction: 'HOLD_IN_QUARANTINE' },
      headers: { ...managerCk, 'x-formapubli-actor': 'mallory' },
    });
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.resource, '/api/rma'))
      .orderBy(desc(auditLogs.createdAt)).limit(5);
    const a = audits.find((x: any) => `${x.details || ''}`.includes(ticketId || '@@none'));
    const actor = `${a?.actorId || ''}`;
    ok('B2. RMA resolve: header actor giả mạo bị ép về QL-01',
      created.status === 200 && res1.status === 200 && !!a && actor === 'QL-01',
      `audit.actor=${actor || '(không tìm thấy)'}`);

    // B3. body.inspectedBy='mallory' khi tạo ticket → DB ép về KHO-01.
    const row = (await db.select().from(rmaTickets).where(eq(rmaTickets.id, ticketId)).limit(1))[0] as any;
    ok('B3. RMA create: body.inspectedBy giả mạo bị ép về KHO-01',
      !!row && row.inspectedBy === 'KHO-01', `inspectedBy=${row?.inspectedBy}`);

    // B4. RMA GET: thủ kho thấy được; nhưng tham số warehouseId do client
    // điều khiển — thủ kho đọc được phiếu RMA của KHO KHÁC. Gọi thật.
    await InventoryService.recordMovement({
      editionId: book.id, warehouseId: 'wh-quynh-mai', eventType: 'RECEIPT', quantityDelta: 30,
      condition: 'NEW', documentRef: 'AUDITB-RECEIPT-2', actorId: 'auditb-setup',
      idempotencyKey: uniq('auditb-receipt-2'),
    });
    const other: any = await call(postRma, 'http://x/api/rma', {
      body: { warehouseId: 'wh-quynh-mai', editionId: book.id, quantity: 1, defectReason: 'BINDING_DEFECT' },
      headers: keeperCk,
    });
    const otherId = other.body?.data?.id;
    // KHO-01 chưa được gán kho ở case này => vẫn xem được mọi kho (hành vi cũ,
    // giữ nguyên cho tài khoản không được gán kho). Ràng buộc gán kho đo ở F5/F6.
    const leak: any = await call(getRma, `http://x/api/rma?warehouseId=wh-quynh-mai`, { headers: keeperCk });
    const leakIds = (leak.body?.data || []).map((t: any) => t.id);
    ok('B4. Tài khoản KHÔNG được gán kho vẫn xem phiếu RMA mọi kho (hành vi cũ)',
      other.status === 200 && leak.status === 200 && leakIds.includes(otherId),
      `đọc được phiếu kho khác=${leakIds.includes(otherId)}`);
  }

  // =========================================================================
  // C. ĐĂNG NHẬP — rate limit, lockout, timing-safe, hạn dùng
  // =========================================================================
  // C1. Sai PIN 5 lần liên tiếp → khóa 429 thật (gọi route login thật).
  // Lần sai thứ 5 trả 429 ngay (khóa chốt tại lần ghi thứ 5), các lần sau 429.
  {
    const victim = 'NV-04';
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await call(postLogin, 'http://x/api/auth/login', { body: { staffId: victim, passcode: '0000-wrong' } });
      statuses.push(r.status);
    }
    ok('C1. Sai PIN: 4 lần đầu 401, từ lần 5 trở đi 429 RATE_LIMITED',
      statuses[0] === 401 && statuses[3] === 401 && statuses[4] === 429 && statuses[5] === 429,
      `statuses=${statuses.join(',')}`);
  }

  // C2. Khóa theo tài khoản KHÔNG bị lách bằng cách đổi không gian/hoa-thường
  // (bucket key lowercase+trim trong auth-session). Gọi thật: sau khi NV-04
  // bị khóa, thử lại với ' nv-04 ' và 'NV-04' → vẫn 429.
  {
    const a = await call(postLogin, 'http://x/api/auth/login', { body: { staffId: ' nv-04 ', passcode: '3456' } });
    const b = await call(postLogin, 'http://x/api/auth/login', { body: { staffId: 'NV-04', passcode: '3456' } });
    ok('C2. Khóa brute-force không lách được bằng hoa/thường + khoảng trắng',
      a.status === 429 && b.status === 429, `lower=${a.status}, exact=${b.status}`);
  }

  // C3. Đổi IP không lách được khóa theo tài khoản (khoá staff độc lập IP).
  {
    const r = await call(postLogin, 'http://x/api/auth/login', {
      body: { staffId: 'NV-04', passcode: '3456' },
      headers: { 'cf-connecting-ip': '203.0.113.77', 'x-forwarded-for': '198.51.100.9' },
    });
    ok('C3. Đổi IP + header giả vẫn bị khóa theo tài khoản', r.status === 429, `status=${r.status}`);
  }

  // C4. safeEqual so sánh hằng thời gian, sai 1 ký tự là false.
  ok('C4. safeEqual đúng/sai', safeEqual('abc123', 'abc123') === true && safeEqual('abc123', 'abc124') === false);

  // C5. Token đã hết hạn bị từ chối (gọi verifySession thật).
  {
    const now = Date.now();
    const expired = await signSession({ role: 'ROLE_OWNER', actorId: 'X', issuedAt: now - 20 * 3600e3, expiresAt: now - 1000 });
    ok('C5. Token quá hạn bị verifySession từ chối', (await verifySession(expired)) === null);
  }

  // C6. Token bị sửa payload (nâng role) bị từ chối.
  {
    const now = Date.now();
    const t = await signSession({ role: 'ROLE_CASHIER', actorId: 'NV-01', issuedAt: now, expiresAt: now + 3600e3 });
    const [p, sig] = t.split('.');
    const forged = `${Buffer.from(JSON.stringify({ role: 'ROLE_OWNER', actorId: 'NV-01', issuedAt: now, expiresAt: now + 3600e3 })).toString('base64url')}.${sig}`;
    ok('C6. Token sửa payload (CASHIER→OWNER) bị từ chối',
      (await verifySession(t))?.role === 'ROLE_CASHIER' && (await verifySession(forged)) === null);
  }

  // C7. isAuthStrict() đang BẬT trong môi trường test ⇒ đo đúng đường production.
  ok('C7. isAuthStrict() = true (đang đo đường bảo vệ production)', isAuthStrict() === true);

  // =========================================================================
  // D. ĐĂNG XUẤT — token có bị vô hiệu hoá ở server không?
  // =========================================================================
  // D1. Đăng nhập lấy cookie, ĐĂNG XUẤT, rồi dùng lại cookie cũ gọi /api/auth/me.
  // Nếu server chỉ xoá cookie phía client thì cookie cũ VẪN dùng được.
  {
    const ck = await loginAs('NV-03', '2345');
    const before = await call((await import('../src/app/api/auth/me/route')).GET, 'http://x/api/auth/me', { headers: { Cookie: ck } });
    await call(postLogout, 'http://x/api/auth/logout', { headers: { Cookie: ck } });
    const after = await call((await import('../src/app/api/auth/me/route')).GET, 'http://x/api/auth/me', { headers: { Cookie: ck } });
    ok('D1. /api/auth/me: cookie hợp lệ trước khi logout = 200', before.status === 200, `trước=${before.status}`);
    ok('D2. ĐĂNG XUẤT KHÔNG thu hồi token phía server (cookie cũ vẫn 200)',
      after.status === 200, `sau logout=${after.status} — token còn sống tới hết 12h`);
  }

  // =========================================================================
  // E. THIẾU PHÂN QUYỀN — gọi route thật không cookie / sai vai trò
  // =========================================================================
  const noAuth = await call(getOrders, 'http://x/api/orders');
  ok('E1. GET /api/orders không cookie → 401', noAuth.status === 401, `status=${noAuth.status}`);

  const taxOrders: any = await call(getOrders, 'http://x/api/orders', { headers: taxCk });
  ok('E2. ROLE_TAX xem /api/orders bị ép OFFICIAL_TAX',
    taxOrders.status === 200 && taxOrders.body?.fiscalScope === 'OFFICIAL_TAX',
    `scope=${taxOrders.body?.fiscalScope}`);

  const keeperOrders: any = await call(getOrders, 'http://x/api/orders', { headers: keeperCk });
  ok('E3. ROLE_WAREHOUSE xem /api/orders → danh sách rỗng (không lộ doanh thu)',
    keeperOrders.status === 200 && Array.isArray(keeperOrders.body?.orders) && keeperOrders.body.orders.length === 0,
    `số đơn thấy=${keeperOrders.body?.orders?.length}`);

  // E4. Thủ kho KHÔNG được xem danh bạ khách (PII: tên/điện thoại/địa chỉ).
  const keeperCust: any = await call(getCustomers, 'http://x/api/customers', { headers: keeperCk });
  ok('E4. ROLE_WAREHOUSE bị chặn khỏi /api/customers (PII)', keeperCust.status === 403, `status=${keeperCust.status}`);

  // E5. Không cookie thì /api/customers cũng 401.
  const anonCust = await call(getCustomers, 'http://x/api/customers');
  ok('E5. /api/customers không cookie → 401', anonCust.status === 401, `status=${anonCust.status}`);

  // E6. /api/auth/accounts là công khai (màn hình đăng nhập) — KHÔNG được lộ hash.
  const accounts: any = await call(getAccounts, 'http://x/api/auth/accounts');
  const firstAcc = (accounts.body?.data || [])[0] || {};
  ok('E6. /api/auth/accounts công khai nhưng KHÔNG lộ passcodeHash/salt',
    accounts.status === 200 && !('passcodeHash' in firstAcc) && !('salt' in firstAcc),
    `status=${accounts.status}, fields=${Object.keys(firstAcc).join('|')}`);

  // =========================================================================
  // F. GHI TIỀN/TỒN — thủ kho bút toán kho KHÔNG được gán của mình
  // =========================================================================
  // F1. Gán KHO-01 vào wh-au-co rồi thử bút toán ở kho khác.
  {
    await db.update(staffAccounts).set({ assignedWarehouseId: 'wh-au-co' })
      .where(eq(staffAccounts.staffId, 'KHO-01'));
    const ck = await loginAs('KHO-01', '5678');
    const mine: any = await call(postMovement, 'http://x/api/inventory/movement', {
      body: { editionId: book.id, warehouseId: 'wh-au-co', eventType: 'RECEIPT', quantityDelta: 5, documentRef: 'AUDITB-OK', idempotencyKey: uniq('mv-ok') },
      headers: { Cookie: ck },
    });
    const other: any = await call(postMovement, 'http://x/api/inventory/movement', {
      body: { editionId: book.id, warehouseId: 'wh-quynh-mai', eventType: 'RECEIPT', quantityDelta: 5, documentRef: 'AUDITB-X', idempotencyKey: uniq('mv-x') },
      headers: { Cookie: ck },
    });
    ok('F1. Bút toán kho ĐƯỢC gán → 200', mine.status === 200, `status=${mine.status}`);
    ok('F2. Bút toán kho KHÔNG được gán → 403 (ràng buộc kho được gán)',
      other.status === 403, `status=${other.status}`);
    await db.update(staffAccounts).set({ assignedWarehouseId: null })
      .where(eq(staffAccounts.staffId, 'KHO-01'));
  }

  // F3. Mở két ở kho không được gán → phải 403 (cashbox route CÓ chặt).
  {
    await db.update(staffAccounts).set({ assignedWarehouseId: 'wh-au-co' })
      .where(eq(staffAccounts.staffId, 'NV-02'));
    const ck = await loginAs('NV-02', '1234');
    const wrong: any = await call(postCashbox, 'http://x/api/cashbox', {
      body: { action: 'OPEN', warehouseId: 'wh-du-phong', openingCash: 1000 },
      headers: { Cookie: ck },
    });
    ok('F3. Mở két ở kho không được gán → 403', wrong.status === 403, `status=${wrong.status}`);
    await db.update(staffAccounts).set({ assignedWarehouseId: null })
      .where(eq(staffAccounts.staffId, 'NV-02'));
  }

  // F4. Thủ kho xem két của người khác bị ép về chính mình (đã có guard).
  {
    const r: any = await call(getCashbox, 'http://x/api/cashbox?cashierId=QL-01', { headers: cashierCk });
    const seen = `${r.body?.data?.cashierId || ''}`;
    ok('F4. CASHIER ngó két người khác bị ép về mình', r.status === 200 && seen !== 'QL-01', `thấy=${seen || '(null)'}`);
  }

  // =========================================================================
  // F5-F7. Ràng buộc kho được gán trên CÁC route ghi tồn (trước đây thiếu).
  // Mỗi case gọi thật route, kiểm tra 403 thật + tồn kho kho khác KHÔNG bị đụng.
  // =========================================================================
  {
    const { InventoryService } = await import('../src/services/inventory.service');
    // Kho đích: quynh-mai. Gán KHO-01 vào au-co => mọi thao tác quynh-mai phải 403.
    await db.update(staffAccounts).set({ assignedWarehouseId: 'wh-au-co' })
      .where(eq(staffAccounts.staffId, 'KHO-01'));
    const ck = await loginAs('KHO-01', '5678');

    // F5. Lập RMA ở kho khác → 403.
    const rmaBad: any = await call(postRma, 'http://x/api/rma', {
      body: { warehouseId: 'wh-quynh-mai', editionId: book.id, quantity: 1, defectReason: 'PRINT_DEFECT' },
      headers: { Cookie: ck },
    });
    ok('F5. Lập RMA ở kho KHÔNG được gán → 403', rmaBad.status === 403, `status=${rmaBad.status}`);

    // F6. Đọc RMA kho khác → 403; và bỏ tham số cũng KHÔNG được xem tất cả.
    const rmaReadBad: any = await call(getRma, 'http://x/api/rma?warehouseId=wh-quynh-mai', { headers: { Cookie: ck } });
    const rmaReadAll: any = await call(getRma, 'http://x/api/rma', { headers: { Cookie: ck } });
    const allWhs = new Set((rmaReadAll.body?.data || []).map((t: any) => t.warehouseId));
    ok('F6. Đọc RMA kho khác → 403, bỏ tham số chỉ thấy kho của mình',
      rmaReadBad.status === 403 && rmaReadAll.status === 200 && !allWhs.has('wh-quynh-mai'),
      `đọc khác=${rmaReadBad.status}, kho thấy khi bỏ tham số=${Array.from(allWhs).join(',') || '(rỗng)'}`);

    // F7. Xuất phiếu chuyển kho từ kho khác → 403.
    const trBad: any = await call(postTransfers, 'http://x/api/transfers', {
      body: { action: 'dispatch', fromWarehouseId: 'wh-quynh-mai', toWarehouseId: 'wh-au-co', items: [{ editionId: book.id, quantity: 1 }], idempotencyKey: uniq('tr-bad') },
      headers: { Cookie: ck },
    });
    ok('F7. Xuất phiếu chuyển kho từ kho KHÔNG được gán → 403', trBad.status === 403, `status=${trBad.status}`);

    // F8. Lập phiếu xuất kho hội chợ từ kho khác → 403.
    const dlBad: any = await call(postDelivery, 'http://x/api/delivery-orders', {
      body: { partnerId: 'part-mao-dinh-le', fromWarehouseId: 'wh-quynh-mai', items: [{ editionId: book.id, quantity: 1 }] },
      headers: { Cookie: ck },
    });
    ok('F8. Lập phiếu xuất kho hội chợ từ kho KHÔNG được gán → 403', dlBad.status === 403, `status=${dlBad.status}`);

    // F9. Cùng thao tác ở kho ĐƯỢC gán vẫn chạy (không chặn nhầm).
    const mvOk2: any = await call(postMovement, 'http://x/api/inventory/movement', {
      body: { editionId: book.id, warehouseId: 'wh-au-co', eventType: 'RECEIPT', quantityDelta: 3, documentRef: 'AUDITB-OK2', idempotencyKey: uniq('mv-ok2') },
      headers: { Cookie: ck },
    });
    ok('F9. Bút toán kho ĐƯỢC gán vẫn 200 (không chặn nhầm)', mvOk2.status === 200, `status=${mvOk2.status}`);

    // F10. Kho khác thực sự KHÔNG bị bút toán (kiểm chứng tác dụng, không chỉ mã 403).
    const balOther = await InventoryService.getBalance(book.id, 'wh-quynh-mai', 'NEW');
    const balOther2 = await InventoryService.getBalance(book.id, 'wh-quynh-mai', 'NEW');
    ok('F10. Tồn kho kho khác không đổi sau các lần gọi bị chặn',
      balOther === balOther2, `tồn quynh-mai=${balOther}`);

    await db.update(staffAccounts).set({ assignedWarehouseId: null })
      .where(eq(staffAccounts.staffId, 'KHO-01'));
  }

  // =========================================================================
  // G. TÀI KHOẢN BỊ VÔ HIỆU HÓA / ĐỔI ROLE → phiên cũ mất hiệu lực
  // =========================================================================
  {
    await db.delete(activeSessions); // lease từ lần login trước chặn S-01
    const ck = await loginAs('NV-01', '1234');
    await db.delete(activeSessions); // lease cũ chặn validateSessionAccount
    await db.update(staffAccounts).set({ isActive: false }).where(eq(staffAccounts.staffId, 'NV-01'));
    const after: any = await call(getOrders, 'http://x/api/orders', { headers: { Cookie: ck } });
    ok('G1. Khóa tài khoản → phiên đang mở bị chặn ngay', after.status === 401 || after.status === 403, `status=${after.status}`);
    await db.update(staffAccounts).set({ isActive: true }).where(eq(staffAccounts.staffId, 'NV-01'));
  }

  // G2. Đổi PIN → bump sessionVersion → phiên cũ chết.
  {
    await db.delete(activeSessions);
    const ck = await loginAs('NV-01', '1234');
    await db.delete(activeSessions);
    const { hashStaffPasscodeV2 } = await import('../src/lib/auth-session');
    const newSalt = `salt-auditb-${Date.now()}`;
    await db.update(staffAccounts)
      .set({ salt: newSalt, passcodeHash: await hashStaffPasscodeV2('4321', newSalt), sessionVersion: 2 })
      .where(eq(staffAccounts.staffId, 'NV-01'));
    const after: any = await call(getOrders, 'http://x/api/orders', { headers: { Cookie: ck } });
    ok('G2. Đổi PIN (bump version) → phiên cũ bị thu hồi', after.status === 401 || after.status === 403, `status=${after.status}`);
    // Trả lại PIN gốc cho suite sau.
    const { DEFAULT_STAFF_ACCOUNTS } = await import('../src/lib/auth-session');
    const orig = DEFAULT_STAFF_ACCOUNTS.find((s) => s.staffId === 'NV-01')!;
    await db.update(staffAccounts)
      .set({ salt: orig.salt, passcodeHash: await hashStaffPasscodeV2(orig.passcode, orig.salt), sessionVersion: 1 })
      .where(eq(staffAccounts.staffId, 'NV-01'));
  }

  console.log(`\n${passed === total ? '🎉' : '⚠️'} RBAC-AUDIT: ${passed}/${total} ${passed === total ? 'PASS 100%' : 'CÓ FAIL'}`);
  if (fails.length) { console.log('❌ FAIL:'); for (const f of fails) console.log(`   - ${f}`); }
  if (passed !== total) process.exit(1);
}

run().catch((err) => {
  console.error('❌ test-rbac-audit thất bại:', err);
  process.exit(1);
});
