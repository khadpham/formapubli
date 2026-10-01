/**
 * scripts/test-gift-approval-hash.ts — ĐƠN VỪA CÓ QUÀ VỪA CẦN DUYỆT CHIẾT KHẤU.
 *
 * Kịch bản thật ở quầy: khách mua đủ mốc, chương trình tự thêm 1 cuốn quà
 * (`is_gift_line = 1`, `is_manual = 0`, giá bán 0đ), đồng thời thu ngân cần
 * Quản lý duyệt chiết khấu cho phần còn lại. Trước khi sửa, đơn này chết 409:
 *  - `generateCanonicalCartHash` băm cả dòng quà (`rate = 1`) vào cartHash,
 *    còn lúc tiêu thụ thì dòng quà đã bị lọc ⇒ hash lệch ⇒ chặn cứng;
 *  - số tiền đã duyệt được tính CÓ giá món quà, còn số tiền lúc chốt thì không
 *    ⇒ `Tổng tiền của giỏ không khớp yêu cầu đã được duyệt`.
 *
 * Luật ở đây — mỗi luật là một cách mất tiền hoặc một cách lách duyệt:
 *  1. Quà TỰ ĐỘNG không làm lệch cartHash (có và không đều băm như nhau).
 *  2. Quà TAY (`is_manual = 1`) VẪN phải nằm trong cartHash — nếu không thì
 *     "thêm quà tay sau khi duyệt" là đường lách duyệt không cần đụng DB.
 *  3. Số tiền xin duyệt KHÔNG chứa giá món quà (quà không phải tiền khách trả).
 *  4. `consumeApproval` vẫn thành công khi giỏ lúc chốt CÓ dòng quà tự động.
 *  5. `consumeApproval` vẫn thành công khi call site đã lọc dòng quà đi (đường
 *     `order.service.ts`) và khi số tiền lúc chốt lỡ có kèm giá quà.
 *  6. ĐỔI SỐ LƯỢNG 1 dòng sách sau khi duyệt ⇒ vẫn phải bị chặn (chống tráo giỏ).
 *  7. Thêm dòng quà TAY sau khi duyệt ⇒ vẫn phải bị chặn (quà tay cần duyệt).
 *  8. Giỏ chỉ có dòng quà ⇒ không xin duyệt được (không có gì để duyệt).
 */
import { createClient } from '@libsql/client';
import { assertIsolatedTestDb } from './test-guard';

const DB = process.env.DATABASE_URL || 'file:formapubli_test.db';
const WH = 'wh-au-co';
const RATE = 0.25;
const CASHIER: any = { staffId: 'staff-gift-hash', role: 'ROLE_CASHIER', fullName: 'Thu Ngân' };
const MANAGER: any = { staffId: 'staff-la', role: 'ROLE_MANAGER', fullName: 'Lan Anh' };

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
async function q1(sql: string, args: any[] = []) {
  return (await db.execute({ sql, args })).rows[0] as any;
}

async function main() {
  assertIsolatedTestDb('test-gift-approval-hash');
  console.log('=== TEST: ĐƠN VỪA CÓ QUÀ VỪA CẦN DUYỆT CHIẾT KHẤU ===\n');

  db = createClient({ url: DB });
  const { DiscountApprovalService, generateCanonicalCartHash } = await import(
    '../src/services/discount-approval.service'
  );

  // --- 0. Chuẩn bị: 3 ấn bản có giá bìa khác nhau -------------------------
  const rows = (await db.execute({
    sql: `SELECT id, cover_price AS cover FROM editions
           WHERE cover_price > 0 ORDER BY cover_price DESC LIMIT 3`,
  })).rows as any[];
  if (rows.length < 3) {
    console.error('⛔ Cần ít nhất 3 ấn bản có giá bìa trong DB test.');
    process.exit(1);
  }
  const [A, B, G] = rows as [{ id: string; cover: number }, any, any];
  const suffix = Date.now().toString().slice(-6);
  console.log(`Dùng: A=${A.id} (${A.cover}), B=${B.id} (${B.cover}), quà G=${G.id} (${G.cover})\n`);

  const itemsNoGift = [
    { editionId: A.id, quantity: 2, unitPrice: Number(A.cover) },
    { editionId: B.id, quantity: 1, unitPrice: Number(B.cover) },
  ];
  const autoGift = {
    editionId: G.id,
    quantity: 1,
    unitPrice: Number(G.cover),
    unitDiscountRate: 1,
    isGiftLine: true,
    isManual: false,
  };
  const manualGift = { ...autoGift, isManual: true };
  const subtotal = 2 * Number(A.cover) + Number(B.cover);
  const finalExpected = Math.round(Number(A.cover) * 0.75) * 2 + Math.round(Number(B.cover) * 0.75);
  const discountExpected = subtotal - finalExpected;

  // --- 1-2. cartHash: quà tự động ẩn, quà tay phải còn --------------------
  console.log('--- 1. cartHash bỏ qua dòng quà TỰ ĐỘNG, giữ dòng quà TAY ---');
  const hashNoGift = generateCanonicalCartHash(itemsNoGift, RATE, WH, 'ORD-GIFT-0001');
  const hashWithAutoGift = generateCanonicalCartHash(
    [...itemsNoGift, autoGift],
    RATE,
    WH,
    'ORD-GIFT-0001'
  );
  const hashWithManualGift = generateCanonicalCartHash(
    [...itemsNoGift, manualGift],
    RATE,
    WH,
    'ORD-GIFT-0001'
  );
  ok('quà tự động KHÔNG làm lệch cartHash', hashNoGift === hashWithAutoGift);
  ok('quà TAY vẫn làm lệch cartHash (không lách được duyệt)', hashWithManualGift !== hashNoGift);
  ok(
    'thứ tự dòng không ảnh hưởng hash khi có dòng quà',
    generateCanonicalCartHash([autoGift, ...itemsNoGift], RATE, WH, 'ORD-GIFT-0001') ===
      hashWithAutoGift
  );

  // --- 3. Số tiền xin duyệt không chứa giá món quà ------------------------
  console.log('\n--- 2. Số tiền yêu cầu duyệt không kèm giá món quà ---');
  const reqNoGift = await DiscountApprovalService.createRequest({
    orderCode: `ORD-GIFT-${suffix}-A`,
    warehouseId: WH,
    cashierId: CASHIER.staffId,
    items: itemsNoGift,
    requestedDiscountRate: RATE,
    actorContext: CASHIER,
  });
  ok('originalAmount = tổng dòng sách', reqNoGift.originalAmount === subtotal, `${reqNoGift.originalAmount} vs ${subtotal}`);
  ok('discountAmount đúng', reqNoGift.discountAmount === discountExpected, `${reqNoGift.discountAmount} vs ${discountExpected}`);
  ok('finalAmount đúng', reqNoGift.finalAmount === finalExpected, `${reqNoGift.finalAmount} vs ${finalExpected}`);

  const reqWithGift = await DiscountApprovalService.createRequest({
    orderCode: `ORD-GIFT-${suffix}-B`,
    warehouseId: WH,
    cashierId: CASHIER.staffId,
    items: [...itemsNoGift, autoGift],
    requestedDiscountRate: RATE,
    actorContext: CASHIER,
  });
  ok(
    'cart có dòng quà tự động: originalAmount KHÔNG đổi',
    reqWithGift.originalAmount === subtotal,
    `${reqWithGift.originalAmount} vs ${subtotal}`
  );
  ok(
    'cart có dòng quà tự động: discountAmount KHÔNG đổi',
    reqWithGift.discountAmount === discountExpected,
    `${reqWithGift.discountAmount} vs ${discountExpected}`
  );
  ok(
    'cart có dòng quà tự động: finalAmount KHÔNG đổi',
    reqWithGift.finalAmount === finalExpected,
    `${reqWithGift.finalAmount} vs ${finalExpected}`
  );

  // Quà TAY thì NGƯỢC LẠI: phải nằm trong số tiền xin duyệt.
  const reqManualGift = await DiscountApprovalService.createRequest({
    orderCode: `ORD-GIFT-${suffix}-C`,
    warehouseId: WH,
    cashierId: CASHIER.staffId,
    items: [...itemsNoGift, manualGift],
    requestedDiscountRate: RATE,
    actorContext: CASHIER,
  });
  ok(
    'quà TAY vẫn được tính vào số tiền duyệt (đúng cần người duyệt)',
    reqManualGift.originalAmount === subtotal + Number(G.cover),
    `${reqManualGift.originalAmount} vs ${subtotal + Number(G.cover)}`
  );

  // --- 4. consumeApproval: giỏ lúc chốt CÓ dòng quà tự động --------------
  console.log('\n--- 3. consumeApproval khi giỏ lúc chốt có dòng quà tự động ---');
  await DiscountApprovalService.approveRequest({
    requestId: reqNoGift.id,
    method: 'ONE_TOUCH',
    actorContext: MANAGER,
  });
  let consumeErr = '';
  try {
    await DiscountApprovalService.consumeApproval({
      requestId: reqNoGift.id,
      // Giỏ lúc chốt ĐÃ CÓ dòng quà (client chưa lọc) — số tiền lúc này lỡ
      // kèm giá món quà, đúng như `calculatedSubtotal` thời trước khi sửa.
      currentItems: [...itemsNoGift, autoGift],
      discountRate: RATE,
      warehouseId: WH,
      orderCode: `ORD-GIFT-${suffix}-A`,
      originalAmount: subtotal + Number(G.cover),
      discountAmount: discountExpected + Number(G.cover),
      finalAmount: finalExpected,
    });
    ok('tiêu thụ phê duyệt THÀNH CÔNG khi giỏ có dòng quà tự động', true);
  } catch (e: any) {
    consumeErr = `${e?.message || e}`;
    ok('tiêu thụ phê duyệt THÀNH CÔNG khi giỏ có dòng quà tự động', false, consumeErr);
  }
  const consumed = await DiscountApprovalService.getRequest(reqNoGift.id);
  ok('yêu cầu chuyển sang CONSUMED', consumed.status === 'CONSUMED', `status=${consumed.status}`);

  // --- 5. consumeApproval: call site đã lọc dòng quà (đường order.service) --
  console.log('\n--- 4. consumeApproval khi call site đã lọc dòng quà ---');
  const reqFiltered = await DiscountApprovalService.createRequest({
    orderCode: `ORD-GIFT-${suffix}-D`,
    warehouseId: WH,
    cashierId: CASHIER.staffId,
    items: [...itemsNoGift, autoGift],
    requestedDiscountRate: RATE,
    actorContext: CASHIER,
  });
  await DiscountApprovalService.approveRequest({
    requestId: reqFiltered.id,
    method: 'ONE_TOUCH',
    actorContext: MANAGER,
  });
  try {
    await DiscountApprovalService.consumeApproval({
      requestId: reqFiltered.id,
      currentItems: itemsNoGift, // order.service.ts đã lọc dòng quà đi
      discountRate: RATE,
      warehouseId: WH,
      orderCode: `ORD-GIFT-${suffix}-D`,
      originalAmount: subtotal,
      discountAmount: discountExpected,
      finalAmount: finalExpected,
    });
    ok('tiêu thụ phê duyệt thành công với giỏ đã lọc dòng quà', true);
  } catch (e: any) {
    ok('tiêu thụ phê duyệt thành công với giỏ đã lọc dòng quà', false, `${e?.message || e}`);
  }

  // --- 6. Tráo giỏ: đổi số lượng 1 dòng sách ⇒ phải bị chặn -------------
  console.log('\n--- 5. Chống tráo giỏ (đổi số lượng sau khi duyệt) ---');
  const reqTamper = await DiscountApprovalService.createRequest({
    orderCode: `ORD-GIFT-${suffix}-E`,
    warehouseId: WH,
    cashierId: CASHIER.staffId,
    items: itemsNoGift,
    requestedDiscountRate: RATE,
    actorContext: CASHIER,
  });
  await DiscountApprovalService.approveRequest({
    requestId: reqTamper.id,
    method: 'ONE_TOUCH',
    actorContext: MANAGER,
  });
  const tampered = [
    { ...itemsNoGift[0], quantity: 3 },
    itemsNoGift[1],
  ];
  const tamperedSubtotal = 3 * Number(A.cover) + Number(B.cover);
  let tamperCaught = false;
  let tamperErr = '';
  try {
    await DiscountApprovalService.consumeApproval({
      requestId: reqTamper.id,
      currentItems: [...tampered, autoGift],
      discountRate: RATE,
      warehouseId: WH,
      orderCode: `ORD-GIFT-${suffix}-E`,
      originalAmount: tamperedSubtotal + Number(G.cover),
      discountAmount: 0,
      finalAmount: 0,
    });
  } catch (e: any) {
    tamperCaught = true;
    tamperErr = `${e?.code || ''} ${e?.message || e}`;
  }
  ok(
    'đổi số lượng 1 dòng sách (kể cả kèm dòng quà) vẫn bị chặn',
    tamperCaught,
    tamperErr || '(KHÔNG bị chặn — lỗ hổng tráo giỏ!)'
  );
  ok('lỗi chặn là STATE_CONFLICT (không phải lỗi ngẫu nhiên)', /STATE_CONFLICT/.test(tamperErr), tamperErr);
  const stillApproved = await DiscountApprovalService.getRequest(reqTamper.id);
  ok('yêu cầu bị chặn vẫn còn nguyên APPROVED (chưa bị tiêu thụ)', stillApproved.status === 'APPROVED', `status=${stillApproved.status}`);

  // --- 7. Thêm quà TAY sau khi duyệt ⇒ phải bị chặn ----------------------
  console.log('\n--- 6. Thêm dòng quà TAY sau khi duyệt (quà tay cần người duyệt) ---');
  const reqManualLater = await DiscountApprovalService.createRequest({
    orderCode: `ORD-GIFT-${suffix}-F`,
    warehouseId: WH,
    cashierId: CASHIER.staffId,
    items: itemsNoGift,
    requestedDiscountRate: RATE,
    actorContext: CASHIER,
  });
  await DiscountApprovalService.approveRequest({
    requestId: reqManualLater.id,
    method: 'ONE_TOUCH',
    actorContext: MANAGER,
  });
  let manualCaught = false;
  try {
    await DiscountApprovalService.consumeApproval({
      requestId: reqManualLater.id,
      currentItems: [...itemsNoGift, manualGift],
      discountRate: RATE,
      warehouseId: WH,
      orderCode: `ORD-GIFT-${suffix}-F`,
      originalAmount: subtotal + Number(G.cover),
      discountAmount: discountExpected + Number(G.cover),
      finalAmount: finalExpected,
    });
  } catch {
    manualCaught = true;
  }
  ok('thêm quà TAY sau khi duyệt bị chặn', manualCaught, '(KHÔNG bị chặn — lách duyệt!)');

  // --- 8. Giỏ chỉ có dòng quà ⇒ không xin duyệt được ---------------------
  console.log('\n--- 7. Giỏ chỉ có dòng quà ---');
  let onlyGiftCaught = false;
  let onlyGiftMsg = '';
  try {
    await DiscountApprovalService.createRequest({
      orderCode: `ORD-GIFT-${suffix}-G`,
      warehouseId: WH,
      cashierId: CASHIER.staffId,
      items: [autoGift],
      requestedDiscountRate: RATE,
      actorContext: CASHIER,
    });
  } catch (e: any) {
    onlyGiftCaught = true;
    onlyGiftMsg = `${e?.message || e}`;
  }
  ok('giỏ chỉ có dòng quà thì không xin duyệt được', onlyGiftCaught, onlyGiftMsg || '(cho qua — tạo yêu cầu 0đ)');

  // --- 9. Số tiền tiêu thụ KHÔNG được nới rộng vô hạn --------------------
  console.log('\n--- 8. Số tiền lệch KHÁC tiền quà vẫn bị chặn ---');
  const reqMoney = await DiscountApprovalService.createRequest({
    orderCode: `ORD-GIFT-${suffix}-H`,
    warehouseId: WH,
    cashierId: CASHIER.staffId,
    items: itemsNoGift,
    requestedDiscountRate: RATE,
    actorContext: CASHIER,
  });
  await DiscountApprovalService.approveRequest({
    requestId: reqMoney.id,
    method: 'ONE_TOUCH',
    actorContext: MANAGER,
  });
  let moneyCaught = false;
  try {
    await DiscountApprovalService.consumeApproval({
      requestId: reqMoney.id,
      currentItems: [...itemsNoGift, autoGift],
      discountRate: RATE,
      warehouseId: WH,
      orderCode: `ORD-GIFT-${suffix}-H`,
      // Cộng THỪA ngoài tiền quà ⇒ vẫn phải chặn, nới lỏng có giới hạn.
      originalAmount: subtotal + Number(G.cover) + 50_000,
      discountAmount: discountExpected + Number(G.cover),
      finalAmount: finalExpected,
    });
  } catch {
    moneyCaught = true;
  }
  ok('thừa tiền ngoài giá món quà vẫn bị chặn', moneyCaught, '(KHÔNG bị chặn — nới lỏng quá tay!)');

  // Không phải mọi yêu cầu trong test đều được duyệt (có cả yêu cầu cố tình
  // bỏ để đo), nên điều cần kiểm là KHÔNG yêu cầu nào bị đẩy vào trạng thái
  // hỏng (bị từ chối/hết hạn/đè) bởi những lần gọi ở trên.
  const broken = await q1(
    `SELECT COUNT(*) AS c FROM discount_approval_requests
      WHERE warehouse_id = ? AND order_code LIKE ?
        AND status NOT IN ('PENDING','APPROVED','CONSUMED')`,
    [WH, `ORD-GIFT-${suffix}-%`]
  );
  ok('không yêu cầu nào rơi vào trạng thái hỏng', Number(broken?.c || 0) === 0, `c=${broken?.c}`);

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error('\n❌ test-gift-approval-hash thất bại');
    process.exit(1);
  }
  console.log('\n✅ ĐƠN CÓ QUÀ VẪN DUYỆT ĐƯỢC, CÒN TRÁO GIỎ VẪN BỊ CHẶN.');
  process.exit(0);
}

main().catch((e) => {
  console.error('\n❌', e?.message || e);
  process.exit(1);
});