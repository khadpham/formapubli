/**
 * scripts/test-goods-sell-e2e.ts — BÁN THẬT 1 món hàng hóa, TỪ ĐẦU ĐẾN CUỐI.
 *
 * scripts/test-goods-in-pos-catalog.ts đã chứng minh hàng hóa HIỆN trong lưới
 * POS và ATP khớp `OrderService.getATP`. Nhưng "hiện" ≠ "bán được": chưa ai chạy
 * đường `OrderService.createOrder` với một sản phẩm hàng hóa. Hổng đó là im lặng
 * — POS quét mã ra dòng, thu ngân bấm Thu ngân, và chỉ biết là hỏng khi thấy lỗi
 * giữa quầy, hoặc tệ hơn: đơn tạo được nhưng tồn không giảm.
 *
 * 9 luật khoá ở đây — mỗi luật là một cách mất tiền thật nếu hỏng:
 *  1. Nhập tồn cho hàng hóa (product_id, edition_id NULL).
 *  2. Hàng hóa có mặt trong `PosCatalogService.getCatalog` với ATP > 0.
 *  3. `OrderService.createOrder` trả đơn COMPLETED (bán được thật).
 *  4. `stock_balances` giảm đúng số lượng bán.
 *  5. `inventory_ledger` có bút toán DISPATCH_SALE đúng số lượng.
 *  6. `order_items.product_id` = id hàng hóa, `edition_id` NULL (hàng hóa không
 *     có ấn bản).
 *  7. ATP giảm đúng sau khi bán.
 *  8. BÁN VƯỢT TỒN phải bị chặn: bán 99 khi chỉ còn 3. Đơn KHÔNG được tạo,
 *     tồn KHÔNG âm. Đây là mấu chốt — lệch ở đây là mất tiền thật.
 *  9. Sách vẫn bán bình thường trong cùng DB (không hỏng gì).
 *
 * Luật 8 cố ý KHÔNG chấp nhận "có ném lỗi nào đó là xong": lỗi phải là lỗi ATP,
 * vì nếu hàng hóa chết ở bước định giá thì bán 99 cá cũng ném lỗi và luật 8 xanh
 * một cách giả — đúng cái bẫy im lặng ta cần diệt.
 */
import { createClient } from '@libsql/client';
import { PosCatalogService } from '../src/services/pos-catalog.service';
import { OrderService } from '../src/services/order.service';
import { ProductService } from '../src/services/product.service';
import { assertIsolatedTestDb } from './test-guard';

const DB = process.env.DATABASE_URL || 'file:formapubli_test.db';
const WH = 'wh-au-co';
const SELL_QTY = 3;
const OVERSELL_QTY = 99;

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
  return r.rows;
}
async function q1(sql: string, args: any[] = []) {
  const rows = await q(sql, args);
  return rows[0] as any;
}

/** Số 0 nếu chưa có dòng tồn (hàng hóa nhập tồn bằng SQL, không qua recordMovement). */
async function physicalQty(productId: string, warehouseId = WH): Promise<number> {
  const row = await q1(
    `SELECT physical_quantity AS q FROM stock_balances
      WHERE product_id = ? AND warehouse_id = ? AND condition = 'NEW'`,
    [productId, warehouseId]
  );
  return row ? Number(row.q) : 0;
}

async function main() {
  assertIsolatedTestDb(DB);
  console.log('=== TEST: BÁN HÀNG HÓA END-TO-END QUA OrderService.createOrder ===\n');

  db = createClient({ url: DB });
  const suffix = Date.now().toString().slice(-6);
  // Quản lý: miễn lease S-01 và miễn guard ca két B2a/B2c ⇒ tập trung vào đường
  // bán hàng hóa, không lẫn biến thể của luồng thu ngân.
  const MANAGER: any = { staffId: 'staff-la', role: 'ROLE_MANAGER', fullName: 'Lan Anh' };

  // --- 1. Chuẩn bị: 1 sản phẩm hàng hóa + nhập tồn thật ------------------
  console.log('--- 1. Nhập tồn cho 1 sản phẩm hàng hóa ---');
  const goods = await ProductService.create({
    code: `SP-E2E${suffix}`,
    name: 'Túi vải FORMA (E2E)',
    sellingPrice: 59000,
    barcode: `8941${suffix}001`,
  });
  ok('tạo được sản phẩm hàng hóa qua ProductService', !!goods?.id, `id=${goods?.id}`);
  ok('productKind = GOODS', goods?.productKind === 'GOODS', `kind=${goods?.productKind}`);

  const INITIAL = 6;
  await db.execute({
    sql: `INSERT INTO stock_balances (id, edition_id, product_id, warehouse_id, condition, physical_quantity)
          VALUES (?, NULL, ?, ?, 'NEW', ?)`,
    args: [`sb-e2e-${goods.id}`, goods.id, WH, INITIAL],
  });
  ok('nhập tồn thật (product_id, edition_id NULL)', (await physicalQty(goods.id)) === INITIAL);

  // Hàng hóa KHÔNG được có dòng `editions` — đó là điều kiện để test này có
  // nghĩa. Nếu có, ta đang test bán sách chứ không phải bán hàng hóa.
  const edRow = await q1('SELECT id FROM editions WHERE id = ?', [goods.id]);
  ok('hàng hóa KHÔNG có dòng editions (đúng bản chất)', !edRow);

  // --- 2. Hàng hóa hiện trong danh mục POS, ATP > 0 ------------------------
  console.log('\n--- 2. Hàng hóa trong danh mục POS ---');
  const cat = await PosCatalogService.getCatalog(WH);
  const line = cat.items.find((i) => i.editionId === goods.id);
  ok('tìm thấy hàng hóa trong catalog', !!line);
  if (!line) {
    console.log('\n⛔ Không có hàng hóa trong danh mục ⇒ dừng, phần còn lại vô nghĩa.');
    process.exit(1);
  }
  ok('kind = GOODS', line.productKind === 'GOODS');
  ok('ATP > 0', line.atp > 0, `atp=${line.atp}`);
  ok('ATP = tồn nhập vào', line.atp === INITIAL, `atp=${line.atp} tồn=${INITIAL}`);

  // --- 3. BÁN THẬT --------------------------------------------------------
  console.log(`\n--- 3. BÁN THẬT ${SELL_QTY} cáo qua OrderService.createOrder ---`);
  const beforeQty = await physicalQty(goods.id);
  const idemKey = `idem-e2e-goods-${suffix}`;
  let order: any = null;
  let sellError = '';
  try {
    order = await OrderService.createOrder({
      warehouseId: WH,
      channel: 'RETAIL_OFFICE',
      paymentMethod: 'CASH',
      items: [{ editionId: goods.id, quantity: SELL_QTY }],
      idempotencyKey: idemKey,
      actorContext: MANAGER,
    });
    ok('createOrder trả về đơn', !!order?.orderId, `orderId=${order?.orderId}`);
  } catch (e: any) {
    sellError = `${e?.message || e}`;
    ok('createOrder KHÔNG ném lỗi khi bán hàng hóa', false, sellError);
  }

  if (!order) {
    console.log('\n⛔ KHÔNG BÁN ĐƯỢC hàng hóa ⇒ các luật 4-9 không kiểm được.');
    console.log(`   Lỗi đầy đủ: ${sellError}`);
    process.exit(1);
  }

  const ordRow = await q1('SELECT status, final_amount AS fa FROM orders WHERE id = ?', [order.orderId]);
  ok('đơn trong DB tồn tại', !!ordRow);
  ok('đơn COMPLETED (chốt ngay, không phải đơn chờ)', ordRow?.status === 'COMPLETED', `status=${ordRow?.status}`);
  ok('tiền đơn = 3 x 59000', Number(ordRow?.fa) === SELL_QTY * 59000, `finalAmount=${ordRow?.fa}`);

  // --- 4. Tồn kho giảm đúng ----------------------------------------------
  console.log('\n--- 4. stock_balances giảm đúng số lượng bán ---');
  const afterQty = await physicalQty(goods.id);
  ok(`tồn ${INITIAL} - ${SELL_QTY} = ${INITIAL - SELL_QTY}`, afterQty === INITIAL - SELL_QTY, `thực tế=${afterQty}`);

  // --- 5. Bút toán kho ----------------------------------------------------
  console.log('\n--- 5. inventory_ledger có DISPATCH_SALE ---');
  const ledRows = await q(
    `SELECT event_type, quantity_delta AS d, document_ref AS ref
       FROM inventory_ledger WHERE correlation_id = ?`,
    [order.orderId]
  );
  ok('có đúng 1 bút toán kho cho đơn này', ledRows.length === 1, `thực tế=${ledRows.length}`);
  const led: any = ledRows[0];
  ok('event_type = DISPATCH_SALE', led?.event_type === 'DISPATCH_SALE', `event=${led?.event_type}`);
  ok(`quantity_delta = -${SELL_QTY}`, Number(led?.d) === -SELL_QTY, `delta=${led?.d}`);
  ok('document_ref = mã đơn', led?.ref === order.orderCode, `${led?.ref} vs ${order.orderCode}`);

  // --- 6. Dòng đơn: productId = hàng hóa, editionId NULL ------------------
  console.log('\n--- 6. order_items gắn đúng hàng hóa ---');
  const itemRows = await q(
    `SELECT edition_id AS ed, product_id AS pid, quantity AS qty
       FROM order_items WHERE order_id = ?`,
    [order.orderId]
  );
  ok('có đúng 1 dòng đơn', itemRows.length === 1, `thực tế=${itemRows.length}`);
  const it: any = itemRows[0];
  ok('product_id = id hàng hóa', it?.pid === goods.id, `${it?.pid} vs ${goods.id}`);
  ok('edition_id NULL (hàng hóa không có ấn bản)', it?.ed === null, `editionId=${it?.ed}`);
  ok(`quantity = ${SELL_QTY}`, Number(it?.qty) === SELL_QTY, `qty=${it?.qty}`);

  // --- 7. ATP giảm đúng ---------------------------------------------------
  console.log('\n--- 7. ATP giảm đúng sau khi bán ---');
  const atpAfter = await OrderService.getATP(goods.id, WH);
  ok(`ATP = ${INITIAL - SELL_QTY} (không còn giữ chỗ nào)`, atpAfter === INITIAL - SELL_QTY, `atp=${atpAfter}`);
  const catAfter = await PosCatalogService.getCatalog(WH);
  const lineAfter = catAfter.items.find((i) => i.editionId === goods.id);
  ok('catalog.atp === getATP sau khi bán', lineAfter?.atp === atpAfter, `${lineAfter?.atp} vs ${atpAfter}`);

  // --- 8. BÁN VƯỢT TỒN phải bị chặn --------------------------------------
  console.log(`\n--- 8. BÁN VƯỢT TỒN: ${OVERSELL_QTY} cáo khi chỉ còn ${INITIAL - SELL_QTY} ---`);
  const beforeOversell = await physicalQty(goods.id);
  const ordersBefore = Number((await q1('SELECT COUNT(*) AS c FROM orders'))?.c || 0);
  let oversellError = '';
  let oversellBlocked = false;
  try {
    await OrderService.createOrder({
      warehouseId: WH,
      channel: 'RETAIL_OFFICE',
      paymentMethod: 'CASH',
      items: [{ editionId: goods.id, quantity: OVERSELL_QTY }],
      idempotencyKey: `idem-e2e-oversell-${suffix}`,
      actorContext: MANAGER,
    });
  } catch (e: any) {
    oversellError = `${e?.message || e}`;
    // Chỉ chấp nhận lỗi ATP. Lỗi khác (vd "Ấn bản không tồn tại") là bằng chứng
    // hàng hóa chết ở chỗ khác, không phải bằng chứng chặn vượt tồn.
    oversellBlocked = /ATP|HẾT HÀNG KHẢ DỤNG|KHÔNG ĐỦ TỒN|XUẤT ÂM/i.test(oversellError);
  }
  ok('bán vượt tồn bị chặn bằng LỖI ATP', oversellBlocked, oversellError || '(KHÔNG ném lỗi — đã bán vượt tồn!)');
  const ordersAfter = Number((await q1('SELECT COUNT(*) AS c FROM orders'))?.c || 0);
  ok('đơn vượt tồn KHÔNG được tạo', ordersAfter === ordersBefore, `${ordersBefore} -> ${ordersAfter}`);
  const oversellOrders = await q(
    'SELECT id FROM orders WHERE idempotency_key = ?',
    [`idem-e2e-oversell-${suffix}`]
  );
  ok('không có bản ghi đơn nào cho key vượt tồn', oversellOrders.length === 0);
  const afterOversell = await physicalQty(goods.id);
  ok('tồn KHÔNG bị âm', afterOversell >= 0, `tồn=${afterOversell}`);
  ok('tồn không đổi sau lần bán vượt tồn bị chặn', afterOversell === beforeOversell, `${beforeOversell} -> ${afterOversell}`);

  // --- 9. Sách vẫn bán bình thường --------------------------------------
  console.log('\n--- 9. Sách vẫn bán bình thường trong cùng DB ---');
  const book = catAfter.items.find((i) => i.productKind === 'BOOK' && i.atp > 0);
  ok('còn sách có ATP trong danh mục', !!book);
  if (book) {
    const bookBefore = await physicalQty(book.editionId);
    let bookOrder: any = null;
    let bookErr = '';
    try {
      bookOrder = await OrderService.createOrder({
        warehouseId: WH,
        channel: 'RETAIL_OFFICE',
        paymentMethod: 'CASH',
        items: [{ editionId: book.editionId, quantity: 1 }],
        idempotencyKey: `idem-e2e-book-${suffix}`,
        actorContext: MANAGER,
      });
    } catch (e: any) {
      bookErr = `${e?.message || e}`;
    }
    ok('bán sách vẫn ra đơn', !!bookOrder?.orderId, bookErr);
    if (bookOrder) {
      const bRow = await q1('SELECT status FROM orders WHERE id = ?', [bookOrder.orderId]);
      ok('đơn sách COMPLETED', bRow?.status === 'COMPLETED', `status=${bRow?.status}`);
      const bookAfter = await physicalQty(book.editionId);
      ok('tồn sách giảm đúng 1', bookAfter === bookBefore - 1, `${bookBefore} -> ${bookAfter}`);
      const bItem = await q1(
        'SELECT edition_id AS ed, product_id AS pid FROM order_items WHERE order_id = ?',
        [bookOrder.orderId]
      );
      ok('dòng sách giữ nguyên edition_id (không hỏng bởi hàng hóa)', bItem?.ed === book.editionId, `editionId=${bItem?.ed}`);
    }
  }

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error('\n❌ test-goods-sell-e2e thất bại');
    process.exit(1);
  }
  console.log('\n✅ HÀNG HÓA BÁN ĐƯỢC THẬT TỪ ĐẦU ĐẾN CUỐI, VÀ CHẶN ĐÚNG BÁN VƯỢT TỒN.');
  process.exit(0);
}

main().catch((e) => {
  console.error('\n❌', e?.message || e);
  process.exit(1);
});
