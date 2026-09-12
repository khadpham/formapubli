import { db, editions } from '../src/db';
import { InventoryService } from '../src/services/inventory.service';
import { ConsignmentService } from '../src/services/consignment.service';
import { GET as ConsignGET } from '../src/app/api/consignments/route';
import { eq } from 'drizzle-orm';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-consignment');

async function runConsignmentTests() {
  console.log('🤝 ========================================================');
  console.log('🤝 KIỂM THỬ SỔ KÝ GỬI ĐẠI LÝ & CÔNG NỢ PHẢI THU (AR)');
  console.log('🤝 ========================================================\n');

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

  const PARTNER = 'part-mao-dinh-le'; // CK 40% theo seed
  const QM = 'wh-quynh-mai';
  const AUCO = 'wh-au-co';
  const book = (await db.select().from(editions).limit(1))[0];
  const cover = book.coverPrice;

  // Chuẩn bị tồn tại Quỳnh Mai.
  await InventoryService.recordMovement({
    editionId: book.id, warehouseId: QM, eventType: 'RECEIPT', quantityDelta: 100,
    condition: 'NEW', documentRef: 'TEST-CONSIGN-PREP', actorId: 'test-runner',
    idempotencyKey: `consign-prep-${Date.now()}`,
  });

  // TEST 1: Gửi ký gửi qua T1 shipments + xác nhận nhận hàng tại quầy.
  const sent = await ConsignmentService.sendToConsignment({
    partnerId: PARTNER,
    fromWarehouseId: QM,
    dispatcherId: 'thu-kho-qm',
    vehicleInfo: 'Xe ôm test Đinh Lễ',
    items: [{ editionId: book.id, quantity: 20 }],
  });
  ok(!!sent.shipmentId, 'Gửi ký gửi mở phiếu T1 shipment', `Phiếu: ${sent.shipmentId}`);
  const recv = await ConsignmentService.confirmConsignmentReceipt(sent.shipmentId, 'tai-xe-test');
  ok(recv.status === 'RECEIVED_FULL', 'Xác nhận quầy nhận đủ 20 cuốn');
  const stock = await ConsignmentService.getPartnerStock(PARTNER);
  const atCounter = stock.items.find((i) => i.editionId === book.id && i.condition === 'NEW')?.quantity ?? 0;
  ok(atCounter === 20, 'Tồn quầy đại lý đúng 20 cuốn', `partner stock = ${atCounter}`);

  // TEST 2: Mở kỳ đối soát snapshot tồn đầu kỳ.
  const stmt = await ConsignmentService.createStatement({
    partnerId: PARTNER,
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    createdBy: 'ke-toan-test',
  });
  const detail1 = await ConsignmentService.getStatement(stmt.statementId);
  const opening = detail1.lines.find((l) => l.editionId === book.id)?.openingQty ?? -1;
  ok(detail1.status === 'DRAFT' && opening === 20, 'Kỳ DRAFT snapshot tồn đầu kỳ 20 cuốn');

  // TEST 3: Báo bán 8 cuốn -> trừ quầy + AR = 8 × giá bìa × 60%.
  const sale = await ConsignmentService.recordSale({
    statementId: stmt.statementId, editionId: book.id, quantity: 8, actorId: 'ke-toan-test',
  });
  const expectedAR = Math.round(8 * cover * (1 - 0.4));
  ok(sale.lineAmount === expectedAR, `AR báo bán đúng ${expectedAR.toLocaleString('vi-VN')} đ (CK 40%)`);
  const afterSale = await ConsignmentService.getPartnerStock(PARTNER);
  ok(
    (afterSale.items.find((i) => i.editionId === book.id && i.condition === 'NEW')?.quantity ?? -1) === 12,
    'Quầy còn 12 cuốn sau báo bán'
  );

  // TEST 4: Thu hồi 5 lành + 2 hỏng về Âu Cơ.
  await ConsignmentService.recordReturn({
    statementId: stmt.statementId, toWarehouseId: AUCO, editionId: book.id,
    newQty: 5, damagedQty: 2, actorId: 'thu-kho-au-co',
  });
  const aucoNew = await InventoryService.getBalance(book.id, AUCO, 'NEW');
  const aucoQuar = await InventoryService.getBalance(book.id, AUCO, 'QUARANTINE');
  ok(aucoNew >= 5 && aucoQuar === 2, 'Âu Cơ nhận 5 lành (NEW) + 2 hỏng (QUARANTINE nối RMA)');

  // TEST 5: Chốt kỳ: tồn cuối 5, thất thoát 0, khóa AR.
  const confirmed = await ConsignmentService.confirm(stmt.statementId, 'ke-toan-test');
  const detail2 = await ConsignmentService.getStatement(stmt.statementId);
  const line = detail2.lines.find((l) => l.editionId === book.id)!;
  ok(confirmed.status === 'CONFIRMED', 'Kỳ chuyển CONFIRMED');
  ok(line.closingQty === 5 && line.lostQty === 0, 'Tồn cuối 5, thất thoát 0 (20 - 8 bán - 7 thu hồi - 5 cuối = 0)');
  ok(confirmed.totalReceivable === expectedAR, `Tổng AR chốt đúng ${expectedAR.toLocaleString('vi-VN')} đ`);

  // TEST 6: Kỳ đã khóa từ chối ghi thêm.
  let lockedBlocked = false;
  try {
    await ConsignmentService.recordSale({
      statementId: stmt.statementId, editionId: book.id, quantity: 1, actorId: 'ke-toan-test',
    });
  } catch {
    lockedBlocked = true;
  }
  ok(lockedBlocked, 'Kỳ CONFIRMED từ chối báo bán thêm');

  // TEST 7: Kỳ 2 có thất thoát 1 cuốn -> CONSIGNMENT_LOSS + AR kỳ 2.
  const stmt2 = await ConsignmentService.createStatement({
    partnerId: PARTNER, periodStart: '2026-10-01', periodEnd: '2026-10-31', createdBy: 'ke-toan-test',
  });
  await ConsignmentService.recordSale({
    statementId: stmt2.statementId, editionId: book.id, quantity: 2, actorId: 'ke-toan-test',
  });
  // Giả lập kiểm đếm phát hiện thiếu 1 cuốn (điều chỉnh ngoài kỳ).
  const partnerWh = await ConsignmentService.partnerWarehouseId(PARTNER);
  await InventoryService.recordMovement({
    editionId: book.id, warehouseId: partnerWh, eventType: 'ADJUSTMENT', quantityDelta: -1,
    condition: 'NEW', documentRef: 'TEST-COUNT', actorId: 'kiem-dem',
    idempotencyKey: `consign-count-${Date.now()}`,
  });
  const confirmed2 = await ConsignmentService.confirm(stmt2.statementId, 'ke-toan-test');
  const detail3 = await ConsignmentService.getStatement(stmt2.statementId);
  const line2 = detail3.lines.find((l) => l.editionId === book.id)!;
  const expectedAR2 = Math.round(2 * cover * (1 - 0.4));
  ok(line2.lostQty === 1, 'Thất thoát 1 cuốn được bóc tách (5 đầu - 2 bán - 2 cuối = 1)');
  ok(confirmed2.totalReceivable === expectedAR2, `AR kỳ 2 đúng ${expectedAR2.toLocaleString('vi-VN')} đ`);

  // TEST 8: Override chiết khấu + sổ thuế ở cấp kỳ.
  const stmt3 = await ConsignmentService.createStatement({
    partnerId: PARTNER, periodStart: '2026-11-01', periodEnd: '2026-11-30',
    discountOverride: 0.5, fiscalScope: 'OFFICIAL_TAX', createdBy: 'manager-test',
  });
  const eff = await ConsignmentService.effectiveDiscount(stmt3.statementId);
  ok(eff === 0.5, 'Override chiết khấu kỳ 50% thắng CK mặc định partner');

  // TEST 9: Kế toán thuế bị chặn xem kỳ nội bộ.
  const taxReq = new Request(`http://localhost/api/consignments?id=${stmt.statementId}`, {
    headers: { 'x-formapubli-role': 'ROLE_TAX', 'x-formapubli-actor': 'tax-test' },
  });
  const taxRes: any = await ConsignGET(taxReq as any);
  ok(taxRes.status === 403, 'TAX xem kỳ INTERNAL_MANAGEMENT bị chặn 403');

  console.log('\n========================================================');
  console.log(`🎉 HOÀN TẤT: ${passed}/${total} BÀI TEST SỔ KÝ GỬI & AR ĐẠT 100%!`);
  console.log('========================================================\n');
}

runConsignmentTests().catch((err) => {
  console.error('❌ test-consignment thất bại:', err);
  process.exit(1);
});
