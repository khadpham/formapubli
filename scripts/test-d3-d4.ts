import { db } from '../src/db';
import { editions, warehouses, stockBalances, counterAllocations, rmaTickets } from '../src/db/schema';
import { eq, and } from 'drizzle-orm';
import { AllocationService } from '../src/services/allocation.service';
import { RmaService } from '../src/services/rma.service';
import { InventoryService } from '../src/services/inventory.service';
import {
  appendExportWatermark,
  generateExportHash,
  verifyExportIntegrity,
} from '../src/lib/export-hash';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-d3-d4');

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, message: string) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(message);
  }
  passedTests++;
  console.log(`✅ PASS: ${message}`);
}

async function runD3D4Verification() {
  console.log('================================================================');
  console.log('🚀 BẮT ĐẦU KIỂM THỬ TOÀN DIỆN PHASE D3 & D4 (QUOTA, RMA, HASH)');
  console.log('================================================================\n');

  // Lấy dữ liệu test sẵn có
  const allEditions = await db.select().from(editions).limit(3);
  const allWarehouses = await db.select().from(warehouses).limit(2);

  if (allEditions.length === 0 || allWarehouses.length === 0) {
    throw new Error('Database chưa có dữ liệu sách hoặc kho để test.');
  }

  const testEdition = allEditions[0];
  const testWarehouse = allWarehouses[0];
  console.log(`📌 Test Target: Sách [${testEdition.code}] tại Kho [${testWarehouse.name}]\n`);

  // -------------------------------------------------------------
  // TEST SUITE 1: D3 - "CHIA MÂM" COUNTER QUOTA
  // -------------------------------------------------------------
  console.log('--- TEST SUITE 1: D3 - "CHIA MÂM" COUNTER QUOTA ---');

  const counterName = `Bàn Test ${Date.now()}`;
  const initialAllocationQty = 50;

  // 1. Phân bổ hạn ngạch cho bàn
  await AllocationService.allocateBooksToCounter({
    warehouseId: testWarehouse.id,
    counterName,
    allocations: [
      {
        editionId: testEdition.id,
        allocatedQuantity: initialAllocationQty,
        notes: 'Bàn giao ca sáng hội chợ',
      },
    ],
  });

  const quotaCheck1 = await AllocationService.checkCounterQuota(
    counterName,
    testEdition.id,
    10
  );

  assert(quotaCheck1.hasAllocation === true, 'Bàn quầy nhận diện đúng hạn ngạch đã chia');
  assert(quotaCheck1.remaining === 50, 'Số lượng còn lại ban đầu đúng bằng 50');
  assert(quotaCheck1.isExceeded === false, 'Yêu cầu 10 cuốn nằm trong hạn ngạch hợp lệ');

  // 2. Ghi nhận bán 15 cuốn
  await AllocationService.recordCounterSales(counterName, [
    { editionId: testEdition.id, quantity: 15 },
  ]);

  const quotaCheck2 = await AllocationService.checkCounterQuota(
    counterName,
    testEdition.id,
    40
  );

  assert(quotaCheck2.sold === 15, 'Số lượng đã bán ghi nhận chính xác 15 cuốn');
  assert(quotaCheck2.remaining === 35, 'Số lượng còn lại trên bàn quầy giảm xuống 35 cuốn');
  assert(quotaCheck2.isExceeded === true, 'Cảnh báo vượt hạn ngạch khi yêu cầu 40 cuốn > 35 cuốn');
  assert(
    !!quotaCheck2.warning && quotaCheck2.warning.includes('35 cuốn'),
    'Thông báo cảnh báo hiển thị đúng số dư còn lại để nhân viên đi tiếp tế'
  );

  // -------------------------------------------------------------
  // TEST SUITE 2: D3 - SHELF PICK LIST (DANH SÁCH SOẠN HÀNG KỆ KHO)
  // -------------------------------------------------------------
  console.log('\n--- TEST SUITE 2: D3 - SHELF PICK LIST GENERATOR ---');

  const pickList = await AllocationService.generatePickList(testWarehouse.id, [
    { editionId: allEditions[0].id, quantityNeeded: 5 },
    { editionId: allEditions[1]?.id || allEditions[0].id, quantityNeeded: 8 },
  ]);

  assert(pickList.totalItemsToPick >= 13, 'Tổng số cuốn cần soạn tính toán chính xác');
  assert(pickList.groups.length > 0, 'Sách được gom nhóm thành công theo vị trí kệ kho');
  assert(
    pickList.groups[0].shelfLocation !== undefined,
    'Mỗi nhóm soạn hàng có gắn nhãn vị trí kệ kho rõ ràng'
  );

  // -------------------------------------------------------------
  // TEST SUITE 3: D4 - RMA & DEFECTIVE QUARANTINE WORKFLOW
  // -------------------------------------------------------------
  console.log('\n--- TEST SUITE 3: D4 - RMA DEFECTIVE QUARANTINE WORKFLOW ---');

  // Đảm bảo có sẵn 20 cuốn tồn NEW để test cách ly
  await InventoryService.recordMovement({
    editionId: testEdition.id,
    warehouseId: testWarehouse.id,
    eventType: 'RECEIPT',
    quantityDelta: 20,
    condition: 'NEW',
    documentRef: 'TEST-PREP',
    actorId: 'admin-tester',
    note: 'Chuẩn bị tồn NEW cho test RMA',
  });


  const initialNewBal = await InventoryService.getBalance(testEdition.id, testWarehouse.id, 'NEW');
  const initialQuarantineBal = await InventoryService.getBalance(
    testEdition.id,
    testWarehouse.id,
    'QUARANTINE'
  );

  // Tạo phiếu RMA cách ly 4 cuốn hỏng bìa
  const rmaQty = 4;
  const ticket = await RmaService.createTicket({
    warehouseId: testWarehouse.id,
    editionId: testEdition.id,
    quantity: rmaQty,
    defectReason: 'BINDING_DEFECT',
    targetCondition: 'QUARANTINE',
    sourceCondition: 'NEW',
    inspectedBy: 'auditor-test',
    notes: 'Bung gáy khi kiểm tra trước giờ mở cửa',
  });

  assert(ticket.status === 'QUARANTINED', 'Phiếu RMA chuyển ngay sang trạng thái QUARANTINED');

  const postNewBal = await InventoryService.getBalance(testEdition.id, testWarehouse.id, 'NEW');
  const postQuarantineBal = await InventoryService.getBalance(
    testEdition.id,
    testWarehouse.id,
    'QUARANTINE'
  );

  assert(
    postNewBal === initialNewBal - rmaQty,
    `Tồn NEW giảm chính xác ${rmaQty} cuốn (từ ${initialNewBal} -> ${postNewBal})`
  );
  assert(
    postQuarantineBal === initialQuarantineBal + rmaQty,
    `Tồn QUARANTINE tăng chính xác ${rmaQty} cuốn (từ ${initialQuarantineBal} -> ${postQuarantineBal})`
  );

  // Thẩm định xong -> Tiêu hủy phế liệu (WRITE_OFF_SCRAP)
  const resolvedTicket = await RmaService.resolveTicket({
    ticketId: ticket.id,
    action: 'WRITE_OFF_SCRAP',
    actorId: 'warehouse-manager',
    notes: 'Sách hỏng hoàn toàn không thể sửa, lập biên bản hủy',
  });

  assert(resolvedTicket.status === 'SCRAPPED', 'Trạng thái ticket chuyển thành SCRAPPED');

  const finalQuarantineBal = await InventoryService.getBalance(
    testEdition.id,
    testWarehouse.id,
    'QUARANTINE'
  );
  assert(
    finalQuarantineBal === initialQuarantineBal,
    'Tồn QUARANTINE đã được trừ hoàn toàn sau khi hủy phế liệu'
  );

  // -------------------------------------------------------------
  // TEST SUITE 4: D4 - WATERMARK & SHA-256 EXPORT INTEGRITY
  // -------------------------------------------------------------
  console.log('\n--- TEST SUITE 4: D4 - WATERMARK & SHA-256 INTEGRITY ---');

  const sampleExportRows = [
    { orderCode: 'ORD-2026-001', finalAmount: 150000, fiscalScope: 'OFFICIAL_TAX' },
    { orderCode: 'ORD-2026-002', finalAmount: 220000, fiscalScope: 'INTERNAL_MANAGEMENT' },
  ];

  const baseCsv = 'Mã Đơn,Thực Thu,Phân Loại\n"ORD-2026-001",150000,"OFFICIAL_TAX"\n"ORD-2026-002",220000,"INTERNAL_MANAGEMENT"';

  const watermarkedCsv = appendExportWatermark(baseCsv, sampleExportRows, {
    actorId: 'lead-accountant',
    actorRole: 'MANAGER',
    reportName: 'BÁO CÁO TÀI CHÍNH KIỂM TOÁN',
    fiscalScope: 'ALL',
  });

  assert(
    watermarkedCsv.includes('# FORMAPUBLI FINANCIAL & AUDIT INTEGRITY TRAIL'),
    'Watermark footer chứa tiêu đề kiểm toán tài chính'
  );
  assert(
    watermarkedCsv.includes('# SHA-256 Data Integrity Hash:'),
    'Watermark footer chứa dòng băm SHA-256 xác thực'
  );

  const correctHash = generateExportHash(sampleExportRows);
  const verifyValid = verifyExportIntegrity(watermarkedCsv, correctHash);
  assert(verifyValid.isValid === true, 'Xác thực file gốc: Hash hoàn toàn khớp 100%');

  // Thử nghiệm giả mạo số liệu: thay đổi số tiền trong sampleExportRows
  const tamperedRows = [
    { orderCode: 'ORD-2026-001', finalAmount: 999999, fiscalScope: 'OFFICIAL_TAX' }, // Sửa số tiền
    { orderCode: 'ORD-2026-002', finalAmount: 220000, fiscalScope: 'INTERNAL_MANAGEMENT' },
  ];
  const tamperedHash = generateExportHash(tamperedRows);
  const verifyTampered = verifyExportIntegrity(watermarkedCsv, tamperedHash);

  assert(
    verifyTampered.isValid === false,
    'Phát hiện gian lận: Kiểm tra trả về isValid = false khi dữ liệu bị sửa'
  );
  assert(
    verifyTampered.reason?.includes('FAILED') === true,
    'Lý do cảnh báo ghi nhận vi phạm sai lệch mã băm'
  );

  console.log('\n================================================================');
  console.log(`🎉 TẤT CẢ ${passedTests}/${totalTests} TESTS ĐÃ ĐẠT 100% CHO PHASE D3 & D4!`);
  console.log('================================================================');
  process.exit(0);
}

runD3D4Verification().catch((err) => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});
