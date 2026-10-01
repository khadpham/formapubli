/**
 * KIỂM ĐỊNH CÔNG THỨC NHUẬN BÚT — CƠ SỞ TIỀN THỰC THU (royaltyBasis).
 *
 * QUY TẮC SỐ 11: suite này GỌI CODE THẬT — `OrderService.createOrder` để tạo đơn
 * có chiết khấu, `RoyaltyService.royaltyStatement` để ra bảng kê, trên CSDL thật
 * dựng bằng đúng chuỗi migration của repo. KHÔNG có regex nào đọc file nguồn.
 * Mọi số kỳ vọng được bốc ra từ DB bằng SQL độc lập rồi so với số service trả.
 *
 * LỖI GỐC ĐANG SỬA: `royaltyStatement` nhân `lượng bán × editions.cover_price`
 * (GIÁ BÌA HIỆN HÀNH) nên khách chiết khấu 10% vẫn khiến tác giả nhận nhuận bút
 * trên 100% giá bìa ⇒ royalty thổi phồng ~10%. Nay mặc định là `NET_SOLD`
 * (SUM `order_items.total_amount` — tiền thực thu sau chiết khấu), và HĐ ghi rõ
 * trả theo giá bìa thì đặt `royaltyBasis = 'COVER_PRICE'`.
 *
 * BẰNG CHỨNG CỐT LÕI (R1): một đơn có chiết khấu, royalty theo NET_SOLD phải
 * NHỎ HƠN royalty theo COVER_PRICE, và chênh lệch đúng bằng tổng tiền chiết khấu.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh, stripToExecutable } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_royalty_basis.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* chưa có */ }
}

let checks = 0;
let failures = 0;

function ok(cond: boolean, name: string, detail = ''): void {
  checks++;
  if (cond) {
    console.log(`  ✅ [${checks}] ${name}${detail ? `\n       ↳ ${detail}` : ''}`);
  } else {
    failures++;
    console.error(`  ❌ [${checks}] ${name}${detail ? `\n       ↳ ${detail}` : ''}`);
  }
}

/** Ngày nghiệp vụ VN của một mốc UTC (độc lập với service, dùng Intl). */
function vnDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(iso));
}

async function run() {
  console.log('--- KIỂM ĐỊNH: CÔNG THỨC NHUẬN BÚT THEO CƠ SỞ TIỀN (agent roy) ---');

  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-royalty-basis');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL });

  // Phải import SAU khi đặt DATABASE_URL: src/db đọc biến này lúc module load.
  const schema = await import('../src/db/schema');
  const { db } = await import('../src/db');
  const { RoyaltyService, ROYALTY_BASIS_LABEL, ROYALTY_BASIS_OPTIONS, ROYALTY_BASES } =
    await import('../src/services/royalty.service');
  const { OrderService } = await import('../src/services/order.service');
  const { SponsorshipService } = await import('../src/services/sponsorship.service');
  const { sql, eq } = await import('drizzle-orm');

  const WH = 'wh-roy';
  const WH_MAIN = 'wh-roy-main';
  const TERM_FROM = '2020-01-01';
  const TERM_TO = '2099-12-31';

  await db.insert(schema.warehouses).values([
    {
      id: WH, code: 'KHO_ROY', name: 'Kho kiểm định royalty',
      warehouseType: 'FAIR_EVENT', isSellableOnPos: true, isActive: true,
    },
    {
      id: WH_MAIN, code: 'KHO_ROY_MAIN', name: 'Kho chính kiểm định royalty',
      warehouseType: 'RETAIL_OFFICE', isSellableOnPos: true, isActive: true,
    },
  ]);
  // wk-disc: tác phẩm dùng cho BẰNG CHỨNG CỐT LÕI (đơn có chiết khấu).
  await db.insert(schema.works).values([
    { id: 'wk-disc', code: 'ROY-DISC', title: 'Tác phẩm chiết khấu', author: 'Tác giả CK', isActive: true },
    { id: 'wk-plain', code: 'ROY-PLAIN', title: 'Tác phẩm không chiết khấu', author: 'Tác giả PL', isActive: true },
    { id: 'wk-sponsor', code: 'ROY-SPONSOR', title: 'Tác phẩm đơn tài trợ', author: 'Tác giả SP', isActive: true },
  ]);
  await db.insert(schema.editions).values([
    { id: 'ed-d1', code: 'ROY-D1', workId: 'wk-disc', isbn: '9780000001001', isbnLast4: '1001', coverPrice: 100000, isActive: true },
    { id: 'ed-p1', code: 'ROY-P1', workId: 'wk-plain', isbn: '9780000001002', isbnLast4: '1002', coverPrice: 80000, isActive: true },
    { id: 'ed-s1', code: 'ROY-S1', workId: 'wk-sponsor', isbn: '9780000001003', isbnLast4: '1003', coverPrice: 120000, isActive: true },
  ]);
  for (const e of ['ed-d1', 'ed-p1', 'ed-s1']) {
    await db.insert(schema.stockBalances).values([
      { id: `sb-${e}`, productId: e, editionId: e, warehouseId: WH, condition: 'NEW', physicalQuantity: 5000 },
      { id: `sb-main-${e}`, productId: e, editionId: e, warehouseId: WH_MAIN, condition: 'NEW', physicalQuantity: 5000 },
    ]);
  }

  const mkContract = (n: string, workId: string, rate: number, basis?: 'NET_SOLD' | 'COVER_PRICE') =>
    RoyaltyService.createContract({
      contractNumber: n, workId, licensorName: `Tác giả ${n}`, royaltyRate: rate,
      printQuota: 100000, effectiveDate: TERM_FROM, expirationDate: TERM_TO,
      createdBy: 'QL-01', royaltyBasis: basis,
    });

  // ======================================================================
  // R1 — BẰNG CHỨNG CỐT LÕI: đơn có chiết khấu, NET_SOLD < COVER_PRICE,
  //      chênh lệch đúng bằng tổng tiền chiết khấu.
  // ======================================================================
  console.log('\n=== R1. NET_SOLD vs COVER_PRICE (đơn có chiết khấu) ===');

  // Mặc định (không truyền royaltyBasis) PHẢI là NET_SOLD.
  const cNet = await mkContract('ROY-HD-NET', 'wk-disc', 0.1);
  const cCov = await mkContract('ROY-HD-COV', 'wk-disc', 0.1, 'COVER_PRICE');

  // Đơn THẬT qua OrderService: 10 cuốn × giá bìa 100.000, chiết khấu 10%.
  const DISCOUNT = 0.1;
  const QTY = 10;
  const ordDisc = await OrderService.createOrder({
    warehouseId: WH, customerName: 'Khách chiết khấu',
    fiscalScope: 'OFFICIAL_TAX', cashierId: 'ROY-CASHIER',
    discountRate: DISCOUNT,
    items: [{ editionId: 'ed-d1', quantity: QTY }],
    idempotencyKey: 'roy-basis-disc-1',
  });

  // Số kỳ vọng bốc từ DB bằng SQL độc lập — KHÔNG lặp lại công thức của service.
  const itemRow = (
    await db
      .select({
        qty: schema.orderItems.quantity,
        cover: schema.orderItems.unitCoverPrice,
        sell: schema.orderItems.unitSellingPrice,
        total: schema.orderItems.totalAmount,
        ordTotal: schema.orders.subtotal,
        discount: schema.orders.discountAmount,
        final: schema.orders.finalAmount,
        status: schema.orders.status,
        channel: schema.orders.channel,
      })
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orderItems.orderId, schema.orders.id))
      .where(eq(schema.orderItems.orderId, ordDisc.orderId))
  )[0];
  const sumNetSql = Number(
    (
      await db
        .select({ v: sql`COALESCE(SUM(${schema.orderItems.totalAmount}), 0)` })
        .from(schema.orderItems)
        .innerJoin(schema.orders, eq(schema.orderItems.orderId, schema.orders.id))
        .where(eq(schema.orders.id, ordDisc.orderId))
    )[0].v
  );

  ok(
    itemRow.discount === 100000 && sumNetSql === 900000 && itemRow.final === 900000,
    'R1.0 Dữ liệu vào đúng: 10 × 100.000 chiết khấu 10% ⇒ tiền thực thu 900.000',
    `subtotal=${itemRow.ordTotal}, discount=${itemRow.discount}, final=${itemRow.final}, ` +
      `unitSelling=${itemRow.sell}, total_amount=${itemRow.total}, SUM(total_amount)=${sumNetSql}`
  );

  const stNet = await RoyaltyService.royaltyStatement(cNet.contractId);
  const stCov = await RoyaltyService.royaltyStatement(cCov.contractId);

  ok(
    stNet.royaltyBasis === 'NET_SOLD' && stCov.royaltyBasis === 'COVER_PRICE',
    'R1.1 Cơ sở đúng như khai báo; hợp đồng KHÔNG truyền basis thì mặc định NET_SOLD',
    `mặc định=${stNet.royaltyBasis} ("${stNet.royaltyBasisLabel}"), HĐ giá bìa=${stCov.royaltyBasis} ("${stCov.royaltyBasisLabel}")`
  );

  ok(
    stNet.soldQty === QTY && stCov.soldQty === QTY,
    'R1.2 soldQty đếm từ SỔ KHO và bằng nhau ở cả hai cơ sở (10 cuốn)',
    `NET_SOLD=${stNet.soldQty}, COVER_PRICE=${stCov.soldQty}`
  );

  ok(
    stNet.coverRevenue === 1000000 && stCov.coverRevenue === 1000000,
    'R1.3 coverRevenue = lượng × giá bìa = 1.000.000 ở CẢ HAI cơ sở (không đổi)',
    `NET_SOLD=${stNet.coverRevenue}, COVER_PRICE=${stCov.coverRevenue}`
  );

  ok(
    stNet.basisRevenue === 900000,
    'R1.4 ★ basisRevenue theo NET_SOLD = 900.000 = SUM(order_items.total_amount), KHÔNG phải 1.000.000',
    `basisRevenue=${stNet.basisRevenue} (cần 900.000; nếu bằng 1.000.000 nghĩa là vẫn nhân giá bìa)`
  );

  ok(
    stCov.basisRevenue === 1000000,
    'R1.5 basisRevenue theo COVER_PRICE = 1.000.000 (giữ đúng hành vi cũ cho HĐ trả theo giá bìa)',
    `basisRevenue=${stCov.basisRevenue}`
  );

  const diffRevenue = stCov.basisRevenue - stNet.basisRevenue;
  ok(
    diffRevenue === 100000 && diffRevenue === Number(itemRow.discount),
    'R1.6 ★ Chênh lệch doanh thu đúng bằng TỔNG TIỀN CHIẾT KHẤU (100.000)',
    `cover - net = ${stCov.basisRevenue} - ${stNet.basisRevenue} = ${diffRevenue}; ` +
      `discountAmount trong DB = ${itemRow.discount}`
  );

  ok(
    stNet.accrued === 90000 && stCov.accrued === 100000 && stNet.accrued < stCov.accrued,
    'R1.7 ★ Royalty NET_SOLD (90.000) NHỎ HƠN royalty COVER_PRICE (100.000) — bằng chứng lỗi đã sửa',
    `accrued NET_SOLD=${stNet.accrued}, COVER_PRICE=${stCov.accrued}, chênh ${stCov.accrued - stNet.accrued} (= 10% × 100.000)`
  );

  ok(
    stNet.soldQtyUnpriced === 0,
    'R1.8 soldQtyUnpriced = 0: mọi cuốn bán đều bốc được giá từ dòng đơn',
    `soldQtyUnpriced=${stNet.soldQtyUnpriced}`
  );

  // 1.500.000 bán trong kỳ 2 của cùng hợp đồng: bảng kê là SỐ TÍCH LŨY, phải cộng
  // dồn chứ không tính riêng từng kỳ (không có chuyện "lệch so với kỳ trước").
  await OrderService.createOrder({
    warehouseId: WH, customerName: 'Khách kỳ 2',
    fiscalScope: 'OFFICIAL_TAX', cashierId: 'ROY-CASHIER',
    discountRate: DISCOUNT,
    items: [{ editionId: 'ed-d1', quantity: 15 }],
    idempotencyKey: 'roy-basis-disc-2',
  });
  const stNet2 = await RoyaltyService.royaltyStatement(cNet.contractId);
  ok(
    stNet2.soldQty === 25 && stNet2.basisRevenue === 2250000 && stNet2.accrued === 225000,
    'R1.9 Bảng kê CỘNG DỒN theo hạn hợp đồng, làm tròn MỘT LẦN ở cuối (25 cuốn ⇒ 225.000)',
    `soldQty=${stNet2.soldQty}, basisRevenue=${stNet2.basisRevenue} (cần 2.250.000), accrued=${stNet2.accrued} (cần 225.000)`
  );

  // ======================================================================
  // R2 — Không có chiết khấu thì hai cơ sở PHẢI BẰNG NHAU (chống hỏng âm thầm).
  // ======================================================================
  console.log('\n=== R2. Đơn KHÔNG chiết khấu: hai cơ sở phải cho cùng kết quả ===');
  const cPlain = await mkContract('ROY-HD-PLAIN', 'wk-plain', 0.1);
  await OrderService.createOrder({
    warehouseId: WH, customerName: 'Khách lẻ',
    fiscalScope: 'OFFICIAL_TAX', cashierId: 'ROY-CASHIER',
    items: [{ editionId: 'ed-p1', quantity: 7 }],
    idempotencyKey: 'roy-basis-plain-1',
  });
  const stPlain = await RoyaltyService.royaltyStatement(cPlain.contractId);
  ok(
    stPlain.basisRevenue === 560000 && stPlain.coverRevenue === 560000 && stPlain.accrued === 56000,
    'R2.1 Đơn giá bìa: NET_SOLD = COVER_PRICE = 560.000 (7 × 80.000)',
    `basisRevenue=${stPlain.basisRevenue}, coverRevenue=${stPlain.coverRevenue}, accrued=${stPlain.accrued}`
  );

  // ======================================================================
  // R3 — Bộ lọc phải khớp `OrderService.getSalesSummary`.
  // ======================================================================
  console.log('\n=== R3. Bộ lọc kênh SPONSORSHIP + trạng thái đơn ===');
  const cSpon = await mkContract('ROY-HD-SPON', 'wk-sponsor', 0.1);

  // Đơn tài trợ phải sinh qua `SponsorshipService.draw`, KHÔNG đẩy
  // `channel: 'SPONSORSHIP'` vào `OrderService.createOrder`. Agent pay (30/09)
  // đã chứng minh đường cũ là lỗ hổng: thu ngân gửi kênh SPONSORSHIP làm đơn
  // BIẾN MẤT khỏi doanh số và lách trọn guard ca két. Nay `createOrder` chặn
  // kênh này — và test này chính là bằng chứng cho thấy bất biến đó có thật.
  let blockedByGuard = false;
  try {
    await OrderService.createOrder({
      warehouseId: WH, customerName: 'Quỹ tài trợ',
      channel: 'SPONSORSHIP', fiscalScope: 'INTERNAL_MANAGEMENT', cashierId: 'ROY-CASHIER',
      items: [{ editionId: 'ed-s1', quantity: 3 }],
      idempotencyKey: 'roy-basis-sponsor-illegal',
    });
  } catch {
    blockedByGuard = true;
  }
  ok(
    blockedByGuard,
    'R3.0 createOrder CHẶN kênh SPONSORSHIP (đơn tài trợ chỉ sinh qua quỹ)'
  );

  const fundSpon = await SponsorshipService.createFund({
    sponsorName: 'Nhà tài trợ test royalty',
    amountReceived: 5_000_000,
    quotaType: 'CAPPED',
    quotaLimit: 5_000_000,
    createdBy: 'ROY-CASHIER',
  });
  await SponsorshipService.draw({
    fundId: fundSpon.fundId,
    editionId: 'ed-s1',
    warehouseId: WH,
    quantity: 3,
    drawnBy: 'ROY-CASHIER',
    idempotencyKey: 'roy-basis-sponsor-1',
  });

  const stSpon = await RoyaltyService.royaltyStatement(cSpon.contractId);
  const sponSummary = await OrderService.getSalesSummary({ channel: 'SPONSORSHIP' });
  const allSummary = await OrderService.getSalesSummary({});
  const sponOrders = (
    await db.select().from(schema.orders).where(eq(schema.orders.channel, 'SPONSORSHIP'))
  ).length;
  ok(
    stSpon.basisRevenue === 0 && stSpon.soldQty === 0 && sponSummary.totalOrders === sponOrders,
    'R3.1 ★ Đơn SPONSORSHIP không sinh nhuận bút, và getSalesSummary cũng loại (2 báo cáo khớp nhau)',
    `royalty: soldQty=${stSpon.soldQty}, basisRevenue=${stSpon.basisRevenue}; ` +
      `getSalesSummary(channel=SPONSORSHIP)=${sponSummary.totalOrders}/${sponOrders} đơn, ` +
      `getSalesSummary(mặc định)=${allSummary.totalOrders} đơn / ${allSummary.totalRevenue} đ (không chứa đơn tài trợ)`
  );

  // Đơn PENDING_CONFIRMATION chưa xuất kho ⇒ không có dòng DISPATCH_SALE ⇒
  // không được tính (đúng như getSalesSummary chỉ lấy COMPLETED).
  // Kho hội chợ không giữ chỗ đơn online nên dùng kho chính RETAIL_OFFICE.
  const cPend = await mkContract('ROY-HD-PEND', 'wk-plain', 0.1);
  const before = await RoyaltyService.royaltyStatement(cPend.contractId);
  await OrderService.createOrder({
    warehouseId: WH_MAIN, customerName: 'Khách chuyển khoản',
    channel: 'RETAIL_ONLINE_WEB', paymentMethod: 'BANK_TRANSFER',
    fiscalScope: 'OFFICIAL_TAX', cashierId: 'ROY-CASHIER',
    confirmImmediately: false,
    items: [{ editionId: 'ed-p1', quantity: 2 }],
    idempotencyKey: 'roy-basis-pending-1',
  });
  const afterPend = await RoyaltyService.royaltyStatement(cPend.contractId);
  const todayVn = vnDay(new Date().toISOString());
  const pendSummary = await OrderService.getSalesSummary({ startDate: todayVn, endDate: todayVn });
  ok(
    afterPend.soldQty === before.soldQty && afterPend.basisRevenue === before.basisRevenue,
    'R3.2 Đơn PENDING (chưa xuất kho) không cộng vào bảng kê — khớp getSalesSummary chỉ lấy COMPLETED',
    `trước soldQty=${before.soldQty}, sau=${afterPend.soldQty}; ` +
      `getSalesSummary hôm nay (${todayVn}) = ${pendSummary.totalOrders} đơn / ${pendSummary.totalRevenue} đ`
  );

  // ======================================================================
  // R4 — Lần bán trong sổ kho mà KHÔNG có dòng đơn (ký gửi): phải lấp bằng giá
  //      bìa (không trả ít hơn trước) và BÁO CÁO ra, không giấu.
  // ======================================================================
  console.log('\n=== R4. Bán ký gửi (không có đơn) — lấp giá bìa + đếm ra ===');
  await db.insert(schema.inventoryLedger).values({
    id: 'led-roy-consign-1', editionId: 'ed-p1', warehouseId: WH,
    eventType: 'CONSIGNMENT_SOLD', quantityDelta: -4, condition: 'NEW',
    documentRef: 'CS-ROY-1', actorId: 'ROY-CASHIER',
    idempotencyKey: 'roy-consign-1',
  } as any);
  const stConsign = await RoyaltyService.royaltyStatement(cPlain.contractId);
  ok(
    stConsign.soldQty === 11 && stConsign.soldQtyUnpriced === 4 && stConsign.basisRevenue === 880000,
    'R4.1 ★ 4 cuốn ký gửi không có dòng đơn: vẫn được trả theo giá bìa và ĐƯỢC ĐẾM RA',
    `soldQty=${stConsign.soldQty}, soldQtyUnpriced=${stConsign.soldQtyUnpriced}, ` +
      `basisRevenue=${stConsign.basisRevenue} (560.000 tiền thực thu + 320.000 lấp giá bìa = 880.000)`
  );
  ok(
    stConsign.accrued === 88000,
    'R4.2 Tác giả không bị trả ít hơn hành vi cũ vì bán ký gửi',
    `accrued=${stConsign.accrued} (cần 88.000)`
  );

  // ======================================================================
  // R5 — Biên ngày hợp đồng: 3 mốc UTC quanh NGÀY HẾT HẠN, cả hai cơ sở.
  // ======================================================================
  console.log('\n=== R5. Biên ngày hết hạn (ngày VN vs mốc UTC) ===');
  // HĐ riêng cho biên: hạn 01/12/2026 → 31/12/2026, giá bìa cao để thấy rõ.
  await db.insert(schema.editions).values({
    id: 'ed-edge', code: 'ROY-EDGE', workId: 'wk-plain', isbn: '9780000001004',
    isbnLast4: '1004', coverPrice: 200000, isActive: true,
  } as any);
  const cEdgeNet = await RoyaltyService.createContract({
    contractNumber: 'ROY-HD-EDGE-NET', workId: 'wk-plain', licensorName: 'Tác giả biên',
    royaltyRate: 0.1, printQuota: 100000, effectiveDate: '2026-12-01', expirationDate: '2026-12-31',
    createdBy: 'QL-01',
  });
  const cEdgeCov = await RoyaltyService.createContract({
    contractNumber: 'ROY-HD-EDGE-COV', workId: 'wk-plain', licensorName: 'Tác giả biên',
    royaltyRate: 0.1, printQuota: 100000, effectiveDate: '2026-12-01', expirationDate: '2026-12-31',
    createdBy: 'QL-01', royaltyBasis: 'COVER_PRICE',
  });
  // Ba mốc: 22:00 VN hôm trước (ngày UTC khác), 03:00 VN 31/12 (ngày UTC khác),
  // 23:30 VN 31/12 (cùng ngày UTC, giờ muộn). Mỗi mốc 2 cuốn, có dòng đơn thật
  // để NET_SOLD bốc được giá (chiết khấu 20% ⇒ 160.000/cuốn).
  const edgeMarks = ['2026-12-30T15:00:00.000Z', '2026-12-30T20:00:00.000Z', '2026-12-31T16:30:00.000Z'];
  for (let i = 0; i < edgeMarks.length; i++) {
    const ts = edgeMarks[i];
    const oid = `ord-roy-edge-${i}`;
    await db.insert(schema.orders).values({
      id: oid, orderCode: `ROY-EDGE-${i}`, idempotencyKey: `roy-edge-ord-${i}`,
      warehouseId: WH, cashierId: 'ROY-CASHIER', status: 'COMPLETED',
      channel: 'FAIR_EVENT', fiscalScope: 'OFFICIAL_TAX',
      subtotal: 400000, discountRate: 0.2, discountAmount: 80000, finalAmount: 320000,
      createdAt: ts,
    } as any);
    await db.insert(schema.orderItems).values({
      id: `oi-roy-edge-${i}`, orderId: oid, editionId: 'ed-edge', productId: 'ed-edge', quantity: 2,
      unitCoverPrice: 200000, unitDiscountRate: 0.2, unitSellingPrice: 160000, totalAmount: 320000,
    } as any);
    await db.insert(schema.inventoryLedger).values({
      id: `led-roy-edge-${i}`, editionId: 'ed-edge', warehouseId: WH,
      eventType: 'DISPATCH_SALE', quantityDelta: -2, condition: 'NEW',
      documentRef: `ROY-EDGE-${i}`, actorId: 'ROY-CASHIER',
      correlationId: oid, idempotencyKey: `roy-edge-led-${i}`, recordedAt: ts,
    } as any);
  }
  const stEdgeNet = await RoyaltyService.royaltyStatement(cEdgeNet.contractId);
  const stEdgeCov = await RoyaltyService.royaltyStatement(cEdgeCov.contractId);
  ok(
    stEdgeNet.soldQty === 6 && stEdgeCov.soldQty === 6,
    'R5.1 Ngày hết hạn phải tính trọn cả 3 mốc (có mốc lệch 7 tiếng về ngày UTC) — 6 cuốn',
    `NET_SOLD soldQty=${stEdgeNet.soldQty}, COVER_PRICE soldQty=${stEdgeCov.soldQty} (cần 6)`
  );
  ok(
    stEdgeNet.basisRevenue === 960000 && stEdgeCov.basisRevenue === 1200000,
    'R5.2 Doanh thu biên: NET_SOLD 960.000 (3 × 2 × 160.000) vs COVER_PRICE 1.200.000',
    `NET_SOLD=${stEdgeNet.basisRevenue} (cần 960.000), COVER_PRICE=${stEdgeCov.basisRevenue} (cần 1.200.000)`
  );

  // Ngoài hạn: 100 cuốn ở 31/12 UTC = 08:00 VN 01/01/2027 ⇒ phải bị loại.
  await db.insert(schema.orders).values({
    id: 'ord-roy-edge-out', orderCode: 'ROY-EDGE-OUT', idempotencyKey: 'roy-edge-out-ord',
    warehouseId: WH, cashierId: 'ROY-CASHIER', status: 'COMPLETED',
    channel: 'FAIR_EVENT', fiscalScope: 'OFFICIAL_TAX',
    subtotal: 20000000, discountRate: 0, discountAmount: 0, finalAmount: 20000000,
    createdAt: '2026-12-31T17:00:00.000Z',
  } as any);
  await db.insert(schema.orderItems).values({
    id: 'oi-roy-edge-out', orderId: 'ord-roy-edge-out', editionId: 'ed-edge', productId: 'ed-edge', quantity: 100,
    unitCoverPrice: 200000, unitDiscountRate: 0, unitSellingPrice: 200000, totalAmount: 20000000,
  } as any);
  await db.insert(schema.inventoryLedger).values({
    id: 'led-roy-edge-out', editionId: 'ed-edge', warehouseId: WH,
    eventType: 'DISPATCH_SALE', quantityDelta: -100, condition: 'NEW',
    documentRef: 'ROY-EDGE-OUT', actorId: 'ROY-CASHIER',
    correlationId: 'ord-roy-edge-out', idempotencyKey: 'roy-edge-out-led',
    recordedAt: '2026-12-31T17:00:00.000Z',
  } as any);
  const stEdgeOut = await RoyaltyService.royaltyStatement(cEdgeNet.contractId);
  ok(
    stEdgeOut.soldQty === 6 && stEdgeOut.basisRevenue === 960000,
    'R5.3 Bán NGOÀI hạn (100 cuốn lúc 08:00 VN 01/01/2027) bị loại khỏi cả hai cơ sở',
    `soldQty=${stEdgeOut.soldQty} (cần 6), basisRevenue=${stEdgeOut.basisRevenue} (cần 960.000)`
  );

  // ======================================================================
  // R6 — Tạm ứng & hợp đồng rỗng: không NaN, không âm.
  // ======================================================================
  console.log('\n=== R6. Tạm ứng, hợp đồng rỗng, tác phẩm chưa có ấn bản ===');
  const cAdv = await RoyaltyService.createContract({
    contractNumber: 'ROY-HD-ADV', workId: 'wk-plain', licensorName: 'Tác giả tạm ứng lớn',
    royaltyRate: 0.1, printQuota: 100000, advanceAmount: 999999999,
    effectiveDate: TERM_FROM, expirationDate: TERM_TO, createdBy: 'QL-01',
  });
  const stAdv = await RoyaltyService.royaltyStatement(cAdv.contractId);
  ok(
    stAdv.payable === 0 && Number.isFinite(stAdv.payable) && Number.isFinite(stAdv.accrued),
    'R6.1 Tạm ứng vượt phát sinh ⇒ payable = 0 (không âm, không NaN)',
    `accrued=${stAdv.accrued}, advance=${stAdv.advanceAmount}, payable=${stAdv.payable}`
  );

  await db.insert(schema.works).values({
    id: 'wk-empty', code: 'ROY-EMPTY', title: 'Tác phẩm rỗng', author: 'x', isActive: true,
  });
  const cEmpty = await RoyaltyService.createContract({
    contractNumber: 'ROY-HD-EMPTY', workId: 'wk-empty', licensorName: 'Tác giả rỗng',
    royaltyRate: 0.1, printQuota: 100, effectiveDate: TERM_FROM, expirationDate: TERM_TO,
    createdBy: 'QL-01',
  });
  const stEmpty = await RoyaltyService.royaltyStatement(cEmpty.contractId);
  ok(
    stEmpty.soldQty === 0 && stEmpty.basisRevenue === 0 && stEmpty.accrued === 0 && stEmpty.payable === 0,
    'R6.2 Tác phẩm chưa có ấn bản: 0/0/0/0, không NaN',
    `soldQty=${stEmpty.soldQty}, basisRevenue=${stEmpty.basisRevenue}, accrued=${stEmpty.accrued}, payable=${stEmpty.payable}`
  );

  // ======================================================================
  // R7 — royalty_rate hỏng trong DB: phải BÁO LỖI, không trả NaN ra bảng kê.
  // ======================================================================
  console.log('\n=== R7. royalty_rate hỏng trong DB (0 / âm / ≥1 / khổng lồ) ===');
  // NaN không lưu được vào cột REAL của SQLite (libsql ném RangeError lúc
  // INSERT), nên ca hỏng thật sự trong DB là giá trị HỮU HẠN ngoài (0,1) —
  // 1e308 sẽ làm phát sinh nhuận bút vô cùng. `Number.isFinite` trong guard vẫn
  // giữ để chắc chắn nếu sau này đổi nguồn dữ liệu.
  const badRates = [
    { label: 'rate=0', value: 0 },
    { label: 'rate=1.5', value: 1.5 },
    { label: 'rate=-0.1', value: -0.1 },
    { label: 'rate=1e308', value: 1e308 },
  ];
  for (let bi = 0; bi < badRates.length; bi++) {
    const label = badRates[bi].label;
    const badRate = badRates[bi].value;
    const cid = `ROY-HD-BAD-${label.replace(/[^a-z0-9]/gi, '')}`;
    await db.insert(schema.rightsContracts).values({
      id: cid, contractNumber: cid, workId: 'wk-plain', royaltyRate: badRate,
      printQuota: 100, advanceAmount: 0, royaltyBasis: 'NET_SOLD',
      effectiveDate: TERM_FROM, expirationDate: TERM_TO, terminated: false, createdBy: 'x',
    } as any);
    let threw = false;
    let msg = '';
    try {
      await RoyaltyService.royaltyStatement(cid);
    } catch (e: any) {
      threw = true;
      msg = e?.message || String(e);
    }
    ok(
      threw && /royalty_rate/.test(msg),
      `R7 ${label}: royaltyStatement BÁO LỖI thay vì trả NaN ra bảng kê`,
      threw ? `lỗi: ${msg.slice(0, 90)}` : 'KHÔNG ném lỗi — sẽ in NaN lên bảng kê'
    );
  }
  // createContract vẫn chặn lúc ghi như cũ.
  let rejectRate = false;
  let rejectNaN = false;
  try {
    await RoyaltyService.createContract({
      contractNumber: 'ROY-BAD-RATE', workId: 'wk-plain', royaltyRate: 1.5,
      printQuota: 100, effectiveDate: TERM_FROM, expirationDate: TERM_TO, createdBy: 'x',
    });
  } catch { rejectRate = true; }
  try {
    await RoyaltyService.createContract({
      contractNumber: 'ROY-BAD-RATE-NAN', workId: 'wk-plain', royaltyRate: Number('abc'),
      printQuota: 100, effectiveDate: TERM_FROM, expirationDate: TERM_TO, createdBy: 'x',
    });
  } catch { rejectNaN = true; }
  let rejectBasis = false;
  try {
    await RoyaltyService.createContract({
      contractNumber: 'ROY-BAD-BASIS', workId: 'wk-plain', royaltyRate: 0.1,
      printQuota: 100, effectiveDate: TERM_FROM, expirationDate: TERM_TO,
      createdBy: 'x', royaltyBasis: 'GIA_BIA' as any,
    });
  } catch { rejectBasis = true; }
  ok(
    rejectRate && rejectNaN && rejectBasis,
    'R7.5 createContract vẫn chặn rate sai, rate NaN và royalty_basis lạ lúc KÝ HĐ',
    `rate=1.5 bị chặn=${rejectRate}, rate=NaN bị chặn=${rejectNaN}, basis lạ bị chặn=${rejectBasis}`
  );

  // ======================================================================
  // R8 — Bảng kê tự đối chiếu: tổng các dòng khớp tổng báo cáo, và khớp SQL.
  // ======================================================================
  console.log('\n=== R8. Tự đối chiếu (khớp SQL độc lập) ===');
  const netSqlAll = Number(
    (
      await db
        .select({
          v: sql`COALESCE(SUM(${schema.orderItems.totalAmount}), 0)`,
        })
        .from(schema.orderItems)
        .innerJoin(schema.orders, eq(schema.orderItems.orderId, schema.orders.id))
        .where(sql`${schema.orders.status} = 'COMPLETED' AND ${schema.orders.channel} != 'SPONSORSHIP'`)
    )[0].v
  );
  const stNetFinal = await RoyaltyService.royaltyStatement(cNet.contractId);
  const sumExpectedNet = 900000 + 1350000; // 10 + 15 cuốn, chiết khấu 10%
  ok(
    stNetFinal.basisRevenue === sumExpectedNet && netSqlAll >= sumExpectedNet,
    'R8.1 basisRevenue NET_SOLD khớp tổng chiết khấu tay tính VÀ không vượt tổng SQL',
    `service=${stNetFinal.basisRevenue}, tay tính=${sumExpectedNet}, tổng SQL mọi đơn COMPLETED (kể cả ngoài HĐ)=${netSqlAll}`
  );
  ok(
    stNetFinal.coverRevenue === 2500000 &&
      stNetFinal.coverRevenue - stNetFinal.basisRevenue === 250000,
    'R8.2 Chênh lệch cover − net bằng đúng tổng chiết khấu của các đơn trong HĐ (250.000)',
    `cover=${stNetFinal.coverRevenue}, net=${stNetFinal.basisRevenue}, chênh=${stNetFinal.coverRevenue - stNetFinal.basisRevenue}`
  );
  ok(
    stNetFinal.payable === Math.max(0, stNetFinal.accrued - stNetFinal.advanceAmount) &&
      stNetFinal.accrued === Math.round(stNetFinal.basisRevenue * stNetFinal.royaltyRate),
    'R8.3 payable = max(0, accrued − tạm ứng); accrued = làm tròn MỘT LẦN ở cuối',
    `accrued=${stNetFinal.accrued} = round(${stNetFinal.basisRevenue} × ${stNetFinal.royaltyRate}), ` +
      `advance=${stNetFinal.advanceAmount}, payable=${stNetFinal.payable}`
  );

  // Cùng dữ liệu → cùng con số (bảng kê là hàm thuần của dữ liệu, không tích lũy
  // trạng thái nên không thể "lệch so với kỳ trước").
  const stRepeat = await RoyaltyService.royaltyStatement(cNet.contractId);
  ok(
    JSON.stringify(stRepeat) === JSON.stringify(stNetFinal),
    'R8.4 Gọi lại trên cùng dữ liệu cho ĐÚNG Y HỆT — không tích lũy, không lệch kỳ',
    `accrued lần 1=${stNetFinal.accrued}, lần 2=${stRepeat.accrued}`
  );

  // R8.5 — RANH GIỚI API: `GET /api/royalties?id=` bọc nguyên statement trong
  // `{success, data:{quota, statement}}`. Nếu đổi tên field, JSON đóng gói ở
  // route sẽ âm thầm mất ⇒ kiểm đúng chỗ hành vi nằm ở, không kiểm lại service.
  const apiShape = (await RoyaltyService.royaltyStatement(cNet.contractId)) as any;
  const apiPayload = { success: true, data: { quota: null, statement: apiShape } };
  const wire = JSON.parse(JSON.stringify(apiPayload));
  ok(
    wire.data.statement.royaltyBasis === 'NET_SOLD' &&
      typeof wire.data.statement.royaltyBasisLabel === 'string' &&
      wire.data.statement.royaltyBasisLabel.length > 0 &&
      typeof wire.data.statement.basisRevenue === 'number' &&
      typeof wire.data.statement.soldQtyUnpriced === 'number' &&
      typeof wire.data.statement.coverRevenue === 'number',
    'R8.5 ★ Cơ sở + nhãn tiếng Việt đi được qua JSON tới client (header bảng in có dán được)',
    `royaltyBasis=${wire.data.statement.royaltyBasis}, ` +
      `royaltyBasisLabel="${wire.data.statement.royaltyBasisLabel}", ` +
      `basisRevenue=${wire.data.statement.basisRevenue}, coverRevenue=${wire.data.statement.coverRevenue}, ` +
      `soldQtyUnpriced=${wire.data.statement.soldQtyUnpriced}`
  );
  ok(
    ROYALTY_BASIS_LABEL.NET_SOLD.includes('chiết khấu') &&
      ROYALTY_BASIS_OPTIONS.length === 2 &&
      ROYALTY_BASES.includes('COVER_PRICE'),
    'R8.6 Nhãn tiếng Việt CÓ DẤU nói đúng cơ sở (không phải mã kỹ thuật)',
    `NET_SOLD="${ROYALTY_BASIS_LABEL.NET_SOLD}", COVER_PRICE="${ROYALTY_BASIS_LABEL.COVER_PRICE}", ` +
      `options=${ROYALTY_BASIS_OPTIONS.length}`
  );

  // ======================================================================
  // R9 — MIGRATION 0030: phải chạy được trên DB CÓ DỮ LIỆU CŨ (nâng cấp),
  //      và hợp đồng cũ phải nhận mặc định NET_SOLD chứ không phải NULL.
  //      Đây là đường đi thật của production, không phải DB dựng mới.
  // ======================================================================
  console.log('\n=== R9. Migration 0030 trên DB nâng cấp (có HĐ cũ) ===');
  const upgradeFile = path.resolve(process.cwd(), 'formapubli_test_royalty_upgrade.db');
  for (const s of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(upgradeFile + s); } catch { /* chưa có */ }
  }
  const upgradeUrl = 'file:' + upgradeFile.split(path.sep).join('/');
  // Dựng DB ở đúng trạng thái TRƯỚC khi có 0030 (journal tới 0029).
  const journalRaw = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'src/db/migrations/meta/_journal.json'), 'utf-8')
  );
  const upTo29 = journalRaw.entries.filter((e: any) => e.idx <= 29).sort((a: any, b: any) => a.idx - b.idx);
  const upClient = createClient({ url: upgradeUrl });
  for (const e of upTo29) {
    const raw = fs.readFileSync(
      path.resolve(process.cwd(), 'src/db/migrations', `${e.tag}.sql`), 'utf-8');
    for (const chunk of raw.split('--> statement-breakpoint')) {
      const stmt = stripToExecutable(chunk);
      if (stmt) await upClient.execute(stmt);
    }
  }
  // Dữ liệu CŨ: 1 hợp đồng và 1 tác phẩm, tạo TRƯỚC khi có cột royalty_basis.
  await upClient.execute(
    `INSERT INTO works (id, code, title, author) VALUES ('wk-old', 'ROY-OLD', 'Tác phẩm cũ', 'Tác giả cũ')`
  );
  await upClient.execute(
    `INSERT INTO rights_contracts
       (id, contract_number, work_id, royalty_rate, print_quota, advance_amount,
        effective_date, expiration_date, terminated, created_by)
     VALUES ('RC-OLD', 'ROY-HD-OLD', 'wk-old', 0.1, 1000, 0, '2020-01-01', '2099-12-31', 0, 'x')`
  );
  // Chạy đúng file migration 0030 như production sẽ chạy.
  const mig30 = fs.readFileSync(
    path.resolve(process.cwd(), 'src/db/migrations/0030_royalty_basis.sql'), 'utf-8');
  for (const chunk of mig30.split('--> statement-breakpoint')) {
    const stmt = stripToExecutable(chunk);
    if (stmt) await upClient.execute(stmt);
  }
  const cols30 = (
    await upClient.execute(`PRAGMA table_info(rights_contracts)`)
  ).rows.map((r: any) => r.name);
  const oldRow = (
    await upClient.execute(
      `SELECT royalty_basis, royalty_rate FROM rights_contracts WHERE id = 'RC-OLD'`
    )
  ).rows[0] as any;
  const nullBasis = Number(
    (
      await upClient.execute(
        `SELECT COUNT(*) AS n FROM rights_contracts WHERE royalty_basis IS NULL`
      )
    ).rows[0]?.n ?? 0
  );
  upClient.close();
  ok(
    cols30.includes('royalty_basis'),
    'R9.1 Migration 0030 chạy được trên DB CÓ DỮ LIỆU CŨ (không phải chỉ DB dựng mới)',
    `độ dài ${cols30.length} cột; có royalty_basis=${cols30.includes('royalty_basis')}`
  );
  ok(
    oldRow?.royalty_basis === 'NET_SOLD' && nullBasis === 0,
    'R9.2 ★ Hợp đồng CŨ tự nhận mặc định NET_SOLD (không NULL ⇒ không ra NaN trên bảng kê)',
    `RC-OLD.royalty_basis="${oldRow?.royalty_basis}", số HĐ NULL=${nullBasis}`
  );
  ok(
    journalRaw.entries.some((e: any) => e.tag === '0030_royalty_basis') &&
      journalRaw.entries.every(
        (e: any, i: number, arr: any[]) => i === 0 || arr[i - 1].when < e.when
      ),
    'R9.3 Journal: entry 0030 có mặt và `when` TĂNG nghiêm ngặt (drizzle bỏ qua entry lùi)',
    `tags cuối=${journalRaw.entries.slice(-2).map((e: any) => `${e.tag}@${e.when}`).join(', ')}`
  );

  // ======================================================================
  console.log('\n========================================================');
  console.log(`KẾT QUẢ: ${checks - failures}/${checks} assertion đạt.`);
  if (failures > 0) {
    console.error(`❌ ${failures} assertion ĐỎ.`);
    process.exit(1);
  }
  console.log('🎉 Công thức nhuận bút theo cơ sở tiền: ĐẠT 100%.');
  console.log('========================================================\n');
}

run().catch((err) => {
  console.error('❌ test-royalty-basis thất bại:', err);
  process.exit(1);
});
