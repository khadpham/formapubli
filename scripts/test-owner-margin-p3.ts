/**
 * scripts/test-owner-margin-p3.ts — tab Chủ GĐ3-P3: pivot biên, dòng tiền, công nợ.
 *
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-owner-margin-p3
 */
import { assertIsolatedTestDb } from './test-guard';
import { db, products, editions, works, warehouses, orders, orderItems, deliveryOrders, deliveryOrderItems, partnerReceipts, partners, bankAccounts } from '../src/db';
import { sql } from 'drizzle-orm';
import { AppError } from '../src/services/app-error';
import { InventoryService } from '../src/services/inventory.service';
import {
  computeCogsForPeriod,
  getMarginPivot,
  getCashByAccount,
  getAgencyPaymentProgress,
} from '../src/services/owner-analytics.service';

assertIsolatedTestDb('test-owner-margin-p3');

let pass = 0;
let fail = 0;
function eq2(label: string, actual: unknown, expected: unknown) {
  if (Object.is(actual, expected)) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ FAIL: ${label} — nhận ${String(actual)}, cần ${String(expected)}`);
  }
}
async function expectCode(label: string, fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
    fail++;
    console.log(`  ❌ FAIL: ${label} — không ném lỗi`);
  } catch (e) {
    eq2(label, e instanceof AppError ? e.code : 'NOT_APP_ERROR', code);
  }
}

async function main() {
  const OWNER = 'ROLE_OWNER' as any;
  // 1. Migration 0048 có cột dest_account_id.
  const c1: any[] = await db.all(sql`SELECT COUNT(*) c FROM pragma_table_info('orders') WHERE name='dest_account_id'`);
  const c2: any[] = await db.all(sql`SELECT COUNT(*) c FROM pragma_table_info('partner_receipts') WHERE name='dest_account_id'`);
  eq2('orders có dest_account_id', Number(c1[0]?.c), 1);
  eq2('partner_receipts có dest_account_id', Number(c2[0]?.c), 1);

  // 2. RBAC.
  await expectCode('quản lý không xem được pivot', () => getMarginPivot('2026-10', 'ROLE_MANAGER' as any), 'FORBIDDEN');
  await expectCode('thu ngân không xem được dòng tiền', () => getCashByAccount('2026-10', 'ROLE_CASHIER' as any), 'FORBIDDEN');
  await expectCode('thủ kho không xem được tiến độ đại lý', () => getAgencyPaymentProgress('ROLE_WAREHOUSE' as any), 'FORBIDDEN');

  // Baseline dòng tiền trước khi seed — runner dùng chung DB cho mọi suite.
  const cashBefore = await getCashByAccount('2026-10', OWNER);

  await db.insert(products).values({ id: 'prod-p3-1', name: 'Sách P3A', productKind: 'BOOK' });
  await db.insert(products).values({ id: 'prod-p3-2', name: 'Sách P3B', productKind: 'GOODS' });
  // prod-p3-1 là sách thật (products.id === editions.id) để phiếu đại lý FK hợp lệ.
  await db.insert(works).values({ id: 'work-p3', code: 'W-P3', title: 'Tác phẩm P3', author: 'TG P3' });
  await db.insert(editions).values({
    id: 'prod-p3-1', code: 'P3A', workId: 'work-p3', isbn: '9780000000001', isbnLast4: '0001', coverPrice: 120000,
  });
  await db.insert(warehouses).values({ id: 'wh-p3', code: 'KHO_P3', name: 'Kho P3' });
  await db.insert(partners).values({ id: 'part-p3', code: 'DL_P3', name: 'Đại lý P3', type: 'WHOLESALE' });
  await db.insert(bankAccounts).values({ id: 'bank-p3', label: 'VCB chính', bankBin: '970436', accountNo: '123' });

  // Tồn kho: nhập 2 lô cho prod-p3-1 (100@20k, 100@30k), 1 lô prod-p3-2 (50@10k).
  const rcpt = async (pid: string, qty: number, cost: number | undefined, lot: string, key: string) => {
    await InventoryService.recordMovement({
      editionId: pid, isBook: false, warehouseId: 'wh-p3', eventType: 'RECEIPT',
      quantityDelta: qty, documentRef: `PN-P3-${key}`, actorId: 'KHO-01',
      idempotencyKey: `idem-p3-rcpt-${key}`, lotId: lot, unitCostSnapshot: cost,
    });
  };
  await rcpt('prod-p3-1', 100, 20000, 'LOT-P3-A', 'a');
  await rcpt('prod-p3-1', 100, 30000, 'LOT-P3-B', 'b');
  await rcpt('prod-p3-2', 50, 10000, 'LOT-P3-C', 'c');

  // 3. computeCogsForPeriod: xuất 150 prod-p3-1 trong tháng 10.
  await InventoryService.recordMovement({
    editionId: 'prod-p3-1', isBook: false, warehouseId: 'wh-p3', eventType: 'DISPATCH_SALE',
    quantityDelta: -150, documentRef: 'PX-P3-1', actorId: 'NV-01',
    idempotencyKey: 'idem-p3-dsp-1', effectiveAt: '2026-10-12T02:00:00.000Z',
  });
  const cog = await computeCogsForPeriod({ productId: 'prod-p3-1', startUtc: '2026-09-30 17:00:00', endUtc: '2026-10-31 17:00:00' });
  eq2('FIFO DB: xuất 150', cog.dispatchedQty, 150);
  eq2('FIFO DB: giá vốn = 100*20k + 50*30k', cog.cogs, 3500000);

  // 4. Đơn online bán prod-p3-1 (2 cuốn × 100k) + bán lẻ prod-p3-2 (1 × 50k tiền mặt).
  await db.insert(orders).values({
    id: 'o-p3-1', orderCode: 'ORD-P3-001', warehouseId: 'wh-p3', channel: 'ONLINE',
    customerName: 'Khách lẻ', subtotal: 200000, finalAmount: 200000, paymentMethod: 'BANK_TRANSFER',
    status: 'COMPLETED', cashierId: 'NV-01', idempotencyKey: 'idem-o-p3-1', createdAt: '2026-10-15 03:00:00',
    destAccountId: 'bank-p3',
  });
  await db.insert(orderItems).values({
    id: 'oi-p3-1', orderId: 'o-p3-1', editionId: 'prod-p3-1', productId: 'prod-p3-1', quantity: 2,
    unitCoverPrice: 120000, unitSellingPrice: 100000, totalAmount: 200000,
  });
  await db.insert(orders).values({
    id: 'o-p3-2', orderCode: 'ORD-P3-002', warehouseId: 'wh-p3', channel: 'FAIR_EVENT',
    customerName: 'Khách lẻ', subtotal: 50000, finalAmount: 50000, paymentMethod: 'CASH',
    status: 'COMPLETED', cashierId: 'NV-01', idempotencyKey: 'idem-o-p3-2', createdAt: '2026-10-16 03:00:00',
  });
  await db.insert(orderItems).values({
    id: 'oi-p3-2', orderId: 'o-p3-2', productId: 'prod-p3-2', quantity: 1,
    unitCoverPrice: 60000, unitSellingPrice: 50000, totalAmount: 50000,
  });
  // Phiếu đại lý: 10 cuốn prod-p3-1 × 70k, khóa sổ tháng 10.
  await db.insert(deliveryOrders).values({
    id: 'pxk-p3-1', code: 'PXK-P3-001', partnerId: 'part-p3', fromWarehouseId: 'wh-p3',
    subtotal: 700000, finalAmount: 700000, status: 'DISPATCHED_LOCKED',
    fiscalScope: 'COMMERCIAL_WHOLESALE', dispatchedAt: '2026-10-18 02:00:00', createdBy: 'staff-admin',
  });
  await db.insert(deliveryOrderItems).values({
    id: 'doi-p3-1', deliveryOrderId: 'pxk-p3-1', editionId: 'prod-p3-1',
    quantity: 10, unitCoverPrice: 120000, unitSellingPrice: 70000, totalAmount: 700000,
  });
  // Xuất kho cho các đơn đã bán (luồng thật do order.service ghi).
  const dsp = async (pid: string, qty: number, at: string, key: string, isBook: boolean) => {
    await InventoryService.recordMovement({
      editionId: pid, isBook, warehouseId: 'wh-p3', eventType: 'DISPATCH_SALE',
      quantityDelta: -qty, documentRef: `PX-P3-${key}`, actorId: 'NV-01',
      idempotencyKey: `idem-p3-dsp-${key}`, effectiveAt: at,
    });
  };
  await dsp('prod-p3-1', 2, '2026-10-15T03:00:00.000Z', 'onl', true);
  await dsp('prod-p3-2', 1, '2026-10-16T03:00:00.000Z', 'ret', false);
  // Xuất kho cho phiếu đại lý (để FIFO có dispatches).
  await dsp('prod-p3-1', 10, '2026-10-18T02:00:00.000Z', 'ag', true);
  // Đại lý trả 300k trong tháng 10.
  await db.insert(partnerReceipts).values({
    id: 'rc-p3-1', partnerId: 'part-p3', amount: 300000, paymentMethod: 'BANK_TRANSFER',
    reference: 'BILL-P3', paidAt: '2026-10-20', receivedBy: 'ADMIN-01',
    status: 'ACTIVE', idempotencyKey: 'idem-rc-p3-1', destAccountId: 'bank-p3',
  });

  // 5. Pivot: online prod-p3-1 doanh thu 200k; đại lý prod-p3-1 700k; bán lẻ prod-p3-2 50k.
  const pivot = await getMarginPivot('2026-10', OWNER);
  const onl = pivot.find((r) => r.channel === 'ONLINE' && r.productId === 'prod-p3-1');
  const ag = pivot.find((r) => r.channel === 'AGENCY' && r.productId === 'prod-p3-1');
  const ret = pivot.find((r) => r.channel === 'RETAIL' && r.productId === 'prod-p3-2');
  eq2('pivot online có dòng', !!onl, true);
  eq2('pivot online doanh thu', onl?.revenue, 200000);
  eq2('pivot đại lý doanh thu', ag?.revenue, 700000);
  eq2('pivot bán lẻ doanh thu', ret?.revenue, 50000);
  // Giá vốn FIFO prod-p3-1 trong tháng: xuất 162 = 100@20k + 62@30k = 3,860,000,
  // phân bổ theo SL: online 2/12, đại lý 10/12.
  eq2('pivot online giá vốn PB theo SL', onl?.cogs, 643333);
  eq2('pivot đại lý giá vốn PB theo SL', ag?.cogs, 3216667);
  eq2('pivot online biên gộp', onl && onl.margin !== null ? Math.round(onl.margin * 1000) / 10 : null, -221.7);
  eq2('pivot bán lẻ giá vốn', ret?.cogs, 10000);
  eq2('pivot bán lẻ biên gộp 80%', ret?.margin, 0.8);

  // 6. Dòng tiền theo tài khoản — so delta với baseline (order-independent).
  const cash = await getCashByAccount('2026-10', OWNER);
  const bucketDelta = (label: string) =>
    (cash.find((b) => b.label === label)?.amount || 0) -
    (cashBefore.find((b) => b.label === label)?.amount || 0);
  eq2('VCB chính tăng 500k (200k online + 300k đại lý)', bucketDelta('VCB chính'), 500000);
  eq2('Tiền mặt tại quầy tăng 50k', bucketDelta('Tiền mặt tại quầy'), 50000);

  // 7. Tiến độ thanh toán đại lý.
  const prog = await getAgencyPaymentProgress(OWNER);
  const dl = prog.find((p) => p.partnerId === 'part-p3');
  eq2('đại lý có dòng', !!dl, true);
  eq2('phải thu 700k', dl?.receivable, 700000);
  eq2('đã thu 300k', dl?.received, 300000);
  eq2('còn lại 400k', dl?.balance, 400000);

  console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'}: ${pass} đạt, ${fail} hỏng`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('❌ EXCEPTION:', e);
  process.exit(1);
});
