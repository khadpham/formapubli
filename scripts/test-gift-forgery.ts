/**
 * scripts/test-gift-forgery.ts — chống THU NGÂN TỰ GẮN CỜ QUÀ.
 *
 * Lỗ hổng: nếu server tin `isGiftLine` từ client thì thu ngân tự gắn cờ là
 * bán 0đ, miễn trần chiết khấu 20%, không cần Quản lý duyệt.
 *
 * Server phải TỰ tra bảng `promotions` và hạ dòng quà giả xuống thành dòng
 * thường — khách trả đúng giá, không báo lỗi.
 */
import assert from 'node:assert';
import { createClient } from '@libsql/client';
import { assertIsolatedTestDb } from './test-guard';

const DB = process.env.DATABASE_URL || 'file:formapubli_test.db';

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ FAIL: ${label} ${extra}`); }
}

async function main() {
  assertIsolatedTestDb(DB);
  console.log('=== TEST: CHỐNG GIẢ MẠO DÒNG QUÀ ===\n');

  const db = createClient({ url: DB });
  const q = async (s: string, a?: any[]) =>
    (await db.execute({ sql: s, args: a || [] })).rows as any[];

  // Cấu hình: đơn đủ mốc tiền thì tặng 1 sản phẩm SPQUA.
  const stamp = Date.now().toString(36);
  const CAMP = `km-${stamp}`;
  const giftId = `sp-qua-${stamp}`;
  await q(`INSERT INTO products (id, code, name, product_kind, selling_price, is_active)
           VALUES (?, ?, 'Quà tặng thử', 'GOODS', 50000, 1)`, [giftId, `SP-QUA-${stamp}`]);
  await q(`INSERT INTO promotions (id, name, is_active) VALUES (?, 'KM thử', 1)`, [CAMP]);

  // ⚠️ MỐC TIỀN PHẢI BÁO TỪ GIÁ THẬT TRONG DB, KHÔNG hard-code.
  //
  // Bản test cũ hard-code mốc 500.000đ và GIẢ ĐỊNH `ed-hh001` giá 110.000đ.
  // Giá thật của HH001 là 36.000đ (data_tabs/sheet1_danhmuc_gid_0.csv) ⇒
  // `eligibleBase` ra 6 × 36.000 = 216.000đ, DƯỚI mốc ⇒ `computeGifts` trả về
  // rỗng ⇒ dòng quà HỢP LỆ bị hạ và test đỏ. Đo được bằng log tạm trong
  // order.service.ts: `eligibleBase: 216000`, `gifts: []`, `allowed: []`.
  // Server chạy ĐÚNG; test sai.
  //
  // Nay mốc = 6 × giá thật ⇒ đơn 6 cuốn vừa đủ mốc, đơn 1 cuốn thì không.
  // Vẫn giữ nguyên 2 nhánh (đủ mốc / thiếu mốc) và vẫn bắt được lỗi "quên
  // nhân số lượng": nếu `eligibleBase` quên `× quantity` thì 6 cuốn ra
  // đúng 1 giá bìa ⇒ thiếu mốc ⇒ nhánh hợp lệ đỏ.
  const bookRow = (await q(`SELECT selling_price FROM products WHERE id = ?`, ['ed-hh001']))[0];
  const BOOK_PRICE = Number(bookRow?.selling_price || 0);
  assert(BOOK_PRICE > 0, 'ed-hh001 phải có giá bán > 0 trong DB test.');
  const QTY_ENOUGH = 6;
  const MIN_SUBTOTAL = BOOK_PRICE * QTY_ENOUGH;

  await q(`INSERT INTO promotion_gifts (id, promotion_id, min_subtotal, product_id, gift_quantity)
           VALUES (?, ?, ?, ?, 1)`, [`kt-${stamp}`, CAMP, MIN_SUBTOTAL, giftId]);

  // Nhập tồn cho sản phẩm quà, nếu không ATP chặn trước khi tới kiểm tra giả
  // mạo — và ta sẽ không biết mình có đang bảo vệ đúng hay không.
  await q(
    `INSERT INTO stock_balances (id, edition_id, product_id, warehouse_id, condition, physical_quantity)
     VALUES (?, NULL, ?, 'wh-au-co', 'NEW', 100)`,
    [`sb-${giftId}`, giftId]
  );
  // Sách dùng làm hàng thường cũng phải đủ tồn, nếu không ATP chặn TRƯỚC khi
  // tới nhánh "dòng quà hợp lệ" và ta lại tưởng mình đang kiểm tra quà.
  // Phải ghi CẢ `inventory_ledger`, không chỉ `UPDATE stock_balances`.
  // `test-master-audit.ts` kiểm bất biến Balance == LedgerSum; nạp tồn bằng
  // UPDATE trần làm lệch ⇒ đỏ. Và đó không phải lỗi của audit mà là của test
  // đang ghi dữ liệu sai cách. Sổ kho là SỔ CÁI BẤT BIẾN — mọi thay đổi tồn
  // đều phải có bút toán.
  // Bút toán nhận phải CÙNG SỐ với phần tăng tồn, nếu không kiểm toán đỏ.
  // Trước đây ghi ledger `+100` nhưng đặt balance bằng `MAX(...,100)` ⇒ hai vế
  // lệch nhau. Cộng ĐÚNG 100, và chỉ khi bút toán thực sự được ghi (nên chạy
  // lại nhiều lần vẫn khớp).
  const topUp = async (
    ledgerId: string,
    editionId: string | null,
    productId: string,
    idem: string
  ) => {
    const already = await q(`SELECT 1 x FROM inventory_ledger WHERE idempotency_key = ?`, [idem]);
    if (already.length) return;
    await q(
      `INSERT INTO inventory_ledger
         (id, edition_id, product_id, warehouse_id, event_type, quantity_delta,
          condition, document_ref, note, actor_id, idempotency_key, effective_at)
       VALUES (?, ?, ?, 'wh-au-co', 'RECEIPT', 100, 'NEW', ?,
               'Nhập tồn phục vụ test giả mạo quà', 'test-gift-forgery', ?, ?)`,
      [ledgerId, editionId, productId, 'FORGERY-RECEIPT', idem, new Date().toISOString()]
    );
    await q(
      `UPDATE stock_balances SET physical_quantity = physical_quantity + 100
       WHERE product_id = ? AND warehouse_id = 'wh-au-co' AND condition = 'NEW'`,
      [productId]
    );
  };

  await topUp('led-forgery-receipt', 'ed-hh001', 'ed-hh001', 'IFG-RECEIPT');
  await topUp('led-forgery-receipt-gift', null, giftId, 'IFG-RECEIPT-GIFT');

  const { OrderService } = await import('../src/services/order.service');
  const { warehouses } = await import('../src/db/schema');

  console.log('--- 1. Dòng quà GIẢ không nằm trong chương trình ---');
  const fakeOrder = await OrderService.createOrder({
    warehouseId: 'wh-au-co',
    channel: 'RETAIL_OFFICE' as any,
    cashierId: 'staff-cashier',
    items: [
      { editionId: 'ed-hh001', quantity: 1, unitDiscountRate: 0 } as any,
      // Giả mạo: client tự gắn cờ quà cho một sản phẩm KHÔNG có trong KM,
      // đồng thời tự ép unitDiscountRate = 1 (100% ⇒ giá 0đ).
      { editionId: 'ed-hh002', quantity: 1, unitDiscountRate: 1, isGiftLine: true } as any,
    ],
  } as any);

  const fakeLine = (await q(
    `SELECT * FROM order_items WHERE order_id = ? AND edition_id = 'ed-hh002'`,
    [fakeOrder.orderId]
  ))[0];
  ok('dòng giả bị HẠ về dòng thường (is_gift_line = 0)', fakeLine?.is_gift_line === 0,
    `thực tế=${fakeLine?.is_gift_line}`);
  ok('KHÔNG bị bán 0đ — phải trả đúng giá bìa', fakeLine?.unit_selling_price > 0,
    `bán=${fakeLine?.unit_selling_price}`);
  ok(
    `giá bán = giá bìa (không chiết khấu cưỡng ép)`,
    fakeLine?.unit_selling_price === fakeLine?.unit_cover_price,
    `bán=${fakeLine?.unit_selling_price} bìa=${fakeLine?.unit_cover_price}`
  );

  console.log('\n--- 2. Dòng quà THẬT được tặng ---');
  console.log(
    `    (giá thật ed-hh001 = ${BOOK_PRICE}đ; ${QTY_ENOUGH} cuốn = ` +
    `${BOOK_PRICE * QTY_ENOUGH}đ; mốc = ${MIN_SUBTOTAL}đ)`
  );
  const realOrder = await OrderService.createOrder({
    warehouseId: 'wh-au-co',
    channel: 'RETAIL_OFFICE' as any,
    cashierId: 'staff-cashier',
    items: [
      // eligibleBase = giá × SỐ LƯỢNG = đúng mốc ⇒ đủ điều kiện nhận quà.
      { editionId: 'ed-hh001', quantity: QTY_ENOUGH, unitDiscountRate: 0 } as any,
      { editionId: giftId, quantity: 1, unitDiscountRate: 1, isGiftLine: true } as any,
    ],
  } as any);
  const realLine = (await q(
    `SELECT * FROM order_items WHERE order_id = ? AND product_id = ?`,
    [realOrder.orderId, giftId]
  ))[0];
  ok('dòng quà THẬT giữ is_gift_line = 1', realLine?.is_gift_line === 1,
    `thực tế=${realLine?.is_gift_line}`);
  ok('giá 0đ', realLine?.unit_selling_price === 0,
    `bán=${realLine?.unit_selling_price}`);

  console.log('\n--- 3. Chưa đủ mốc thì dòng quà bị hạ ---');
  const lowOrder = await OrderService.createOrder({
    warehouseId: 'wh-au-co',
    channel: 'RETAIL_OFFICE' as any,
    cashierId: 'staff-cashier',
    items: [
      { editionId: 'ed-hh001', quantity: 1, unitDiscountRate: 0 } as any,  // = BOOK_PRICE
      { editionId: giftId, quantity: 1, unitDiscountRate: 1, isGiftLine: true } as any,
    ],
  } as any);
  const lowLine = (await q(
    `SELECT * FROM order_items WHERE order_id = ? AND product_id = ?`,
    [lowOrder.orderId, giftId]
  ))[0];
  ok(`đơn ${BOOK_PRICE} < mốc ${MIN_SUBTOTAL} ⇒ dòng quà bị hạ`, lowLine?.is_gift_line === 0,
    `thực tế=${lowLine?.is_gift_line}`);
  ok('KHÔNG được bán 0đ', lowLine?.unit_selling_price === 50_000,
    `bán=${lowLine?.unit_selling_price}`);

  // Khoá đúng lỗi vừa gặp: `eligibleBase` PHẢI nhân số lượng, và so sánh
  // mốc phải là `>=` tại đúng ranh giới. Một cuốn thiếu (5 × giá bìa) dưới
  // mốc phải bị hạ, dù gần tới mốc — trước đây test không có ca này nên quên
  // nhân số lượng vẫn xanh.
  console.log('\n--- 3b. Thiếu MỘT cuốn là thiếu mốc (biên `>=`) ---');
  const nearMissOrder = await OrderService.createOrder({
    warehouseId: 'wh-au-co',
    channel: 'RETAIL_OFFICE' as any,
    cashierId: 'staff-cashier',
    items: [
      { editionId: 'ed-hh001', quantity: QTY_ENOUGH - 1, unitDiscountRate: 0 } as any,
      { editionId: giftId, quantity: 1, unitDiscountRate: 1, isGiftLine: true } as any,
    ],
  } as any);
  const nearMissLine = (await q(
    `SELECT * FROM order_items WHERE order_id = ? AND product_id = ?`,
    [nearMissOrder.orderId, giftId]
  ))[0];
  ok(
    `${QTY_ENOUGH - 1} cuốn = ${BOOK_PRICE * (QTY_ENOUGH - 1)} < mốc ${MIN_SUBTOTAL} ⇒ bị hạ`,
    nearMissLine?.is_gift_line === 0,
    `thực tế=${nearMissLine?.is_gift_line}`
  );
  ok('thiếu mốc thì KHÔNG được bán 0đ', nearMissLine?.unit_selling_price === 50_000,
    `bán=${nearMissLine?.unit_selling_price}`);

  console.log('\n--- 4. Chiến dịch TẮT thì không tặng ---');
  await q(`UPDATE promotions SET is_active = 0 WHERE id = ?`, [CAMP]);
  const offOrder = await OrderService.createOrder({
    warehouseId: 'wh-au-co',
    channel: 'RETAIL_OFFICE' as any,
    cashierId: 'staff-cashier',
    items: [
      { editionId: 'ed-hh001', quantity: QTY_ENOUGH, unitDiscountRate: 0 } as any,
      { editionId: giftId, quantity: 1, unitDiscountRate: 1, isGiftLine: true } as any,
    ],
  } as any);
  const offLine = (await q(
    `SELECT * FROM order_items WHERE order_id = ? AND product_id = ?`,
    [offOrder.orderId, giftId]
  ))[0];
  ok('chiến dịch tắt ⇒ dòng quà bị hạ', offLine?.is_gift_line === 0,
    `thực tế=${offLine?.is_gift_line}`);
  await q(`UPDATE promotions SET is_active = 1 WHERE id = ?`, [CAMP]);

  console.log('\n--- 5. Sách không bị ảnh hưởng ---');
  const okCount = (await q(
    `SELECT COUNT(*) n FROM order_items WHERE is_gift_line = 0`
  ))[0].n;
  ok('đa số dòng vẫn là dòng thường', Number(okCount) > 0, `số=${okCount}`);
  const wrongPrices = (await q(
    `SELECT COUNT(*) n FROM order_items WHERE unit_discount_rate = 1 AND is_gift_line = 0`
  ))[0].n;
  ok('không còn dòng chiết khấu 100% nào mang nhãn dòng thường', Number(wrongPrices) === 0,
    `số=${wrongPrices}`);

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error('\n❌ THU NGÂN CÓ THỂ TỰ TẶNG HÀNG MIỄN PHÍ — CHẶN NGAY.');
    process.exit(1);
  }
  console.log('\n✅ Server tự xác minh quà. Client không tự quyết được.');
  process.exit(0);
}

main().catch((e) => { console.error('\n❌', e?.message || e); process.exit(1); });
