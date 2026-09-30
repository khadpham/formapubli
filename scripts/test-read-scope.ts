/**
 * KIỂM ĐỊNH: route ĐỌC cũng phải giới hạn theo kho được gán.
 *
 * CHẠY: npx tsx scripts/run-isolated.ts --only=test-read-scope
 *
 * Bối cảnh (auditB 30/09 đã vá phía GHI): `assertAssignedWarehouse` chỉ tồn tại
 * ở route ghi. Phía ĐỌC thì không có gì chặn ⇒ thủ kho được gán kho Âu Cơ vẫn
 * xem được danh sách chuyển hàng và phiếu xuất của kho Quỳnh Mai.
 *
 * Vì không thể "chặn" khi đọc, phải LỌC kết quả — đó là `filterByAssignedWarehouse`
 * và `assertReadWarehouse` trong `src/lib/auth-session.ts`.
 *
 * Test này gọi THẬT handler của route (không regex file nguồn).
 */
import { db, editions, warehouses } from '../src/db';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { GET as getTransfers } from '../src/app/api/transfers/route';
import { GET as getDeliveryOrders } from '../src/app/api/delivery-orders/route';
import { POST as postLogin } from '../src/app/api/auth/login/route';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-read-scope');

const J = (v: unknown) => JSON.stringify(v);

let passed = 0;
const fails: string[] = [];
const total = 10;
const ok = (name: string, cond: boolean, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}${extra ? ` (${extra})` : ''}`); }
  else { fails.push(name); console.log(`  ✗ ${name}${extra ? ` (${extra})` : ''}`); }
};

async function call(handler: (req: any) => Promise<Response>, url: string, cookie: string) {
  const r = await handler(
    new Request(url, { method: 'GET', headers: { cookie } }) as any
  );
  const text = await r.text();
  let body: any = {};
  try { body = JSON.parse(text); } catch { /* phản hồi không phải JSON */ }
  return { status: r.status, body };
}

function cookieOf(setCookie: string | null): string {
  const m = `${setCookie || ''}`.match(/formapubli_session=([^;]+)/);
  return m ? `formapubli_session=${m[1]}` : '';
}

async function loginAs(staffId: string, passcode: string): Promise<string> {
  const r = await postLogin(
    new Request('http://x/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ staffId, passcode }),
    }) as any
  );
  if (r.status !== 200) throw new Error(`Đăng nhập ${staffId} thất bại: ${r.status}`);
  return cookieOf(r.headers.get('set-cookie'));
}

async function run() {
  console.log('\n=== ROUTE ĐỌC: GIỚI HẠN THEO KHO ĐƯỢC GÁN ===');

  const allWarehouses = await db.select().from(warehouses).orderBy(warehouses.id);
  if (allWarehouses.length < 2) throw new Error('Cần ít nhất 2 kho trong DB test.');
  const myWarehouse = 'wh-au-co';
  const otherWarehouse = allWarehouses.find((w) => w.id !== myWarehouse)?.id;
  if (!otherWarehouse) throw new Error(`DB test phải có kho khác ngoài ${myWarehouse}.`);

  // `KHO-01` là Thủ Kho (ROLE_WAREHOUSE), passcode 5678 — xem DEFAULT_STAFF_ACCOUNTS.
  // Chọn đúng role này vì đó là vai trò bị ràng buộc kho; OWNER/MANAGER có
  // `assignedWarehouseId = null` nên không bao giờ bị lọc, test sẽ vô nghĩa.
  const staffId = 'KHO-01';
  const passcode = '5678';

  await db
    .update(schema.staffAccounts)
    .set({ assignedWarehouseId: myWarehouse })
    .where(eq(schema.staffAccounts.staffId, staffId));

  const cookie = await loginAs(staffId, passcode);

  // Tạo 2 phiếu xuất: một ở kho mình, một ở kho khác.
  const book = (await db.select().from(editions).limit(1))[0];
  const partner = (await db.select().from(schema.partners).limit(1))[0];
  if (!partner) throw new Error('DB test chưa có đối tác nào.');
  const stamp = Date.now();
  const mine = `ro-mine-${stamp}`;
  const theirs = `ro-theirs-${stamp}`;
  const base = {
    partnerId: partner.id,
    status: 'DRAFT' as const,
    createdBy: staffId,
    note: 'read-scope test',
    finalAmount: 100000,
    subtotal: 100000,
    discountRate: 0,
  };
  await db.insert(schema.deliveryOrders).values({
    ...base,
    id: mine,
    code: mine,
    fromWarehouseId: myWarehouse,
    createdAt: new Date().toISOString(),
  } as any);
  await db.insert(schema.deliveryOrders).values({
    ...base,
    id: theirs,
    code: theirs,
    fromWarehouseId: otherWarehouse,
    createdAt: new Date().toISOString(),
  } as any);

  // 1) Danh sách phiếu xuất của kho khác KHÔNG được xuất hiện.
  const list = await call(getDeliveryOrders, 'http://x/api/delivery-orders', cookie);
  const rows = Array.isArray(list.body?.data) ? list.body.data : [];
  const ids = rows.map((r: any) => String(r.id || r.code || ''));
  ok('D1. Danh sách phiếu xuất trả 200', list.status === 200, `status=${list.status} body=${J(list.body).slice(0, 200)}`);
  ok('D2. KHÔNG lộ phiếu của kho khác', !ids.includes(theirs), `n=${ids.length}`);
  ok('D3. VẪN thấy phiếu của kho mình', ids.includes(mine), `n=${ids.length}`);

  // Phiếu chuyển hàng: một phiếu GỬI TỪ kho mình, một phiếu HOÀN TOÀN kho khác.
  // (Không có dữ liệu này thì T2/T3 chỉ "đỏ giả" — phải tạo thật để kiểm.)
  const third = allWarehouses.find((w) => w.id !== myWarehouse && w.id !== otherWarehouse)?.id || myWarehouse;
  const trMine = `ro-tr-mine-${stamp}`;
  const trTheirs = `ro-tr-theirs-${stamp}`;
  await db.insert(schema.transferShipments).values({
    id: trMine,
    fromWarehouseId: myWarehouse,
    toWarehouseId: third,
    dispatcherId: staffId,
    status: 'IN_TRANSIT',
    dispatchedAt: new Date().toISOString(),
  } as any);
  await db.insert(schema.transferShipments).values({
    id: trTheirs,
    fromWarehouseId: otherWarehouse,
    toWarehouseId: third,
    dispatcherId: 'NV-01',
    status: 'IN_TRANSIT',
    dispatchedAt: new Date().toISOString(),
  } as any);

  // 2) Chuyển hàng: không lộ phiếu của kho khác.
  const tList = await call(getTransfers, 'http://x/api/transfers', cookie);
  const tRows = Array.isArray(tList.body?.data) ? tList.body.data : [];
  const tIds = tRows.map((r: any) => String(r.id || ''));
  ok('T1. Chuyển hàng trả 200', tList.status === 200, `status=${tList.status}`);
  ok('T2. KHÔNG lộ phiếu chuyển hàng của kho khác', !tIds.includes(trTheirs), `n=${tIds.length}`);
  ok('T3. VẪN thấy phiếu gửi từ kho mình', tIds.includes(trMine), `n=${tIds.length}`);

  // 3) Mở từng phiếu: của kho khác phải bị chặn, của kho mình thì được.
  const oneTheirs = await call(getTransfers, `http://x/api/transfers?id=${trTheirs}`, cookie);
  ok('T4. Mở phiếu chuyển hàng của KHO KHÁC bị chặn 403', oneTheirs.status === 403, `status=${oneTheirs.status}`);
  const oneMine = await call(getTransfers, `http://x/api/transfers?id=${trMine}`, cookie);
  ok('T5. Mở phiếu chuyển hàng của KHO MÌNH vẫn được', oneMine.status === 200, `status=${oneMine.status}`);

  // 4) Dọn dẹp.
  await db.delete(schema.transferShipments).where(eq(schema.transferShipments.id, trMine));
  await db.delete(schema.transferShipments).where(eq(schema.transferShipments.id, trTheirs));
  await db.delete(schema.deliveryOrders).where(eq(schema.deliveryOrders.id, mine));
  await db.delete(schema.deliveryOrders).where(eq(schema.deliveryOrders.id, theirs));
  await db
    .update(schema.staffAccounts)
    .set({ assignedWarehouseId: null })
    .where(eq(schema.staffAccounts.staffId, staffId));

  console.log(`\nTổng ${total} assertion — PASS ${passed}, FAIL ${fails.length}.`);
  if (fails.length) { for (const f of fails) console.log(`  ✗ ${f}`); process.exit(1); }
  console.log('\n✅ ROUTE ĐỌC ĐÃ GIỚI HẠN THEO KHO.');
}

run().catch((e) => { console.error('❌', e); process.exit(1); });
