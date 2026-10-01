/**
 * Báo cáo chốt ngày — trường `highlight` (đơn giá trị cao nhất trong ngày).
 *
 * Ba thứ cần chứng minh, mỗi thứ một cái bẫy riêng:
 *
 * 1. Đúng đơn + đúng số SP. `itemCount` phải là TỔNG `order_items.quantity` của
 *    đơn đó (một đơn nhiều dòng), không phải số dòng — gieo 2 dòng 3 + 4 = 7.
 * 2. Hoà tiền phải ỔN ĐỊNH. Hai đơn cùng `final_amount`: kết quả phải là cùng
 *    một đơn mọi lần chạy, không phụ thuộc thứ tự hàng SQLite trả về. Ở đây còn
 *    cố tình dùng HAI họ timestamp đang cùng tồn tại trong DB:
 *    `…THH:MM:SSZ` (app ghi) và `… HH:MM:SS` (SQLite `CURRENT_TIMESTAMP`, UTC).
 *    So CHUỖI thì chuỗi họ 2 nhỏ hơn họ 1 (dấu cách < chữ T) ⇒ đơn ra SAU lại
 *    được coi là ra trước ⇒ chọn sai đơn. Phải chuẩn hoá qua
 *    `parseDbTimestamp` rồi mới so.
 * 3. Ngày không có đơn ⇒ `highlight === null` (không bịa thẻ "đơn lớn nhất").
 *
 * Ngày nghiệp vụ = ngày VN: cửa sổ ngày D là 17:00 UTC hôm trước → 17:00 UTC
 * hôm D, nên mốc UTC buổi sáng vẫn thuộc ngày VN đó. Cố định ngày (không dùng
 * `new Date()`) để lần chạy nào cũng ra cùng kết quả.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_highlight.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

const D_BIG = '2026-10-01'; // ngày có 2 đơn khác tiền
const D_TIE = '2026-10-02'; // ngày có 2 đơn BẰNG TIỀN
const D_EMPTY = '2026-10-03'; // ngày không có đơn nào

let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  assert.ok(cond, msg);
}

async function run() {
  console.log('--- TEST BÁO CÁO NGÀY: ĐƠN GIÁ TRỊ CAO NHẤT (highlight) ---');

  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-settlement-highlight');

  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../src/db/schema');
  const { DailySettlementService } = await import('../src/services/daily-settlement.service');

  const rawClient = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(rawClient);

  await db.insert(schema.warehouses).values({
    id: 'wh-hl-1',
    code: 'KHO_HL',
    name: 'Gian Hàng Điểm Nhấn',
    warehouseType: 'FAIR_EVENT',
    isSellableOnPos: true,
    isActive: true,
  });

  await db.insert(schema.works).values({
    id: 'work-hl-1',
    code: 'FORMA-HL-1',
    title: 'Điểm Nhấn Của Ngày',
    author: 'Forma Author',
    isActive: true,
  });

  await db.insert(schema.editions).values([
    { id: 'ed-hl-1', code: 'HL-01', workId: 'work-hl-1', isbn: '9786040009011', isbnLast4: '9011', coverPrice: 100000, isActive: true },
    { id: 'ed-hl-2', code: 'HL-02', workId: 'work-hl-1', isbn: '9786040009022', isbnLast4: '9022', coverPrice: 200000, isActive: true },
  ]);

  const order = async (v: {
    id: string; code: string; final: number; subtotal: number; discount: number;
    method: string; createdAt: string;
  }) => {
    await db.insert(schema.orders).values({
      id: v.id,
      orderCode: v.code,
      warehouseId: 'wh-hl-1',
      cashierId: 'CASH-HL',
      subtotal: v.subtotal,
      discountRate: v.subtotal > 0 ? v.discount / v.subtotal : 0,
      discountAmount: v.discount,
      finalAmount: v.final,
      paymentMethod: v.method,
      status: 'COMPLETED',
      idempotencyKey: 'idem-' + v.id,
      createdAt: v.createdAt,
    });
  };
  const item = async (id: string, orderId: string, editionId: string, qty: number) => {
    await db.insert(schema.orderItems).values({
      id, orderId, editionId, quantity: qty,
      unitCoverPrice: 100000, unitSellingPrice: 90000, totalAmount: qty * 90000,
    });
  };

  // --- Ngày 1: đơn lớn 900.000 (tiền mặt, 2 dòng sách) và đơn nhỏ 300.000 ------
  await order({
    id: 'ord-hl-big', code: 'ORD-HL-BIG', final: 900000, subtotal: 1000000, discount: 100000,
    method: 'CASH', createdAt: `${D_BIG}T02:00:00.000Z`, // 09:00 giờ VN
  });
  await item('it-hl-big-1', 'ord-hl-big', 'ed-hl-1', 3);
  await item('it-hl-big-2', 'ord-hl-big', 'ed-hl-2', 4);

  await order({
    id: 'ord-hl-small', code: 'ORD-HL-SMALL', final: 300000, subtotal: 400000, discount: 100000,
    method: 'BANK_TRANSFER', createdAt: `${D_BIG}T03:00:00.000Z`, // 10:00 giờ VN
  });
  await item('it-hl-small-1', 'ord-hl-small', 'ed-hl-2', 2);

  console.log('\n[Case 1] Ngày có 2 đơn khác tiền → highlight là đơn lớn hơn');
  const r1: any = await DailySettlementService.getDailyFairSettlement(
    { warehouseId: 'wh-hl-1', date: D_BIG }, db
  );
  ok(r1.highlight !== null, `phải có highlight, nhận ${JSON.stringify(r1.highlight)}`);
  ok(r1.highlight.orderCode === 'ORD-HL-BIG', `orderCode phải là ORD-HL-BIG, nhận ${r1.highlight.orderCode}`);
  ok(r1.highlight.finalAmount === 900000, `finalAmount phải 900000, nhận ${r1.highlight.finalAmount}`);
  ok(r1.highlight.subtotal === 1000000, `subtotal phải 1000000, nhận ${r1.highlight.subtotal}`);
  ok(r1.highlight.discountAmount === 100000, `discountAmount phải 100000, nhận ${r1.highlight.discountAmount}`);
  ok(r1.highlight.paymentMethod === 'CASH', `paymentMethod phải CASH, nhận ${r1.highlight.paymentMethod}`);
  ok(
    r1.highlight.itemCount === 7,
    `itemCount phải là TỔNG quantity của đơn (3+4=7), nhận ${r1.highlight.itemCount}`
  );
  ok(
    String(r1.highlight.createdAt).includes(D_BIG),
    `createdAt phải là giờ tạo của đơn đó, nhận ${r1.highlight.createdAt}`
  );
  ok(r1.financials.netSales === 1200000, 'netSales của ngày không đổi (1200000)');
  console.log(`✓ highlight = ${r1.highlight.orderCode} · ${r1.highlight.finalAmount} đ · ${r1.highlight.itemCount} SP`);

  // --- Ngày 2: hai đơn BẰNG TIỀN, cố tình chèn đơn ra sau trước ---------------
  // Hai mốc thời gian khác HỌ (ISO vs SQLite) để bắt lỗi so chuỗi.
  await order({
    id: 'ord-hl-tie-b', code: 'ORD-HL-TIE-B', final: 500000, subtotal: 500000, discount: 0,
    method: 'CASH', createdAt: `${D_TIE} 02:00:00`, // họ SQLite = 09:00 giờ VN (ra SAU)
  });
  await item('it-hl-tie-b', 'ord-hl-tie-b', 'ed-hl-1', 1);

  await order({
    id: 'ord-hl-tie-a', code: 'ORD-HL-TIE-A', final: 500000, subtotal: 500000, discount: 0,
    method: 'QR_CODE', createdAt: `${D_TIE}T01:00:00.000Z`, // họ ISO = 08:00 giờ VN (ra TRƯỚC)
  });
  await item('it-hl-tie-a', 'ord-hl-tie-a', 'ed-hl-1', 1);

  console.log('\n[Case 2] Hai đơn bằng tiền → phải ra cùng một đơn, mọi lần chạy');
  const r2: any = await DailySettlementService.getDailyFairSettlement(
    { warehouseId: 'wh-hl-1', date: D_TIE }, db
  );
  ok(r2.highlight !== null, 'ngày có đơn thì highlight không được null');
  ok(
    r2.highlight.orderCode === 'ORD-HL-TIE-A',
    `đơn ra TRƯỚC phải thắng khi bằng tiền, nhận ${r2.highlight.orderCode} (so chuỗi sẽ chọn nhầm ORD-HL-TIE-B)`
  );
  ok(r2.highlight.paymentMethod === 'QR_CODE', 'hình thức thanh toán lấy đúng của đơn thắng');
  ok(r2.highlight.itemCount === 1, 'itemCount của đơn thắng');
  const r2b: any = await DailySettlementService.getDailyFairSettlement(
    { warehouseId: 'wh-hl-1', date: D_TIE }, db
  );
  ok(
    r2b.highlight.orderCode === r2.highlight.orderCode,
    'chạy lại phải ra CÙNG đơn — thứ tự hàng DB không được đổi kết quả'
  );
  console.log(`✓ Hoà tiền ổn định: ${r2.highlight.orderCode} (ra trước) được chọn ở cả 2 lần chạy`);

  // --- Ngày 3: không có đơn nào ------------------------------------------------
  console.log('\n[Case 3] Ngày không có đơn → highlight = null');
  const r3: any = await DailySettlementService.getDailyFairSettlement(
    { warehouseId: 'wh-hl-1', date: D_EMPTY }, db
  );
  ok(r3.financials.totalOrdersCount === 0, 'ngày trống không có đơn');
  ok(r3.highlight === null, `highlight phải null, nhận ${JSON.stringify(r3.highlight)}`);
  ok(Array.isArray(r3.topSellers), 'topSellers vẫn là mảng rỗng — không đổi contract cũ');
  console.log('✓ Không bịa đơn lớn nhất cho ngày không bán được gì');

  console.log(`\n🎉 BÁO CÁO NGÀY — ĐƠN GIÁ TRỊ CAO NHẤT: ${checks} assertions PASS!`);
}

run()
  .catch((err) => {
    console.error('❌ TEST FAILED:', err);
    process.exit(1);
  })
  .finally(() => {
    for (const s of ['', '-wal', '-shm', '-journal']) {
      try { fs.unlinkSync(DB_FILE + s); } catch {}
    }
  });
