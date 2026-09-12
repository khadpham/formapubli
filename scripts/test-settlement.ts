import { db, editions } from '../src/db';
import { InventoryService } from '../src/services/inventory.service';
import { ConsignmentService } from '../src/services/consignment.service';
import { SettlementService } from '../src/services/settlement.service';
import { POST as SettlementsPOST } from '../src/app/api/settlements/route';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-settlement');

async function runSettlementTests() {
  console.log('💵 ========================================================');
  console.log('💵 KIỂM THỬ THU TIỀN CÔNG NỢ KÝ GỬI (SETTLEMENT)');
  console.log('💵 ========================================================\n');

  let passed = 0;
  let total = 0;
  const ok = (cond: boolean, name: string, detail = '') => {
    total++;
    if (cond) {
      passed++;
      console.log(`  ✅ [PASS ${total}] ${name}${detail ? `\n     ↳ ${detail}` : ''}`);
    } else {
      console.error(`  ❌ [FAIL ${total}] ${name}${detail ? ` — ${detail}` : ''}`);
      throw new Error(`Kiểm thử thất bại: ${name}`);
    }
  };

  const PARTNER = 'part-mao-dinh-le';
  const QM = 'wh-quynh-mai';
  const book = (await db.select().from(editions).limit(1))[0];
  const cover = book.coverPrice ?? 0;

  // Dựng kỳ CONFIRMED có AR: gửi 10 -> nhận -> mở kỳ -> bán 6 -> thu hồi 0 -> chốt.
  await InventoryService.recordMovement({
    editionId: book.id, warehouseId: QM, eventType: 'RECEIPT', quantityDelta: 100,
    condition: 'NEW', documentRef: 'TEST-SETTLE-PREP', actorId: 'test-runner',
    idempotencyKey: `settle-prep-${Date.now()}`,
  });
  const sent = await ConsignmentService.sendToConsignment({
    partnerId: PARTNER, fromWarehouseId: QM, dispatcherId: 'thu-kho-qm',
    items: [{ editionId: book.id, quantity: 10 }],
  });
  await ConsignmentService.confirmConsignmentReceipt(sent.shipmentId, 'tai-xe-test');
  const stmt = await ConsignmentService.createStatement({
    partnerId: PARTNER, periodStart: '2026-09-01', periodEnd: '2026-09-30', createdBy: 'ke-toan-test',
  });
  await ConsignmentService.recordSale({
    statementId: stmt.statementId, editionId: book.id, quantity: 6, actorId: 'ke-toan-test',
  });
  const confirmed = await ConsignmentService.confirm(stmt.statementId, 'ke-toan-test');
  const AR = confirmed.totalReceivable;
  const expectedAR = Math.round(6 * cover * (1 - 0.4));
  ok(AR === expectedAR && AR > 0, `Kỳ CONFIRMED chốt AR ${AR.toLocaleString('vi-VN')} đ`);

  // TEST 1: Thu từng phần 40% CASH có reference.
  const part1 = Math.floor(AR * 0.4);
  const pay1 = await SettlementService.recordPayment({
    statementId: stmt.statementId, amount: part1, paymentMethod: 'CASH',
    reference: 'BILL-TT-001', receivedBy: 'thu-ngan-test', cashboxSessionId: 'cbs-test-01',
  });
  ok(pay1.remaining === AR - part1, `Thu 40% còn nợ ${pay1.remaining.toLocaleString('vi-VN')} đ`);
  const bal1 = await SettlementService.getBalance(stmt.statementId);
  ok(bal1.status === 'CONFIRMED' && bal1.paid === part1, 'Chưa đủ vẫn CONFIRMED');

  // TEST 2: Chặn overpay + chặn thiếu reference.
  let overBlocked = false;
  try {
    await SettlementService.recordPayment({
      statementId: stmt.statementId, amount: bal1.remaining + 1000, paymentMethod: 'BANK_TRANSFER',
      reference: 'CK-OVER', receivedBy: 'ke-toan-test',
    });
  } catch {
    overBlocked = true;
  }
  ok(overBlocked, 'Chặn thu vượt dư nợ còn lại');

  let refBlocked = false;
  try {
    await SettlementService.recordPayment({
      statementId: stmt.statementId, amount: 1000, paymentMethod: 'CASH',
      reference: '   ', receivedBy: 'thu-ngan-test',
    });
  } catch {
    refBlocked = true;
  }
  ok(refBlocked, 'Chặn phiếu thiếu mã tham chiếu giao dịch');

  // TEST 3: Thu nốt -> PAID.
  const pay2 = await SettlementService.recordPayment({
    statementId: stmt.statementId, amount: bal1.remaining, paymentMethod: 'BANK_TRANSFER',
    reference: 'CK-TT-002', receivedBy: 'ke-toan-test',
  });
  ok(pay2.status === 'PAID' && pay2.remaining === 0, 'Thu đủ 100% AR -> kỳ PAID');

  // TEST 4: VOID phiếu đầu -> hoàn hạn mức, lùi PAID về CONFIRMED, record giữ lại.
  const voided = await SettlementService.voidPayment(pay1.paymentId, 'manager-test', 'Thu trùng bill giấy');
  const bal2 = await SettlementService.getBalance(stmt.statementId);
  ok(
    voided.status === 'VOIDED' && bal2.status === 'CONFIRMED' && bal2.remaining === part1,
    'VOID hoàn nợ + lùi PAID về CONFIRMED',
    `còn nợ ${bal2.remaining.toLocaleString('vi-VN')} đ`
  );
  let voidReasonRequired = false;
  try {
    await SettlementService.voidPayment(pay2.paymentId, 'manager-test', '  ');
  } catch {
    voidReasonRequired = true;
  }
  ok(voidReasonRequired, 'VOID bắt buộc ghi lý do');

  // TEST 5: Kỳ DRAFT không được thu + TAX bị chặn ở API.
  const draft = await ConsignmentService.createStatement({
    partnerId: PARTNER, periodStart: '2026-10-01', periodEnd: '2026-10-31', createdBy: 'ke-toan-test',
  });
  let draftBlocked = false;
  try {
    await SettlementService.recordPayment({
      statementId: draft.statementId, amount: 1000, paymentMethod: 'CASH',
      reference: 'BILL-DRAFT', receivedBy: 'thu-ngan-test',
    });
  } catch {
    draftBlocked = true;
  }
  ok(draftBlocked, 'Kỳ DRAFT chưa chốt không được thu tiền');

  const taxReq = new Request('http://localhost/api/settlements', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-formapubli-role': 'ROLE_TAX' },
    body: JSON.stringify({
      action: 'record', statementId: stmt.statementId, amount: 1000,
      paymentMethod: 'CASH', reference: 'BILL-TAX', receivedBy: 'tax-test',
    }),
  });
  const taxRes: any = await SettlementsPOST(taxReq as any);
  ok(taxRes.status === 403, 'TAX thu tiền công nợ bị chặn 403');

  console.log('\n========================================================');
  console.log(`🎉 HOÀN TẤT: ${passed}/${total} BÀI TEST SETTLEMENT ĐẠT 100%!`);
  console.log('========================================================\n');
}

runSettlementTests().catch((err) => {
  console.error('❌ test-settlement thất bại:', err);
  process.exit(1);
});
