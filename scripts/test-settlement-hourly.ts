/**
 * Báo cáo chốt ngày — trường `ordersByHour` (dải 24 giờ, giờ Việt Nam).
 *
 * Bản in cần biết lúc nào bán được (dải 24 cột cao điểm) mà KHÔNG được thêm
 * query mới: `ordersByHour` gom từ `dayOrders` đã có sẵn trong hàm.
 *
 * Bẫy chính của trường này là MÚI GIỜ. Mọi cột thời gian trong DB là UTC, còn
 * biên bản đọc bằng giờ Việt Nam (UTC+7, không DST). Ba cách làm sai, mỗi cái
 * một cái bẫy riêng, đều phải bị test này bắt:
 *
 *  1. Lấy thẳng giờ UTC ⇒ cột cao nhất lệch 7 tiếng. Ở đây đơn 10:00 giờ VN
 *     được ghi `03:00Z`; test đòi nằm ở bucket 10, không phải bucket 3.
 *  2. Cắt chuỗi `created_at.slice(11,13)` ⇒ lấy đúng GIỜ UTC cho chuỗi ISO, và
 *     với chuỗi họ SQLite (`'… 02:00:00'`) cũng vậy ⇒ lệch 7 tiếng.
 *  3. So chuỗi timestamp với nhau để suy ra giờ ⇒ DB có HAI họ timestamp
 *     ('YYYY-MM-DDTHH:MM:SSZ' của app và 'YYYY-MM-DD HH:MM:SS' của SQLite
 *     `CURRENT_TIMESTAMP`, cũng UTC). Phải chuẩn hoá qua `parseDbTimestamp` rồi
 *     mới cộng 7 giờ.
 *
 * Ngày nghiệp vụ = ngày VN: cửa sổ ngày D là 17:00 UTC hôm trước → 17:00 UTC
 * hôm D. Gieo đơn ở CẢ HAI mốc (01:00 giờ VN = 18:00 UTC hôm trước, và
 * 23:00 giờ VN = 16:00 UTC hôm D) để bucket 0 và bucket 23 có dữ liệu thật,
 * không chỉ dựa vào đơn buổi sáng.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_hourly.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

const D = '2026-10-01'; // ngày nghiệp vụ VN (4 đơn)
const D_EMPTY = '2026-10-03'; // ngày không bán được gì

let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  assert.ok(cond, msg);
}

/** Bucket của một mốc giờ VN trong `ordersByHour`. */
function bucketOf(rows: any[], hour: number) {
  const found = rows.find((r) => Number(r.hour) === hour);
  assert.ok(found, `ordersByHour phải có mốc giờ ${hour} (thiếu mốc ⇒ dải giờ bị hụt)`);
  return found;
}

async function run() {
  console.log('--- TEST BÁO CÁO NGÀY: DẢI 24 GIỜ (ordersByHour) ---');

  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-settlement-hourly');

  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../src/db/schema');
  const { DailySettlementService } = await import('../src/services/daily-settlement.service');

  const rawClient = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(rawClient);

  await db.insert(schema.warehouses).values({
    id: 'wh-hr-1',
    code: 'KHO_HR',
    name: 'Gian Hàng Dải Giờ',
    warehouseType: 'FAIR_EVENT',
    isSellableOnPos: true,
    isActive: true,
  });

  await db.insert(schema.works).values({
    id: 'work-hr-1',
    code: 'FORMA-HR-1',
    title: 'Ấn Phẩm Của Dải Giờ',
    author: 'Forma Author',
    isActive: true,
  });

  await db.insert(schema.editions).values([
    { id: 'ed-hr-1', code: 'HR-01', workId: 'work-hr-1', isbn: '9786040009110', isbnLast4: '9110', coverPrice: 100000, isActive: true },
  ]);

  // Đơn: 4 mốc giờ VN khác nhau, trong đó 2 đơn trùng giờ 10 để chắc chắn CỘNG DỒN
  // chứ không phải ghi đè. `createdAt` ghi đúng họ ISO mà app ghi.
  const orders = [
    // 17:30 UTC 30/09 = 00:30 giờ VN 01/10 → bucket 0
    { id: 'ord-hr-0', code: 'ORD-HR-00', final: 200000, createdAt: '2026-09-30T17:30:00.000Z' },
    // 18:00 UTC 30/09 = 01:00 giờ VN 01/10 → bucket 1
    { id: 'ord-hr-1', code: 'ORD-HR-01', final: 100000, createdAt: '2026-09-30T18:00:00.000Z' },
    // 03:00 + 03:30 UTC 01/10 = 10:00 + 10:30 giờ VN → bucket 10 (2 đơn)
    { id: 'ord-hr-10a', code: 'ORD-HR-10A', final: 300000, createdAt: '2026-10-01T03:00:00.000Z' },
    { id: 'ord-hr-10b', code: 'ORD-HR-10B', final: 500000, createdAt: '2026-10-01T03:30:00.000Z' },
    // 16:00 UTC 01/10 = 23:00 giờ VN → bucket 23
    { id: 'ord-hr-23', code: 'ORD-HR-23', final: 400000, createdAt: '2026-10-01T16:00:00.000Z' },
  ];

  for (const o of orders) {
    await db.insert(schema.orders).values({
      id: o.id,
      orderCode: o.code,
      warehouseId: 'wh-hr-1',
      cashierId: 'CASH-HR',
      subtotal: o.final,
      discountRate: 0,
      discountAmount: 0,
      finalAmount: o.final,
      paymentMethod: 'CASH',
      status: 'COMPLETED',
      idempotencyKey: 'idem-' + o.id,
      createdAt: o.createdAt,
    });
    await db.insert(schema.orderItems).values({
      id: 'it-' + o.id,
      orderId: o.id,
      editionId: 'ed-hr-1',
      quantity: 1,
      unitCoverPrice: 100000,
      unitSellingPrice: o.final,
      totalAmount: o.final,
    });
  }

  console.log('\n[Case 1] Ngày có 5 đơn rải 4 mốc giờ VN (00:30, 01:00, 10:00, 10:30, 23:00)');
  const r: any = await DailySettlementService.getDailyFairSettlement(
    { warehouseId: 'wh-hr-1', date: D }, db
  );

  ok(
    Array.isArray(r.ordersByHour),
    `phải có ordersByHour trong báo cáo, nhận ${JSON.stringify(r.ordersByHour)}`
  );
  ok(
    r.ordersByHour.length === 24,
    `ordersByHour phải đủ 24 mốc (giờ không bán = 0), nhận ${r.ordersByHour.length}`
  );
  ok(
    r.ordersByHour.every((x: any, i: number) => Number(x.hour) === i),
    'các mốc phải đúng thứ tự 0 → 23'
  );

  ok(bucketOf(r.ordersByHour, 0).orders === 1, 'giờ 0 giờ VN phải có 1 đơn');
  ok(bucketOf(r.ordersByHour, 0).sales === 200000, 'doanh thu giờ 0 = 200.000');
  ok(bucketOf(r.ordersByHour, 1).orders === 1, 'giờ 1 giờ VN phải có 1 đơn');
  ok(bucketOf(r.ordersByHour, 1).sales === 100000, 'doanh thu giờ 1 = 100.000');
  ok(
    bucketOf(r.ordersByHour, 10).orders === 2,
    `giờ 10 giờ VN phải CỘNG DỒN 2 đơn, nhận ${bucketOf(r.ordersByHour, 10).orders} (lấy giờ UTC sẽ ra bucket 3)`
  );
  ok(
    bucketOf(r.ordersByHour, 10).sales === 800000,
    `doanh thu giờ 10 = 300.000 + 500.000, nhận ${bucketOf(r.ordersByHour, 10).sales}`
  );
  ok(
    bucketOf(r.ordersByHour, 23).orders === 1,
    `giờ 23 giờ VN phải có 1 đơn, nhận ${bucketOf(r.ordersByHour, 23).orders}`
  );
  ok(bucketOf(r.ordersByHour, 23).sales === 400000, 'doanh thu giờ 23 = 400.000');

  // Giờ không bán = 0, KHÔNG được rơi mất mốc (dải 24 cột phải đều nhau trên bản in).
  ok(bucketOf(r.ordersByHour, 2).orders === 0, 'giờ 2 không bán được gì thì orders = 0');
  ok(bucketOf(r.ordersByHour, 2).sales === 0, 'giờ 2 không bán được gì thì sales = 0');
  ok(bucketOf(r.ordersByHour, 22).orders === 0, 'giờ 22 không bán được gì thì orders = 0');

  // Dải giờ phải khớp đúng tổng của ngày — cộng trộn 7 tiếng sẽ vỡ chỗ này.
  const sumOrders = r.ordersByHour.reduce((s: number, x: any) => s + Number(x.orders || 0), 0);
  const sumSales = r.ordersByHour.reduce((s: number, x: any) => s + Number(x.sales || 0), 0);
  ok(
    sumOrders === r.financials.totalOrdersCount,
    `tổng orders của dải giờ (${sumOrders}) phải bằng totalOrdersCount (${r.financials.totalOrdersCount})`
  );
  ok(
    sumSales === r.financials.netSales,
    `tổng sales của dải giờ (${sumSales}) phải bằng netSales (${r.financials.netSales})`
  );

  console.log('✓ Dải giờ đủ 24 mốc, cộng dồn đúng giờ Việt Nam, giờ trống = 0');

  console.log('\n[Case 2] Ngày không có đơn → dải giờ vẫn đủ 24 mốc, toàn 0');
  const e: any = await DailySettlementService.getDailyFairSettlement(
    { warehouseId: 'wh-hr-1', date: D_EMPTY }, db
  );
  ok(
    Array.isArray(e.ordersByHour) && e.ordersByHour.length === 24,
    'ngày trống vẫn phải có đủ 24 mốc để bản in không bị hụt cột'
  );
  ok(
    e.ordersByHour.every((x: any) => Number(x.orders || 0) === 0 && Number(x.sales || 0) === 0),
    'ngày không bán được gì thì mọi mốc giờ đều phải là 0'
  );
  console.log('✓ Ngày trống không bịa ra giờ bán hàng');

  console.log(`\n🎉 BÁO CÁO NGÀY — DẢI 24 GIỜ: ${checks} assertions PASS!`);
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
