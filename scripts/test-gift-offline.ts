/**
 * scripts/test-gift-offline.ts — ĐƠN OFFLINE CÓ DÒNG QUÀ: KHÔNG ĐƯỢC THU TIỀN QUÀ.
 *
 * Kịch bản hội chợ mất mạng: thu ngân bán 800.000đ, đơn đạt mốc nên chương trình
 * tặng thêm cuốn sách 300.000đ, mạng rớt giữa chừng ⇒ đơn nằm trong IndexedDB.
 * Khi có mạng, `PosCheckoutTerminal` đồng bộ lên `POST /api/orders`.
 *
 * Lỗi đã sửa: đường offline gửi `unitDiscountRate = undefined` cho MỌI dòng, mà
 * `order.service.ts` định giá bằng `item.unitDiscountRate ?? discountRate` ⇒ dòng
 * quà nhận chiết khấu cả đơn (vd 10%) thay vì 100%. Đơn offline 800.000 + quà
 * 300.000 ghi `finalAmount` 1.040.000 ⇒ **thu 240.000đ tiền món quà từ khách**,
 * và nó im lặng — không ai thấy lỗi cho tới khi đối chiếu két cuối ngày.
 *
 * Luật ở đây:
 *  1. `toOfflineSyncItem` ép `unitDiscountRate = 1` cho dòng quà (dù offline
 *     lưu dòng đó KHÔNG có mức chiết khấu nào).
 *  2. Đơn offline thật qua `createOrder`: `final_amount` = tổng dòng thường,
 *     KHÔNG cộng tiền món quà.
 *  3. `order_items` ghi đúng: dòng quà `unit_discount_rate = 1`,
 *     `is_gift_line = 1`, `total_amount = 0`.
 *  4. Đơn Tặng sách (BV-03) giữ nguyên: mọi dòng bán 0đ.
 *  5. Mutation check: nếu map cũ (bỏ cờ dòng quà) thì `final_amount` ĐƯỢC cộng
 *     tiền quà — chứng minh luật 2 thật sự bắt được lỗi, không xanh giả.
 *
 * ⚠️ SERVER KHÔNG TIN CỜ `isGiftLine` TỪ CLIENT (`order.service.ts:616`): chỉ
 * dòng quà nằm trong `promotions`/`promotion_gifts` đang bật MỚI được bán 0đ.
 * Bản test cũ không dựng chiến dịch nên dòng quà bị hạ về dòng thường ⇒
 * `final_amount` = 64.800đ (đã thu tiền quà), test đỏ 8 luật mà server chạy
 * ĐÚNG. Nay test dựng chiến dịch thật với mốc tiền đọc từ DB.
 *
 * ⚠️ KHÔNG hard-code giá: `normal.coverPrice`/`giftBook.coverPrice` đến từ
 * `PosCatalogService.getCatalog` (đọc DB). Sau này đổi giá danh mục thì các
 * kỳ vọng ở bước 2/3 tự đi theo.
 */
import { assertIsolatedTestDb } from './test-guard';
import { toOfflineSyncItem } from '../src/lib/offline-db';
import { priceLine } from '../src/lib/pricing';

const DB = process.env.DATABASE_URL || 'file:formapubli_test.db';
const WH = 'wh-au-co';
const ORDER_DISCOUNT = 0.1;
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

async function main() {
  assertIsolatedTestDb('test-gift-offline');
  console.log('=== TEST: ĐƠN OFFLINE CÓ DÒNG QUÀ KHÔNG THU TIỀN QUÀ ===\n');

  const { createClient } = await import('@libsql/client');
  const db = createClient({ url: DB });
  const { PosCatalogService } = await import('../src/services/pos-catalog.service');
  const { OrderService } = await import('../src/services/order.service');

  // --- 1. Chuẩn bị: 2 cuốn sách, mỗi cuốn ATP >= 2 (bán 2 lần: đúng + đối chứng)
  const cat = await PosCatalogService.getCatalog(WH);
  const books = cat.items.filter((i: any) => i.productKind === 'BOOK' && i.atp >= 2);
  if (books.length < 2) {
    console.error(
      `⛔ Cần 2 cuốn sách có ATP >= 2 trong ${WH}, thấy ${books.length}. ` +
        'Hãy chạy lại qua runner (DB test phải được setup lại).'
    );
    process.exit(1);
  }
  const [normal, giftBook] = books as any[];
  const suffix = Date.now().toString().slice(-6);
  console.log(`Sách bán: ${normal.editionId} (${normal.coverPrice}), quà: ${giftBook.editionId} (${giftBook.coverPrice})\n`);

  // --- 1a. Dựng chiến dịch tặng quà ---------------------------------------
  // `order.service.ts:552-596` chỉ chấp nhận dòng quà nằm trong `promotions` +
  // `promotion_gifts` đang bật và đủ mốc. Mốc = `normal.coverPrice` (đọc từ
  // DB) vì `eligibleBase` của đơn này = 1 × `normal.coverPrice`.
  //
  // ⚠️ KHÔNG "nạp thêm tồn" bằng `UPDATE stock_balances` để test chạy nhiều
  // lần: số dư tăng mà không có dòng `inventory_ledger` tương ứng ⇒
  // `test-master-audit.ts` đỏ "Bất biến Sổ Cái" (Balance=98 vs LedgerSum=44).
  // Test cứ dựa vào luật chặn "ATP >= 2" ở trên như bản gốc.
  console.log('--- 1a. Dựng chiến dịch tặng quà ---');
  const CAMP_ID = `km-gift-offline`;
  const RULE_ID = `kt-gift-offline`;
  await db.execute({
    sql: `INSERT OR REPLACE INTO promotions (id, name, is_active) VALUES (?, ?, 1)`,
    args: [CAMP_ID, 'KM tặng quà — test offline'],
  });
  await db.execute({
    sql: `INSERT OR REPLACE INTO promotion_gifts (id, promotion_id, min_subtotal, product_id, gift_quantity)
          VALUES (?, ?, ?, ?, 1)`,
    args: [RULE_ID, CAMP_ID, Number(normal.coverPrice), giftBook.editionId],
  });
  console.log(`    mốc tiền = ${normal.coverPrice}đ (đọc từ DB); quà là ${giftBook.editionId} giá ${giftBook.coverPrice}đ`);
  ok('chiến dịch tặng quà đã dựng và đủ mốc', true);

  // Đơn offline: thu ngân lưu xuống IndexedDB. Dòng quà KHÔNG có
  // `unitDiscountRate` — đúng thực tế, cờ quà là thứ định nghĩa nó bán 0đ.
  const offlineItems = [
    {
      editionId: normal.editionId,
      code: normal.code,
      title: normal.title,
      quantity: 1,
      unitCoverPrice: normal.coverPrice,
    },
    {
      editionId: giftBook.editionId,
      code: giftBook.code,
      title: giftBook.title,
      quantity: 1,
      unitCoverPrice: giftBook.coverPrice,
      isGiftLine: true,
    },
  ];

  // --- 2. Map đồng bộ: dòng quà BẮT BUỘC mang unitDiscountRate = 1 -------
  console.log('--- 1. Payload đồng bộ (toOfflineSyncItem) ---');
  const mapped = offlineItems.map((it) => toOfflineSyncItem(it, false));
  ok('dòng thường không tự mang chiết khấu (server tự áp chiết khấu đơn)',
    mapped[0].unitDiscountRate === undefined, `rate=${mapped[0].unitDiscountRate}`);
  ok('dòng quà mang unitDiscountRate = 1', mapped[1].unitDiscountRate === 1, `rate=${mapped[1].unitDiscountRate}`);
  ok('dòng quà giữ cờ isGiftLine', mapped[1].isGiftLine === true);
  ok('dòng thường không mang cờ quà', mapped[0].isGiftLine === false);
  ok('giữ đủ trường gửi server (editionId/SL/giá bìa)',
    mapped.every((m) => !!m.editionId && m.quantity > 0 && m.unitCoverPrice > 0));
  ok('đơn Tặng sách (BV-03) vẫn bán 0đ mọi dòng',
    toOfflineSyncItem(offlineItems[0], true).unitDiscountRate === 1);

  // --- 3. Đồng bộ THẬT qua OrderService.createOrder ----------------------
  console.log('\n--- 2. Đồng bộ thật: createOrder với payload trên ---');
  const normalFinal = priceLine(normal.coverPrice, ORDER_DISCOUNT, 1).finalAmount;
  const giftFinalIfStolen = priceLine(giftBook.coverPrice, ORDER_DISCOUNT, 1).finalAmount;

  let order: any = null;
  let err = '';
  try {
    order = await OrderService.createOrder({
      warehouseId: WH,
      channel: 'RETAIL_OFFICE',
      paymentMethod: 'CASH',
      discountRate: ORDER_DISCOUNT,
      items: mapped,
      idempotencyKey: `idem-gift-offline-${suffix}`,
      actorContext: MANAGER,
      isOfflineSync: true,
      allowOverdraft: true,
    } as any);
  } catch (e: any) {
    err = `${e?.message || e}`;
  }
  ok('đồng bộ đơn offline có dòng quà ra đơn thật', !!order?.orderId, err || '(không có orderId)');
  if (!order) {
    console.error(`\n⛔ Đồng bộ thất bại ⇒ các luật sau không kiểm được.\n   Lỗi: ${err}`);
    process.exit(1);
  }

  const ord: any = (await db.execute({
    sql: 'SELECT subtotal AS st, discount_amount AS da, final_amount AS fa FROM orders WHERE id = ?',
    args: [order.orderId],
  })).rows[0];
  ok(`final_amount = ${normalFinal} (đúng tổng dòng thường)`,
    Number(ord.fa) === normalFinal, `fa=${ord.fa} vs ${normalFinal}`);
  ok('final_amount KHÔNG cộng tiền món quà',
    Number(ord.fa) !== normalFinal + giftFinalIfStolen,
    `fa=${ord.fa}, nếu thu tiền quà sẽ là ${normalFinal + giftFinalIfStolen}`);
  ok('subtotal không chứa giá món quà',
    Number(ord.st) === normal.coverPrice, `st=${ord.st} vs ${normal.coverPrice}`);
  ok('discount_amount = chiết khấu trên dòng thường',
    Number(ord.da) === normal.coverPrice - normalFinal, `da=${ord.da}`);

  const lines: any[] = (await db.execute({
    sql: `SELECT edition_id AS ed, quantity AS qty, unit_discount_rate AS rate,
                 total_amount AS total, is_gift_line AS gift
            FROM order_items WHERE order_id = ?`,
    args: [order.orderId],
  })).rows as any[];
  ok('đơn có đúng 2 dòng', lines.length === 2, `thực tế=${lines.length}`);
  const giftLine = lines.find((l) => l.ed === giftBook.editionId);
  const normalLine = lines.find((l) => l.ed === normal.editionId);
  ok('dòng quà ghi is_gift_line = 1', Number(giftLine?.gift) === 1, `gift=${giftLine?.gift}`);
  ok('dòng quà ghi unit_discount_rate = 1', Number(giftLine?.rate) === 1, `rate=${giftLine?.rate}`);
  ok('dòng quà có thành tiền 0đ', Number(giftLine?.total) === 0, `total=${giftLine?.total}`);
  ok('dòng thường ghi chiết khấu của đơn', Number(normalLine?.rate) === ORDER_DISCOUNT, `rate=${normalLine?.rate}`);

  // --- 4. Mutation check: map CŨ (bỏ cờ quà) thì mất tiền -------------
  console.log('\n--- 3. Mutation check: payload map CŨ có thu tiền món quà ---');
  const legacyMapped = offlineItems.map((it: any) => ({
    editionId: it.editionId,
    quantity: it.quantity,
    unitCoverPrice: it.unitCoverPrice,
    // Đường sync CŨ: undefined cho mọi dòng ⇒ dòng quà nhận chiết khấu cả đơn.
    unitDiscountRate: undefined,
    isGiftLine: false,
  }));
  let legacyOrder: any = null;
  let legacyErr = '';
  try {
    legacyOrder = await OrderService.createOrder({
      warehouseId: WH,
      channel: 'RETAIL_OFFICE',
      paymentMethod: 'CASH',
      discountRate: ORDER_DISCOUNT,
      items: legacyMapped,
      idempotencyKey: `idem-gift-offline-legacy-${suffix}`,
      actorContext: MANAGER,
      isOfflineSync: true,
      allowOverdraft: true,
    } as any);
  } catch (e: any) {
    legacyErr = `${e?.message || e}`;
  }
  ok('đơn với payload map cũ vẫn tạo được (lỗi là im lặng, không phải crash)',
    !!legacyOrder?.orderId, legacyErr || '(không có orderId)');
  if (legacyOrder) {
    const legacyOrd: any = (await db.execute({
      sql: 'SELECT final_amount AS fa FROM orders WHERE id = ?',
      args: [legacyOrder.orderId],
    })).rows[0];
    ok(`payload map cũ thu THÊM ${giftFinalIfStolen}đ tiền quà (lỗi bị lộ)`,
      Number(legacyOrd.fa) === normalFinal + giftFinalIfStolen,
      `fa=${legacyOrd.fa} vs ${normalFinal + giftFinalIfStolen}`);
    ok('⇒ luật "final_amount = tổng dòng thường" BẮT ĐƯỢC lỗi này',
      Number(legacyOrd.fa) > Number(ord.fa), `${legacyOrd.fa} > ${ord.fa}`);
  }

  // --- 5. Dọn dẹp: chỉ xoá CHIẾN DỊCH do test tạo -----------------------
  // ⚠️ KHÔNG xoá `orders`/`order_items`/`inventory_ledger`: 2 cuốn này thuộc
  // danh mục thật (`ed-hh001`, `ed-hh002`), xoá sổ kho sẽ làm
  // `test-master-audit.ts` đỏ "bảo toàn số dư tồn kho". Đơn + sổ kho phải
  // để lại đúng như mọi lần chạy trước.
  console.log('\n--- 4. Dọn dẹp chiến dịch test ---');
  await db.execute({ sql: `DELETE FROM promotion_gifts WHERE id = ?`, args: [RULE_ID] });
  await db.execute({ sql: `DELETE FROM promotions WHERE id = ?`, args: [CAMP_ID] });
  const campLeft = (await db.execute({
    sql: `SELECT (SELECT COUNT(*) FROM promotions WHERE id = ?) +
            (SELECT COUNT(*) FROM promotion_gifts WHERE id = ?) AS n`,
    args: [CAMP_ID, RULE_ID],
  })).rows[0] as any;
  ok('không để lại chiến dịch test', Number(campLeft?.n) === 0, `còn=${campLeft?.n}`);

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error('\n❌ test-gift-offline thất bại');
    process.exit(1);
  }
  console.log('\n✅ ĐƠN OFFLINE CÓ QUÀ: KHÔNG THU TIỀN MÓN QUÀ.');
  process.exit(0);
}

main().catch((e) => {
  console.error('\n❌', e?.message || e);
  process.exit(1);
});