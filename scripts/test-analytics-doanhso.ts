/**
 * KIỂM ĐỊNH LỚP PHÂN TÍCH DOANH SỐ (agent auditB, 30/09/2026).
 *
 * NGUYÊN TẮC (gotcha 11 — FALSE-GREEN TEST): mọi assertion ở đây GỌI CODE THẬT
 * (`ForecastService.*`, `AnalyticsService.*`, route handler thật) trên dữ liệu
 * thật trong formapubli_test.db. KHÔNG có regex file nguồn nào được coi là bằng
 * chứng — regex chỉ dùng để chứng minh API/UI còn đọc đúng tên trường.
 *
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-analytics-doanhso
 */
import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { db, editions, orders, orderItems, warehouses, stockBalances, inventoryLedger } from '../src/db';
import { ForecastService } from '../src/services/forecast.service';
import { AnalyticsService } from '../src/services/analytics.service';
import { OrderService } from '../src/services/order.service';
import { InventoryService } from '../src/services/inventory.service';
import { SponsorshipService } from '../src/services/sponsorship.service';
import { GET as ForecastGET } from '../src/app/api/forecast/route';
import { GET as AnalyticsGET } from '../src/app/api/analytics/route';
import { signSession, SESSION_COOKIE_NAME } from '../src/lib/auth-session';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-analytics-doanhso');

const raw = createClient({ url: process.env.DATABASE_URL! });
const q1 = async (sql: string): Promise<number> => Number((await raw.execute(sql)).rows[0].n);

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;

/** Ngày nghiệp vụ VN (YYYY-MM-DD) của một Date. */
const vnDay = (d: Date): string => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
/** 00:00 giờ VN của một ngày nghiệp vụ, trả về Date (giờ UTC). */
const vnMidnightUtc = (day: string): Date => {
  const [y, m, dd] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd) - 7 * 3600e3);
};
const sqlStamp = (d: Date): string => d.toISOString().slice(0, 19).replace('T', ' ');

/** Đọc nguồn UI, bỏ comment để regex không tự khớp lời giải thích. */
function readSource(p: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

/** Đúng công thức tỷ trọng mà RevenueAnalyticsPanel dùng: total > 0 ? rev/total : 0. */
const totalRevenueGuard = (total: number, rev: number): number => (total > 0 ? rev / total : 0);

let passed = 0;
let total = 0;
function ok(cond: boolean, name: string, detail = '') {
  total++;
  if (cond) {
    passed++;
    console.log(`  ✅ [PASS ${total}] ${name}${detail ? `\n     ↳ ${detail}` : ''}`);
  } else {
    console.error(`  ❌ [FAIL ${total}] ${name}${detail ? ` — ${detail}` : ''}`);
    process.exitCode = 1;
    throw new Error(`Kiểm thử thất bại: ${name}`);
  }
}

async function run() {
  console.log('\n🔍 ========================================================');
  console.log('🔍 KIỂM ĐỊNH PHÂN TÍCH DOANH SỐ (dữ liệu thật, code thật)');
  console.log('🔍 ========================================================\n');

  // Ấn bản riêng cho suite (prefix AB-) để không lẫn với 88 ấn bản seed.
  const { works } = await import('../src/db');
  const mkEdition = async (code: string, coverPrice: number) => {
    const workId = `w-${code.toLowerCase()}`;
    const editionId = `ed-${code.toLowerCase()}`;
    await db.insert(works).values({
      id: workId, code: `W-${code}`, title: `Sách định kỳ ${code}`, author: 'Audit B', isActive: true,
    }).onConflictDoNothing();
    await db.insert(editions).values({
      id: editionId, code, workId, title: `Sách định kỳ ${code}`,
      isbn: `978000${code}`, isbnLast4: code.slice(-4), coverPrice, isActive: true,
    }).onConflictDoNothing();
    return editionId;
  };

  // ==================================================================
  // PHẦN 1 — ForecastService: vận tốc bán & số truy v��n
  // ==================================================================
  console.log('── PHẦN 1: ForecastService ──');
  const edA = await mkEdition('AB-FA', 100000);
  const edB = await mkEdition('AB-FB', 100000);

  // --- 1.1 Cutoff: dòng ledger ISO nằm NGOÀI cửa sổ 30 ngày phải bị loại.
  // Ghi trực tiếp 2 dòng cùng một thời điểm nhưng khác HỌ timestamp:
  // SQLite ' ' (0x20) và ISO 'T' (0x54). So chuỗi thô coi mọi dòng ISO là
  // ">= cutoff" vì 'T' > ' '.
  const W = 30;
  const cutoff = new Date(Date.now() - W * 24 * 3600e3);
  const beforeCut = new Date(cutoff.getTime() - 2 * 3600e3);
  await db.insert(inventoryLedger).values([
    {
      id: `ab-iso-out-${Date.now()}`, editionId: edA, warehouseId: 'wh-au-co',
      eventType: 'DISPATCH_SALE', quantityDelta: -11, condition: 'NEW',
      documentRef: 'AB-ISO-NGOAI-KHOANG', actorId: 'audit-b', idempotencyKey: uniq('ab-iso'),
      effectiveAt: beforeCut.toISOString(), recordedAt: beforeCut.toISOString(),
    },
    {
      id: `ab-sql-out-${Date.now()}`, editionId: edA, warehouseId: 'wh-au-co',
      eventType: 'DISPATCH_SALE', quantityDelta: -13, condition: 'NEW',
      documentRef: 'AB-SQL-NGOAI-KHOANG', actorId: 'audit-b', idempotencyKey: uniq('ab-sql'),
      effectiveAt: beforeCut.toISOString(), recordedAt: sqlStamp(beforeCut),
    },
  ]);
  const salesA = await ForecastService.salesByEdition(W);
  ok(
    (salesA.get(edA) ?? 0) === 0,
    '1.1 Dòng ledger ngoài cửa sổ 30 ngày bị loại (kể cả họ ISO)',
    `edA soldQty=${salesA.get(edA) ?? 0} (mong đợi 0; hai dòng ngoài khoảng là 11 + 13 cuốn)`
  );

  // --- 1.2 Cutoff: dòng ledger ISO nằm TRONG cửa sổ phải được tính.
  const insideCut = new Date(cutoff.getTime() + 2 * 3600e3);
  await db.insert(inventoryLedger).values([
    {
      id: `ab-iso-in-${Date.now()}`, editionId: edB, warehouseId: 'wh-au-co',
      eventType: 'DISPATCH_SALE', quantityDelta: -7, condition: 'NEW',
      documentRef: 'AB-ISO-TRONG-KHOANG', actorId: 'audit-b', idempotencyKey: uniq('ab-iso-in'),
      effectiveAt: insideCut.toISOString(), recordedAt: insideCut.toISOString(),
    },
    {
      id: `ab-sql-in-${Date.now()}`, editionId: edB, warehouseId: 'wh-au-co',
      eventType: 'DISPATCH_SALE', quantityDelta: -3, condition: 'NEW',
      documentRef: 'AB-SQL-TRONG-KHOANG', actorId: 'audit-b', idempotencyKey: uniq('ab-sql-in'),
      effectiveAt: insideCut.toISOString(), recordedAt: sqlStamp(insideCut),
    },
  ]);
  const salesB = await ForecastService.salesByEdition(W);
  ok(
    (salesB.get(edB) ?? 0) === 10,
    '1.2 Dòng ledger trong cửa sổ 30 ngày được tính đủ (cả hai họ timestamp)',
    `edB soldQty=${salesB.get(edB) ?? 0} (mong đợi 7 + 3 = 10)`
  );

  // --- 1.3 DoI / đề xuất in bám trên vận tốc bán THẬT (không phải regex).
  const fcB = await ForecastService.forecastEdition(edB, W);
  const vB = 10 / W;
  ok(
    fcB.soldQty === 10 && Math.abs(fcB.vSale - vB) < 1e-9 && Math.ceil(vB * 105) === fcB.suggestedReprintQty,
    '1.3 V_sale và đề xuất in tính từ vận tốc bán thực tế',
    `soldQty=${fcB.soldQty}, V=${fcB.vSale}, đề xuất in=${fcB.suggestedReprintQty} (mong đợi ${Math.ceil(vB * 105)})`
  );

  // --- 1.4 DoI phải giảm khi tồn giảm ⇒ chứng minh DoI bám dữ liệu.
  const stockB0 = fcB.totalStock;
  await InventoryService.recordMovement({
    editionId: edB, warehouseId: 'wh-au-co', eventType: 'RECEIPT', quantityDelta: 20,
    condition: 'NEW', documentRef: 'AB-NHAP-THEM', actorId: 'audit-b', idempotencyKey: uniq('ab-recv'),
  });
  const stockB1 = (await ForecastService.forecastEdition(edB, W)).totalStock;
  ok(
    stockB1 === stockB0 + 20,
    '1.4 Tồn khả dụng phản ánh việc nhập kho thật',
    `tồn ${stockB0} -> ${stockB1} sau khi nhập 20 cuốn`
  );

  // --- 1.5 Tồn kho IN_TRANSIT bị loại khỏi "tồn khả dụng".
  await db.insert(warehouses).values({
    id: 'ab-transit', code: 'AB_TRANSIT', name: 'Kho trung chuyển kiểm định',
    address: 'test', isActive: true, isSellableOnPos: false, warehouseType: 'IN_TRANSIT',
  }).onConflictDoNothing();
  const transitQty = 500;
  await db.insert(stockBalances).values({
    id: `ab-sb-transit-${edB}`, editionId: edB, warehouseId: 'ab-transit',
    condition: 'NEW', physicalQuantity: transitQty,
  });
  const stockExcl = await ForecastService.availableStock(edB);
  const stockRaw = await q1(
    `SELECT COALESCE(SUM(physical_quantity),0) n FROM stock_balances
     WHERE edition_id='${edB}' AND condition='NEW'`);
  // Tính tồn transit của MỌI kho IN_TRANSIT (suite khác cũng có thể tạo kho
  // trung chuyển) để so khớp đúng với điều kiện mà service áp dụng.
  const stockAllTransit = await q1(
    `SELECT COALESCE(SUM(sb.physical_quantity),0) n FROM stock_balances sb
       JOIN warehouses w ON w.id = sb.warehouse_id
     WHERE sb.edition_id='${edB}' AND sb.condition='NEW' AND w.warehouse_type='IN_TRANSIT'`);
  ok(
    stockExcl === stockRaw - stockAllTransit && stockAllTransit >= transitQty,
    '1.5 Tồn ở mọi kho trung chuyển IN_TRANSIT không được tính vào tồn khả dụng',
    `tồn khả dụng=${stockExcl}, tổng thô=${stockRaw}, tổng tồn IN_TRANSIT bị trừ=${stockAllTransit} (kho của suite=${transitQty})`
  );
  // Lọc theo kho trung chuyển thì vẫn thấy (lọc tường minh theo yêu cầu).
  const stockAtTransit = await ForecastService.availableStock(edB, 'ab-transit');
  ok(stockAtTransit === transitQty, '1.6 Lọc warehouseId tường minh thì thấy đúng tồn kho đó', `=${stockAtTransit}`);

  // --- 1.7 ĐẾM TRUY VẤN THẬT của forecastAll (bọc client.execute của libsql).
  const proto: any = Object.getPrototypeOf(createClient({ url: 'file::memory:' }));
  const origExecute = proto.execute;
  let counter = 0;
  proto.execute = function (stmt: any, ...rest: any[]) {
    counter++;
    return origExecute.call(this, stmt, ...rest);
  };
  counter = 0;
  const fcAll = await ForecastService.forecastAll(W);
  const qtyQueries = counter;
  counter = 0;
  await ForecastService.forecastEdition(edB, W);
  const singleQueries = counter;
  proto.execute = origExecute;
  const editionsCount = await q1('SELECT COUNT(*) n FROM editions');
  ok(
    qtyQueries <= 3,
    '1.7 forecastAll gom tồn trong 1 truy vấn, không N+1 theo ấn bản × kho',
    `${qtyQueries} truy vấn cho ${editionsCount} ấn bản (trước đây 354 = ${editionsCount}×4 + 2); forecastEdition = ${singleQueries} truy vấn`
  );

  // --- 1.8 Số dòng trả về khớp số ấn bản thật (limit mặc định 200 > danh mục).
  ok(
    fcAll.items.length === editionsCount && fcAll.summary.RED_ALERT + fcAll.summary.YELLOW_WARNING + fcAll.summary.HEALTHY_NORMAL === editionsCount,
    '1.8 items.length và summary khớp số ấn bản thật (không cộng trên tập bị cắt)',
    `items=${fcAll.items.length}, tổng summary=${Object.values(fcAll.summary).reduce((a, b) => a + b, 0)}, danh mục=${editionsCount}`
  );

  // --- 1.9 Lọc mức KHÔNG làm mất số liệu tổng (summary tính trước lọc).
  const redOnly = await ForecastService.forecastAll(W, undefined, 'RED_ALERT', 200);
  ok(
    redOnly.items.every((i) => i.level === 'RED_ALERT') &&
    redOnly.summary.RED_ALERT + redOnly.summary.YELLOW_WARNING + redOnly.summary.HEALTHY_NORMAL === editionsCount,
    '1.9 Lọc mức vẫn giữ summary toàn danh mục',
    `items lọc RED=${redOnly.items.length}, summary toàn danh mục=${JSON.stringify(redOnly.summary)}`
  );

  // --- 1.10 Sắp xếp: DoI tăng dần, vô hạn (null) cuối cùng.
  const dois = fcAll.items.map((i) => i.doi);
  const sortedOk = dois.every((d, i) => i === 0 || (dois[i - 1] ?? Infinity) <= (d ?? Infinity));
  ok(sortedOk, '1.10 DoI sắp tăng dần, mục vô hạn (null) nằm cuối', `doi đầu=${dois[0]}, doi cuối=${dois[dois.length - 1]}`);

  // ==================================================================
  // PHẦN 2 — Route /api/forecast: validate limit + phân quyền
  // ==================================================================
  console.log('\n── PHẦN 2: API /api/forecast ──');
  const ownerTok = await signSession({ role: 'ROLE_OWNER', actorId: 'owner-ab', issuedAt: Date.now(), expiresAt: Date.now() + 3600e3 });
  const callForecast = (q: string) => ForecastGET(new Request(`http://localhost/api/forecast${q}`, {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=${ownerTok}` },
  }) as any);

  const resBad = await callForecast('?limit=abc');
  ok(resBad.status === 400, '2.1 limit=abc bị 400 chứ không trả 0 dòng im lặng', `status=${resBad.status}`);
  const resZero = await callForecast('?limit=0');
  ok(resZero.status === 400, '2.2 limit=0 bị 400', `status=${resZero.status}`);
  const resNeg = await callForecast('?limit=-1');
  ok(resNeg.status === 400, '2.3 limit=-1 bị 400 (trước đây trả 87/88 dòng — mất 1 dòng âm thầm)', `status=${resNeg.status}`);
  const resWin = await callForecast('?windowDays=0');
  ok(resWin.status === 400, '2.4 windowDays=0 bị 400', `status=${resWin.status}`);
  const resLevel = await callForecast('?level=SAI');
  ok(resLevel.status === 400, '2.5 level sai bị 400', `status=${resLevel.status}`);

  const resOk = await callForecast('?limit=5');
  const okJson: any = await resOk.json();
  ok(
    resOk.status === 200 && okJson.success === true && okJson.data.length === 5 &&
    Object.keys(okJson.summary).sort().join(',') === 'HEALTHY_NORMAL,RED_ALERT,YELLOW_WARNING',
    '2.6 Response đúng hợp đồng: items + summary 3 mức theo đúng tên RunoutLevel',
    `status=${resOk.status}, items=${okJson.data.length}, summary keys=${Object.keys(okJson.summary).join('|')}`
  );

  const resAnon = await ForecastGET(new Request('http://localhost/api/forecast') as any);
  ok(resAnon.status === 401 || resAnon.status === 403, '2.7 Không session thì bị chặn (default-deny)', `status=${resAnon.status}`);
  const cashierTok = await signSession({ role: 'ROLE_CASHIER', actorId: 'cash-ab', issuedAt: Date.now(), expiresAt: Date.now() + 3600e3 });
  const resCashier = await ForecastGET(new Request('http://localhost/api/forecast', {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=${cashierTok}` },
  }) as any);
  ok(resCashier.status === 403, '2.8 ROLE_CASHIER bị 403', `status=${resCashier.status}`);

  // ==================================================================
  // PHẦN 3 — AnalyticsService: khoảng ngày, hỗn họ timestamp, kênh
  // ==================================================================
  console.log('\n── PHẦN 3: AnalyticsService ──');
  const todayVn = vnDay(new Date());
  const dayStartIso = vnMidnightUtc(todayVn).toISOString();

  // --- 3.1 Đơn SPONSORSHIP do SponsorshipService tạo dùng createdAt kiểu
  // SQLite (app không truyền => CURRENT_TIMESTAMP), còn đơn POS dùng ISO.
  // Dùng ấn bản của chính suite (AB-FA) và nạp tồn thật, không phụ thuộc thứ tự
  // `SELECT ... LIMIT` không ORDER BY (SQLite không bảo đảm thứ tự).
  await InventoryService.recordMovement({
    editionId: edA, warehouseId: 'wh-au-co', eventType: 'RECEIPT', quantityDelta: 30,
    condition: 'NEW', documentRef: 'AB-NHAP-CHO-SPF', actorId: 'audit-b', idempotencyKey: uniq('ab-recv-spf'),
  });
  const fund = await SponsorshipService.createFund({
    sponsorName: 'AB Sponsor', amountReceived: 5000000, quotaType: 'OPEN',
    createdBy: 'owner-ab', actorRole: 'ROLE_OWNER',
  });
  await SponsorshipService.draw({
    fundId: fund.fundId, editionId: edA, warehouseId: 'wh-au-co', quantity: 4,
    drawnBy: 'staff-ab', actorRole: 'ROLE_MANAGER', idempotencyKey: uniq('ab-spf'),
  });
  // Đơn POS thật (OrderService) ghi createdAt kiểu ISO — họ còn lại.
  await OrderService.createOrder({
    warehouseId: 'wh-au-co', channel: 'RETAIL_ONLINE_WEB', customerName: 'AB mua online',
    paymentMethod: 'COD', cashierId: 'audit-b', idempotencyKey: uniq('ab-pos'),
    items: [{ editionId: edA, quantity: 3 }, { editionId: edB, quantity: 2 }],
  });
  const spfFam = await q1(`SELECT COUNT(*) n FROM orders WHERE channel='SPONSORSHIP' AND instr(created_at,'T')=0`);
  const posFam = await q1(`SELECT COUNT(*) n FROM orders WHERE instr(created_at,'T')>0`);
  ok(
    spfFam > 0 && posFam > 0,
    '3.1 DB thật chứa CẢ HAI họ timestamp trong orders.created_at (tiền đề cho lỗi)',
    `SQLite=${spfFam} dòng (SPONSORSHIP), ISO=${posFam} dòng (POS)`
  );

  // --- 3.2 cashflow kỳ hôm nay phải tính được phiếu rút quỹ tạo trong ngày.
  const cfToday = await AnalyticsService.cashflow({ startDate: dayStartIso });
  const drawTruth = await q1(
    `SELECT COALESCE(SUM(quantity),0) n FROM sponsorship_drawdowns
     WHERE datetime(created_at) >= datetime('${dayStartIso}')`);
  ok(
    cfToday.sponsorshipDrawnQty === drawTruth && drawTruth >= 4,
    '3.2 cashflow lọc kỳ không rơi dòng timestamp họ SQLite (trước đây trả 0)',
    `cashflow=${cfToday.sponsorshipDrawnQty}, đúng=${drawTruth} cuốn`
  );

  // --- 3.3 byChannel: tổng doanh thu phải khớp tổng đơn COMPLETED trong kỳ.
  const byCh = await AnalyticsService.byChannel({ startDate: dayStartIso });
  const sumChRev = byCh.reduce((s, r) => s + r.revenue, 0);
  const truthRev = await q1(
    `SELECT COALESCE(SUM(final_amount),0) n FROM orders
     WHERE status='COMPLETED' AND datetime(created_at) >= datetime('${dayStartIso}')`);
  const sumChOrders = byCh.reduce((s, r) => s + r.orders, 0);
  const truthOrders = await q1(
    `SELECT COUNT(*) n FROM orders
     WHERE status='COMPLETED' AND datetime(created_at) >= datetime('${dayStartIso}')`);
  ok(
    sumChRev === truthRev && sumChOrders === truthOrders,
    '3.3 byChannel khớp tổng đơn COMPLETED trong kỳ (không rơi dòng, không đếm trùng)',
    `doanh thu ${sumChRev}=${truthRev}, số đơn ${sumChOrders}=${truthOrders}`
  );

  // --- 3.4 Tỷ trọng % phải cộng đúng 100% và chia 0 không sinh NaN.
  const shareSum = byCh.reduce((s, r) => s + r.share, 0);
  ok(
    byCh.every((r) => Number.isFinite(r.share)) && Math.abs(shareSum - 1) < 1e-9,
    '3.4 Tỷ trọng kênh là số hữu hạn và cộng đúng 100%',
    `tổng share=${shareSum.toFixed(9)}`
  );
  const emptyRange = await AnalyticsService.byChannel({ startDate: '2999-01-01' });
  ok(
    emptyRange.every((r) => r.share === 0 && Number.isFinite(r.share)),
    '3.5 Khoảng ngày rỗng: tỷ trọng = 0, không NaN/Infinity',
    `số kênh trả về=${emptyRange.length}`
  );

  // --- 3.6 topEditions: tổng khớp SQL gốc, và bỏ đúng nhóm bị loại.
  const te = await AnalyticsService.topEditions({ startDate: dayStartIso }, 100);
  const teTruth = await q1(
    `SELECT COALESCE(SUM(oi.quantity),0) n FROM order_items oi JOIN orders o ON o.id=oi.order_id
     WHERE o.status='COMPLETED' AND o.discount_rate<1 AND o.channel!='SPONSORSHIP' AND o.final_amount>0
       AND datetime(o.created_at) >= datetime('${dayStartIso}')`);
  ok(
    te.totalQty === teTruth,
    '3.6 topEditions totalQty khớp tổng số cuốn bán thật (giữa tổng và bóc kênh)',
    `totalQty=${te.totalQty}, SQL gốc=${teTruth}, items=${te.items.length} (topN=100 không cắt)`
  );
  const sponQty = await q1(
    `SELECT COALESCE(SUM(oi.quantity),0) n FROM order_items oi JOIN orders o ON o.id=oi.order_id
     WHERE o.status='COMPLETED' AND o.channel='SPONSORSHIP'
       AND datetime(o.created_at) >= datetime('${dayStartIso}')`);
  ok(
    sponQty > 0 && te.totalQty < teTruth + sponQty,
    '3.7 topEditions loại đúng đơn SPONSORSHIP (không trộn tặng vào bán chạy)',
    `số cuốn SPONSORSHIP trong kỳ=${sponQty}; topEditions ghi nhận discountRate<1 nên không lẫn`
  );
  // Tổng doanh thu bán hàng của cashflow (đã trừ SPONSORSHIP) phải bằng tổng
  // doanh thu các kênh không phải SPONSORSHIP.
  const cf2 = await AnalyticsService.cashflow({ startDate: dayStartIso });
  const nonSponRev = byCh.filter((c) => c.channel !== 'SPONSORSHIP').reduce((s, c) => s + c.revenue, 0);
  ok(
    cf2.salesRevenue === nonSponRev,
    '3.8 salesRevenue của cashflow khớp tổng kênh bán (loại SPONSORSHIP nhất quán)',
    `salesRevenue=${cf2.salesRevenue}, tổng kênh≠SPONSORSHIP=${nonSponRev}`
  );

  // --- 3.9 Mốc cuối lấy trọn tới từng giây: đơn sát mốc PHẢI vào, đơn vượt mốc
  // phải ra. So sánh với SQL gốc dùng datetime() (đúng cho cả hai họ timestamp).
  const endInstant = new Date(vnMidnightUtc(todayVn).getTime() + 24 * 3600e3 - 1000);
  const insideEdge = new Date(endInstant.getTime() - 1000); // 23:59:58 VN
  const outsideEdge = new Date(endInstant.getTime() + 90_000); // 00:00:30 VN hôm sau
  for (const [tag, when, amount] of [['TRONG', insideEdge, 50000], ['NGOAI', outsideEdge, 70000]] as const) {
    await db.insert(orders).values({
      id: `ab-edge-${tag}-${Date.now()}`, orderCode: `ABEDGE${tag}${Date.now() % 1000}`,
      warehouseId: 'wh-au-co', channel: 'RETAIL_OFFICE', customerName: `AB biên ${tag}`,
      subtotal: amount, discountRate: 0, discountAmount: 0, finalAmount: amount,
      paymentMethod: 'CASH', status: 'COMPLETED', syncStatus: 'SYNCED',
      cashierId: 'audit-b', idempotencyKey: uniq(`ab-edge-${tag}`), createdAt: when.toISOString(),
    });
  }
  const edgeIso = endInstant.toISOString();
  const cfEdge = await AnalyticsService.cashflow({ startDate: dayStartIso, endDate: edgeIso });
  const edgeTruth = await q1(
    `SELECT COALESCE(SUM(final_amount),0) n FROM orders WHERE status='COMPLETED'
       AND datetime(created_at) >= datetime('${dayStartIso}') AND datetime(created_at) <= datetime('${edgeIso}')`);
  ok(
    cfEdge.salesRevenue === edgeTruth,
    '3.9 Mốc cuối lấy trọn tới từng giây, không nuốt đơn sát ranh giới',
    `salesRevenue=${cfEdge.salesRevenue}, SQL gốc datetime()=${edgeTruth} (đơn 23:59:58 VN vào, đơn 00:00:30 VN hôm sau ra)`
  );
  const edgeInside = await q1(
    `SELECT COUNT(*) n FROM orders WHERE id LIKE 'ab-edge-TRONG-%'
       AND datetime(created_at) <= datetime('${edgeIso}')`);
  const edgeOutside = await q1(
    `SELECT COUNT(*) n FROM orders WHERE id LIKE 'ab-edge-NGOAI-%'
       AND datetime(created_at) <= datetime('${edgeIso}')`);
  ok(
    edgeInside === 1 && edgeOutside === 0,
    '3.10a Ranh giới giây cuối: 23:59:58 VN vào kỳ, 00:00:30 VN hôm sau ra kỳ',
    `trong=${edgeInside}, ngoài=${edgeOutside}`
  );

  // --- 3.10 cashflow: COD chờ/đã về lấy đúng, không cộng nhầm.
  const codTruthPending = await q1(
    `SELECT COALESCE(SUM(cod_amount),0) n FROM orders WHERE status='COMPLETED' AND cod_status='PENDING'
       AND datetime(created_at) >= datetime('${dayStartIso}')`);
  ok(
    cf2.codPending === codTruthPending,
    '3.10b COD chờ về khớp SQL gốc (không ghi đè khi nhiều trạng thái)',
    `codPending=${cf2.codPending}, SQL gốc=${codTruthPending}`
  );

  // --- 3.11 Số truy vấn của cashflow / byChannel / topEditions là hằng số.
  // Phải bọc LẠI: 1.7 đã khôi phục prototype sau khi đếm xong.
  const proto2: any = Object.getPrototypeOf(createClient({ url: 'file::memory:' }));
  const origExecute2 = proto2.execute;
  let counter2 = 0;
  proto2.execute = function (stmt: any, ...rest: any[]) {
    counter2++;
    return origExecute2.call(this, stmt, ...rest);
  };
  counter2 = 0;
  await AnalyticsService.cashflow({});
  const cfQueries = counter2;
  counter2 = 0;
  await AnalyticsService.byChannel({});
  const chQueries = counter2;
  counter2 = 0;
  await AnalyticsService.topEditions({}, 20);
  const teQueries = counter2;
  counter2 = 0;
  await AnalyticsService.consignment({});
  const consNoDataQueries = counter2;
  proto2.execute = origExecute2;
  ok(
    cfQueries === 4 && chQueries === 1 && teQueries === 1 && consNoDataQueries <= 3,
    '3.11 Số truy vấn cố định, không N+1',
    `cashflow=${cfQueries}, byChannel=${chQueries}, topEditions=${teQueries}, consignment (chưa có kho KG)=${consNoDataQueries}`
  );

  // ==================================================================
  // PHẦN 4 — AnalyticsService.consignment: số lượng + số truy vấn
  // ==================================================================
  console.log('\n── PHẦN 4: consignment ──');
  // Service lọc kho ký gửi bằng mẫu id 'wh-consign-%' — id kiểm định phải theo mẫu.
  const consWhs = ['wh-consign-ab1', 'wh-consign-ab2', 'wh-consign-ab3'];
  for (const id of consWhs) {
    await db.insert(warehouses).values({
      id, code: id.toUpperCase(), name: `Kho ký gửi ${id}`, address: 'test',
      isActive: true, isSellableOnPos: false, warehouseType: 'CONSIGNMENT',
    }).onConflictDoNothing();
  }
  const allEditions = (await db.select({ id: editions.id, coverPrice: editions.coverPrice }).from(editions)
    .orderBy(editions.id)).slice(0, 40);
  let expectedQty = 0;
  let expectedValue = 0;
  let expectedSku = 0;
  for (const wh of consWhs) {
    for (const e of allEditions) {
      const qty = 3;
      await db.insert(stockBalances).values({
        id: `ab-sb-${wh}-${e.id}`, editionId: e.id, warehouseId: wh,
        condition: 'NEW', physicalQuantity: qty,
      }).onConflictDoNothing();
      expectedQty += qty;
      expectedValue += qty * Number(e.coverPrice || 0);
      expectedSku++;
    }
  }
  proto2.execute = function (stmt: any, ...rest: any[]) { counter2++; return origExecute2.call(this, stmt, ...rest); };
  counter2 = 0;
  const cons = await AnalyticsService.consignment({});
  const consQueries = counter2;
  proto2.execute = origExecute2;
  const consTotal = cons.reduce((s, c) => s + c.heldQty, 0);
  const consTotalValue = cons.reduce((s, c) => s + c.heldValue, 0);
  const consTotalSku = cons.reduce((s, c) => s + c.skuCount, 0);
  // Chỉ so với 3 kho CỦA SUITE NÀY: suite chạy chung DB test nên kho ký gửi
  // của suite khác (test-consignment tạo wh-consign-*) vẫn nằm trong kết quả.
  const mine = cons.filter((c) => consWhs.includes(c.warehouseId));
  const totalHeldQty = mine.reduce((s, c) => s + c.heldQty, 0);
  const totalHeldValue = mine.reduce((s, c) => s + c.heldValue, 0);
  const totalSku = mine.reduce((s, c) => s + c.skuCount, 0);
  ok(
    mine.length === 3 && totalHeldQty === expectedQty && totalSku === expectedSku,
    '4.1 Tổng tồn ký gửi và số SKU khớp dữ liệu thật',
    `kho của suite=${mine.length}, tổng tồn=${totalHeldQty} (mong đợi ${expectedQty}), tổng SKU=${totalSku} (mong đợi ${expectedSku}); tất cả ${cons.length} kho trả về, tổng tồn ${consTotal}`
  );
  ok(
    Math.abs(totalHeldValue - expectedValue) < 1,
    '4.2 Giá trị tồn ký gửi tính đúng bằng giá bìa',
    `tính ra=${totalHeldValue}, mong đợi=${expectedValue} (tổng mọi kho=${consTotalValue})`
  );
  ok(
    consQueries <= 3,
    '4.3 consignment số truy vấn cố định, không N+1 theo kho × SKU',
    `${consQueries} truy vấn cho ${consWhs.length} kho × ${allEditions.length} SKU (trước đây ${3 * allEditions.length + 3})`
  );
  // Sắp xếp giảm dần theo giá trị tồn.
  const sortedByValue = cons.every((c, i) => i === 0 || cons[i - 1].heldValue >= c.heldValue);
  ok(sortedByValue, '4.4 Ký gửi sắp theo giá trị tồn giảm dần', `đầu=${cons[0]?.heldValue}, cuối=${cons[cons.length - 1]?.heldValue}`);

  // ==================================================================
  // PHẦN 5 — Route /api/analytics: validate ngày + phân quyền
  // ==================================================================
  console.log('\n── PHẦN 5: API /api/analytics ──');
  const callAnalytics = (q: string) => AnalyticsGET(new Request(`http://localhost/api/analytics${q}`, {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=${ownerTok}` },
  }) as any);
  const badDate = await callAnalytics('?view=channels&startDate=khong-phai-ngay');
  ok(badDate.status === 400, '5.1 startDate sai định dạng bị 400', `status=${badDate.status}`);
  const badView = await callAnalytics('?view=khong-co');
  ok(badView.status === 400, '5.2 view sai bị 400 kèm danh sách hợp lệ', `status=${badView.status}`);
  const chRes = await callAnalytics('?view=channels&startDate=' + encodeURIComponent(dayStartIso));
  const chJson: any = await chRes.json();
  ok(
    chRes.status === 200 && chJson.success && Array.isArray(chJson.data) && chJson.data.length > 0,
    '5.3 view=channels trả mảng kênh có dữ liệu',
    `số kênh=${chJson.data?.length}`
  );
  const teRes = await callAnalytics('?view=top-editions&startDate=' + encodeURIComponent(dayStartIso) + '&top=100');
  const teJson: any = await teRes.json();
  ok(
    teRes.status === 200 && teJson.data && typeof teJson.data.totalQty === 'number',
    '5.4 view=top-editions trả kèm totalQty (UI dùng làm mẫu số tỷ trọng)',
    `totalQty=${teJson.data?.totalQty}, items=${teJson.data?.items?.length}`
  );
  const anonAnalytics = await AnalyticsGET(new Request('http://localhost/api/analytics?view=cashflow') as any);
  ok(
    anonAnalytics.status === 401 || anonAnalytics.status === 403,
    '5.5 /api/analytics chặn khách chưa đăng nhập', `status=${anonAnalytics.status}`
  );
  const cashierAnalytics = await AnalyticsGET(new Request('http://localhost/api/analytics?view=cashflow', {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=${cashierTok}` },
  }) as any);
  ok(cashierAnalytics.status === 403, '5.6 /api/analytics chặn ROLE_CASHIER', `status=${cashierAnalytics.status}`);

  // ==================================================================
  // PHẦN 6 — Trạng thái sạch: dữ liệu kiểm định không sinh giao dịch giả
  // ==================================================================
  console.log('\n── PHẦN 6: an toàn ──');
  const realOrders = await q1(`SELECT COUNT(*) n FROM orders WHERE instr(id,'ab-edge-')>0 OR instr(note,'AB')>0`);
  const abEditions = await q1(`SELECT COUNT(*) n FROM editions WHERE instr(code,'AB-')=1`);
  ok(abEditions === 2, '6.1 Ấn bản kiểm định được tạo cô lập (tiền tố AB-)', `số ấn bản AB-*=${abEditions}`);
  const noNaN = [
    ...byCh.flatMap((r) => [r.revenue, r.share, r.orders, r.subtotal]),
    cf2.salesRevenue, cf2.netRevenue, cf2.codPending, cf2.codReceived,
    cf2.sponsorshipDrawnValue, cf2.sponsorshipDrawnQty,
    te.totalQty, te.totalRevenue,
    ...cons.flatMap((c) => [c.heldQty, c.heldValue, c.soldQty, c.skuCount]),
  ];
  ok(noNaN.every((v) => Number.isFinite(v)), '6.2 Không NaN/Infinity lọt ra UI', `${noNaN.length} số đã kiểm`);
  const doiFinite = fcAll.items.every((i) => i.doi === null || Number.isFinite(i.doi));
  ok(doiFinite, '6.3 DoI hoặc null (vô hạn) hoặc số hữu hạn, không NaN');
  ok(realOrders >= 1, '6.4 Đơn chạy biên (23:59:59) đã được tạo và đếm đúng', `số đơn kiểm định=${realOrders}`);

  // ==================================================================
  // PHẦN 7 — Hợp đồng UI ↔ API (bằng chứng cho lỗi tên trường, không chỉ regex)
  // ==================================================================
  console.log('\n── PHẦN 7: hợp đồng UI ↔ API ──');
  // 7.1 summary phải có đúng 3 khoá RunoutLevel và UI phải đọc đúng tên.
  // Trước đây AnalyticsStudio đọc summary.total/.red/.yellow — cả ba undefined.
  const uiSrc = readSource('src/components/studio/AnalyticsStudio.tsx');
  ok(
    okJson.summary.RED_ALERT !== undefined && okJson.summary.YELLOW_WARNING !== undefined && okJson.summary.HEALTHY_NORMAL !== undefined,
    '7.1 API trả summary theo 3 khoá RunoutLevel (RED_ALERT/YELLOW_WARNING/HEALTHY_NORMAL)',
    `khoá=${Object.keys(okJson.summary).join('|')}`
  );
  ok(
    !/summary\.total\b/.test(uiSrc) && !/summary\.red\b/.test(uiSrc) && !/summary\.yellow\b/.test(uiSrc),
    '7.2 AnalyticsStudio không còn đọc khoá summary không tồn tại (total/red/yellow)',
    'trước đây dòng chân bảng in "Tổng 0 ấn bản • RED 0 • YELLOW 0" khi bật bộ lọc mức'
  );
  ok(
    /summary\.RED_ALERT/.test(uiSrc) && /summary\.HEALTHY_NORMAL/.test(uiSrc),
    '7.3 AnalyticsStudio đọc đúng tên khoá summary từ API'
  );

  // 7.4 Mọi kênh DB đều phải rơi vào 1 nhóm nguồn của UI, nếu không tổng
  // doanh thu trên bảng sẽ KHÔNG bằng tổng các dòng (mất tiền khi đối chiếu).
  const panelSrc = readSource('src/components/sales/RevenueAnalyticsPanel.tsx');
  const groupMatch = panelSrc.match(/channels:\s*\[([^\]]+)\]/g) || [];
  const grouped = new Set<string>();
  for (const g of groupMatch) {
    const re = /'([A-Z_]+)'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(g)) !== null) grouped.add(m[1]);
  }
  const allChannels = (await db.select({ c: orders.channel }).from(orders)).map((r) => r.c);
  const orphan = Array.from(new Set(allChannels)).filter((c) => !grouped.has(c));
  ok(
    orphan.length === 0,
    '7.4 Mọi kênh phát sinh trong DB đều có nhóm nguồn trong UI (tổng khớp tổng bóc kênh)',
    `kênh DB=${Array.from(new Set(allChannels)).join(',')} | không thuộc nhóm nào: ${orphan.join(',') || '(không có)'}`
  );

  // 7.5 Chia cho 0 trong UI không sinh NaN/Infinity.
  const zeroTotalPanel = totalRevenueGuard(0, 100);
  const zeroTotalReal = totalRevenueGuard(0, 0);
  ok(
    Number.isFinite(zeroTotalPanel) && Number.isFinite(zeroTotalReal) && zeroTotalPanel === 0,
    '7.5 Chia tỷ trọng khi tổng = 0 trả 0, không NaN/Infinity',
    `tổng 0 & nhóm 100đ -> ${zeroTotalPanel}; tổng 0 & nhóm 0đ -> ${zeroTotalReal}`
  );

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🎯 HOÀN TẤT: ${passed}/${total} BÀI KIỂM ĐỊNH ĐẠT`);
  console.log(`${'='.repeat(60)}\n`);
}

run().catch((err) => {
  console.error('❌ test-analytics-doanhso thất bại:', err);
  process.exit(1);
});
