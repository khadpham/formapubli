/**
 * scripts/test-owner-finance-p1.ts — tab Chủ GĐ3-P1: tổng hợp doanh thu đa kênh.
 *
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-owner-finance-p1
 */
import { assertIsolatedTestDb } from './test-guard';
import { db, warehouses, partners, deliveryOrders, partnerReceipts, orders } from '../src/db';
import { vnMonthRangeUtc, getChannelRevenue } from '../src/services/owner-finance.service';

assertIsolatedTestDb('test-owner-finance-p1');

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

async function main() {
  // 1. Biên tháng VN: kỳ 2026-10 theo giờ VN = 30/09 17:00 → 31/10 17:00 UTC.
  // Kỳ vọng ghi cứng độc lập (không import từ code).
  const [s, e] = vnMonthRangeUtc('2026-10');
  eq2('đầu kỳ UTC', s, '2026-09-30 17:00:00');
  eq2('cuối kỳ UTC', e, '2026-10-31 17:00:00');

  // Baseline trước khi seed — test phải đúng dù suite khác đã seed trước
  // (runner dùng chung một DB cho mọi suite).
  const revBefore = await getChannelRevenue('2026-10');

  await db.insert(warehouses).values({ id: 'wh-p1', code: 'KHO_P1', name: 'Kho P1' });
  await db.insert(partners).values({ id: 'part-p1', code: 'DL_P1', name: 'Đại lý P1', type: 'WHOLESALE' });

  // Đại lý: 1 phiếu khóa sổ trong tháng (10tr) + 1 phiếu DRAFT (loại) + 1 phiếu tháng 9 (loại).
  await db.insert(deliveryOrders).values({
    id: 'pxk-p1-1', code: 'PXK-P1-001', partnerId: 'part-p1', fromWarehouseId: 'wh-p1',
    subtotal: 10000000, finalAmount: 10000000, status: 'DISPATCHED_LOCKED',
    fiscalScope: 'COMMERCIAL_WHOLESALE', dispatchedAt: '2026-10-05 02:00:00', createdBy: 'staff-admin',
  });
  await db.insert(deliveryOrders).values({
    id: 'pxk-p1-2', code: 'PXK-P1-002', partnerId: 'part-p1', fromWarehouseId: 'wh-p1',
    subtotal: 5000000, finalAmount: 5000000, status: 'DRAFT',
    fiscalScope: 'COMMERCIAL_WHOLESALE', createdBy: 'staff-admin',
  });
  // Ký gửi không tính vào phải thu bán đứt.
  await db.insert(deliveryOrders).values({
    id: 'pxk-p1-3', code: 'PXK-P1-003', partnerId: 'part-p1', fromWarehouseId: 'wh-p1',
    subtotal: 7000000, finalAmount: 7000000, status: 'DISPATCHED_LOCKED',
    fiscalScope: 'CONSIGNMENT_DISPATCH', dispatchedAt: '2026-10-06 02:00:00', createdBy: 'staff-admin',
  });
  // Thực thu: 4tr trong tháng + 1 phiếu VOIDED (loại).
  await db.insert(partnerReceipts).values({
    id: 'rc-p1-1', partnerId: 'part-p1', amount: 4000000, paymentMethod: 'BANK_TRANSFER',
    reference: 'BILL-P1', paidAt: '2026-10-15', receivedBy: 'staff-admin',
    status: 'ACTIVE', idempotencyKey: 'idem-p1-1',
  });
  await db.insert(partnerReceipts).values({
    id: 'rc-p1-2', partnerId: 'part-p1', amount: 9999999, paymentMethod: 'CASH',
    reference: 'BILL-P1-VOID', paidAt: '2026-10-16', receivedBy: 'staff-admin',
    status: 'VOIDED', idempotencyKey: 'idem-p1-2',
  });

  // Đơn lẻ: online 500k; bán lẻ tiền mặt 300k + QR 200k; đơn hủy (loại);
  // đơn 31/10 18:00 UTC = 01/11 01:00 giờ VN → thuộc tháng 11, phải loại.
  const ord = (id: string, code: string, channel: string, status: string, createdAt: string, finalAmount: number, paymentMethod = 'CASH') => ({
    id, orderCode: code, warehouseId: 'wh-p1', channel, partnerId: null, customerId: null,
    customerName: 'Khách lẻ', subtotal: finalAmount, discountRate: 0, discountAmount: 0,
    finalAmount, paymentMethod, fiscalScope: 'INTERNAL_MANAGEMENT', vatRate: 0,
    status, cashierId: 'staff-admin', idempotencyKey: `idem-${id}`, createdAt,
  });
  await db.insert(orders).values(ord('o-p1-1', 'ORD-P1-001', 'ONLINE', 'COMPLETED', '2026-10-10 01:00:00', 500000, 'BANK_TRANSFER'));
  await db.insert(orders).values(ord('o-p1-2', 'ORD-P1-002', 'FAIR_EVENT', 'COMPLETED', '2026-10-11 00:00:00', 300000, 'CASH'));
  await db.insert(orders).values(ord('o-p1-3', 'ORD-P1-003', 'RETAIL_OFFICE', 'COMPLETED', '2026-10-12 00:00:00', 200000, 'QR_CODE'));
  await db.insert(orders).values(ord('o-p1-4', 'ORD-P1-004', 'ONLINE', 'CANCELLED', '2026-10-13 00:00:00', 800000, 'CASH'));
  await db.insert(orders).values(ord('o-p1-5', 'ORD-P1-005', 'ONLINE', 'COMPLETED', '2026-10-31 18:00:00', 900000, 'CASH'));
  // Bán sỉ tại quầy — kênh riêng, không gộp vào bán lẻ hay đại lý công nợ.
  await db.insert(orders).values(ord('o-p1-6', 'ORD-P1-006', 'WHOLESALE_PARTNER', 'COMPLETED', '2026-10-17 00:00:00', 1000000, 'BANK_TRANSFER'));

  const r = await getChannelRevenue('2026-10');
  const d = (after: number, bef: number) => after - bef;
  eq2('đại lý: số phiếu tăng', d(r.agency.orders, revBefore.agency.orders), 1);
  eq2('đại lý: phải thu tăng', d(r.agency.receivable, revBefore.agency.receivable), 10000000);
  eq2('đại lý: thực thu tăng', d(r.agency.received, revBefore.agency.received), 4000000);
  eq2('đại lý: còn lại tăng', d(r.agency.balance, revBefore.agency.balance), 6000000);
  eq2('online: số đơn tăng', d(r.online.orders, revBefore.online.orders), 1);
  eq2('online: doanh thu tăng', d(r.online.revenue, revBefore.online.revenue), 500000);
  eq2('bán lẻ: số đơn tăng', d(r.retail.orders, revBefore.retail.orders), 2);
  eq2('bán lẻ: doanh thu tăng', d(r.retail.revenue, revBefore.retail.revenue), 500000);
  eq2('bán lẻ: tiền mặt tăng', d(r.retail.cash, revBefore.retail.cash), 300000);
  eq2('bán lẻ: CK/QR tăng', d(r.retail.bankQr, revBefore.retail.bankQr), 200000);
  eq2('bán sỉ: số đơn tăng', d(r.wholesale.orders, revBefore.wholesale.orders), 1);
  eq2('bán sỉ: doanh thu tăng', d(r.wholesale.revenue, revBefore.wholesale.revenue), 1000000);

  console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'}: ${pass} đạt, ${fail} hỏng`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('❌ EXCEPTION:', e);
  process.exit(1);
});
