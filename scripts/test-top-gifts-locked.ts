/**
 * scripts/test-top-gifts-locked.ts — KHÓA HÀNH VI (verify-first, không đổi hành vi).
 *
 * `AnalyticsService.topEditions(range, topN, warehouseId?, excludeGifts = true)`
 * phải MẶC ĐỊNH loại dòng quà khỏi bảng "Top bán chạy" và trả `totalGiftQty`
 * riêng. Hành vi này đã đúng từ trước (merge `e3491e4`); suite này chỉ chặn
 * hồi quy — không "sửa" service để xanh.
 *
 * VÌ SAO TỰ TẠO `products` MÀ KHÔNG DÙNG SẴN CÓ:
 * DB test dùng chung cho MỌI suite, và phần lớn suite bán các ấn bản seed
 * (88 mã HH/TP/H) rồi KHÔNG dọn. Nếu lấy 1 ấn bản seed làm "món quà", nhóm
 * `COALESCE(edition_id, product_id)` của nó đã có dòng bán thật của suite khác
 * ⇒ assertion "món quà vắng mặt" đỏ giả (và ngược lại là XANH giả khi suite
 * khác chưa chạy). Sản phẩm riêng của suite này thì không ai khác bán được.
 *
 * DỌN DẸP BẮT BUỘC (try/finally): assertion 3.6 của `test-analytics-doanhso`
 * đối chiếu `topEditions.totalQty` với SQL gốc KHÔNG lọc `is_gift_line`.
 * Để lại dòng quà của đơn COMPLETED ở DB test chung ⇒ 3.6 đỏ. Suite này dọn
 * trong `finally` nên thứ tự không ảnh hưởng kết quả; vẫn đặt TRƯỚC
 * `test-analytics-doanhso` trong `scripts/run-isolated.ts` theo yêu cầu brief
 * để không mở cửa sổ dữ liệu lệch.
 *
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-top-gifts-locked
 */
import { sql } from 'drizzle-orm';
import { db, orders, orderItems, products } from '../src/db';
import { AnalyticsService } from '../src/services/analytics.service';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-top-gifts-locked');

const uid = () => `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
const WH = 'wh-au-co';
const NORMAL_QTY = 1;
const GIFT_QTY = 9;
// topN=100 (max) để nhóm của fixture KHÔNG bị cắt khỏi bảng khi DB test chung
// đã có >20 nhóm từ suite khác. Không truyền tham số 4 ⇒ vẫn đang kiểm đúng
// MẶC ĐỊNH của `excludeGifts`.
const TOP_N = 100;

async function run() {
  let passed = 0;
  const total = 4;
  const ok = (n: string, c: boolean, extra = '') => {
    if (c) passed++;
    console.log(`${c ? '✅' : '❌'} ${n}${extra ? ` — ${extra}` : ''}`);
  };

  const normalCode = `TGL-N-${uid()}`;
  const giftCode = `TGL-G-${uid()}`;
  const normalProductId = `pr-tgl-n-${uid()}`;
  const giftProductId = `pr-tgl-g-${uid()}`;
  const orderId = `ord-tgl-${uid()}`;
  const normalLineId = `oi-tgl-n-${uid()}`;
  const giftLineId = `oi-tgl-g-${uid()}`;

  try {
    // MỐC ĐO TRƯỚC: các suite quà chạy trước trong ALL_SUITES (test-gift-forgery…)
    // để lại dòng quà trong DB test chung. `totalGiftQty` cộng cả chúng ⇒ phải
    // so DELTA, không so tuyệt đối — cùng một luật, không phụ thuộc thứ tự chạy.
    const beforeGiftQty = (await AnalyticsService.topEditions({}, 1)).totalGiftQty;

    await db.insert(products).values([
      { id: normalProductId, code: normalCode, name: 'Hàng bán thật (TGL)' },
      { id: giftProductId, code: giftCode, name: 'Quà tặng 0đ (TGL)' },
    ] as any);

    // `discount_rate` mặc định 0.0 (< 1 ✓), `channel` mặc định FAIR_EVENT
    // (!= SPONSORSHIP ✓), `final_amount` > 0 ✓ — đủ điều kiện lọc của
    // topEditions. `is_gift_line` set TƯỜNG MINH (không dựa vào default).
    await db.insert(orders).values({
      id: orderId,
      orderCode: `TGL${uid()}`,
      warehouseId: WH,
      subtotal: 100000,
      finalAmount: 100000,
      idempotencyKey: `tgl-${uid()}`,
      status: 'COMPLETED',
    } as any);
    await db.insert(orderItems).values([
      {
        id: normalLineId,
        orderId,
        productId: normalProductId,
        quantity: NORMAL_QTY,
        unitCoverPrice: 100000,
        unitSellingPrice: 100000,
        totalAmount: 100000,
        isGiftLine: false,
      },
      {
        id: giftLineId,
        orderId,
        productId: giftProductId,
        quantity: GIFT_QTY,
        unitCoverPrice: 0,
        unitSellingPrice: 0,
        totalAmount: 0,
        isGiftLine: true,
      },
    ] as any);

    // (a) Mặc định: KHÔNG truyền tham số 4.
    const def = await AnalyticsService.topEditions({}, TOP_N);
    const defGift = def.items.find((i) => i.code === giftCode);
    const defNormal = def.items.find((i) => i.code === normalCode);
    // Chống XANH GIẢ: dòng bán thật phải hiện, nếu không "quà vắng mặt" chỉ
    // có nghĩa là cả đơn không lọt vào (test rỗng).
    ok(
      '1. dòng bán thật có mặt (bảng không rỗng — chống xanh giả)',
      !!defNormal && defNormal.qty === NORMAL_QTY,
      `qty=${defNormal?.qty ?? 'KHÔNG THẤY'}`
    );
    ok(
      '2. MẶC ĐỊNH loại dòng quà khỏi top bán chạy',
      !defGift,
      `món quà ${defGift ? 'CÓ mặt (sai)' : 'vắng mặt (đúng)'}, items=${def.items.length}`
    );
    // So DELTA chứ không so tuyệt đối: truy vấn `totalGiftQty` không lọc kho
    // nên nó cộng cả dòng quà của suite khác trong DB test chung. Hiệu đúng
    // GIFT_QTY mới chứng minh nhánh đếm quà thật sự chạy và thấy fixture này.
    ok(
      '3. totalGiftQty đếm đúng lượng quà của fixture',
      def.totalGiftQty - beforeGiftQty === GIFT_QTY,
      `trước=${beforeGiftQty}, sau=${def.totalGiftQty}, hiệu=${def.totalGiftQty - beforeGiftQty} (cần = ${GIFT_QTY})`
    );

    // (b) Cờ vẫn còn hoạt động: tắt loại quà ⇒ dòng quà phải xuất hiện.
    const inc = await AnalyticsService.topEditions({}, TOP_N, undefined, false);
    const incGift = inc.items.find((i) => i.code === giftCode);
    ok(
      '4. excludeGifts=false thì dòng quà CÓ mặt (cờ còn sống)',
      !!incGift && incGift.qty === GIFT_QTY && inc.totalGiftQty === 0,
      incGift
        ? `qty=${incGift.qty}, revenue=${incGift.revenue}, totalGiftQty=${inc.totalGiftQty} (phải 0)`
        : 'KHÔNG THẤY'
    );
  } finally {
    // BẮT BUỘC kể cả khi insert/assert lỗi giữa chừng — xem cảnh báo 3.6 ở đầu file.
    await db
      .delete(orderItems)
      .where(sql`${orderItems.id} IN (${normalLineId}, ${giftLineId})`);
    await db.delete(orders).where(sql`${orders.id} = ${orderId}`);
    await db.delete(products).where(sql`${products.id} IN (${normalProductId}, ${giftProductId})`);
  }

  console.log(`TOP-GIFTS-LOCKED: ${passed}/${total}`);
  process.exit(passed === total ? 0 : 1);
}

run().catch((e) => {
  console.error('❌', e?.message || e);
  process.exit(1);
});
