/**
 * Bảng tổng hợp Hồ Gươm (Task 1): API full đầu sách + Task 2 (nút CSV).
 * RED trước, GREEN sau (TDD).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const readSrc2 = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');
let checks2 = 0;
const ok2 = (cond: boolean, msg: string) => { checks2++; assert.ok(cond, msg); };

// --- Task 1: shape API (file chưa tồn tại lúc RED) ---
const route2 = readSrc2('src/app/api/reports/ho-guom-summary/route.ts');
ok2(/ROLE_OWNER/.test(route2) && /ROLE_MANAGER/.test(route2), 'API chi Chu + Quan ly');
ok2(/ho-guom-summary/.test(route2), 'API tra mode ho-guom-summary');
ok2(/assertVnDay|BAD_RANGE|92/.test(route2), 'API chan ky xau/qua dai');
console.log(`=== HO-GUOM-SUMMARY (Task 1 shape): PASS — ${checks2} assertions ===`);

// --- Task 2: nút CSV trong modal + helper BOM ---
const settleModal2 = readSrc2('src/components/pos/DailyFairSettlementModal.tsx');
const csvLib = readSrc2('src/lib/csv-export.ts');
ok2(/Xuất CSV/.test(settleModal2), 'modal Ky co nut Xuat CSV');
ok2(/canExportCsv/.test(settleModal2), 'nut CSV chi Quan ly tro len (canExportCsv)');
ok2(/ho-guom-summary/.test(settleModal2), 'CSV doc tu API tong hop');
ok2(/FEFF|BOM/.test(csvLib), 'CSV co BOM mo bang Excel');

import { db } from '../src/db';

async function dbPart() {
  const { orders, orderItems, editions, products, works, warehouses } = await import('../src/db');
  const { eq, sql } = await import('drizzle-orm');
  const { DailySettlementService } = await import('../src/services/daily-settlement.service');
  const { HoGuomSummaryService } = await import('../src/services/ho-guom-summary.service');
  const wh = (await db.select().from(warehouses))[0];
  assert.ok(wh, 'DB cách ly phải có kho');
  const stamp = Date.now();
  const wid = `wh-hoguom-${stamp}`;
  await db.insert(warehouses).values({ id: wid, code: `HOG${stamp}`, name: 'Kho Ho Guom test', warehouseType: 'FAIR_EVENT', isActive: true } as any);
  const workId = `w-hoguom-${stamp}`;
  await db.insert(works).values({ id: workId, code: `W-HOG-${stamp}`, title: 'Tac pham test', author: 'Tac gia test' } as any);
  const edA = `ed-hoguom-a-${stamp}`;
  const edB = `ed-hoguom-b-${stamp}`;
  for (const [eid, code, title, price] of [[edA, `HOGA${stamp}`, 'Sach A', 100], [edB, `HOGB${stamp}`, 'Sach B', 200]] as any[]) {
    await db.insert(products).values({ id: eid, name: title, productKind: 'BOOK', sellingPrice: price } as any);
    await db.insert(editions).values({ id: eid, workId, code, title, isbn: '9780000000000', isbnLast4: '0000', coverPrice: price, productId: eid } as any);
  }
  const mkOrder = (n: number, iso: string, amt: number, method: string) => ({
    id: `ord-hoguom-${stamp}-${n}`,
    orderCode: `HOG${stamp}${n}`,
    idempotencyKey: `idem-hoguom-${stamp}-${n}`,
    warehouseId: wid,
    customerName: 'Khach Ho Guom',
    subtotal: amt,
    finalAmount: amt,
    paymentMethod: method,
    status: 'COMPLETED',
    cashierId: 'staff-admin',
    createdAt: iso,
  });
  await db.insert(orders).values([
    mkOrder(1, '2026-09-20T02:00:00.000Z', 400, 'CASH'),
    mkOrder(2, '2026-09-20T03:00:00.000Z', 100, 'BANK_TRANSFER'),
  ] as any);
  await db.insert(orderItems).values([
    { id: `oi-hg-${stamp}-1`, orderId: `ord-hoguom-${stamp}-1`, productId: edA, editionId: edA, quantity: 2, unitCoverPrice: 100, unitSellingPrice: 100, totalAmount: 200 } as any,
    { id: `oi-hg-${stamp}-2`, orderId: `ord-hoguom-${stamp}-1`, productId: edB, editionId: edB, quantity: 1, unitCoverPrice: 200, unitSellingPrice: 200, totalAmount: 200 } as any,
    // Dòng quà: is_gift_line=1, giá 0 — KHÔNG được vào doanh thu/top.
    { id: `oi-hg-${stamp}-3`, orderId: `ord-hoguom-${stamp}-2`, productId: edA, editionId: edA, quantity: 5, unitCoverPrice: 100, unitSellingPrice: 0, totalAmount: 0, isGiftLine: 1 } as any,
    { id: `oi-hg-${stamp}-4`, orderId: `ord-hoguom-${stamp}-2`, productId: edB, editionId: edB, quantity: 1, unitCoverPrice: 100, unitSellingPrice: 100, totalAmount: 100 } as any,
  ]);
  try {
    // Gía trị hằng lấy từ nguồn thật: CASH + BANK_TRANSFER (schema.ts), không QR_TRANSFER.
    const day: any = await DailySettlementService.getDailyFairSettlement({ warehouseId: wid, date: '2026-09-20' });
    const sum: any = await HoGuomSummaryService.summary({ warehouseId: wid, startDate: '2026-09-20', endDate: '2026-09-20' });
    assert.equal(sum.mode, 'ho-guom-summary', 'mode tong hop');
    assert.equal(sum.totals.net, day.financials.netSales, 'ky 1 ngay == bao cao ngay (net)');
    assert.equal(sum.totals.orders, day.financials.totalOrdersCount, 'ky 1 ngay == bao cao ngay (don)');
    assert.equal(sum.totals.net, 500, 'thu 500 (400+100), qua 0d khong cong');
    assert.equal(sum.lines.length, 2, 'full 2 dau sach (khong slice top)');
    const lineA = sum.lines.find((l: any) => l.code === `HOGA${stamp}`);
    assert.ok(lineA && lineA.soldQty === 2 && lineA.soldRevenue === 200, 'sach A: 2 cuon/200đ (qua 5 cuon khong cong)');
    assert.equal(sum.giftsInScope.total, 5, 'qua trong kho: 5');
    assert.ok(String(sum.stockNote).includes('hiện tại'), 'nhan ton hien tai bat buoc');
    const s2: any = await HoGuomSummaryService.summary({ warehouseId: wid, startDate: '2026-09-20', endDate: '2026-09-21' });
    assert.equal(s2.range.dayCount, 2, 'ky 2 ngay du 2 moc');
    assert.equal(s2.totals.net, 500, 'ky 2 ngay van thu 500 (ngay 21 khong don)');
    await assert.rejects(
      HoGuomSummaryService.summary({ warehouseId: wid, startDate: '2026-09-21', endDate: '2026-09-20' }),
      'dao ngay bi tu choi'
    );
    console.log('=== HO-GUOM-SUMMARY (DB cách ly): PASS ===');
  } finally {
    await db.run(sql`DELETE FROM order_items WHERE id LIKE ${`oi-hg-${stamp}-%`}`);
    await db.run(sql`DELETE FROM orders WHERE id LIKE ${`ord-hoguom-${stamp}-%`}`);
    await db.delete(editions).where(eq(editions.id, edA));
    await db.delete(editions).where(eq(editions.id, edB));
    await db.delete(products).where(eq(products.id, edA));
    await db.delete(products).where(eq(products.id, edB));
    await db.delete(works).where(eq(works.id, workId));
    await db.delete(warehouses).where(eq(warehouses.id, wid));
  }
}

if ((process.env.DATABASE_URL || '').includes('formapubli_test')) {
  dbPart().catch((e) => {
    console.error('HO-GUOM-SUMMARY DB FAIL:', e?.message || e);
    process.exit(1);
  });
} else {
  console.log('(bỏ qua phần DB: chỉ chạy trên DB cách ly qua run-isolated)');
}

console.log('=== HO-GUOM-SUMMARY (Task 2 UI): PASS ===');
