import { db, works, editions, inventoryLedger } from '../src/db';
import { InventoryService } from '../src/services/inventory.service';
import { OrderService } from '../src/services/order.service';
import { RoyaltyService, deriveLifecycle } from '../src/services/royalty.service';
import { eq } from 'drizzle-orm';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-royalties');

async function runRoyaltyTests() {
  console.log('📜 ========================================================');
  console.log('📜 KIỂM THỬ SỔ BẢN QUYỀN & NHUẬN BÚT TÁC GIẢ');
  console.log('📜 ========================================================\n');

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

  const workList = await db.select().from(works).limit(3);
  if (workList.length < 3) throw new Error('Test DB chưa seed đủ tác phẩm.');
  const [workA, workB, workC] = workList;
// PHẢI có `ORDER BY id`. Không có thì SQLite trả dòng tuỳ ý — đã đo được:
// cùng code, cùng DB sạch, chạy 3 lần cho EXIT = 0, 1, 1. Test này FLAKY,
// không phải lỗi của code nghiệp vụ. Khiến cả một buổi tìm lỗi sai hướng.
const edOf = async (workId: string) =>
  (await db.select().from(editions).where(eq(editions.workId, workId)).orderBy(editions.id).limit(1))[0];
  const edA = await edOf(workA.id);
  const edB = await edOf(workB.id);

  // Hợp đồng A: còn hiệu lực dài, quota 2000, rate 10%, tạm ứng 50k.
  //
  // `royaltyBasis: 'COVER_PRICE'` — KHAI BÁO ĐÚNG Ý ĐỊNH của suite này: nó kiểm
  // công thức "bán × GIÁ BÌA × rate". Trước khi có cột `royalty_basis`, mọi hợp
  // đồng đều ngầm dùng giá bìa nên assertion này luôn xanh; nay mặc định là
  // NET_SOLD (tiền thực thu sau chiết khấu), và suite chạy trên DB dùng chung —
  // nơi các suite trước đã để lại đơn có chiết khấu trên cùng ấn bản — thì
  // `accrued` theo tiền thực thu KHÔNG còn bằng `round(coverRevenue × rate)`.
  // Đó không phải hỏng, đó là hành vi MỚI ĐÚNG; suite này giữ nguyên assertion
  // của công thức giá bìa và khai báo rõ nó muốn kiểm cái đó. Công thức
  // NET_SOLD được kiểm ở scripts/test-royalty-basis.ts.
  const cA = await RoyaltyService.createContract({
    contractNumber: `HD-BQ-TEST-${Date.now().toString().slice(-5)}`,
    workId: workA.id,
    licensorName: 'Tác giả Test A',
    royaltyRate: 0.1,
    printQuota: 2000,
    advanceAmount: 50000,
    effectiveDate: '2020-01-01',
    expirationDate: '2099-12-31',
    createdBy: 'manager-test',
    royaltyBasis: 'COVER_PRICE',
  });

  // HỢP ĐỒNG B: CÙNG tác phẩm, CÙNG dữ liệu bán, nhưng để mặc định NET_SOLD.
  // Dùng để chứng minh trên CHÍNH dữ liệu của suite này rằng hai cơ sở cho ra
  // hai con số khác nhau đúng bằng tổng tiền chiết khấu.
  const cANet = await RoyaltyService.createContract({
    contractNumber: `HD-BQ-NET-${Date.now().toString().slice(-5)}`,
    workId: workA.id,
    licensorName: 'Tác giả Test A (net)',
    royaltyRate: 0.1,
    printQuota: 2000,
    advanceAmount: 50000,
    effectiveDate: '2020-01-01',
    expirationDate: '2099-12-31',
    createdBy: 'manager-test',
  });

  // In 300 + bán 20 trong thời hạn (DB seed đã có sẵn OPENING 50/ấn bản).
  const printedBefore = (await RoyaltyService.quotaStatus(cA.contractId)).printed;
  await InventoryService.recordMovement({
    editionId: edA.id, warehouseId: 'wh-au-co', eventType: 'RECEIPT', quantityDelta: 300,
    condition: 'NEW', documentRef: 'TEST-ROYALTY-PRINT', actorId: 'test-runner',
    idempotencyKey: `roy-print-${Date.now()}`,
  });
  const soldBefore = (await RoyaltyService.royaltyStatement(cA.contractId)).soldQty;
  await OrderService.createOrder({
    warehouseId: 'wh-au-co', customerName: 'Khách royalty test',
    fiscalScope: 'INTERNAL_MANAGEMENT', cashierId: 'royalty-test',
    items: [{ editionId: edA.id, quantity: 20 }],
    idempotencyKey: `roy-sell-${Date.now()}`,
  });

  // TEST 1: Hạn ngạch in (+300 so với mốc, còn ~1650, chưa cảnh báo).
  const quotaA = await RoyaltyService.quotaStatus(cA.contractId);
  ok(
    quotaA.printed === printedBefore + 300 &&
    quotaA.remaining === 2000 - quotaA.printed &&
    quotaA.quotaWarning === false && quotaA.lifecycle === 'ACTIVE',
    'Quota +300, còn ~1650, ACTIVE, chưa cảnh báo',
    `printed=${quotaA.printed}, remaining=${quotaA.remaining}`
  );

  // TEST 2: Nhuận bút tăng đúng +20 cuốn: bán × giá bìa × 10% − tạm ứng, floor 0.
  // (HĐ A khai báo COVER_PRICE — xem giải thích ở chỗ tạo hợp đồng.)
  const stmtA = await RoyaltyService.royaltyStatement(cA.contractId);
  const coverA = edA.coverPrice ?? 0;
  const expectedAccrued = Math.round(stmtA.coverRevenue * 0.1);
  ok(
    stmtA.royaltyBasis === 'COVER_PRICE' &&
      stmtA.basisRevenue === stmtA.coverRevenue &&
      stmtA.soldQty === soldBefore + 20 &&
      stmtA.coverRevenue === stmtA.soldQty * coverA &&
      stmtA.accrued === expectedAccrued &&
      stmtA.payable === Math.max(0, expectedAccrued - 50000),
    'Nhuận bút đúng công thức (bán × bìa × rate − tạm ứng, floor 0)',
    `cơ sở=${stmtA.royaltyBasis}, bán ${stmtA.soldQty}, doanh thu bìa ${stmtA.coverRevenue}, ` +
      `phát sinh ${stmtA.accrued}, phải trả ${stmtA.payable}`
  );

  // TEST 2b: CÙNG dữ liệu, hợp đồng để mặc định NET_SOLD.
  // Chứng minh ngay trên dữ liệu của suite này: nếu DB có đơn chiết khấu thì
  // royalty theo tiền thực thu NHỎ HƠN, và chênh lệch đúng bằng tổng chiết khấu.
  const stmtNet = await RoyaltyService.royaltyStatement(cANet.contractId);
  const discountGap = stmtNet.coverRevenue - stmtNet.basisRevenue;
  ok(
    stmtNet.royaltyBasis === 'NET_SOLD' &&
      stmtNet.soldQty === stmtA.soldQty &&
      stmtNet.basisRevenue <= stmtNet.coverRevenue &&
      (discountGap === 0 || stmtNet.accrued < stmtA.accrued),
    'Mặc định NET_SOLD: cùng lượng bán, doanh thu ≤ giá bìa, phát sinh ≤ HĐ giá bìa',
    `NET_SOLD: basisRevenue=${stmtNet.basisRevenue}, coverRevenue=${stmtNet.coverRevenue}, ` +
      `chênh(chiết khấu)=${discountGap}, phát sinh=${stmtNet.accrued} ` +
      `(${discountGap > 0 ? 'NHỎ HƠN' : 'bằng'} HĐ giá bìa ${stmtA.accrued})`
  );
  ok(
    discountGap === 0
      ? stmtNet.basisRevenue === stmtNet.coverRevenue
      : stmtNet.accrued === Math.round(stmtNet.basisRevenue * 0.1),
    'Chênh lệch giữa hai cơ sở CHÍNH LÀ tổng tiền chiết khấu, không phải lỗi làm tròn',
    `cover − net = ${discountGap}; accrued NET_SOLD = ${stmtNet.accrued} = round(${stmtNet.basisRevenue} × 0.1)`
  );

  // TEST 3: Cảnh báo tuyệt đối (còn <= 200).
  const cB = await RoyaltyService.createContract({
    contractNumber: `HD-BQ-WARN-${Date.now().toString().slice(-5)}`,
    workId: workB.id, licensorName: 'Tác giả Test B', royaltyRate: 0.08,
    printQuota: 250, effectiveDate: '2020-01-01', expirationDate: '2099-12-31',
    createdBy: 'manager-test',
  });
  const printedBBefore = (await RoyaltyService.quotaStatus(cB.contractId)).printed;
  await InventoryService.recordMovement({
    editionId: edB.id, warehouseId: 'wh-au-co', eventType: 'RECEIPT', quantityDelta: 100,
    condition: 'NEW', documentRef: 'TEST-ROYALTY-PRINT-B', actorId: 'test-runner',
    idempotencyKey: `roy-print-b-${Date.now()}`,
  });
  const quotaB = await RoyaltyService.quotaStatus(cB.contractId);
  ok(
    quotaB.printed === printedBBefore + 100 && quotaB.remaining === 250 - quotaB.printed &&
    quotaB.quotaWarning === true,
    'Còn ~150/250 (<=200) bật QUOTA_WARNING',
    `remaining=${quotaB.remaining}`
  );

  // TEST 4: Cảnh báo tỉ lệ (còn <= 10% nhưng > 200).
  const cB2 = await RoyaltyService.createContract({
    contractNumber: `HD-BQ-RATIO-${Date.now().toString().slice(-5)}`,
    workId: workC.id, licensorName: 'Tác giả Test C', royaltyRate: 0.12,
    printQuota: 5000, effectiveDate: '2020-01-01', expirationDate: '2099-12-31',
    createdBy: 'manager-test',
  });
  const edC = await edOf(workC.id);
  const printedCBefore = (await RoyaltyService.quotaStatus(cB2.contractId)).printed;
  await InventoryService.recordMovement({
    editionId: edC.id, warehouseId: 'wh-au-co', eventType: 'RECEIPT', quantityDelta: 4600,
    condition: 'NEW', documentRef: 'TEST-ROYALTY-PRINT-C', actorId: 'test-runner',
    idempotencyKey: `roy-print-c-${Date.now()}`,
  });
  const quotaC = await RoyaltyService.quotaStatus(cB2.contractId);
  const ratioC = quotaC.remaining / 5000;
  ok(
    quotaC.printed === printedCBefore + 4600 && ratioC <= 0.1 && quotaC.quotaWarning === true,
    'Còn ~8% quota bật QUOTA_WARNING theo tỉ lệ',
    `remaining=${quotaC.remaining}`
  );

  // TEST 5b: Ranh giới NGÀY HẾT HẠN — chỗ code cũ làm mất tiền tác giả.
  //
  // `expiration_date` là NGÀY VIỆT NAM nhưng `recorded_at` là UTC. Code cũ so
  // chuỗi với cận trên `'${expirationDate} 2'`:
  //   · '2026-12-31 23:59:59' <= '2026-12-31 2' là FALSE ⇒ mất 22 giờ cuối ngày.
  //   · Dòng ISO bị loại HẾT cả ngày, vì so chuỗi thì 'T' > ' '.
  // Các test trên dùng `2099-12-31` nên không bao giờ chạm ranh giới này và mọi
  // thứ đều xanh; đây là ca riêng chạm đúng chỗ hỏng.
  const cEdge = await RoyaltyService.createContract({
    contractNumber: `HD-BQ-EDGE-${Date.now().toString().slice(-5)}`,
    workId: workC.id, licensorName: 'Tác giả ranh giới', royaltyRate: 0.1,
    printQuota: 1000, effectiveDate: '2026-12-01', expirationDate: '2026-12-31',
    createdBy: 'manager-test',
  });
  const printedEdgeBefore = (await RoyaltyService.quotaStatus(cEdge.contractId)).printed;
  const edEdge = await edOf(workC.id);
  // Ba mốc trên NGÀY HẾT HẠN, mỗi mốc 10 đơn vị:
  //   · 22:00 giờ VN hôm trước = 15:00 UTC hôm trước  → ngày UTC khác ngày VN
  //   · 03:00 giờ VN 31/12   = 20:00 UTC 30/12        → ngày UTC khác ngày VN
  //   · 23:30 giờ VN 31/12   = 16:30 UTC 31/12        → cùng ngày, giờ muộn
  for (const recordedAt of ['2026-12-30T15:00:00.000Z', '2026-12-30T20:00:00.000Z', '2026-12-31T16:30:00.000Z']) {
    await db.insert(inventoryLedger).values({
      id: `led-edge-${recordedAt}-${Math.random().toString(36).slice(2, 8)}`,
      editionId: edEdge.id, productId: edEdge.id, warehouseId: 'wh-au-co',
      eventType: 'RECEIPT', quantityDelta: 10, condition: 'NEW',
      documentRef: 'ROYALTY-EDGE', actorId: 'test-runner',
      idempotencyKey: `roy-edge-${recordedAt}-${Math.random().toString(36).slice(2, 8)}`,
      recordedAt,
    } as any);
  }
  const printedEdge = (await RoyaltyService.quotaStatus(cEdge.contractId)).printed;
  ok(
    printedEdge === printedEdgeBefore + 30,
    'NGÀY HẾT HẠN phải tính trọn cả 3 mốc (gồm 2 mốc lệch 7 tiếng về ngày UTC)',
    `trước=${printedEdgeBefore} sau=${printedEdge} (cần +30)`
  );

  // TEST 5c: Cùng ranh giới đó nhưng ở `royaltyStatement` — hàm tính TIỀN thật.
  // 30 ấn chỉ chạm quota, nên không ai nhận ra mất tiền. Ở đây ta bán 30 cuốn ở
  // ngày hết hạn rồi đòi royalty phải khớp; code cũ trả thiếu vì dòng ISO 23:30
  // giờ VN bị `<= 'ngày 2'` loại mất.
  for (const recordedAt of ['2026-12-30T15:00:00.000Z', '2026-12-30T20:00:00.000Z', '2026-12-31T16:30:00.000Z']) {
    await db.insert(inventoryLedger).values({
      id: `led-edge-sale-${recordedAt}-${Math.random().toString(36).slice(2, 8)}`,
      editionId: edEdge.id, productId: edEdge.id, warehouseId: 'wh-au-co',
      eventType: 'DISPATCH_SALE', quantityDelta: -10, condition: 'NEW',
      documentRef: 'ROYALTY-EDGE-SALE', actorId: 'test-runner',
      idempotencyKey: `roy-edge-sale-${recordedAt}-${Math.random().toString(36).slice(2, 8)}`,
      recordedAt,
    } as any);
  }
  const stmtEdge = await RoyaltyService.royaltyStatement(cEdge.contractId);
  ok(
    stmtEdge.soldQty === 30,
    'royaltyStatement phải tính trọn lượng bán ở NGÀY HẾT HẠN (tiền tác giả)',
    `soldQty=${stmtEdge.soldQty} payable=${stmtEdge.payable} (cần soldQty 30)`
  );

  // TEST 5: Vòng đời EXPIRED + TERMINATED + filter.
  const cExp = await RoyaltyService.createContract({
    contractNumber: `HD-BQ-EXP-${Date.now().toString().slice(-5)}`,
    workId: workA.id, licensorName: 'HĐ cũ', royaltyRate: 0.1,
    printQuota: 1000, effectiveDate: '2020-01-01', expirationDate: '2020-12-31',
    createdBy: 'manager-test',
  });
  const quotaExp = await RoyaltyService.quotaStatus(cExp.contractId);
  ok(quotaExp.lifecycle === 'EXPIRED', 'Quá hạn -> EXPIRED');
  const term = await RoyaltyService.terminateContract(cA.contractId, 'manager-test', 'Thanh lý trước hạn test');
  ok(term.lifecycle === 'TERMINATED', 'Chấm dứt tay -> TERMINATED');
  const actives = await RoyaltyService.listContracts('ACTIVE');
  ok(
    actives.some((c) => c.id === cB.contractId) && !actives.some((c) => c.id === cA.contractId),
    'Lọc ACTIVE loại đúng HĐ terminated'
  );
  ok(
    deriveLifecycle(false, '2099-01-01', '2026-01-01') === 'ACTIVE' &&
    deriveLifecycle(true, '2099-01-01', '2026-01-01') === 'TERMINATED' &&
    deriveLifecycle(false, '2020-01-01', '2026-01-01') === 'EXPIRED',
    'Hàm vòng đời thuần đúng 3 nhánh'
  );

  // TEST 6: Validate đầu vào (rate, hạn, lý do chấm dứt).
  let badRate = false;
  try {
    await RoyaltyService.createContract({
      contractNumber: 'HD-BAD', workId: workA.id, royaltyRate: 1.5, printQuota: 100,
      effectiveDate: '2026-01-01', expirationDate: '2031-01-01', createdBy: 'x',
    });
  } catch { badRate = true; }
  let badDates = false;
  try {
    await RoyaltyService.createContract({
      contractNumber: 'HD-BAD2', workId: workA.id, royaltyRate: 0.1, printQuota: 100,
      effectiveDate: '2031-01-01', expirationDate: '2026-01-01', createdBy: 'x',
    });
  } catch { badDates = true; }
  let noReason = false;
  try {
    await RoyaltyService.terminateContract(cB.contractId, 'manager-test', '  ');
  } catch { noReason = true; }
  ok(badRate && badDates && noReason, 'Từ chối rate sai, hạn đảo, chấm dứt không lý do');

  console.log('\n========================================================');
  console.log(`🎉 HOÀN TẤT: ${passed}/${total} BÀI TEST BẢN QUYỀN & NHUẬN BÚT ĐẠT 100%!`);
  console.log('========================================================\n');
}

runRoyaltyTests().catch((err) => {
  console.error('❌ test-royalties thất bại:', err);
  process.exit(1);
});
