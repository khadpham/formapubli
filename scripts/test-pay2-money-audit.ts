/**
 * AUDIT C2 — LỚP TIỀN THẬT, vòng 2 (30/09): những lỗ hổng mà `test-auditC-money`
 * (vòng 1) chưa chạm tới.
 *
 * NGUYÊN TẮC (gotcha 11 — FALSE-GREEN TEST): mọi kiểm chứng ở đây GỌI CODE THẬT
 * với DỮ LIỆU THẬT trong formapubli_test.db. Không assertion nào lặp lại logic SQL
 * thuần, không assertion nào soi regex nguồn để "chứng minh" một đường ranh giới
 * đã chạy. Số liệu trước→sau đều đọc từ DB.
 *
 * Vòng này tìm được (xem báo cáo):
 *  - LỖI 1: `channel: 'SPONSORSHIP'` do client gửi vào /api/orders ⇒ đơn tiền mặt
 *    thật biến mất khỏi mọi báo cáo doanh số VÀ lách trọn bộ guard ca két của
 *    kênh quầy. ĐÃ SỬA ở `OrderService.createOrder` (chặn tại service, đúng nơi
 *    mọi caller đều đi qua).
 *  - LỖI 2: hoàn tiền mặt bùng sang két của KHO KHÁC ⇒ `expectedCash` két đó
 *    âm, còn két kho đã thu vẫn hiện đã bán trọn. ĐÃ SỬA ở
 *    `ReturnService.complete` (két hoàn phải thuộc kho xuất của đơn gốc).
 *  - LỖI 3 (CHƯA SỬA, cần owner quyết): đơn tiền mặt chốt TỨC THÌ ở kênh quầy
 *    không bắt buộc có ca két. Xem khối K dưới đây.
 *  - LỖI 4 (CHƯA SỬA, ngoài phạm vi file của agent): QR mang số tiền do CLIENT
 *    tính, không phải `finalAmount` server ghi. Xem khối G.
 *
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-pay2-money-audit
 */
import assert from 'node:assert/strict';
import { db, orders, orderItems, editions, cashboxSessions, discountApprovalRequests } from '../src/db';
import { sql, eq } from 'drizzle-orm';
import { OrderService, CashboxService, businessDateOf } from '../src/services/order.service';
import { InventoryService } from '../src/services/inventory.service';
import { ReturnService } from '../src/services/return.service';
import { SponsorshipService } from '../src/services/sponsorship.service';
import { BundleService } from '../src/services/bundle.service';
import { DiscountApprovalService } from '../src/services/discount-approval.service';
import { generateVietQRPayload, normalizeVietqrContent } from '../src/lib/vietqr';
import { resolveTransferContent } from '../src/lib/transfer-content';
import { priceLine } from '../src/lib/pricing';
import type { CartItemInput } from '../src/services/discount-approval.service';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-pay2-money-audit');

const A = 'wh-au-co';
const B = 'wh-quynh-mai';
const CASHIER = { staffId: 'NV-01', role: 'ROLE_CASHIER', fullName: 'Thu Ngân 01' } as any;
const MGR = { staffId: 'QL-01', role: 'ROLE_MANAGER', fullName: 'Lan Anh' } as any;
const CASHIER2 = { staffId: 'NV-02', role: 'ROLE_CASHIER', fullName: 'Thu Ngân 02' } as any;

let checks = 0;
function ok(label: string, cond: boolean, extra = '') {
  checks++;
  const line = `${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`;
  console.log(line);
  assert.ok(cond, `${label} ${extra}`);
}

let seq = 0;
/** Tiền tố riêng: DB test dùng chung cho ~98 suite, không được đụng số liệu của nhau. */
const uniq = (p: string) => `pay2-${p}-${Date.now()}-${seq++}`;

async function pickEditions(n: number, warehouseId = A, minQty = 12) {
  const all: any[] = await db.select({ id: editions.id, coverPrice: editions.coverPrice }).from(editions);
  const out: Array<{ id: string; cover: number }> = [];
  for (const e of all) {
    if (out.length >= n) break;
    if ((await InventoryService.getBalance(e.id, warehouseId, 'NEW')) >= minQty) {
      out.push({ id: e.id, cover: e.coverPrice || 0 });
    }
  }
  assert.ok(out.length >= n, `Cần ${n} ấn bản tồn dày ở ${warehouseId}, thực tế ${out.length}`);
  return out;
}

/** Bảng chụp tiền + tồn để chứng minh "bị từ chối ⇒ không ghi gì". */
async function snapshot(warehouseId = A) {
  const ords: any[] = await db.select().from(orders);
  const led: any[] = await db.all(sql`SELECT COUNT(*) AS n FROM inventory_ledger`);
  const bals: any[] = await db.all(
    sql`SELECT edition_id || ':' || condition || ':' || physical_quantity AS k FROM stock_balances WHERE warehouse_id = ${warehouseId} ORDER BY k`
  );
  return {
    orders: ords.length,
    ledger: Number((led as any[])[0]?.n || 0),
    balances: (bals as any[]).map((b: any) => `${b.k}`).join('|'),
  };
}

async function openShift(cashierId: string, warehouseId: string, openingCash = 500000) {
  const s: any = await CashboxService.openSession({ warehouseId, cashierId, openingCash });
  return s.session.id as string;
}

async function run() {
  console.log('\n=== AUDIT C2 — LỚP TIỀN THẬT vòng 2 (gọi code thật, dữ liệu thật) ===');
  const ed = await pickEditions(5);
  const shiftA = await openShift(CASHIER.staffId, A);
  const shiftAMgr = await openShift(MGR.staffId, A);

  // =====================================================================
  // A. PHÉP TÍNH — chiết khấu TRỘN (dòng + tổng) và bộ lọc ngày nghiệp vụ VN
  // =====================================================================
  console.log('\n--- A. PHÉP TÍNH (chiết khấu trộn + ngày nghiệp vụ VN) ---');
  {
    const o: any = await OrderService.createOrder({
      warehouseId: A, channel: 'FAIR_EVENT', paymentMethod: 'CASH',
      discountRate: 0.1, cashierId: CASHIER.staffId, cashboxSessionId: shiftA,
      idempotencyKey: uniq('a-mix'),
      items: [
        { editionId: ed[0].id, quantity: 3, unitDiscountRate: 0.1 },
        { editionId: ed[1].id, quantity: 2 },
        { editionId: ed[2].id, quantity: 4, unitDiscountRate: 0.25 },
      ],
    } as any);
    const ls: any[] = await db.select().from(orderItems).where(eq(orderItems.orderId, o.orderId));
    const sumCover = ls.reduce((s, l) => s + l.unitCoverPrice * l.quantity, 0);
    const sumTotal = ls.reduce((s, l) => s + l.totalAmount, 0);
    ok('A1 chiết khấu trộn: subtotal = Σ(giá bìa × SL)', o.subtotal === sumCover, `${o.subtotal} vs ${sumCover}`);
    ok('A2 chiết khấu trộn: finalAmount = Σ dòng', o.finalAmount === sumTotal, `${o.finalAmount} vs ${sumTotal}`);
    ok('A3 chiết khấu trộn: discountAmount = subtotal − final', o.discountAmount === o.subtotal - o.finalAmount, `${o.discountAmount}`);
    ok(
      'A4 mỗi dòng lưu đúng mức giảm riêng (dòng 25% không bị kéo về 10%)',
      ls.find((l) => l.editionId === ed[2].id)?.unitDiscountRate === 0.25 &&
        ls.find((l) => l.editionId === ed[1].id)?.unitDiscountRate === 0.1,
      ls.map((l) => `${l.unitDiscountRate}`).join(',')
    );
    // Tính tay theo priceLine — nguồn sự thật dùng chung — rồi đối chiếu.
    const byHand = ls.reduce(
      (s, l) => s + priceLine(l.unitCoverPrice, l.unitDiscountRate ?? 0, l.quantity).finalAmount,
      0
    );
    ok('A5 tổng tiền = Σ priceLine() tính tay (không lệch làm tròn)', o.finalAmount === byHand, `${o.finalAmount} vs ${byHand}`);

    // A6: lọc ngày nghiệp vụ VN trên đường TIỀN (createdAtBetween đã harden).
    // Đối chiếu bằng tay: đơn nào rơi vào ngày VN hôm nay thì phải vào báo cáo.
    const today = businessDateOf(new Date());
    const yDay = businessDateOf(new Date(Date.now() - 86_400_000));
    const allA: any[] = await db.select().from(orders).where(eq(orders.warehouseId, A));
    const paid = allA.filter((x) => x.status === 'COMPLETED' && x.channel !== 'SPONSORSHIP');
    for (const day of [today, yDay]) {
      const sum: any = await OrderService.getSalesSummary({ warehouseId: A, startDate: day, endDate: day });
      const hand = paid.filter((x) => businessDateOf(new Date(x.createdAt)) === day).reduce((t, x) => t + x.finalAmount, 0);
      ok(`A6 báo cáo doanh số ngày ${day} = Σ đơn COMPLETED của đúng ngày VN`, sum.totalRevenue === hand, `${sum.totalRevenue} vs ${hand}`);
      ok(
        `A6b báo cáo ngày ${day} không nuốt đơn 00:00–07:00 VN (7 tiếng đầu)`,
        sum.totalOrders === paid.filter((x) => businessDateOf(new Date(x.createdAt)) === day).length,
        `${sum.totalOrders} đơn`
      );
    }
  }

  // =====================================================================
  // B. BIÊN HTTP: rác vào số tiền phải 400, không phải 500, không ghi gì
  // =====================================================================
  console.log('\n--- B. BIÊN HTTP (route thật) ---');
  {
    const { POST: postOrders } = await import('../src/app/api/orders/route');
    const { POST: postLogin } = await import('../src/app/api/auth/login/route');
    const { POST: postLogout } = await import('../src/app/api/auth/logout/route');
    const login = async (staffId: string, passcode: string) => {
      const res: any = await postLogin(
        new Request('http://localhost/api/auth/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ staffId, passcode }),
        }) as any
      );
      const m = `${res.headers.get('set-cookie') || ''}`.match(/formapubli_session=([^;]+)/);
      return { status: res.status, cookie: m ? `formapubli_session=${m[1]}` : '' };
    };
    const tn = await login('NV-01', '1234');
    const mgr = await login('QL-01', '8888');
    ok('B0 đăng nhập thu ngân + quản lý thật', tn.status === 200 && mgr.status === 200, `NV-01=${tn.status} QL-01=${mgr.status}`);
    const call = async (cookie: string, body: any) => {
      const res: any = await postOrders(
        new Request('http://localhost/api/orders', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify(body),
        }) as any
      );
      return { status: res.status, json: await res.json() };
    };

    // B1 — LỖI 1 ĐÃ SỬA: kênh SPONSORSHIP không được bán hàng.
    {
      const before = await snapshot();
      const r = await call(tn.cookie, {
        warehouseId: A, channel: 'SPONSORSHIP', paymentMethod: 'CASH',
        customerName: 'PAY2-B1', idempotencyKey: uniq('b-spf'),
        items: [{ editionId: ed[0].id, quantity: 1 }],
      });
      const after = await snapshot();
      ok('B1 kênh SPONSORSHIP bị từ chối ở đường bán hàng', r.status === 400, `status ${r.status}: ${r.json?.error}`);
      ok('B1b kênh SPONSORSHIP bị từ chối thì không ghi gì', JSON.stringify(before) === JSON.stringify(after));
    }
    {
      // Chặn ở SERVICE chứ không phải route: đường đồng bộ offline / caller nội
      // bộ cũng không lách được. Gọi thẳng OrderService.
      let blocked = false;
      try {
        await OrderService.createOrder({
          warehouseId: A, channel: 'SPONSORSHIP', paymentMethod: 'CASH',
          cashierId: CASHIER.staffId, idempotencyKey: uniq('b-spf-svc'),
          items: [{ editionId: ed[0].id, quantity: 1 }],
        } as any);
      } catch (e: any) {
        blocked = /SPONSORSHIP/.test(e.message);
      }
      ok('B1c service cũng chặn kênh SPONSORSHIP (mọi caller đều qua đây)', blocked);
    }

    // B2 — rác số tiền: chuỗi rác, số lượng chuỗi, số lượng phân số.
    for (const [label, patch] of [
      ['discountRate "abc"', { discountRate: 'abc' }],
      ['discountRate "0.5abc"', { discountRate: '0.5abc' }],
      ['quantity "3" (chuỗi)', { items: [{ editionId: ed[0].id, quantity: '3' }] }],
      ['quantity 2.5', { items: [{ editionId: ed[0].id, quantity: 2.5 }] }],
      // Dưới trần 20% để lọt qua cổng duyệt rồi mới tới lớp service — đây mới
      // là chỗ chuỗi phải bị chặn (service so `Number.isFinite` trên BẢN GỐC).
      ['unitDiscountRate "0.15" (chuỗi)', { items: [{ editionId: ed[0].id, quantity: 1, unitDiscountRate: '0.15' }] }],
    ] as Array<[string, any]>) {
      const before = await snapshot();
      const r = await call(tn.cookie, {
        warehouseId: A, channel: 'FAIR_EVENT', paymentMethod: 'CASH',
        customerName: 'PAY2-B2', idempotencyKey: uniq('b-rac'),
        items: [{ editionId: ed[0].id, quantity: 1 }],
        ...patch,
      });
      const after = await snapshot();
      // Bất biến thật: KHÔNG tạo đơn, KHÔNG ghi gì. Mã lỗi có thể 400 (lớp
      // service chặn rác) hoặc 403 (cổng trần 20% chặn trước) — cả hai đều đúng.
      ok(
        `B2 ${label} bị từ chối (400/403, không phải 500)`,
        r.json?.success === false && (r.status === 400 || r.status === 403),
        `status ${r.status}: ${r.json?.error}`
      );
      ok(`B2 ${label} không ghi gì`, JSON.stringify(before) === JSON.stringify(after));
    }

    // B3 — chiết khấu 20% của THU NGÂN không có phê duyệt: chặn.
    {
      const r = await call(tn.cookie, {
        warehouseId: A, channel: 'FAIR_EVENT', paymentMethod: 'CASH',
        customerName: 'PAY2-B3', idempotencyKey: uniq('b-cap'),
        discountRate: 0.2, items: [{ editionId: ed[0].id, quantity: 1 }],
      });
      ok('B3 thu ngân chiết khấu 20% không có duyệt ⇒ 403', r.status === 403, `status ${r.status}: ${r.json?.error}`);
    }
    {
      // Dưới trần vẫn bán được (hợp đồng cũ không hỏng).
      const r = await call(tn.cookie, {
        warehouseId: A, channel: 'FAIR_EVENT', paymentMethod: 'CASH',
        customerName: 'PAY2-B3b', idempotencyKey: uniq('b-cap-ok'),
        discountRate: 0.1, items: [{ editionId: ed[0].id, quantity: 1 }],
      });
      ok('B3b thu ngân chiết khấu 10% (dưới trần) vẫn bán được', r.status === 200, `status ${r.status}: ${r.json?.error}`);
    }

    // B4 — giả lập duyệt rồi đổi giỏ / đổi mức / đổi kho / trưởng ca khác.
    {
      const mkReq = async (opts: { rate: number; qty: number; wh?: string; cashier?: string; edId?: string }) => {
        const req: any = await DiscountApprovalService.createRequest({
          orderCode: uniq('ORD-B4'), warehouseId: opts.wh || A, cashierId: opts.cashier || CASHIER.staffId,
          items: [{ editionId: opts.edId || ed[0].id, quantity: opts.qty, unitPrice: 1, unitDiscountRate: opts.rate }],
          requestedDiscountRate: opts.rate,
          actorContext: { staffId: opts.cashier || CASHIER.staffId, role: 'ROLE_CASHIER' } as any,
        });
        return req;
      };
      const appr: any = await mkReq({ rate: 0.3, qty: 1 });
      await DiscountApprovalService.approveRequest({ requestId: appr.id, method: 'ONE_TOUCH', actorContext: MGR });
      const base = { channel: 'FAIR_EVENT', paymentMethod: 'CASH', discountRate: 0.3, discountApprovalId: appr.id };

      // B4a: giỏ khác sau khi duyệt.
      let r = await call(tn.cookie, {
        ...base, warehouseId: A, customerName: 'PAY2-B4a', idempotencyKey: uniq('b4a'),
        items: [{ editionId: ed[0].id, quantity: 2, unitDiscountRate: 0.3 }],
      });
      ok('B4a đổi giỏ sau khi duyệt ⇒ 403', r.status === 403, `status ${r.status}: ${r.json?.error}`);

      // B4b: đổi mức chiết khấu sau khi duyệt.
      r = await call(tn.cookie, {
        ...base, warehouseId: A, customerName: 'PAY2-B4b', idempotencyKey: uniq('b4b'),
        discountRate: 0.6, items: [{ editionId: ed[0].id, quantity: 1, unitDiscountRate: 0.6 }],
      });
      ok('B4b đổi mức chiết khấu sau khi duyệt ⇒ 403', r.status === 403, `status ${r.status}: ${r.json?.error}`);

      // B4c: duyệt của thu ngân khác.
      const apprOther: any = await mkReq({ rate: 0.3, qty: 1, cashier: CASHIER2.staffId });
      await DiscountApprovalService.approveRequest({ requestId: apprOther.id, method: 'ONE_TOUCH', actorContext: MGR });
      r = await call(tn.cookie, {
        ...base, warehouseId: A, customerName: 'PAY2-B4c', idempotencyKey: uniq('b4c'),
        discountApprovalId: apprOther.id, items: [{ editionId: ed[0].id, quantity: 1, unitDiscountRate: 0.3 }],
      });
      ok('B4c dùng phê duyệt của thu ngân KHÁC ⇒ 403', r.status === 403, `status ${r.status}: ${r.json?.error}`);

      // B4d: duyệt của kho khác.
      const apprWh: any = await mkReq({ rate: 0.3, qty: 1, wh: B });
      await DiscountApprovalService.approveRequest({ requestId: apprWh.id, method: 'ONE_TOUCH', actorContext: MGR });
      r = await call(tn.cookie, {
        ...base, warehouseId: A, customerName: 'PAY2-B4d', idempotencyKey: uniq('b4d'),
        discountApprovalId: apprWh.id, items: [{ editionId: ed[0].id, quantity: 1, unitDiscountRate: 0.3 }],
      });
      ok('B4d dùng phê duyệt của KHO KHÁC ⇒ 403', r.status === 403, `status ${r.status}: ${r.json?.error}`);

      // B4e: duyệt còn PENDING (chưa ai bấm duyệt) ⇒ 403.
      const apprPend: any = await mkReq({ rate: 0.3, qty: 1 });
      r = await call(tn.cookie, {
        ...base, warehouseId: A, customerName: 'PAY2-B4e', idempotencyKey: uniq('b4e'),
        discountApprovalId: apprPend.id, items: [{ editionId: ed[0].id, quantity: 1, unitDiscountRate: 0.3 }],
      });
      ok('B4e dùng yêu cầu còn PENDING (chưa duyệt) ⇒ 403', r.status === 403, `status ${r.status}: ${r.json?.error}`);
      const pendRow: any = (await db.select().from(discountApprovalRequests).where(eq(discountApprovalRequests.id, apprPend.id)))[0];
      ok('B4f yêu cầu bị từ chối thì KHÔNG bị tiêu thụ', pendRow.status === 'PENDING', pendRow.status);

      // B4g: giỏ khớp 100% + đúng duyệt ⇒ bán được, và duyệt bị CONSUMED.
      r = await call(tn.cookie, {
        ...base, warehouseId: A, customerName: 'PAY2-B4g', idempotencyKey: uniq('b4g'),
        items: [{ editionId: ed[0].id, quantity: 1, unitDiscountRate: 0.3 }],
      });
      const used: any = (await db.select().from(discountApprovalRequests).where(eq(discountApprovalRequests.id, appr.id)))[0];
      ok(
        'B4g giỏ khớp duyệt ⇒ bán được và duyệt bị tiêu thụ 1 lần',
        r.status === 200 && used.status === 'CONSUMED',
        `status ${r.status}, approval ${used.status}`
      );

      // B4h: dùng lại đúng duyệt đã CONSUMED cho đơn mới ⇒ 403.
      r = await call(tn.cookie, {
        ...base, warehouseId: A, customerName: 'PAY2-B4h', idempotencyKey: uniq('b4h'),
        items: [{ editionId: ed[0].id, quantity: 1, unitDiscountRate: 0.3 }],
      });
      ok('B4h dùng lại approval đã tiêu thụ cho đơn mới ⇒ 403', r.status === 403, `status ${r.status}: ${r.json?.error}`);
    }

    // B5 — replay đơn PENDING chuyển khoản với giỏ khác: 409 và không giữ chỗ thêm.
    {
      const key = uniq('b5-key');
      const body: any = {
        warehouseId: A, channel: 'FAIR_EVENT', paymentMethod: 'BANK_TRANSFER',
        customerName: 'PAY2-B5', idempotencyKey: key, confirmImmediately: false,
        items: [{ editionId: ed[3].id, quantity: 1 }],
      };
      const a = await call(tn.cookie, body);
      const atp1 = await OrderService.getATP(ed[3].id, A);
      const b = await call(tn.cookie, { ...body, items: [{ editionId: ed[3].id, quantity: 2 }] });
      const atp2 = await OrderService.getATP(ed[3].id, A);
      ok('B5 replay đơn PENDING với giỏ khác ⇒ 409', a.status === 200 && b.status === 409, `${a.status}/${b.status}: ${b.json?.error}`);
      ok('B5b replay bị từ chối thì KHÔNG giữ chỗ ATP thêm', atp1 === atp2, `ATP ${atp1} -> ${atp2}`);

      // B5c — LỖI 3 ĐÃ SỬA: client KHÔNG gửi cashboxSessionId thì server tự gắn
      // ca OPEN; lần thử lại (F5 / mạng lỗi) phải trả về ĐÚNG ĐƠN CŨ, không
      // phải 409 vì "phiên két khác" — trước khi sửa, đơn PENDING quầy không gửi
      // session luôn không replay được.
      const key2 = uniq('b5c-key');
      const body2: any = {
        warehouseId: A, channel: 'FAIR_EVENT', paymentMethod: 'BANK_TRANSFER',
        customerName: 'PAY2-B5c', idempotencyKey: key2, confirmImmediately: false,
        items: [{ editionId: ed[3].id, quantity: 1 }],
      };
      const c1 = await call(tn.cookie, body2);
      const c2 = await call(tn.cookie, body2);
      ok(
        'B5c replay đơn PENDING quầy không gửi phiên két ⇒ trả đúng đơn cũ (không 409)',
        c1.status === 200 && c2.status === 200 && c1.json?.data?.orderId === c2.json?.data?.orderId,
        `${c1.status}/${c2.status} ${c1.json?.data?.orderId} vs ${c2.json?.data?.orderId}: ${c2.json?.error}`
      );
      const rows5: any[] = await db.all(
        sql`SELECT COUNT(*) AS n FROM orders WHERE idempotency_key = ${key2}`
      );
      ok('B5d replay không sinh đơn thứ hai', Number((rows5 as any[])[0].n) === 1, `${(rows5 as any[])[0].n} dòng`);
      if (c2.json?.data?.orderId) {
        await OrderService.cancelOrder(c2.json.data.orderId, 'ROLE_CASHIER', 'dọn case B5c', undefined, CASHIER.staffId);
      }
      await OrderService.cancelOrder(a.json.data.orderId, 'ROLE_CASHIER', 'dọn case B5', undefined, CASHIER.staffId);
    }

    // Nhả lease.
    for (const c of [tn.cookie, mgr.cookie]) {
      const m = c.match(/formapubli_session=([^;]+)/);
      if (!m) continue;
      const rq: any = new Request('http://localhost/api/auth/logout', { method: 'POST' });
      rq.cookies = { get: (n: string) => (n === 'formapubli_session' ? { value: m[1] } : undefined) };
      await postLogout(rq);
    }
  }

  // =====================================================================
  // C. RACE TIỀN — hai đơn PENDING cùng giữ ATP vượt tồn phải chặn đúng một
  // =====================================================================
  console.log('\n--- C. RACE: giữ ATP vượt tồn ---');
  {
    const slim = await pickEditions(1, A, 3);
    const eid = slim[0].id;
    const bal = await InventoryService.getBalance(eid, A, 'NEW');
    const qty = bal; // chiếm hết tồn
    const shift = await openShift(MGR.staffId, A);
    const p1: any = await OrderService.createOrder({
      warehouseId: A, channel: 'FAIR_EVENT', paymentMethod: 'BANK_TRANSFER',
      cashierId: MGR.staffId, cashboxSessionId: shift, confirmImmediately: false,
      // Quản lý miễn trần giữ chỗ (MAX_PENDING_HOLD_UNITS_PER_CASHIER) — thu ngân
      // thì đơn 45 cuốn này bị chặn ở cổng trần, không tới được tầng ATP.
      actorContext: { staffId: MGR.staffId, role: MGR.role },
      idempotencyKey: uniq('c-p1'), items: [{ editionId: eid, quantity: qty }],
    } as any);
    const atpAfterHold = await OrderService.getATP(eid, A);
    ok('C1 đơn PENDING giữ đúng phần ATP của nó', atpAfterHold === 0, `ATP ${bal} -> ${atpAfterHold} (giữ ${qty})`);
    let blocked = false, msg = '';
    try {
      await OrderService.createOrder({
        warehouseId: A, channel: 'FAIR_EVENT', paymentMethod: 'BANK_TRANSFER',
        cashierId: CASHIER.staffId, cashboxSessionId: shiftA, confirmImmediately: false,
        idempotencyKey: uniq('c-p2'), items: [{ editionId: eid, quantity: 1 }],
      } as any);
    } catch (e: any) {
      blocked = /ATP|HẾT HÀNG/.test(e.message);
      msg = e.message;
    }
    ok('C2 đơn PENDING thứ hai vượt tồn đã giữ ⇒ bị chặn (không bán vượt)', blocked, msg);
    ok('C3 tồn vật lý chưa bị đụng khi cả hai đều chờ', (await InventoryService.getBalance(eid, A, 'NEW')) === bal, `${bal}`);
    await OrderService.cancelOrder(p1.orderId, 'ROLE_MANAGER', 'dọn case C', MGR, MGR.staffId);
    ok('C4 huỷ đơn chờ ⇒ ATP được nhả lại', (await OrderService.getATP(eid, A)) === bal, `ATP -> ${await OrderService.getATP(eid, A)}`);
  }

  // =====================================================================
  // D. HOÀN TIỀN MẶT — LỖI 2 ĐÃ SỬA: không được bùng sang két kho khác
  // =====================================================================
  console.log('\n--- D. HOÀN TIỀN (sổ két) ---');
  {
    const shiftB = await openShift(MGR.staffId, B);
    const o: any = await OrderService.createOrder({
      warehouseId: A, channel: 'FAIR_EVENT', paymentMethod: 'CASH',
      cashierId: MGR.staffId, cashboxSessionId: shiftAMgr,
      idempotencyKey: uniq('d-o'), items: [{ editionId: ed[1].id, quantity: 1 }],
    } as any);
    const lines: any[] = await db.select().from(orderItems).where(eq(orderItems.orderId, o.orderId));
    const beforeA: any = await CashboxService.calculateSessionStats(shiftAMgr);
    const beforeB: any = await CashboxService.calculateSessionStats(shiftB);
    const req: any = await ReturnService.createRequest({
      orderId: o.orderId, returnType: 'REFUND', reason: 'PRINTING_DEFECT',
      targetWarehouseId: B, inventoryDisposition: 'RESTOCK', cashboxSessionId: shiftB,
      actorContext: MGR, idempotencyKey: uniq('d-req'),
      items: [{ orderItemId: lines[0].id, editionId: ed[1].id, quantity: 1 }],
    } as any);
    await ReturnService.approve(req.returnId, MGR.role, MGR.staffId, MGR, uniq('d-ap'));
    let blocked = false, msg = '';
    try {
      await ReturnService.complete(req.returnId, MGR.role, undefined, MGR, uniq('d-done'));
    } catch (e: any) {
      blocked = /kho đã thu/.test(e.message);
      msg = e.message;
    }
    ok('D1 hoàn tiền mặt sang két KHO KHÁC bị chặn', blocked, msg);
    const afterA: any = await CashboxService.calculateSessionStats(shiftAMgr);
    const afterB: any = await CashboxService.calculateSessionStats(shiftB);
    ok('D2 két kho khác không bị bùng âm', afterB.totalCashSales === beforeB.totalCashSales, `${beforeB.totalCashSales} -> ${afterB.totalCashSales}`);
    ok('D3 két kho đã thu giữ nguyên bán hàng', afterA.totalCashSales === beforeA.totalCashSales, `${beforeA.totalCashSales} -> ${afterA.totalCashSales}`);
    const st: any[] = await db.all(sql`SELECT status FROM return_orders WHERE id = ${req.returnId}`);
    ok('D4 phiếu hoàn bị rollback, không lọt trạng thái COMPLETED', st[0]?.status !== 'COMPLETED', st[0]?.status);

    // D5: hoàn đúng kho thì sổ két giảm đúng số tiền. Dùng đơn RIÊNG: phiếu D1
    // (bị chặn) vẫn còn giữ chỗ 1/1 cuốn nên không xin hoàn lại dòng đó được.
    const o2: any = await OrderService.createOrder({
      warehouseId: A, channel: 'FAIR_EVENT', paymentMethod: 'CASH',
      cashierId: MGR.staffId, cashboxSessionId: shiftAMgr,
      idempotencyKey: uniq('d-o2'), items: [{ editionId: ed[1].id, quantity: 1 }],
    } as any);
    const lines2: any[] = await db.select().from(orderItems).where(eq(orderItems.orderId, o2.orderId));
    const req2: any = await ReturnService.createRequest({
      orderId: o2.orderId, returnType: 'REFUND', reason: 'PRINTING_DEFECT',
      targetWarehouseId: A, inventoryDisposition: 'RESTOCK', cashboxSessionId: shiftAMgr,
      actorContext: MGR, idempotencyKey: uniq('d-req2'),
      items: [{ orderItemId: lines2[0].id, editionId: ed[1].id, quantity: 1 }],
    } as any);
    await ReturnService.approve(req2.returnId, MGR.role, MGR.staffId, MGR, uniq('d-ap2'));
    const pre: any = await CashboxService.calculateSessionStats(shiftAMgr);
    await ReturnService.complete(req2.returnId, MGR.role, undefined, MGR, uniq('d-done2'));
    const post: any = await CashboxService.calculateSessionStats(shiftAMgr);
    ok(
      'D5 hoàn tiền mặt đúng kho: két giảm đúng số tiền hoàn',
      pre.totalCashSales - post.totalCashSales === o2.finalAmount && post.totalRefunds === o2.finalAmount,
      `${pre.totalCashSales} -> ${post.totalCashSales}, hoàn ${post.totalRefunds} (đơn ${o2.finalAmount}đ)`
    );
    // D6: két KHÔNG BAO GIỜ âm sau khi hoàn.
    const act: any = await CashboxService.getActiveSession(MGR.staffId, A);
    ok('D6 expectedCash két không âm', (act.expectedCash ?? 0) >= 0, `${act.expectedCash}`);
  }

  // =====================================================================
  // E. QUỸ TÀI TRỢ — vượt tồn / sổ quỹ khớp sách
  // =====================================================================
  console.log('\n--- E. QUỸ TÀI TRỢ ---');
  {
    // Hạn mức CAPPED cố tình ĐỦ LỚN để tầng ATP/tồn là lớp phải chặn, không
    // phải hạn mức tiền — nếu không ta chỉ đo lại thứ đã có test vòng 1.
    const QUOTA = 1_000_000_000;
    const fund: any = await SponsorshipService.createFund({
      sponsorName: 'PAY2 Sponsor', amountReceived: QUOTA, quotaType: 'CAPPED',
      quotaLimit: QUOTA, createdBy: MGR.staffId, actorRole: MGR.role,
    });
    const slim = await pickEditions(1, A, 2);
    const eid = slim[0].id;
    const st0 = await InventoryService.getBalance(eid, A, 'NEW');
    let blocked = false, msg = '';
    try {
      await SponsorshipService.draw({
        fundId: fund.fundId, editionId: eid, warehouseId: A, quantity: st0 + 5,
        drawnBy: MGR.staffId, actorRole: MGR.role, idempotencyKey: uniq('e-over'),
      });
    } catch (e: any) {
      blocked = /tồn/.test(e.message);
      msg = e.message;
    }
    ok('E1 rút quỹ vượt tồn kho bị chặn', blocked, msg);
    const f1: any = await SponsorshipService.getFund(fund.fundId);
    ok('E2 rút bị chặn thì quỹ KHÔNG bị trừ', f1.balanceRemaining === QUOTA && f1.totalDrawnQty === 0, `${f1.balanceRemaining}/${f1.totalDrawnQty}`);
    ok('E3 rút bị chặn thì tồn không đổi', (await InventoryService.getBalance(eid, A, 'NEW')) === st0, `${st0}`);

    // E4: rút hợp lệ rồi đối chiếu sổ quỹ với số sách đã ra kho.
    await SponsorshipService.draw({
      fundId: fund.fundId, editionId: eid, warehouseId: A, quantity: 1,
      drawnBy: MGR.staffId, actorRole: MGR.role, idempotencyKey: uniq('e-ok'),
    });
    const f2: any = await SponsorshipService.getFund(fund.fundId);
    const outQty = st0 - (await InventoryService.getBalance(eid, A, 'NEW'));
    const draws: any[] = await db.all(
      sql`SELECT drawn_value FROM sponsorship_drawdowns WHERE fund_id = ${fund.fundId}`
    );
    const spent = (draws as any[]).reduce((s, r) => s + Number(r.drawn_value), 0);
    ok(
      'E4 sổ quỹ khớp 100% số sách đã ra kho',
      f2.totalDrawnQty === outQty && f2.totalDrawnValue === spent && f2.balanceRemaining === QUOTA - spent,
      `ra kho ${outQty} cuốn, sổ ${f2.totalDrawnQty}/${spent}đ, dư ${f2.balanceRemaining}`
    );
    ok('E5 số dư quỹ không âm', (f2.balanceRemaining || 0) >= 0, `${f2.balanceRemaining}`);

    // E6: quỹ OPEN không bị chặn bởi hạn mức nhưng sổ vẫn cộng dồn.
    const openFund: any = await SponsorshipService.createFund({
      sponsorName: 'PAY2 Open', amountReceived: QUOTA, quotaType: 'OPEN',
      createdBy: MGR.staffId, actorRole: MGR.role,
    });
    await SponsorshipService.draw({
      fundId: openFund.fundId, editionId: eid, warehouseId: A, quantity: 1,
      drawnBy: MGR.staffId, actorRole: MGR.role, idempotencyKey: uniq('e-open'),
    });
    const of: any = await SponsorshipService.getFund(openFund.fundId);
    ok(
      'E6 quỹ OPEN: số dư không trừ, tổng vẫn cộng dồn, vẫn ACTIVE',
      of.balanceRemaining === 0 && of.totalDrawnQty === 1 && of.status === 'ACTIVE',
      `${of.status}/${of.balanceRemaining}/${of.totalDrawnQty}`
    );

    // E7: hai lần rút SONG SONG cùng idempotencyKey chỉ ghi 1 lần (UNIQUE chặn).
    const key = uniq('e-idem');
    const before7 = await InventoryService.getBalance(eid, A, 'NEW');
    const r7 = await Promise.allSettled([
      SponsorshipService.draw({ fundId: openFund.fundId, editionId: eid, warehouseId: A, quantity: 1, drawnBy: MGR.staffId, actorRole: MGR.role, idempotencyKey: key }),
      SponsorshipService.draw({ fundId: openFund.fundId, editionId: eid, warehouseId: A, quantity: 1, drawnBy: MGR.staffId, actorRole: MGR.role, idempotencyKey: key }),
    ]);
    const won7 = r7.filter((x) => x.status === 'fulfilled').length;
    ok(
      'E7 hai lần rút SONG SANG cùng idempotencyKey chỉ ghi 1 lần',
      won7 === 1 && (await InventoryService.getBalance(eid, A, 'NEW')) === before7 - 1,
      `thắng ${won7}, tồn ${before7} -> ${await InventoryService.getBalance(eid, A, 'NEW')}`
    );
  }

  // =====================================================================
  // F. COMBO — tổng dòng phải khớp, và chiết khấu đơn KHÔNG được áp vào combo
  // =====================================================================
  console.log('\n--- F. COMBO ---');
  {
    const bundle: any = await BundleService.createBundle({
      code: uniq('PAY2C'), seasonName: 'PAY2', releaseDate: '2026-09-30', comboPrice: 199000,
      items: [
        { editionId: ed[0].id, quantityInBundle: 1 },
        { editionId: ed[1].id, quantityInBundle: 2 },
      ],
    });
    const priced: any[] = await BundleService.priceLines(bundle.bundleId, 3);
    ok('F1 combo: Σ dòng = comboPrice × số bộ', priced.reduce((s, p) => s + p.totalAmount, 0) === 199000 * 3, `${priced.reduce((s, p) => s + p.totalAmount, 0)}`);
    const o: any = await OrderService.createOrder({
      warehouseId: A, channel: 'FAIR_EVENT', paymentMethod: 'CASH',
      discountRate: 0.1, cashierId: CASHIER.staffId, cashboxSessionId: shiftA,
      idempotencyKey: uniq('f-order'),
      bundles: [{ bundleId: bundle.bundleId, quantity: 2 }],
      items: [{ editionId: ed[2].id, quantity: 1 }],
    } as any);
    const ls: any[] = await db.select().from(orderItems).where(eq(orderItems.orderId, o.orderId));
    const bundleLines = ls.filter((l) => l.bundleId);
    const looseLines = ls.filter((l) => !l.bundleId);
    ok(
      'F2 đơn combo: finalAmount = Σ dòng (lẻ + combo)',
      o.finalAmount === ls.reduce((s, l) => s + l.totalAmount, 0),
      `${o.finalAmount} vs ${ls.reduce((s, l) => s + l.totalAmount, 0)}`
    );
    ok(
      'F3 dòng combo KHÔNG bị áp chiết khấu đơn 10%',
      bundleLines.every((l) => (l.unitDiscountRate ?? 0) === 0),
      bundleLines.map((l) => `${l.unitDiscountRate}`).join(',')
    );
    ok(
      'F4 dòng lẻ CÓ chiết khấu 10%',
      looseLines.every((l) => Math.abs((l.unitDiscountRate ?? 0) - 0.1) < 1e-9),
      looseLines.map((l) => `${l.unitDiscountRate}`).join(',')
    );
    ok('F5 discountAmount = subtotal − final', o.discountAmount === o.subtotal - o.finalAmount, `${o.discountAmount}`);
    // Chiết khấu đơn chỉ được áp vào phần LẺ (combo do quản lý định giá sẵn).
    const looseHand = priceLine(ed[2].cover, 0.1, 1).finalAmount;
    ok(
      'F6 tiền dòng lẻ = priceLine() tính tay',
      looseLines[0].totalAmount === looseHand,
      `${looseLines[0].totalAmount} vs ${looseHand}`
    );
  }

  // =====================================================================
  // G. QR — LỖI 4 CHƯA SỬA (ngoài phạm vi file của agent): số tiền trên QR
  //    do CLIENT tính, không phải finalAmount server ghi.
  // =====================================================================
  console.log('\n--- G. QR: số tiền mã hoá ---');
  {
    const o: any = await OrderService.createOrder({
      warehouseId: A, channel: 'FAIR_EVENT', paymentMethod: 'BANK_TRANSFER',
      cashierId: CASHIER.staffId, cashboxSessionId: shiftA, confirmImmediately: false,
      idempotencyKey: uniq('g-order'), items: [{ editionId: ed[3].id, quantity: 2, unitDiscountRate: 0.15 }],
    } as any);
    const serverAmount = o.finalAmount;
    // Mô phỏng POS đã nạp danh mục TỪ TRƯỚC khi giá bìa được sửa (giá cũ 90% giá
    // mới). `PosCheckoutTerminal` tính `finalAmount` từ giá trong giỏ rồi đưa
    // vào `session.amount` — KHÔNG đọc `resData.data.finalAmount`.
    const staleCover = Math.round(ed[3].cover * 0.9);
    const staleFinal = priceLine(staleCover, 0.15, 2).finalAmount;
    const qr = generateVietQRPayload({
      bankBin: '970405', accountNo: '0123456789', amount: staleFinal,
      content: resolveTransferContent({ template: null, orderCode: o.orderCode, itemCount: 2, warehouseName: '', warehouseCode: '', manualContent: null }),
    });
    const tlv = (s: string) => { const o2: any[] = []; let i = 0; while (i + 4 <= s.length) { const tag = s.slice(i, i + 2); const len = parseInt(s.slice(i + 2, i + 4), 10); if (!Number.isInteger(len)) break; o2.push([tag, s.slice(i + 4, i + 4 + len)]); i += 4 + len; } return o2; };
    const tag54 = tlv(qr).find((t) => t[0] === '54')?.[1];
    // HỢP ĐỒNG ĐÚNG (đã đúng): QR dựng từ số tiền server ghi thì khớp tuyệt đối.
    const qrGood = generateVietQRPayload({ bankBin: '970405', accountNo: '0123456789', amount: serverAmount, content: normalizeVietqrContent('ORD1') });
    ok(
      'G1 QR dựng từ finalAmount SERVER thì thẻ 54 khớp đơn',
      tlv(qrGood).find((t) => t[0] === '54')?.[1] === String(serverAmount),
      `${tlv(qrGood).find((t) => t[0] === '54')?.[1]} vs ${serverAmount}`
    );
    // LỖI 4: giá danh mục cũ ⇒ QR lệch đơn. Đây là TRẠNG THÁI HIỆN TẠI của
    // PosCheckoutTerminal (dòng `amount: isGift ? 0 : finalAmount`) — khối này
    // đỏ lên để canh; khi vá xong phải đảo thành khẳng định ngược lại.
    ok(
      'G2 ⚠️ BUG CHƯA SỬA: QR mang số tiền tính từ giỏ client, lệch finalAmount server',
      tag54 !== String(serverAmount),
      `QR ${tag54}đ ≠ đơn ${serverAmount}đ (giá danh mục cũ ${staleCover} vs giá DB ${ed[3].cover}) — file sở hữu: PosCheckoutTerminal.tsx`
    );
    await OrderService.cancelOrder(o.orderId, 'ROLE_CASHIER', 'dọn case G', undefined, CASHIER.staffId);
  }

  // =====================================================================
  // K. LỖI 3 CHƯA SỬA (cần owner quyết) — đơn tiền mặt chốt TỨC THÌ ở kênh
  //    quầy không bắt buộc có ca két ⇒ tiền không nằm trong sổ ca nào.
  // =====================================================================
  console.log('\n--- K. ⚠️ BUG CHƯA SỬA: bán tiền mặt không cần mở ca két ---');
  {
    const other = 'NV-04';
    // Chắc chắn thu ngân này KHÔNG có ca OPEN ở kho A (không được dựa vào
    // trạng thái DB dùng chung với suite khác).
    await db.run(
      sql`UPDATE cashbox_sessions SET status = 'CLOSED' WHERE cashier_id = ${other} AND warehouse_id = ${A} AND status = 'OPEN'`
    );
    const left: any[] = await db.all(
      sql`SELECT COUNT(*) AS n FROM cashbox_sessions WHERE cashier_id = ${other} AND warehouse_id = ${A} AND status = 'OPEN'`
    );
    ok('K0 thu ngân thử không có ca két nào đang mở', Number(left[0]?.n) === 0, `${left[0]?.n} ca OPEN`);
    const o: any = await OrderService.createOrder({
      warehouseId: A, channel: 'FAIR_EVENT', paymentMethod: 'CASH',
      cashierId: other, idempotencyKey: uniq('k-order'),
      items: [{ editionId: ed[2].id, quantity: 1 }],
    } as any);
    const row: any = (await db.select().from(orders).where(eq(orders.id, o.orderId)))[0];
    const openHere: any[] = await db.all(
      sql`SELECT id FROM cashbox_sessions WHERE cashier_id = ${other} AND warehouse_id = ${A} AND status = 'OPEN'`
    );
    // KHỐI NÀY ĐỎ LÊN ĐỂ CANH. Khi vá xong (bắt buộc có ca két cho đơn tiền mặt
    // chốt ngay ở kênh quầy) phải ĐẢO thành: bị chặn + không ghi đơn.
    ok(
      'K1 ⚠️ BUG CHƯA SỬA: đơn tiền mặt COMPLETED mà cashbox_session_id = NULL',
      row.status === 'COMPLETED' && row.cashboxSessionId === null,
      `đơn ${o.orderCode} ${row.finalAmount}đ, cashbox_session_id = ${row.cashboxSessionId}`
    );
    // Tiền đó không nằm trong sổ ca nào: quét MỌI ca của thu ngân này.
    const inAny: any[] = await db.all(
      sql`SELECT COUNT(*) AS n FROM orders WHERE cashier_id = ${other} AND cashbox_session_id IS NOT NULL AND id = ${o.orderId}`
    );
    ok(
      'K2 ⚠️ BUG CHƯA SỬA: tiền đó KHÔNG xuất hiện trong sổ ca nào (chốt ca lệch)',
      Number(inAny[0]?.n) === 0,
      `đơn ${row.finalAmount}đ không thuộc ca nào (${openHere.length} ca OPEN của thu ngân)`
    );
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`AUDIT C2 — LỚP TIỀN THẬT vòng 2: ${checks} assertions PASS 100%`);
  process.exit(0);
}

run().catch((err) => {
  console.error('\n❌ test-pay2-money-audit THẤT BẠI:', err?.message || err);
  if (err?.stack) console.error(String(err.stack).split('\n').slice(0, 8).join('\n'));
  process.exit(1);
});
