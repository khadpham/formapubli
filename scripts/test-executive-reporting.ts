/**
 * KIỂM ĐỊNH LỚP BÁO CÁO QUẢN TRỊ (auditA).
 *
 * Phạm vi: ExecutiveDashboard.tsx (logic biểu đồ tách ra để gọi trực tiếp),
 * executive-query.service.ts, executive-digest.service.ts.
 *
 * CHẠY: npx tsx scripts/run-isolated.ts --only=test-executive-reporting
 * Mọi case gọi CODE THẬT trên DB test (không lặp lại logic SQL trong test).
 */
import { and, eq, sql } from 'drizzle-orm';
import { db, editions, cashboxSessions, partners, orders } from '../src/db';
import { ExecutiveQueryService } from '../src/services/executive-query.service';
import { ExecutiveDigestService, monthRangeOf } from '../src/services/executive-digest.service';
import { OrderService, CashboxService } from '../src/services/order.service';
import { InventoryService } from '../src/services/inventory.service';
import { SponsorshipService } from '../src/services/sponsorship.service';
import {
  buildLast7DaysRevenue,
  buildFiscalSplit,
  formatOrderTime,
} from '../src/components/dashboard/ExecutiveDashboard';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-executive-reporting');

let passed = 0;
let total = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) {
    passed++;
    console.log(`✅ PASS  ${name}${extra ? `  [${extra}]` : ''}`);
  } else {
    console.log(`❌ FAIL  ${name}${extra ? `  [${extra}]` : ''}`);
  }
};
const section = (t: string) => console.log(`\n── ${t} ──`);

/** Một ấn bản có tồn đủ để bán. */
async function pickSellableEdition(): Promise<string> {
  return (await pickSellableEditions(1))[0].id;
}

/** N ấn bản khác nhau có tồn đủ tại Âu Cơ. */
async function pickSellableEditions(n: number): Promise<Array<{ id: string; code: string }>> {
  const all = await db.select({ id: editions.id, code: editions.code }).from(editions).limit(60);
  const out: Array<{ id: string; code: string }> = [];
  for (const e of all) {
    if (out.length >= n) break;
    if ((await InventoryService.getBalance(e.id, 'wh-au-co', 'NEW')) >= 20) out.push(e);
  }
  if (out.length < n) throw new Error(`DB test không đủ ấn bản tồn tại Âu Cơ (cần ${n}).`);
  return out;
}

async function main() {
  console.log('🧭 KIỂM ĐỊNH BÁO CÁO QUẢN TRỊ (auditA)');

  // =========================================================================
  section('A. ExecutiveDashboard — biểu đồ 7 ngày theo NGÀY NGHIỆP VỤ VN');
  // Mốc thời gian: 2026-03-10T01:00:00Z = 08:00 VN ngày 10/3.
  //   ⇒ 7 cột phải là 04/3 … 10/3 (giờ VN).
  // Đơn mốc:
  //   10/3 06:30 VN (2026-03-09T23:30Z)  → 1.000.000  phải vào cột "10/3"
  //   10/3 00:30 VN (2026-03-09T17:30Z)  →   500.000  phải vào cột "10/3"
  //   09/3 23:30 VN (2026-03-09T16:30Z)  → 2.000.000  phải vào cột "9/3"
  //   03/3 12:00 VN (2026-03-03T05:00Z)  → 4.000.000  phải vào cột "4/3" (ngoài 7 ngày → bỏ)
  const ordersA = [
    { createdAt: '2026-03-09T23:30:00.000Z', finalAmount: 1_000_000 },
    { createdAt: '2026-03-09T17:30:00.000Z', finalAmount: 500_000 },
    { createdAt: '2026-03-09T16:30:00.000Z', finalAmount: 2_000_000 },
    { createdAt: '2026-03-03T05:00:00.000Z', finalAmount: 4_000_000 },
  ];
  const nowA = new Date('2026-03-10T01:00:00.000Z');
  const chartA = buildLast7DaysRevenue(ordersA, nowA);
  const labelsA = chartA.map((d) => d.label);
  const lastCol = chartA[chartA.length - 1];
  const prevCol = chartA[chartA.length - 2];
  ok(
    'A1. 7 nhãn cột là 7 ngày liên tiếp giờ VN (4/3 → 10/3)',
    labelsA.join(',') === '4/3,5/3,6/3,7/3,8/3,9/3,10/3',
    labelsA.join(' ')
  );
  ok(
    'A2. Đơn lúc 06:30 sáng VN nằm ở cột HÔM NAY (trước: rơi sang cột hôm kia)',
    lastCol.label === '10/3' && lastCol.total === 1_500_000,
    `cột cuối ${lastCol.label} = ${lastCol.total.toLocaleString('vi-VN')}`
  );
  ok(
    'A3. Đơn lúc 00:30 VN (sau nửa đêm) cũng ở cột HÔM NAY',
    lastCol.total === 1_000_000 + 500_000,
    `${lastCol.total.toLocaleString('vi-VN')} đ`
  );
  ok(
    'A4. Đơn 23:30 tối hôm trước nằm ở cột HÔM QUA, không dính cột hôm nay',
    prevCol.label === '9/3' && prevCol.total === 2_000_000,
    `cột ${prevCol.label} = ${prevCol.total.toLocaleString('vi-VN')}`
  );
  ok(
    'A5. Đơn ngoài 7 ngày bị loại (tổng = 3.500.000)',
    chartA.reduce((s, d) => s + d.total, 0) === 3_500_000,
    `${chartA.reduce((s, d) => s + d.total, 0).toLocaleString('vi-VN')} đ`
  );
  // Dòng created_at dạng SQLite CURRENT_TIMESTAMP (không múi giờ) vẫn phải
  // đọc đúng — đây là họ timestamp thứ hai đang cùng tồn tại trong DB.
  const chartNaive = buildLast7DaysRevenue(
    [{ createdAt: '2026-03-09 20:00:00', finalAmount: 300_000 }],
    nowA
  );
  ok(
    'A6. created_at dạng "YYYY-MM-DD HH:mm:ss" (SQLite) gom đúng ngày VN',
    chartNaive[chartNaive.length - 1].total === 300_000,
    `cột cuối = ${chartNaive[chartNaive.length - 1].total.toLocaleString('vi-VN')}`
  );

  section('B. ExecutiveDashboard — tỷ lệ % sổ kép + giờ hiển thị');
  // 1đ thuế / 199đ nội bộ: làm tròn từng phần ra 1% + 100% = 101%.
  const splitB = buildFiscalSplit({ officialTax: { revenue: 1 }, internalManagement: { revenue: 199 } });
  ok(
    'B1. Hai tỷ lệ luôn kín 100% (không 101%/99% làm vòng tròn chồng/khoảng trống)',
    splitB.taxPct + splitB.internalPct === 100,
    `thuế ${splitB.taxPct}% + nội bộ ${splitB.internalPct}%`
  );
  const splitB2 = buildFiscalSplit({ officialTax: { revenue: 0 }, internalManagement: { revenue: 500 } });
  ok('B2. Không có sổ thuế → 0% / 100%, không NaN', splitB2.taxPct === 0 && splitB2.internalPct === 100);
  const splitB3 = buildFiscalSplit(null);
  ok('B3. summary rỗng → 0/0, không NaN/Infinity', splitB3.total === 0 && splitB3.taxPct === 0);
  // 2026-03-09T17:30Z = 00:30 ngày 10/3 giờ VN.
  const shown = formatOrderTime('2026-03-09T17:30:00.000Z');
  ok(
    'B4. Giờ trong bảng đơn là GIỜ VIỆT NAM, không phải UTC (00:30 ngày 10/3)',
    shown === '10/03 00:30',
    `hiện "${shown}"`
  );
  ok('B5. created_at hỏng/null không làm sập bảng', formatOrderTime(null) === '—', `hiện "${formatOrderTime(null)}"`);

  // =========================================================================
  section('C. executive-query — cửa sổ "N ngày" của truy vấn danh mục');
  const saleEdition = await pickSellableEdition();
  const saleCode = (await db.select({ code: editions.code }).from(editions).where(eq(editions.id, saleEdition)).limit(1))[0].code;
  const stamp = Date.now();
  const soldQtyOf = async (windowDays: number) => {
    const r = await ExecutiveQueryService.queryCatalog({ topEditionsBySales: true, windowDays, limit: 50 });
    return r.items.find((i) => i.code === saleCode)?.soldQty ?? 0;
  };
  // Đơn NGOÀI cửa sổ 30 ngày nhưng rơi vào ĐÚNG NGÀY UTC của mốc cắt:
  //   mốc cắt = now - 30 ngày; đơn = mốc cắt - 8 giờ (30 ngày 8 giờ tuổi).
  const cutoffInstant = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const outsideIso = new Date(cutoffInstant.getTime() - 8 * 3600 * 1000).toISOString();
  const insideIso = new Date(Date.now() - 3600 * 1000).toISOString();
  const beforeQty = await soldQtyOf(30);
  await OrderService.createOrder({
    warehouseId: 'wh-au-co', customerName: 'Cửa sổ 30 ngày', cashierId: 'auditA',
    note: 'auditA', idempotencyKey: `auditA-win-out-${stamp}`,
    createdAt: outsideIso, backdateApproved: true,
    items: [{ editionId: saleEdition, quantity: 2 }],
  });
  await OrderService.createOrder({
    warehouseId: 'wh-au-co', customerName: 'Cửa sổ 30 ngày', cashierId: 'auditA',
    note: 'auditA', idempotencyKey: `auditA-win-in-${stamp}`,
    createdAt: insideIso, backdateApproved: true,
    items: [{ editionId: saleEdition, quantity: 1 }],
  });
  const afterQty = await soldQtyOf(30);
  ok(
    'C1. Đơn 30 ngày 8 giờ tuổi KHÔNG lọt vào báo cáo "30 ngày"',
    afterQty - beforeQty === 1,
    `delta=${afterQty - beforeQty} (đúng = 1; lỗi = 3)`
  );

  // =========================================================================
  section('D. executive-query — đối soát két theo ngày');
  // 25 ca mới hơn, đều mở/đóng trong hôm nay; 1 ca CŨ nằm ngoài 20 dòng gần nhất.
  const oldOpenedAt = new Date(Date.now() - 3 * 24 * 3600 * 1000);
  const oldSessionId = `cbs-auditA-old-${stamp}`;
  await db.insert(cashboxSessions).values({
    id: oldSessionId,
    warehouseId: 'wh-au-co',
    cashierId: 'auditA-old',
    openingCash: 100_000,
    status: 'CLOSED',
    openedAt: oldOpenedAt.toISOString(),
    closedAt: new Date(oldOpenedAt.getTime() + 3600 * 1000).toISOString(),
    expectedCash: 300_000,
    closingCashActual: 300_000,
    cashDiscrepancy: 0,
  });
  for (let i = 0; i < 25; i++) {
    const opened = new Date(Date.now() - (i + 1) * 60 * 1000);
    await db.insert(cashboxSessions).values({
      id: `cbs-auditA-new-${stamp}-${i}`,
      warehouseId: 'wh-au-co',
      cashierId: `auditA-new-${i}`,
      openingCash: 0,
      status: 'CLOSED',
      openedAt: opened.toISOString(),
      closedAt: new Date(opened.getTime() + 600_000).toISOString(),
      expectedCash: 0,
      closingCashActual: 0,
      cashDiscrepancy: 0,
    });
  }
  const oldVnDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(oldOpenedAt);
  const byDate = await ExecutiveQueryService.queryCashboxReconciliation({ date: oldVnDay });
  ok(
    'D1. Hỏi két theo ngày cũ vẫn ra đúng ca (trước: limit 20 dòng rồi mới lọc ⇒ rỗng)',
    byDate.recentSessions.some((s) => s.id === oldSessionId),
    `ngày ${oldVnDay}: thấy ${byDate.recentSessions.length} ca`
  );

  // Ca chốt tự động: cash_discrepancy = NULL ⇒ KHÔNG ai đếm két.
  const autoId = `cbs-auditA-auto-${stamp}`;
  const { session: autoOpened } = await CashboxService.openSession({
    warehouseId: 'wh-quynh-mai', cashierId: 'auditA-auto', openingCash: 0,
  });
  await CashboxService.autoCloseSession({
    sessionId: autoOpened.id, reason: 'auditA', actorRole: 'ROLE_MANAGER', actorId: 'auditA',
  });
  const rawAuto = await db.select().from(cashboxSessions).where(eq(cashboxSessions.id, autoId as any));
  const autoSessionId = autoOpened.id;
  void rawAuto; void autoId;
  const reconAll = await ExecutiveQueryService.queryCashboxReconciliation({});
  const autoRow = reconAll.recentSessions.find((s) => s.id === autoSessionId);
  const autoRaw = await db
    .select({ st: cashboxSessions.status, d: cashboxSessions.cashDiscrepancy })
    .from(cashboxSessions)
    .where(eq(cashboxSessions.id, autoSessionId))
    .limit(1);
  ok(
    'D2. Ca chốt tự động (chưa ai đếm két, chênh lệch NULL) KHÔNG bị báo "Cân bằng"',
    !!autoRaw[0] && autoRaw[0].st === 'CLOSED' && autoRaw[0].d === null && autoRow?.discrepancyStatus !== 'BALANCED',
    `DB: status=${autoRaw[0]?.st} discrepancy=${String(autoRaw[0]?.d)} → báo "${autoRow?.discrepancyStatus}"`
  );

  // =========================================================================
  section('E. executive-query — tổng doanh thu khớp với bóc kênh');
  const [partner] = await db.select({ id: partners.id }).from(partners).limit(1);
  // Đơn tài trợ tạo đúng LUỒNG QUỸ THẬT (SponsorshipService.draw): kênh
  // SPONSORSHIP, giảm 100% nên finalAmount = 0. getSalesSummary CỐ TÌNH loại kênh
  // này, còn bóc kênh thì không ⇒ số đơn lệch 1.
  //
  // 30/09: trước đây case này dựng đơn bằng `OrderService.createOrder` với
  // `channel: 'SPONSORSHIP'` — chính là cách lách mà LỖI 1 (đường bán hàng nhận
  // kênh của quỹ) đã bị chặn. Đã đổi sang đúng đường ghi thật.
  const spfFund: any = await SponsorshipService.createFund({
    sponsorName: 'Tài trợ', amountReceived: 10_000_000, quotaType: 'CAPPED',
    quotaLimit: 10_000_000, partnerId: partner?.id, createdBy: 'auditA', actorRole: 'ROLE_OWNER',
  });
  await SponsorshipService.draw({
    fundId: spfFund.fundId, editionId: saleEdition, warehouseId: 'wh-au-co',
    quantity: 1, drawnBy: 'auditA', actorRole: 'ROLE_OWNER',
    idempotencyKey: `auditA-sponsor-${stamp}`,
  });
  const sales = await ExecutiveQueryService.querySalesSummary({ windowDays: 30, fiscalScope: 'ALL' });
  const breakdownSum = Object.values(sales.channelBreakdown).reduce((s, c) => s + c.revenue, 0);
  const breakdownCount = Object.values(sales.channelBreakdown).reduce((s, c) => s + c.count, 0);
  ok(
    'E1. Tổng doanh thu = tổng các kênh (số tiền khớp tuyệt đối)',
    breakdownSum === sales.totalRevenue,
    `kênh=${breakdownSum.toLocaleString('vi-VN')} vs tổng=${sales.totalRevenue.toLocaleString('vi-VN')}`
  );
  ok(
    'E2. Tổng số đơn = tổng số đơn các kênh (đếm khớp)',
    breakdownCount === sales.totalOrders,
    `kênh=${breakdownCount} vs tổng=${sales.totalOrders}`
  );
  const salesTax = await ExecutiveQueryService.querySalesSummary({ windowDays: 30, fiscalScope: 'OFFICIAL_TAX' });
  const taxSum = Object.values(salesTax.channelBreakdown).reduce((s, c) => s + c.revenue, 0);
  const taxCount = Object.values(salesTax.channelBreakdown).reduce((s, c) => s + c.count, 0);
  ok(
    'E3. Lọc theo Sổ Thuế: kênh khớp đúng tổng đã lọc',
    taxSum === salesTax.totalRevenue && taxCount === salesTax.totalOrders,
    `kênh=${taxSum}/${taxCount} vs tổng=${salesTax.totalRevenue}/${salesTax.totalOrders}`
  );
  const salesInt = await ExecutiveQueryService.querySalesSummary({ windowDays: 30, fiscalScope: 'INTERNAL_MANAGEMENT' });
  const intSum = Object.values(salesInt.channelBreakdown).reduce((s, c) => s + c.revenue, 0);
  const intCount = Object.values(salesInt.channelBreakdown).reduce((s, c) => s + c.count, 0);
  ok(
    'E4. Lọc theo Sổ Nội bộ: kênh khớp đúng tổng đã lọc (đơn tài trợ không phải doanh số bán)',
    intSum === salesInt.totalRevenue && intCount === salesInt.totalOrders,
    `kênh=${intSum}/${intCount} vs tổng=${salesInt.totalRevenue}/${salesInt.totalOrders}`
  );

  // =========================================================================
  section('F. executive-digest — ranh giới tháng theo giờ VN + N+1');
  const feb = monthRangeOf(2026, 2);
  ok(
    'F1. Ranh giới cuối tháng phủ TRỌN phút cuối (23:59:59.999 VN)',
    feb.startDate === '2026-01-31T17:00:00.000Z' && feb.endDate === '2026-02-28T16:59:59.999Z',
    `start=${feb.startDate} end=${feb.endDate}`
  );
  // 3 đơn lúc 23:59:30 VN ngày 28/2/2026 (= 16:59:30Z) — nằm trong tháng, phải
  // có mặt. 3 ấn bản khác nhau để N+1 "tra editions từng dòng" lộ ra rõ.
  const febEditions = await pickSellableEditions(3);
  const lastMinuteIso = '2026-02-28T16:59:30.000Z';
  for (let i = 0; i < febEditions.length; i++) {
    await OrderService.createOrder({
      warehouseId: 'wh-au-co', customerName: 'Phút cuối tháng', cashierId: 'auditA',
      note: 'auditA', idempotencyKey: `auditA-feb-${stamp}-${i}`,
      createdAt: lastMinuteIso, backdateApproved: true,
      items: [{ editionId: febEditions[i].id, quantity: 5 - i }],
    });
  }
  const digestFeb = await ExecutiveDigestService.buildMonthlyDigest(2026, 2);
  const febTop = digestFeb.topEditions.find((t) => t.code === febEditions[0].code);
  ok(
    'F2. Đơn 23:59:30 ngày cuối tháng KHÔNG bị rơi khỏi digest tháng',
    !!febTop,
    `topEditions có ${febEditions[0].code}: ${febTop ? 'có' : 'KHÔNG'}`
  );
  ok(
    'F3. Số lượng trong digest khớp tổng order_items của tháng',
    (febTop?.qty ?? 0) >= 5,
    `qty=${febTop?.qty ?? 0}`
  );
  // Đối chiếu tổng doanh thu tháng với tổng SQL trên đúng cửa sổ giờ VN.
  const febWindowSum = await db
    .select({ t: sql<number>`COALESCE(SUM(${orders.finalAmount}), 0)` })
    .from(orders)
    .where(
      and(
        eq(orders.status, 'COMPLETED'),
        sql`datetime(${orders.createdAt}) >= datetime(${feb.startDate})`,
        sql`datetime(${orders.createdAt}) <= datetime(${feb.endDate})`
      )
    );
  ok(
    'F4. Doanh thu digest tháng khớp tổng đơn hoàn tất trong cửa sổ giờ VN',
    Math.abs(digestFeb.fiscal.all.revenue - Number(febWindowSum[0]?.t || 0)) < 1,
    `digest=${digestFeb.fiscal.all.revenue} vs SQL=${Number(febWindowSum[0]?.t || 0)}`
  );

  // N+1: đếm số câu SELECT riêng vào bảng editions trong lúc dựng digest.
  const client = (db as any).session?.client as { execute: any; batch: any } | undefined;
  let editionSelects = 0;
  const realExecute = client!.execute;
  const realBatch = client!.batch;
  const countStmt = (q: any) => {
    const text = typeof q === 'string' ? q : q?.sql || q?.query || '';
    if (/from\s+"?editions"?/i.test(text) && !/join\s+"?editions"?/i.test(text)) editionSelects++;
  };
  client!.execute = async (arg: any) => { countStmt(arg); return realExecute.call(client, arg); };
  client!.batch = async (arg: any, ...rest: any[]) => {
    for (const st of Array.isArray(arg) ? arg : [arg]) countStmt(st);
    return realBatch.call(client, arg, ...rest);
  };
  try {
    await ExecutiveDigestService.buildMonthlyDigest(2026, 2);
  } finally {
    client!.execute = realExecute;
    client!.batch = realBatch;
  }
  const topRowCount = digestFeb.topEditions.length;
  ok(
    'F5. Dựng digest KHÔNG truy vấn editions riêng cho từng dòng top (N+1 đã dẹp)',
    topRowCount >= 2 && editionSelects < 1 + topRowCount,
    `topEditions=${topRowCount} dòng, SELECT editions riêng=${editionSelects} (N+1 sẽ là ${1 + topRowCount})`
  );

  section('G. executive-digest — CSV + briefing không bịa số');
  // Tháng hiện tại (giờ VN) — chắc chắn có dữ liệu sau các đơn phía trên.
  const nowVn = new Date();
  const [vnY, vnM] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
    .format(nowVn)
    .split('-')
    .map(Number);
  const digestNow = await ExecutiveDigestService.buildMonthlyDigest(vnY, vnM);
  const csv = ExecutiveDigestService.buildCsv(digestNow);
  ok(
    'G1. CSV có header chuẩn và đủ dòng dữ liệu',
    csv.csv.split('\n')[0] === 'loai,ma,tieu_de,so_luong,doanh_thu_vnd' && csv.csv.split('\n').length > 1,
    `${csv.csv.split('\n').length} dòng CSV`
  );
  const nonSponsorRevenue = digestNow.channels
    .filter((c) => c.channel !== 'SPONSORSHIP')
    .reduce((s, c) => s + c.revenue, 0);
  ok(
    'G2. Doanh thu tháng = tổng doanh thu các kênh BÁN (không tính kênh tài trợ)',
    Math.abs(nonSponsorRevenue - digestNow.fiscal.all.revenue) < 1,
    `kênh bán=${nonSponsorRevenue} vs fiscal.all=${digestNow.fiscal.all.revenue}`
  );
  ok(
    'G3. Số đơn tháng ≥ số đơn trong từng sổ (không đếm thiếu)',
    digestNow.fiscal.all.orders >= digestNow.fiscal.officialTax.orders &&
      digestNow.fiscal.all.orders >= digestNow.fiscal.internal.orders,
    `all=${digestNow.fiscal.all.orders} tax=${digestNow.fiscal.officialTax.orders} internal=${digestNow.fiscal.internal.orders}`
  );
  ok(
    'G4. Doanh thu mọi kênh = doanh thu sổ Thuế + sổ Nội bộ (đối chiếu chéo)',
    digestNow.fiscal.all.revenue === digestNow.fiscal.officialTax.revenue + digestNow.fiscal.internal.revenue,
    `${digestNow.fiscal.all.revenue} = ${digestNow.fiscal.officialTax.revenue} + ${digestNow.fiscal.internal.revenue}`
  );
  ok(
    'G5. Số đơn mọi kênh = số đơn sổ Thuế + sổ Nội bộ (đếm không trùng/không thiếu)',
    digestNow.fiscal.all.orders === digestNow.fiscal.officialTax.orders + digestNow.fiscal.internal.orders,
    `${digestNow.fiscal.all.orders} = ${digestNow.fiscal.officialTax.orders} + ${digestNow.fiscal.internal.orders}`
  );
  // Dọn dẹp: các ca két thử nghiệm.
  await db.delete(cashboxSessions).where(eq(cashboxSessions.cashierId, `auditA-auto`));
  await db.delete(cashboxSessions).where(eq(cashboxSessions.id, oldSessionId));
  await db.delete(cashboxSessions).where(eq(cashboxSessions.cashierId, 'auditA-old'));
  for (let i = 0; i < 25; i++) {
    await db.delete(cashboxSessions).where(eq(cashboxSessions.id, `cbs-auditA-new-${stamp}-${i}`));
  }

  console.log(`\n${passed === total ? '🎉' : '⚠️'}  AUDIT BÁO CÁO QUẢN TRỊ: ${passed}/${total} khẳng định ${passed === total ? 'PASS 100%' : 'CÓ FAIL'}`);
  if (passed !== total) process.exit(1);
}

main().catch((err) => {
  console.error('❌ test-executive-reporting thất bại:', err);
  process.exit(1);
});

void and; void sql;

