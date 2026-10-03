/**
 * scripts/test-manual-gift-approval.ts — QUÀ TAY ("Tặng thêm") QUA DUYỆT.
 *
 * Luồng: thu ngân thêm quà tay (ngoài chương trình) → xin duyệt (kèm rate 0
 * nếu đơn không chiết khấu) → quản lý duyệt → đơn 201, dòng quà 0đ.
 *
 * Luật khoá:
 *  1. `createRequest` tra giá từ `products` — quà tay là HÀNG HÓA (không có
 *     dòng `editions`) vẫn xin duyệt được. (Trước đây tra `editions` ⇒ chết
 *     "Ấn bản không tồn tại" — đúng lỗi đã tốn một đêm ở order.service.)
 *  2. Rate 0 chỉ hợp lệ khi có dòng quà tay; không quà tay + rate 0 ⇒ chặn
 *     (tránh yêu cầu duyệt rác).
 *  3. Dòng quà tay bắt buộc miễn phí 100% (rate dòng = 1) — giảm một phần sẽ
 *     lệch tiền duyệt/đơn và chết 409 khó hiểu ở consumeApproval.
 *  4. Đơn có quà tay + `discountApprovalId` đã duyệt ⇒ 201, `is_gift_line = 1`,
 *     giá 0đ, tiền đơn không nhiễm giá quà.
 *  5. Đơn có quà tay mà KHÔNG có `discountApprovalId` ⇒ dòng bị hạ về thường,
 *     khách trả đúng giá (chống tự tặng).
 *  6. Tráo giỏ: duyệt đơn A rồi nhét thêm quà tay lúc chốt ⇒ 409.
 *
 * Tự dựng dữ liệu riêng (pr-manual-gift / ed-manual-book) và tự dọn sạch.
 */
import assert from 'node:assert';
import { createClient } from '@libsql/client';
import { OrderService } from '../src/services/order.service';
import { DiscountApprovalService } from '../src/services/discount-approval.service';
import { assertIsolatedTestDb } from './test-guard';

const DB = process.env.DATABASE_URL || 'file:formapubli_test.db';
const WH = 'wh-au-co';
const BOOK_ID = 'ed-manual-book';
const GIFT_ID = 'pr-manual-gift';
const WORK_ID = 'w-manual-book';
const CASHIER: any = { staffId: 'NV-09', role: 'ROLE_CASHIER', fullName: 'Thu Ngan 09' };
const MANAGER: any = { staffId: 'staff-la', role: 'ROLE_MANAGER', fullName: 'Lan Anh' };

const BOOK_PRICE = 100000;
const GIFT_PRICE = 5000;

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ FAIL: ${label}${extra ? ` — ${extra}` : ''}`);
  }
}

let db: any;
async function q(sql: string, args: any[] = []) {
  const r = await db.execute({ sql, args });
  return r.rows as any[];
}
async function q1(sql: string, args: any[] = []) {
  const r = await db.execute({ sql, args });
  return r.rows[0] as any;
}

async function cleanup() {
  const mgOrders = await q(`SELECT id, order_code AS c FROM orders WHERE note LIKE '%MG-NOTE-%'`);
  const mgCodes = mgOrders.map((o: any) => o.c);
  const mgIds = mgOrders.map((o: any) => o.id);
  for (const c of mgCodes) {
    await q(`DELETE FROM inventory_ledger WHERE document_ref = ?`, [c]);
  }
  for (const id of mgIds) {
    await q(`DELETE FROM order_items WHERE order_id = ?`, [id]);
  }
  await q(`DELETE FROM orders WHERE note LIKE '%MG-NOTE-%'`);
  await q(`DELETE FROM discount_approval_requests WHERE cashier_id IN ('NV-09','staff-la') AND order_code LIKE 'ORD-MG-%'`);
  // Bút toán ledger của sách mang edition_id (không mang tag MG) — dọn theo ID.
  await q(`DELETE FROM inventory_ledger WHERE edition_id = ? OR product_id IN (?,?)`, [BOOK_ID, BOOK_ID, GIFT_ID]);
  await q(`DELETE FROM stock_balances WHERE product_id IN (?,?)`, [BOOK_ID, GIFT_ID]);
  await q(`DELETE FROM editions WHERE id = ?`, [BOOK_ID]);
  await q(`DELETE FROM products WHERE id IN (?,?)`, [BOOK_ID, GIFT_ID]);
  await q(`DELETE FROM works WHERE id = ?`, [WORK_ID]);
}

async function main() {
  assertIsolatedTestDb(DB);
  console.log('=== TEST: quà tay qua duyệt ===\n');
  db = createClient({ url: DB });
  await cleanup();

  console.log('--- 1. Dựng sách + quà hàng hóa + tồn ---');
  await db.execute({ sql: `INSERT INTO works (id,code,title,author) VALUES (?,?,?,?)`, args: [WORK_ID, 'W-MG', 'Sách manual', 'TG'] });
  await db.execute({ sql: `INSERT INTO products (id,name,product_kind,selling_price) VALUES (?,?,'BOOK',?)`, args: [BOOK_ID, 'Sách manual', BOOK_PRICE] });
  await db.execute({ sql: `INSERT INTO editions (id,work_id,code,isbn,isbn_last4,cover_price) VALUES (?,?,?,?,?,?)`, args: [BOOK_ID, WORK_ID, 'MG-BOOK', '9780000000111', '1', BOOK_PRICE] });
  await db.execute({ sql: `INSERT INTO products (id,name,product_kind,selling_price,is_gift_item) VALUES (?,?,'GOODS',?,1)`, args: [GIFT_ID, 'Quà tay', GIFT_PRICE] });
  for (const [id, eid] of [[BOOK_ID, BOOK_ID], [GIFT_ID, null]] as Array<[string, string | null]>) {
    await db.execute({ sql: `INSERT INTO stock_balances (id,edition_id,product_id,warehouse_id,condition,physical_quantity) VALUES (?,?,?,?,'NEW',20)`, args: [`sb-mg-${id}`, eid, id, WH] });
  }
  ok('dựng xong', true);

  const manualLine = { editionId: GIFT_ID, quantity: 1, unitDiscountRate: 1, isGiftLine: true, isManual: true } as any;
  const bookLine = { editionId: BOOK_ID, quantity: 1 } as any;

  console.log('\n--- 2. createRequest quà tay hàng hóa, rate 0 ---');
  let req: any = null;
  let err = '';
  try {
    req = await DiscountApprovalService.createRequest({
      orderCode: `ORD-MG-${Date.now()}-A`,
      warehouseId: WH,
      cashierId: CASHIER.staffId,
      items: [bookLine, manualLine],
      requestedDiscountRate: 0,
      actorContext: CASHIER,
    });
  } catch (e: any) {
    err = `${e?.message || e}`;
  }
  ok('xin duyệt quà tay hàng hóa rate 0 thành công', !!req?.id, err);
  if (req) {
    ok('tiền duyệt gồm giá quà tay (quản lý thấy đúng giá trị)', Number(req.originalAmount) === BOOK_PRICE + GIFT_PRICE, `orig=${req?.originalAmount}`);
  }

  console.log('\n--- 3. Rate 0 không quà tay ⇒ chặn; quà tay rate lẻ ⇒ chặn ---');
  let blocked = false;
  try {
    await DiscountApprovalService.createRequest({
      orderCode: `ORD-MG-${Date.now()}-B`, warehouseId: WH, cashierId: CASHIER.staffId,
      items: [bookLine], requestedDiscountRate: 0, actorContext: CASHIER,
    });
  } catch {
    blocked = true;
  }
  ok('rate 0 không quà tay bị chặn', blocked);
  blocked = false;
  try {
    await DiscountApprovalService.createRequest({
      orderCode: `ORD-MG-${Date.now()}-C`, warehouseId: WH, cashierId: CASHIER.staffId,
      items: [bookLine, { ...manualLine, unitDiscountRate: 0.5 }], requestedDiscountRate: 0, actorContext: CASHIER,
    });
  } catch {
    blocked = true;
  }
  ok('quà tay giảm một phần (rate 0.5) bị chặn', blocked);

  console.log('\n--- 4. Duyệt rồi chốt đơn có quà tay ⇒ 201, quà 0đ ---');
  await DiscountApprovalService.approveRequest({ requestId: req.id, method: 'ONE_TOUCH', actorContext: MANAGER });
  let order: any = null;
  err = '';
  try {
    order = await OrderService.createOrder({
      warehouseId: WH,
      channel: 'RETAIL_OFFICE',
      paymentMethod: 'CASH',
      items: [
        { editionId: BOOK_ID, quantity: 1 },
        { editionId: GIFT_ID, quantity: 1, unitDiscountRate: 1, isGiftLine: true },
      ],
      discountApprovalId: req.id,
      note: 'MG-NOTE-duyet',
      idempotencyKey: `idem-mg-duyet-${Date.now()}`,
      actorContext: CASHIER,
    });
  } catch (e: any) {
    err = `${e?.message || e}`;
  }
  ok('createOrder có duyệt không ném lỗi', !!order?.orderId, err);
  if (order) {
    ok('tiền đơn không nhiễm giá quà', order.subtotal === BOOK_PRICE && order.finalAmount === BOOK_PRICE, `sub=${order.subtotal} final=${order.finalAmount}`);
    const gl = await q1(`SELECT is_gift_line g, unit_discount_rate r, unit_selling_price s, is_gift_shortfall f FROM order_items WHERE order_id = ? AND product_id = ?`, [order.orderId, GIFT_ID]);
    ok('dòng quà tay 0đ, cờ đủ', Number(gl?.g) === 1 && Number(gl?.r) === 1 && Number(gl?.s) === 0 && Number(gl?.f) === 0, JSON.stringify(gl));
  }

  console.log('\n--- 4b. Quà tay + chiết khấu đơn 10% cùng lúc ⇒ vẫn 201, quà 0đ ---');
  // Khoản hở cũ: rate 0 là trường hợp duy nhất được test. Thu ngân có thể đã
  // áp 10% (< 20% nên tự áp được, không cần duyệt) rồi mới thêm quà tay ⇒ đơn
  // đi kèm CẢ duyệt lẫn chiết khấu đơn. Số tiền duyệt = giá gốc cả đơn + giá
  // quà; tiền đơn = không có giá quà ⇒ `consumeApproval` chỉ chấp nhận khi lệch
  // đúng bằng `manualGiftSubtotal` (discount-approval.service.ts:970).
  let reqMixed: any = null;
  err = '';
  try {
    reqMixed = await DiscountApprovalService.createRequest({
      orderCode: `ORD-MG-${Date.now()}-E`,
      warehouseId: WH,
      cashierId: CASHIER.staffId,
      // Dòng sách KHÔNG gán `unitDiscountRate` — đúng như client gửi: client
      // chỉ gán rate cho dòng quà, còn dòng thường dựa vào `discountRate` đơn
      // (PosCheckoutTerminal.tsx). Gán rate ở đây sẽ che lỗi lệch payload.
      items: [{ ...bookLine, unitDiscountRate: undefined }, manualLine],
      requestedDiscountRate: 0.1,
      actorContext: CASHIER,
    });
  } catch (e: any) {
    err = `${e?.message || e}`;
  }
  ok('xin duyệt kèm CK đơn 10% + quà tay', !!reqMixed?.id, err);
  let orderMixed: any = null;
  if (reqMixed) {
    err = '';
    try {
      await DiscountApprovalService.approveRequest({ requestId: reqMixed.id, method: 'ONE_TOUCH', actorContext: MANAGER });
      orderMixed = await OrderService.createOrder({
        warehouseId: WH,
        channel: 'RETAIL_OFFICE',
        paymentMethod: 'CASH',
        discountRate: 0.1,
        items: [
          { editionId: BOOK_ID, quantity: 1 },
          { editionId: GIFT_ID, quantity: 1, unitDiscountRate: 1, isGiftLine: true },
        ],
        discountApprovalId: reqMixed.id,
        note: 'MG-NOTE-mixed',
        idempotencyKey: `idem-mg-mixed-${Date.now()}`,
        actorContext: CASHIER,
      });
    } catch (e: any) {
      err = `${e?.message || e}`;
    }
    ok('chốt đơn CK 10% + quà tay đã duyệt không bị chặn ở consumeApproval', !!orderMixed?.orderId, err);
    if (orderMixed) {
      ok('tiền đơn = CK 10% trên sách, không nhiễm giá quà', orderMixed.subtotal === BOOK_PRICE && orderMixed.finalAmount === BOOK_PRICE - BOOK_PRICE * 0.1, `sub=${orderMixed.subtotal} final=${orderMixed.finalAmount}`);
      const glm = await q1(`SELECT is_gift_line g, unit_selling_price s FROM order_items WHERE order_id = ? AND product_id = ?`, [orderMixed.orderId, GIFT_ID]);
      ok('dòng quà tay vẫn 0đ khi đơn có chiết khấu', Number(glm?.g) === 1 && Number(glm?.s) === 0, JSON.stringify(glm));
    }
  }

  console.log('\n--- 5. Quà tay không duyệt ⇒ hạ về dòng thường ---');
  let order2: any = null;
  err = '';
  try {
    order2 = await OrderService.createOrder({
      warehouseId: WH,
      channel: 'RETAIL_OFFICE',
      paymentMethod: 'CASH',
      items: [
        { editionId: BOOK_ID, quantity: 1 },
        { editionId: GIFT_ID, quantity: 1, unitDiscountRate: 1, isGiftLine: true },
      ],
      note: 'MG-NOTE-khongduyet',
      idempotencyKey: `idem-mg-khongduyet-${Date.now()}`,
      actorContext: MANAGER,
    });
  } catch (e: any) {
    err = `${e?.message || e}`;
  }
  ok('đơn vẫn tạo được', !!order2?.orderId, err);
  if (order2) {
    const gl2 = await q1(`SELECT is_gift_line g, total_amount t FROM order_items WHERE order_id = ? AND product_id = ?`, [order2.orderId, GIFT_ID]);
    ok('dòng quà giả bị hạ, khách trả đúng giá', Number(gl2?.g) === 0 && Number(gl2?.t) === GIFT_PRICE, JSON.stringify(gl2));
  }

  console.log('\n--- 6. Tráo giỏ: duyệt đơn thường, chốt nhét thêm quà tay ⇒ 409 ---');
  const reqPlain = await DiscountApprovalService.createRequest({
    orderCode: `ORD-MG-${Date.now()}-D`, warehouseId: WH, cashierId: CASHIER.staffId,
    items: [{ ...bookLine, unitDiscountRate: 0.1 }], requestedDiscountRate: 0.1, actorContext: CASHIER,
  });
  await DiscountApprovalService.approveRequest({ requestId: reqPlain.id, method: 'ONE_TOUCH', actorContext: MANAGER });
  let err409 = '';
  try {
    await OrderService.createOrder({
      warehouseId: WH,
      channel: 'RETAIL_OFFICE',
      paymentMethod: 'CASH',
      discountRate: 0.1,
      items: [
        { editionId: BOOK_ID, quantity: 1, unitDiscountRate: 0.1 },
        { editionId: GIFT_ID, quantity: 1, unitDiscountRate: 1, isGiftLine: true },
      ],
      discountApprovalId: reqPlain.id,
      note: 'MG-NOTE-trao',
      idempotencyKey: `idem-mg-trao-${Date.now()}`,
      actorContext: CASHIER,
    });
  } catch (e: any) {
    err409 = `${e?.message || e}`;
  }
  ok('tráo thêm quà tay sau duyệt bị chặn', /thay đổi|khớp|duyệt lại/i.test(err409), err409);

  await cleanup();
  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) process.exit(1);
  console.log('✅ QUÀ TAY QUA DUYỆT ĐÚNG.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
