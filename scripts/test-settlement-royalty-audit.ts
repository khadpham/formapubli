/**
 * KIỂM ĐỊNH LỚP CHỐT CA / BÁO CÁO DOANH THU / ROYALTY (agent auditC).
 *
 * QUY TẮC SỐ 11: suite này GỌI CODE THẬT — import service thật từ `src/services`
 * và chạy trên CSDL thật (`formapubli_test_auditC.db`, dựng bằng đúng chuỗi
 * migration của repo). KHÔNG có regex nào đọc file nguồn để "chứng minh" điều gì.
 * Mọi số liệu kỳ vọng đều được bốc ra từ DB bằng SQL độc lập rồi so với số
 * service trả về.
 *
 * 3 nhóm:
 *   A. TIỀN MẶT QUA NỬA ĐÊM + chốt ngày trùng lặp + ca chưa đếm két.
 *   B. ROYALTY: công thức chia, làm tròn, ngưỡng bậc thang, lọc theo vòng đời.
 *   C. BÁO CÁO DOANH THU: biên ngày nghiệp vụ VN, ranh giới cuối ngày, kênh.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_auditC.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* chưa có */ }
}

let checks = 0;
let failures = 0;
const results: { name: string; pass: boolean; detail: string }[] = [];

function ok(cond: boolean, name: string, detail = ''): void {
  checks++;
  if (cond) {
    results.push({ name, pass: true, detail });
    console.log(`  ✅ [${checks}] ${name}${detail ? `\n       ↳ ${detail}` : ''}`);
  } else {
    failures++;
    results.push({ name, pass: false, detail });
    console.error(`  ❌ [${checks}] ${name}${detail ? `\n       ↳ ${detail}` : ''}`);
  }
}

/** Ngày nghiệp vụ VN của một mốc UTC (độc lập với service, dùng Intl). */
function vnDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(iso));
}

async function run() {
  console.log('--- KIỂM ĐỊNH: CHỐT CA / DOANH THU / ROYALTY (auditC) ---');

  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-settlement-royalty-audit');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL });

  // Phải import SAU khi đặt DATABASE_URL: src/db đọc biến này lúc module load.
  const schema = await import('../src/db/schema');
  const { db } = await import('../src/db');
  const { DailySettlementService } = await import('../src/services/daily-settlement.service');
  const { RoyaltyService, deriveLifecycle, QUOTA_WARN_ABSOLUTE } =
    await import('../src/services/royalty.service');
  const { AnalyticsService } = await import('../src/services/analytics.service');
  const { OrderService } = await import('../src/services/order.service');
  const { sql } = await import('drizzle-orm');

  // ---------------------------------------------------------------- seed ---
  const WH = 'wh-auditc';
  await db.insert(schema.warehouses).values({
    id: WH, code: 'KHO_AUDITC', name: 'Kho kiểm định auditC',
    warehouseType: 'FAIR_EVENT', isSellableOnPos: true, isActive: true,
  });
  await db.insert(schema.works).values([
    { id: 'wk-a', code: 'AUDIT-A', title: 'Tác phẩm A', author: 'Tác giả A', isActive: true },
    { id: 'wk-b', code: 'AUDIT-B', title: 'Tác phẩm B', author: 'Tác giả B', isActive: true },
    { id: 'wk-c', code: 'AUDIT-C', title: 'Tác phẩm C', author: 'Tác giả C', isActive: true },
  ]);
  await db.insert(schema.editions).values([
    { id: 'ed-a1', code: 'AUD-A1', workId: 'wk-a', isbn: '9780000000101', isbnLast4: '0101', coverPrice: 89000, isActive: true },
    { id: 'ed-a2', code: 'AUD-A2', workId: 'wk-a', isbn: '9780000000102', isbnLast4: '0102', coverPrice: 123000, isActive: true },
    { id: 'ed-b1', code: 'AUD-B1', workId: 'wk-b', isbn: '9780000000201', isbnLast4: '0201', coverPrice: 55000, isActive: true },
    { id: 'ed-c1', code: 'AUD-C1', workId: 'wk-c', isbn: '9780000000301', isbnLast4: '0301', coverPrice: 70000, isActive: true },
  ]);
  for (const e of ['ed-a1', 'ed-a2', 'ed-b1', 'ed-c1']) {
    await db.insert(schema.stockBalances).values({
      id: `sb-${e}`, editionId: e, warehouseId: WH, condition: 'NEW', physicalQuantity: 500,
    });
  }

  const mkOrder = async (o: {
    id: string; code: string; amount: number; createdAt: string;
    sessionId?: string | null; method?: string; channel?: string;
    editionId?: string; qty?: number; unitPrice?: number; scope?: string;
    status?: string;
  }) => {
    await db.insert(schema.orders).values({
      id: o.id, orderCode: o.code, idempotencyKey: 'k-' + o.id,
      warehouseId: WH, cashierId: 'CASH-AUDITC', cashboxSessionId: o.sessionId ?? null,
      status: o.status || 'COMPLETED', paymentMethod: o.method || 'CASH',
      channel: o.channel || 'FAIR_EVENT', fiscalScope: o.scope || 'INTERNAL_MANAGEMENT',
      subtotal: o.amount, discountAmount: 0, discountRate: 0, finalAmount: o.amount,
      createdAt: o.createdAt,
    } as any);
    if (o.editionId) {
      await db.insert(schema.orderItems).values({
        id: `it-${o.id}`, orderId: o.id, editionId: o.editionId, quantity: o.qty || 1,
        unitCoverPrice: o.unitPrice || 0, unitSellingPrice: o.unitPrice || 0,
        totalAmount: o.amount,
      } as any);
    }
  };

  // ======================================================================
  // A. TIỀN MẶT
  // ======================================================================
  console.log('\n=== A. TIỀN MẶT QUA NỖI ĐÊM / ĐỐI SOÁT KÉT ===');

  // Ngày nghiệp vụ D = 2026-10-02. Mốc UTC tương ứng: 01/10 17:00Z → 02/10 16:59:59Z.
  const D = '2026-10-02';
  const D_PREV_UTC_2330 = '2026-10-01T16:30:00Z'; // 23:30 VN 01/10
  const D_UTC_0030 = '2026-10-01T17:30:00Z';      // 00:30 VN 02/10
  const D_UTC_1200 = '2026-10-02T12:00:00Z';      // 19:00 VN 02/10

  ok(vnDay(D_UTC_0030) === D, 'Mốc kiểm chuẩn: 00:30 VN 02/10 thuộc ngày 02/10');
  ok(vnDay(D_PREV_UTC_2330) === '2026-10-01', 'Mốc kiểm chuẩn: 23:30 VN 01/10 thuộc ngày 01/10');

  // --- A1: ca mở NGÀY HÔM TRƯỚC, bán xuyên nửa đêm vào ngày D -------------
  await db.insert(schema.cashboxSessions).values({
    id: 'sess-cross', warehouseId: WH, cashierId: 'CASH-AUDITC',
    openingCash: 300000, status: 'OPEN', openedAt: D_PREV_UTC_2330,
  } as any);
  await mkOrder({ id: 'o-cross-1', code: 'AUD-CROSS-1', amount: 400000, sessionId: 'sess-cross', createdAt: D_UTC_0030, editionId: 'ed-a1', qty: 4, unitPrice: 100000 });
  await mkOrder({ id: 'o-cross-2', code: 'AUD-CROSS-2', amount: 150000, sessionId: 'sess-cross', method: 'BANK_TRANSFER', createdAt: D_UTC_0030, editionId: 'ed-a2', qty: 1, unitPrice: 150000 });

  const rCross = await DailySettlementService.getDailyFairSettlement({ warehouseId: WH, date: D });
  const cross = rCross.cashboxReconciliation;
  const crossRow = (cross.sessions as any[]).find((s) => s.id === 'sess-cross');
  const cashDay = rCross.paymentBreakdown.cash.sales;

  ok(
    !!crossRow,
    'A1.1 Ca mở 23:30 hôm trước nhưng bán sang ngày D phải CÓ trong báo cáo ngày D',
    `sessionsCount=${rCross.sessionsCount}, ids=${JSON.stringify((cross.sessions as any[]).map((s) => s.id))}`
  );
  ok(
    cross.expectedCashTotal === 700000,
    'A1.2 expectedCashTotal = bàn giao 300.000 + tiền mặt bán trong ngày 400.000',
    `expectedCashTotal=${cross.expectedCashTotal} (cần 700000), tiền mặt bán trong ngày=${cashDay}`
  );
  ok(
    cross.expectedCashTotal === cross.openingCashTotal + cashDay,
    'A1.3 Bất biến: tiền két kỳ vọng = tiền đầu ca + doanh số tiền mặt trong ngày',
    `kỳ vọng=${cross.expectedCashTotal}, đầu ca=${cross.openingCashTotal}, tiền mặt ngày=${cashDay}`
  );

  // Báo cáo của ngày HÔM TRƯỚC không được nuốt mất tiền đã bán sang ngày D.
  const rPrev = await DailySettlementService.getDailyFairSettlement({ warehouseId: WH, date: '2026-10-01' });
  ok(
    rPrev.paymentBreakdown.cash.sales === 0 && rPrev.cashboxReconciliation.openingCashTotal === 300000,
    'A1.4 Ngày 01/10: không có doanh số tiền mặt nhưng vẫn thấy bàn giao 300.000 của ca đó',
    `cashSales=${rPrev.paymentBreakdown.cash.sales}, opening=${rPrev.cashboxReconciliation.openingCashTotal}`
  );

  // --- A2: ca mở NGÀY HÔM NAY, đóng hôm mai (bán sang ngày D+1) -----------
  await db.insert(schema.cashboxSessions).values({
    id: 'sess-tomorrow', warehouseId: WH, cashierId: 'CASH-AUDITC',
    openingCash: 200000, status: 'OPEN', openedAt: D_UTC_1200, // 19:00 VN 02/10
  } as any);
  await mkOrder({ id: 'o-tmr-1', code: 'AUD-TMR-1', amount: 600000, sessionId: 'sess-tomorrow', createdAt: D_UTC_1200 });
  const D_NEXT_UTC_0100 = '2026-10-02T18:00:00Z'; // 01:00 VN 03/10
  await mkOrder({ id: 'o-tmr-2', code: 'AUD-TMR-2', amount: 250000, sessionId: 'sess-tomorrow', createdAt: D_NEXT_UTC_0100 });

  const rD = await DailySettlementService.getDailyFairSettlement({ warehouseId: WH, date: D });
  const tmrRow = (rD.cashboxReconciliation.sessions as any[]).find((s) => s.id === 'sess-tomorrow');
  ok(
    Number(tmrRow?.expectedCashLive) === 800000,
    'A2.1 Ca mở ngày D, bán 600.000 trong ngày D: kỳ vọng = 200.000 + 600.000 (không tính 250.000 của ngày mai)',
    `expectedCashLive=${tmrRow?.expectedCashLive} (cần 800000)`
  );

  // Tổng phải khớp tổng các dòng (bất biến báo cáo).
  const sumLive = (rD.cashboxReconciliation.sessions as any[])
    .reduce((s, x) => s + Number(x.expectedCashLive || 0), 0);
  ok(
    Math.abs(sumLive - rD.cashboxReconciliation.expectedCashTotal) < 0.01,
    'A2.2 Tổng `expectedCashLive` của từng ca phải khớp `expectedCashTotal`',
    `sumLive=${sumLive}, expectedCashTotal=${rD.cashboxReconciliation.expectedCashTotal}`
  );

  // Đóng 2 ca của A1/A2 ngay tại đây: phạm vi ca mới đúng là "ca có mặt trong
  // ngày", nên để chúng OPEN sẽ (đúng) xuất hiện ở MỌI ngày sau và làm nhiễu A3/A4.
  await db.update(schema.cashboxSessions)
    .set({ status: 'CLOSED', closingCashActual: 700000, expectedCash: 700000, cashDiscrepancy: 0, closedAt: D_NEXT_UTC_0100 })
    .where(sql`${schema.cashboxSessions.id} = 'sess-cross'`);
  await db.update(schema.cashboxSessions)
    .set({ status: 'CLOSED', closingCashActual: 1050000, expectedCash: 1050000, cashDiscrepancy: 0, closedAt: D_NEXT_UTC_0100 })
    .where(sql`${schema.cashboxSessions.id} = 'sess-tomorrow'`);

  // --- A3: ca CHƯA ĐẾM KÉT (auto-close) không được báo chênh lệch bịa --------
  const D3 = '2026-10-05';
  await db.insert(schema.cashboxSessions).values({
    id: 'sess-uncounted', warehouseId: WH, cashierId: 'CASH-AUDITC',
    openingCash: 100000, status: 'CLOSED',
    // Đóng ca tự động: KHÔNG có tiền thực đếm, KHÔNG có chênh lệch.
    closingCashActual: null, expectedCash: 1000000, cashDiscrepancy: null,
    openedAt: `${D3}T02:00:00Z`, closedAt: `${D3}T09:00:00Z`, notes: 'AUTO_CLOSE_UNVERIFIED_CASH',
  } as any);
  await mkOrder({ id: 'o-unc-1', code: 'AUD-UNC-1', amount: 900000, sessionId: 'sess-uncounted', createdAt: `${D3}T05:00:00Z` });

  const rUnc = await DailySettlementService.getDailyFairSettlement({ warehouseId: WH, date: D3 });
  const unc = rUnc.cashboxReconciliation;
  ok(
    unc.cashVariance === null,
    'A3.1 Ca chưa ai đếm két KHÔNG được sinh ra con số chênh lệch',
    `cashVariance=${unc.cashVariance} (UI sẽ in "Thiếu két: ${unc.cashVariance} đ")`
  );
  ok(
    unc.cashVariancePending === true,
    'A3.2 Phải báo "chưa thể đối soát" thay vì im lặng',
    `cashVariancePending=${unc.cashVariancePending}`
  );
  ok(
    unc.closingCashActualTotal === 0 && unc.expectedCashTotal === 1000000,
    'A3.3 Tổng vẫn phải phản ánh đúng: kỳ vọng 1.000.000, thực đếm chưa có (0)',
    `expected=${unc.expectedCashTotal}, actual=${unc.closingCashActualTotal}`
  );

  // --- A4: dấu của chênh lệch (thiếu / thừa) ------------------------------
  const D4 = '2026-10-06';
  await db.insert(schema.cashboxSessions).values({
    id: 'sess-short', warehouseId: WH, cashierId: 'CASH-AUDITC',
    openingCash: 100000, status: 'CLOSED',
    closingCashActual: 900000, expectedCash: 1000000, cashDiscrepancy: -100000,
    openedAt: `${D4}T02:00:00Z`, closedAt: `${D4}T08:00:00Z`,
  } as any);
  await mkOrder({ id: 'o-short', code: 'AUD-SHORT', amount: 900000, sessionId: 'sess-short', createdAt: `${D4}T05:00:00Z` });
  const rShort = await DailySettlementService.getDailyFairSettlement({ warehouseId: WH, date: D4 });
  ok(
    rShort.cashboxReconciliation.cashVariance === -100000,
    'A4.1 Đếm ít hơn kỳ vọng ⇒ chênh lệch ÂM đúng số tiền (thiếu 100.000, không đảo dấu)',
    `cashVariance=${rShort.cashboxReconciliation.cashVariance} (mong đợi -100000)`
  );

  const D5 = '2026-10-07';
  await db.insert(schema.cashboxSessions).values({
    id: 'sess-surplus', warehouseId: WH, cashierId: 'CASH-AUDITC',
    openingCash: 100000, status: 'CLOSED',
    closingCashActual: 1200000, expectedCash: 1000000, cashDiscrepancy: 200000,
    openedAt: `${D5}T02:00:00Z`, closedAt: `${D5}T08:00:00Z`,
  } as any);
  await mkOrder({ id: 'o-surplus', code: 'AUD-SURPLUS', amount: 900000, sessionId: 'sess-surplus', createdAt: `${D5}T05:00:00Z` });
  const rSur = await DailySettlementService.getDailyFairSettlement({ warehouseId: WH, date: D5 });
  ok(
    (rSur.cashboxReconciliation.cashVariance ?? 0) > 0,
    'A4.2 Đếm nhiều hơn kỳ vọng ⇒ chênh lệch DƯƠNG (thừa két)',
    `cashVariance=${rSur.cashboxReconciliation.cashVariance} (mong đợi > 0)`
  );

  // --- A5: chốt ngày trùng lặp -------------------------------------------
  const D6 = '2026-10-08';
  await db.insert(schema.cashboxSessions).values({
    id: 'sess-ok', warehouseId: WH, cashierId: 'CASH-AUDITC',
    openingCash: 500000, status: 'CLOSED',
    closingCashActual: 1500000, expectedCash: 1500000, cashDiscrepancy: 0,
    openedAt: `${D6}T02:00:00Z`, closedAt: `${D6}T08:00:00Z`,
  } as any);
  await mkOrder({ id: 'o-ok', code: 'AUD-OK', amount: 1000000, sessionId: 'sess-ok', createdAt: `${D6}T05:00:00Z` });

  const close1: any = await DailySettlementService.closeDay({
    warehouseId: WH, date: D6, actorRole: 'ROLE_MANAGER', actorId: 'QL-01', notes: 'chốt ngày auditC',
  });
  const close2: any = await DailySettlementService.closeDay({
    warehouseId: WH, date: D6, actorRole: 'ROLE_MANAGER', actorId: 'QL-01', notes: 'chốt ngày auditC',
  });
  const idemRows = await db.select().from(schema.idempotencyKeys)
    .where(sql`${schema.idempotencyKeys.key} = ${DailySettlementService.dayCloseKey(WH, D6)}`);
  const auditRows = await db.select().from(schema.auditLogs)
    .where(sql`${schema.auditLogs.id} = ${`aud-day-close-${WH}-${D6}`}`);
  ok(idemRows.length === 1, 'A5.1 Gọi chốt ngày 2 lần ⇒ chỉ 1 bản ghi idempotency',
    `bản ghi=${idemRows.length}, isDuplicate lần 2=${close2?.isDuplicate}`);
  ok(auditRows.length === 1, 'A5.2 Không ghi trùng audit log SETTLE_DAY', `audit rows=${auditRows.length}`);
  ok(close1.netSales === close2.netSales && close1.dayCloseKey === close2.dayCloseKey,
    'A5.3 Lần gọi lại trả về đúng bản ghi cũ', `netSales ${close1.netSales} vs ${close2.netSales}`);

  let dupBlocked = false;
  try {
    await DailySettlementService.closeDay({
      warehouseId: WH, date: D6, actorRole: 'ROLE_MANAGER', actorId: 'QL-01', notes: 'khác nội dung',
    });
  } catch { dupBlocked = true; }
  ok(dupBlocked, 'A5.4 Chốt lại với nội dung khác phải bị từ chối (một ngày không có 2 bản chốt)');

  // --- A6: bảng đối soát tồn KHÔNG được cắt theo "top 10 bán chạy" ---------
  // 12 ấn bản, số lượng bán 1..12 ⇒ top 10 là 12,11,10,9,8,7,6,5,4,3. Ấn bản
  // AUD-TOP-1 và AUD-TOP-2 nằm NGOÀI top 10 nhưng vẫn bán thật ⇒ `soldToday`
  // phải là 1 và 2, không phải 0. Bug đã có: `soldMap` dựng lại từ `topSellers`
  // đã `.slice(0, 10)`.
  for (let i = 1; i <= 12; i++) {
    const edId = `ed-top-${i}`;
    await db.insert(schema.editions).values({
      id: edId, code: `AUD-TOP-${i}`, workId: 'wk-b', isbn: `9790000000${100 + i}`,
      isbnLast4: `0${100 + i}`, coverPrice: 10000, isActive: true,
    });
    await db.insert(schema.stockBalances).values({
      id: `sb-${edId}`, editionId: edId, warehouseId: WH, condition: 'NEW', physicalQuantity: 100,
    });
    await mkOrder({
      id: `o-top-s${i}`, code: `AUD-TOPS-${i}`, amount: 10 * i, createdAt: `${D6}T06:00:00Z`,
      editionId: edId, qty: i, unitPrice: 10000,
    });
  }
  const rTop = await DailySettlementService.getDailyFairSettlement({ warehouseId: WH, date: D6 });
  const soldByCode = new Map<string, number>(
    rTop.inventoryReconciliation.map((it: any) => [it.code, Number(it.soldToday)])
  );
  ok(
    rTop.topSellers.length === 10 && !rTop.topSellers.some((s: any) => s.code === 'AUD-TOP-1'),
    'A6.1 Bảng "top bán chạy" cắt đúng 10 dòng, AUD-TOP-1/2 nằm ngoài danh sách đó',
    `topSellers=${rTop.topSellers.length}, có AUD-TOP-1=${rTop.topSellers.some((s: any) => s.code === 'AUD-TOP-1')}`
  );
  ok(
    soldByCode.get('AUD-TOP-1') === 1 && soldByCode.get('AUD-TOP-2') === 2,
    'A6.2 `soldToday` của ấn bản NGOÀI top 10 vẫn phải đúng (không bị đoán bằng 0)',
    `AUD-TOP-1=${soldByCode.get('AUD-TOP-1')} (cần 1), AUD-TOP-2=${soldByCode.get('AUD-TOP-2')} (cần 2), ` +
    `AUD-TOP-12=${soldByCode.get('AUD-TOP-12')} (cần 12)`
  );

  // ======================================================================
  // B. ROYALTY
  // ======================================================================
  console.log('\n=== B. ROYALTY ===');

  // --- B1: công thức chia phải khớp ledger thật --------------------------
  const TERM_A = { from: '2026-01-01', to: '2026-12-31' };
  const cA = await RoyaltyService.createContract({
    contractNumber: 'AUD-HD-A', workId: 'wk-a', licensorName: 'Tác giả A',
    royaltyRate: 0.075, printQuota: 5000, advanceAmount: 0,
    effectiveDate: TERM_A.from, expirationDate: TERM_A.to, createdBy: 'QL-01',
  });
  // 7 cuốn ed-a1 (89.000) + 3 cuốn ed-a2 (123.000) trong hạn.
  const ledgerRows = [
    { id: 'led-1', ed: 'ed-a1', qty: -7, ts: '2026-03-10T04:00:00Z' },
    { id: 'led-2', ed: 'ed-a2', qty: -3, ts: '2026-03-11T04:00:00Z' },
    // Ngoài hạn: nằm trước effectiveDate ⇒ KHÔNG được tính.
    { id: 'led-3', ed: 'ed-a1', qty: -100, ts: '2025-12-31T16:59:30Z' },
  ];
  for (const r of ledgerRows) {
    await db.insert(schema.inventoryLedger).values({
      id: r.id, editionId: r.ed, warehouseId: WH, eventType: 'DISPATCH_SALE',
      quantityDelta: r.qty, condition: 'NEW', documentRef: 'AUD-ROY',
      actorId: 'auditc', idempotencyKey: 'k-' + r.id, recordedAt: r.ts,
    } as any);
  }
  // In trong hạn: 800 cuốn ed-a1.
  await db.insert(schema.inventoryLedger).values({
    id: 'led-print', editionId: 'ed-a1', warehouseId: WH, eventType: 'RECEIPT',
    quantityDelta: 800, condition: 'NEW', documentRef: 'AUD-PRINT',
    actorId: 'auditc', idempotencyKey: 'k-led-print', recordedAt: '2026-02-01T04:00:00Z',
  } as any);

  const stmtA = await RoyaltyService.royaltyStatement(cA.contractId);
  const expCoverRevenue = 7 * 89000 + 3 * 123000;         // 623.000 + 369.000
  const expAccrued = Math.round(expCoverRevenue * 0.075); // 74.400
  ok(stmtA.soldQty === 10, 'B1.1 soldQty = 10 cuốn trong hạn (không tính 100 cuốn ngoài hạn)',
    `soldQty=${stmtA.soldQty} (cần 10)`);
  ok(stmtA.coverRevenue === expCoverRevenue, 'B1.2 coverRevenue khớp số học từ lượng bán × giá bìa',
    `coverRevenue=${stmtA.coverRevenue} (cần ${expCoverRevenue})`);
  ok(stmtA.accrued === expAccrued, 'B1.3 accrued = làm tròn MỘT LẦN ở cuối, không làm tròn mỗi dòng',
    `accrued=${stmtA.accrued} (cần ${expAccrued}); làm tròn từng dòng sẽ ra ` +
    `${Math.round(7 * 89000 * 0.075) + Math.round(3 * 123000 * 0.075)}`);
  ok(stmtA.payable === expAccrued, 'B1.4 payable = accrued − tạm ứng (tạm ứng = 0)',
    `payable=${stmtA.payable}`);

  const quotaA = await RoyaltyService.quotaStatus(cA.contractId);
  ok(quotaA.printed === 800 && quotaA.remaining === 4200,
    'B1.5 Hạn ngạch in chỉ tính RECEIPT trong hạn (800), không tính số dư mở đầu',
    `printed=${quotaA.printed}, remaining=${quotaA.remaining}`);

  // --- B2: tạm ứng lớn hơn phát sinh ⇒ payable = 0, không âm ---------------
  const cAdv = await RoyaltyService.createContract({
    contractNumber: 'AUD-HD-ADV', workId: 'wk-b', licensorName: 'Tác giả B',
    royaltyRate: 0.1, printQuota: 1000, advanceAmount: 999999999,
    effectiveDate: TERM_A.from, expirationDate: TERM_A.to, createdBy: 'QL-01',
  });
  const stmtAdv = await RoyaltyService.royaltyStatement(cAdv.contractId);
  ok(stmtAdv.payable === 0 && Number.isFinite(stmtAdv.payable),
    'B2.1 Tạm ứng vượt phát sinh ⇒ payable = 0 (không âm, không NaN)',
    `payable=${stmtAdv.payable}, accrued=${stmtAdv.accrued}`);

  // --- B3: tác phẩm không có ấn bản nào ⇒ không NaN -------------------------
  await db.insert(schema.works).values({ id: 'wk-empty', code: 'AUD-EMPTY', title: 'Tác phẩm rỗng', author: 'x', isActive: true });
  const cEmpty = await RoyaltyService.createContract({
    contractNumber: 'AUD-HD-EMPTY', workId: 'wk-empty', licensorName: 'Tác giả rỗng',
    royaltyRate: 0.1, printQuota: 100, effectiveDate: TERM_A.from,
    expirationDate: TERM_A.to, createdBy: 'QL-01',
  });
  const stmtEmpty = await RoyaltyService.royaltyStatement(cEmpty.contractId);
  const qEmpty = await RoyaltyService.quotaStatus(cEmpty.contractId);
  ok(
    stmtEmpty.soldQty === 0 && stmtEmpty.coverRevenue === 0 && stmtEmpty.accrued === 0 && stmtEmpty.payable === 0
      && qEmpty.remaining === 100,
    'B3.1 Tác phẩm chưa có ấn bản: 0/0/0/0, hạn ngạch còn nguyên, không NaN',
    `stmt=${JSON.stringify({ q: stmtEmpty.soldQty, r: stmtEmpty.coverRevenue, a: stmtEmpty.accrued, p: stmtEmpty.payable })}, remaining=${qEmpty.remaining}`
  );

  // --- B4: ngưỡng cảnh báo bậc thang --------------------------------------
  const cWarn = await RoyaltyService.createContract({
    contractNumber: 'AUD-HD-WARN', workId: 'wk-c', licensorName: 'Tác giả C',
    royaltyRate: 0.1, printQuota: 1000, effectiveDate: TERM_A.from,
    expirationDate: TERM_A.to, createdBy: 'QL-01',
  });
  // In 799 ⇒ còn 201 (> 200, > 10%) ⇒ KHÔNG cảnh báo.
  await db.insert(schema.inventoryLedger).values({
    id: 'led-warn-799', editionId: 'ed-c1', warehouseId: WH, eventType: 'RECEIPT',
    quantityDelta: 799, condition: 'NEW', documentRef: 'AUD-WARN', actorId: 'auditc',
    idempotencyKey: 'k-warn-799', recordedAt: '2026-02-01T04:00:00Z',
  } as any);
  const qWarn1 = await RoyaltyService.quotaStatus(cWarn.contractId);
  // In thêm 1 ⇒ còn 200 ⇒ chạm ngưỡng tuyệt đối ⇒ cảnh báo.
  await db.insert(schema.inventoryLedger).values({
    id: 'led-warn-1', editionId: 'ed-c1', warehouseId: WH, eventType: 'RECEIPT',
    quantityDelta: 1, condition: 'NEW', documentRef: 'AUD-WARN', actorId: 'auditc',
    idempotencyKey: 'k-warn-1', recordedAt: '2026-02-01T04:00:00Z',
  } as any);
  const qWarn2 = await RoyaltyService.quotaStatus(cWarn.contractId);
  ok(
    qWarn1.remaining === 201 && qWarn1.quotaWarning === false,
    'B4.1 Còn 201 (vượt ngưỡng tuyệt đối 200) ⇒ chưa cảnh báo',
    `remaining=${qWarn1.remaining}, warning=${qWarn1.quotaWarning}, QUOTA_WARN_ABSOLUTE=${QUOTA_WARN_ABSOLUTE}`
  );
  ok(
    qWarn2.remaining === 200 && qWarn2.quotaWarning === true,
    'B4.2 Còn đúng 200 ⇒ bật cảnh báo (biên <=)',
    `remaining=${qWarn2.remaining}, warning=${qWarn2.quotaWarning}`
  );

  // --- B5: lọc vòng đời KHÔNG được cắt bởi limit trước --------------------
  // 2 hợp đồng MỚI NHẤT (theo created_at) đều KHÔNG ACTIVE. listContracts
  // ('ACTIVE', 2) phải trả 2 hợp đồng ACTIVE thật, không phải 0 dòng.
  const cLive = await RoyaltyService.createContract({
    contractNumber: 'AUD-HD-LIVE', workId: 'wk-a', licensorName: 'Còn hiệu lực',
    royaltyRate: 0.1, printQuota: 1000, effectiveDate: TERM_A.from,
    expirationDate: TERM_A.to, createdBy: 'QL-01',
  });
  const cDead = await RoyaltyService.createContract({
    contractNumber: 'AUD-HD-DEAD', workId: 'wk-a', licensorName: 'Đã chấm dứt',
    royaltyRate: 0.1, printQuota: 1000, effectiveDate: TERM_A.from,
    expirationDate: TERM_A.to, createdBy: 'QL-01',
  });
  const cOld = await RoyaltyService.createContract({
    contractNumber: 'AUD-HD-OLD', workId: 'wk-a', licensorName: 'Đã quá hạn',
    royaltyRate: 0.1, printQuota: 1000, effectiveDate: '2020-01-01',
    expirationDate: '2020-12-31', createdBy: 'QL-01',
  });
  await RoyaltyService.terminateContract(cDead.contractId, 'QL-01', 'thanh lý');
  // Ép created_at để thứ tự newest-first xác định: DEAD mới nhất, OLD kế, LIVE
  // là HĐ ACTIVE mới nhất còn lại. Các HĐ tạo "bây giờ" (2026) cũng ACTIVE.
  await db.update(schema.rightsContracts)
    .set({ createdAt: '2029-01-01 00:00:00' })
    .where(sql`${schema.rightsContracts.id} = ${cLive.contractId}`);
  await db.update(schema.rightsContracts)
    .set({ createdAt: '2030-01-01 00:00:00' })
    .where(sql`${schema.rightsContracts.id} = ${cOld.contractId}`);
  await db.update(schema.rightsContracts)
    .set({ createdAt: '2031-01-01 00:00:00' })
    .where(sql`${schema.rightsContracts.id} = ${cDead.contractId}`);

  const actives = await RoyaltyService.listContracts('ACTIVE', 2);
  const expired = await RoyaltyService.listContracts('EXPIRED', 2);
  const terminated = await RoyaltyService.listContracts('TERMINATED', 2);
  ok(
    actives.length === 2 && actives.some((c: any) => c.id === cLive.contractId),
    'B5.1 listContracts("ACTIVE", 2) trả 2 HĐ ACTIVE thật, không phải 0 (limit không được cắt trước khi lọc)',
    `trả về ${actives.length} dòng: ${JSON.stringify(actives.map((c: any) => c.contractNumber))}`
  );
  ok(
    expired.length === 1 && expired[0].id === cOld.contractId
      && terminated.length === 1 && terminated[0].id === cDead.contractId,
    'B5.2 Lọc EXPIRED / TERMINATED trong SQL khớp đúng hợp đồng tương ứng',
    `EXPIRED=${JSON.stringify(expired.map((c: any) => c.contractNumber))}, ` +
    `TERMINATED=${JSON.stringify(terminated.map((c: any) => c.contractNumber))}`
  );

  // --- B6: vòng đời suy ra theo ngày VN ------------------------------------
  ok(
    deriveLifecycle(null, '2099-01-01', '2026-01-01') === 'ACTIVE' &&
      deriveLifecycle(false, '2026-01-01', '2026-01-01') === 'ACTIVE' &&
      deriveLifecycle(false, '2025-12-31', '2026-01-01') === 'EXPIRED' &&
      deriveLifecycle(true, '2099-01-01', '2026-01-01') === 'TERMINATED',
    'B6.1 Vòng đời: ngày hết hạn = hôm nay vẫn ACTIVE; hôm sau mới EXPIRED; terminated thắng',
    'ACTIVE/EXPIRED/TERMINATED đúng 3 nhánh'
  );

  // --- B7: từ chối rate 0 / 1 (chia cho 0) --------------------------------
  let rate0 = false, rate1 = false, rateNaN = false;
  try {
    await RoyaltyService.createContract({
      contractNumber: 'AUD-HD-R0', workId: 'wk-a', royaltyRate: 0, printQuota: 100,
      effectiveDate: '2026-01-01', expirationDate: '2027-01-01', createdBy: 'x',
    });
  } catch { rate0 = true; }
  try {
    await RoyaltyService.createContract({
      contractNumber: 'AUD-HD-R1', workId: 'wk-a', royaltyRate: 1, printQuota: 100,
      effectiveDate: '2026-01-01', expirationDate: '2027-01-01', createdBy: 'x',
    });
  } catch { rate1 = true; }
  try {
    await RoyaltyService.createContract({
      contractNumber: 'AUD-HD-RN', workId: 'wk-a', royaltyRate: Number('abc'), printQuota: 100,
      effectiveDate: '2026-01-01', expirationDate: '2027-01-01', createdBy: 'x',
    });
  } catch { rateNaN = true; }
  ok(rate0 && rate1 && rateNaN, 'B7.1 Chặn royalty_rate = 0, = 1 và NaN (không chia cho 0)',
    `rate0=${rate0}, rate1=${rate1}, NaN=${rateNaN}`);

  // ======================================================================
  // C. BÁO CÁO DOANH THU
  // ======================================================================
  console.log('\n=== C. BÁO CÁO DOANH THU ===');

  const RD = '2026-11-10';
  const mk = (id: string, code: string, amount: number, createdAt: string, channel = 'FAIR_EVENT', method = 'CASH') =>
    mkOrder({ id, code, amount, createdAt, channel, method, editionId: 'ed-a1', qty: 1, unitPrice: amount });

  await mk('o-r-early', 'AUD-R-EARLY', 111000, '2026-11-09T17:30:00Z'); // 00:30 VN 10/11
  await mk('o-r-late', 'AUD-R-LATE', 222000, '2026-11-10T16:59:30Z'); // 23:59:30 VN 10/11
  await mk('o-r-sqlearly', 'AUD-R-SQLE', 333000, '2026-11-09 17:30:00'); // họ SQLite, 00:30 VN 10/11
  await mk('o-r-sqllate', 'AUD-R-SQLL', 444000, '2026-11-10 16:59:30'); // họ SQLite, 23:59:30 VN 10/11
  await mk('o-r-prev', 'AUD-R-PREV', 555000, '2026-11-09T16:59:30Z'); // 23:59:30 VN 09/11 ⇒ NGOÀI ngày
  await mk('o-r-next', 'AUD-R-NEXT', 666000, '2026-11-10T17:00:00Z'); // 00:00 VN 11/11 ⇒ NGOÀI ngày

  const expectedDayRevenue = 111000 + 222000 + 333000 + 444000; // 1.110.000
  const expectedDayOrders = 4;

  const ch = await AnalyticsService.byChannel({ startDate: RD, endDate: RD });
  const dayRevenue = ch.reduce((s, r) => s + Number(r.revenue || 0), 0);
  const dayOrders = ch.reduce((s, r) => s + Number(r.orders || 0), 0);
  ok(
    dayRevenue === expectedDayRevenue,
    'C1.1 byChannel(ngày D) phải gom đủ 4 đơn (00:30 VN + 23:59:30 VN, cả 2 họ timestamp)',
    `doanh thu ngày ${RD} = ${dayRevenue} (cần ${expectedDayRevenue}); chi tiết=${JSON.stringify(ch.map((r) => [r.channel, r.orders, r.revenue]))}`
  );
  ok(
    dayOrders === expectedDayOrders,
    'C1.2 Số đơn ngày D khớp tổng đếm được',
    `đơn=${dayOrders} (cần ${expectedDayOrders})`
  );

  // Sổ doanh số (đường đã sửa trước đây) phải cho CÙNG kết quả.
  const ledger = await OrderService.getSalesSummary({ startDate: RD, endDate: RD });
  ok(
    ledger.totalRevenue === expectedDayRevenue,
    'C1.3 Sổ doanh số (getSalesSummary) và báo cáo phân tích phải cho CÙNG tổng',
    `getSalesSummary=${ledger.totalRevenue} vs byChannel=${dayRevenue} (cần ${expectedDayRevenue})`
  );

  // --- C2: kênh SPONSORSHIP không được làm tổng lệch bóc kênh ---------------
  // Dùng CỬA SỔ UTC (ISO đầy đủ) để ca này đo đúng chuyện "tổng vs bóc kênh",
  // không đo lại lỗi ngày ở C1. Cần có dữ liệu thật, nếu không 0 == 0 xanh giả.
  const ISO_FROM = '2026-11-10T17:00:00.000Z'; // 00:00 VN 11/11
  const ISO_TO = '2026-11-11T16:59:59.999Z';   // hết ngày 11/11
  const RD2 = '2026-11-11';
  await mk('o-s-sale', 'AUD-S-SALE', 500000, '2026-11-11T04:00:00Z', 'RETAIL_OFFICE');
  await mk('o-s-gift', 'AUD-S-GIFT', 0, '2026-11-11T04:00:00Z', 'SPONSORSHIP');
  const ch2 = await AnalyticsService.byChannel({ startDate: ISO_FROM, endDate: ISO_TO });
  const cf2 = await AnalyticsService.cashflow({ startDate: ISO_FROM, endDate: ISO_TO });
  const sumCh2 = ch2.reduce((s, r) => s + Number(r.revenue || 0), 0);
  const salesOnly = ch2.filter((c) => c.channel !== 'SPONSORSHIP').reduce((s, r) => s + Number(r.revenue || 0), 0);
  ok(
    sumCh2 >= 500000 && ch2.length >= 2,
    'C2.0 Dữ liệu bóc kênn PHẢI có thật (nếu 0 thì các assert dưới đây xanh giả)',
    `tổng=${sumCh2}, số kênh=${ch2.length}, chi tiết=${JSON.stringify(ch2.map((r) => [r.channel, r.orders, r.revenue]))}`
  );
  ok(
    cf2.salesRevenue === salesOnly,
    'C2.1 cashflow.salesRevenue (loại SPONSORSHIP) phải bằng tổng bóc kênh loại SPONSORSHIP',
    `salesRevenue=${cf2.salesRevenue}, tổng kênh loại SPONSORSHIP=${salesOnly}, tổng mọi kênh=${sumCh2}`
  );
  ok(
    Math.abs(sumCh2 - salesOnly) < 0.01,
    'C2.2 SPONSORSHIP 0đ không được làm lệch giữa tổng và bóc kênh',
    `tổng mọi kênh=${sumCh2}, tổng bán=${salesOnly}`
  );
  ok(
    ch2.every((r) => Number.isFinite(Number(r.share)) && Number(r.share) >= 0 && Number(r.share) <= 1),
    'C2.3 `share` mỗi kênh là số hữu hạn trong [0, 1] (không NaN/Infinity)',
    `share=${JSON.stringify(ch2.map((r) => r.share))}`
  );

  // --- C3: topEditions — tổng phải tính trên TẬP ĐỦ, không trên tập đã cắt --
  for (let i = 1; i <= 5; i++) {
    await mk(`o-top-${i}`, `AUD-TOP-${i}`, 10000 * i, '2026-11-12T04:00:00Z', 'RETAIL_OFFICE');
    await db.insert(schema.orderItems).values({
      id: `it-top-${i}`, orderId: `o-top-${i}`, editionId: 'ed-b1', quantity: i,
      unitCoverPrice: 10000, unitSellingPrice: 10000, totalAmount: 10000 * i,
    } as any);
  }
  const top = await AnalyticsService.topEditions({ startDate: '2026-11-12', endDate: '2026-11-12' }, 1, WH);
  const topAll = await AnalyticsService.topEditions({ startDate: '2026-11-12', endDate: '2026-11-12' }, 100, WH);
  const sumAllRevenue = topAll.items.reduce((s, r) => s + Number(r.revenue || 0), 0);
  const sumAllQty = topAll.items.reduce((s, r) => s + Number(r.qty || 0), 0);
  // 5 đơn × 2 dòng: 1 dòng ed-a1 (qty 1) + 1 dòng ed-b1 (qty i). Mỗi ấn bản
  // 150.000 đ ⇒ tổng 300.000 đ / 20 cuốn trên CẢ 2 ấn bản.
  ok(
    top.items.length === 1 && topAll.items.length === 2
      && sumAllRevenue === 300000 && sumAllQty === 20
      && top.totalRevenue === sumAllRevenue && top.totalQty === sumAllQty,
    'C3.1 totalQty/totalRevenue tính trên TẬP ĐỦ, không cộng trên tập đã bị `limit` cắt',
    `items(limit 1)=${top.items.length}, items(đủ)=${topAll.items.length}, ` +
    `totalRevenue=${top.totalRevenue} (tổng tập đủ=${sumAllRevenue}, cần 300000), ` +
    `totalQty=${top.totalQty} (tổng tập đủ=${sumAllQty}, cần 20)`
  );

  // --- C4: khoảng rỗng không được sinh NaN / Infinity ---------------------
  const emptyCh = await AnalyticsService.byChannel({ startDate: '2030-01-01', endDate: '2030-01-02' });
  const emptyCf = await AnalyticsService.cashflow({ startDate: '2030-01-01', endDate: '2030-01-02' });
  const emptyTop = await AnalyticsService.topEditions({ startDate: '2030-01-01', endDate: '2030-01-02' }, 20, WH);
  const badNums = [
    ...emptyCh.map((r) => r.share),
    emptyCf.salesRevenue, emptyCf.netRevenue, emptyCf.codPending, emptyCf.codReceived,
    emptyTop.totalQty, emptyTop.totalRevenue,
    ...emptyTop.items.map((i) => i.qtyShare),
  ].filter((v) => typeof v !== 'number' || !Number.isFinite(v));
  ok(badNums.length === 0, 'C4.1 Khoảng không có dữ liệu: không NaN/Infinity/undefined lọt ra',
    `giá trị lỗi=${JSON.stringify(badNums)}`);

  // --- C5: mốc cuối kỳ không nuốt giao dịch cuối cùng ----------------------
  const chBoundary = await AnalyticsService.byChannel({ startDate: '2026-11-10', endDate: '2026-11-10' });
  const hasLate = chBoundary.some((r) => Number(r.orders) > 0);
  ok(hasLate && dayRevenue === expectedDayRevenue,
    'C5.1 Giao dịch lúc 23:59:30 ngày cuối phải còn trong báo cáo (không bị mốc cuối nuốt)',
    `tổng=${dayRevenue} (cần ${expectedDayRevenue})`);

  // ======================================================================
  // D. THU TIỀN CÔNG NỢ KÝ GỬI (settlement.service)
  // ======================================================================
  console.log('\n=== D. THU TIỀN KÝ GỬI (paid_at là ngày nghiệp vụ) ===');

  const { SettlementService } = await import('../src/services/settlement.service');
  const partId = 'part-auditc';
  await db.insert(schema.partners).values({
    id: partId, code: 'AUDIT_PARTNER', name: 'Đại lý kiểm định', type: 'CONSIGNMENT', discountRate: 0.4,
  });
  const stmtId = 'CS-AUDITC-1';
  await db.insert(schema.consignmentStatements).values({
    id: stmtId, partnerId: partId, periodStart: '2026-11-01', periodEnd: '2026-11-30',
    fiscalScope: 'OFFICIAL_TAX', status: 'CONFIRMED', totalReceivable: 1000000,
    createdBy: 'QL-01', confirmedAt: '2026-12-01 00:00:00',
  } as any);

  const pay = await SettlementService.recordPayment({
    statementId: stmtId, amount: 400000, paymentMethod: 'BANK_TRANSFER',
    reference: 'FT-ABC-001', receivedBy: 'QL-01', paidAt: '2026-11-15',
  } as any);
  const bal = await SettlementService.getBalance(stmtId);
  ok(
    pay.remaining === 600000 && bal.remaining === 600000 && bal.paid === 400000,
    'D1.1 Thu 400.000 trên kỳ 1.000.000 ⇒ còn nợ 600.000 (tổng khớp sổ)',
    `remaining=${bal.remaining}, paid=${bal.paid}, paymentsCount=${bal.paymentsCount}`
  );

  let badDate = false;
  try {
    await SettlementService.recordPayment({
      statementId: stmtId, amount: 1000, paymentMethod: 'CASH',
      reference: 'FT-X', receivedBy: 'QL-01', paidAt: 'hôm qua',
    } as any);
  } catch { badDate = true; }
  ok(badDate, 'D1.2 `paid_at` sai định dạng phải bị từ chối (nếu không, phiếu thu nằm ở ngày không tồn tại)',
    `paidAt="hôm qua" bị chặn=${badDate}`);

  let badDate2 = false;
  try {
    await SettlementService.recordPayment({
      statementId: stmtId, amount: 1000, paymentMethod: 'CASH',
      reference: 'FT-Y', receivedBy: 'QL-01', paidAt: '01/10/2026',
    } as any);
  } catch { badDate2 = true; }
  ok(badDate2, 'D1.3 `paid_at` dạng DD/MM/YYYY cũng bị từ chối', `bị chặn=${badDate2}`);

  const payRows = await db.select().from(schema.consignmentPayments)
    .where(sql`${schema.consignmentPayments.statementId} = ${stmtId}`);
  ok(
    payRows.length === 1 && payRows[0].paidAt === '2026-11-15',
    'D1.4 Hai lần gọi sai định dạng không được ghi thêm phiếu thu nào',
    `số phiếu thu=${payRows.length}, paidAt=${payRows[0]?.paidAt}`
  );

  // ======================================================================
  console.log('\n================ BẢNG KẾT QUẢ ================');
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'} | ${r.name}`);
  }
  console.log('===============================================');
  console.log(`Tổng ${checks} assertion — PASS ${checks - failures}, FAIL ${failures}.`);

  if (failures > 0) {
    assert.ok(false, `${failures}/${checks} assertion FAIL — xem bảng trên`);
  }
}

run()
  .catch((err) => {
    console.error('\n❌ test-settlement-royalty-audit:', err);
    process.exit(1);
  })
  .finally(() => {
    for (const s of ['', '-wal', '-shm', '-journal']) {
      try { fs.unlinkSync(DB_FILE + s); } catch { /* handle chưa nhả */ }
    }
  });
