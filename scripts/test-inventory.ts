import { InventoryService } from '../src/services/inventory.service';
import { toActorContext } from '../src/services/actor-context';
import { setDirectTransferAllowlist, resetDirectTransferAllowlist } from '../src/services/direct-transfer-policy';
import { db, editions, warehouses, inventoryLedger, stockBalances } from '../src/db';
import { eq } from 'drizzle-orm';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-inventory');

// CP3-B1.1 (mục 5): bổ sung actorContext + key; không đổi assertion.
const ICTX = (id: string) => toActorContext(id, 'ROLE_MANAGER');

async function runInventoryTests() {
  console.log('🧪 ===============================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ SỔ CÁI KHO VẬN BẤT BIẾN & 3 KHO');
  console.log('🧪 ===============================================\n');

  // 1. Lấy 1 ấn bản bất kỳ đang có trong danh mục (mã SKU đổi theo đợt cập
  // nhật danh mục, nên không hardcode mã — luôn tra động từ CSDL).
  const [book] = await db.select().from(editions).orderBy(editions.code).limit(1);
  if (!book) {
    throw new Error('Danh mục ấn bản đã seed rỗng!');
  }
  console.log(`📚 Sách kiểm thử: [${book.code}] ${book.title} (ISBN: ${book.isbn}, Đuôi: ${book.isbnLast4})`);

  const allWh = await db.select().from(warehouses);
  const whAuCo = allWh.find((w) => w.code === 'KHO_AU_CO')!;
  const whQuynhMai = allWh.find((w) => w.code === 'KHO_QUYNH_MAI')!;
  const whDuPhong = allWh.find((w) => w.code === 'KHO_DU_PHONG')!;

  console.log(`🏢 Kho 1: ${whAuCo.name} (${whAuCo.code})`);
  console.log(`🏢 Kho 2: ${whQuynhMai.name} (${whQuynhMai.code})`);
  console.log(`🏢 Kho 3: ${whDuPhong.name} (${whDuPhong.code})\n`);

  // CP3-B1.2 (mục 3): cấu hình tường minh cặp Quỳnh Mai ↔ Âu Cơ cho transfer
  // trực tiếp; dọn trong finally. Không đổi assertion nghiệp vụ.
  setDirectTransferAllowlist([[whQuynhMai.id, whAuCo.id]]);
  try {

  const baseAuCo = await InventoryService.getBalance(book.id, whAuCo.id, 'NEW');
  const baseQuynhMai = await InventoryService.getBalance(book.id, whQuynhMai.id, 'NEW');
  const baseDuPhong = await InventoryService.getBalance(book.id, whDuPhong.id, 'NEW');

  // 2. Test 1: Nhập 1,000 cuốn vào Kho 2 (Quỳnh Mai) từ Nhà in
  console.log('\n--- TEST 1: Nhập kho từ Nhà in về Kho 2 (Quỳnh Mai) ---');
  const receiptDoc = `PNK-${Date.now()}`;
  const receiptResult = await InventoryService.recordMovement({
    editionId: book.id,
    warehouseId: whQuynhMai.id,
    eventType: 'RECEIPT',
    quantityDelta: 1000,
    documentRef: receiptDoc,
    actorId: 'Lan Anh (Kế toán kho)',
    note: 'Nhập in đợt 1 từ Nhà in Hội nhà văn',
    idempotencyKey: `receipt-${Date.now()}`,
  });
  console.log(`✅ Đã nhập 1,000 cuốn vào Quỳnh Mai. Số dư mới: ${receiptResult.newQuantity}`);

  // 3. Test 2: Chuyển 200 cuốn từ Kho 2 (Quỳnh Mai) sang Kho 1 (Âu Cơ) để soạn đơn lẻ
  console.log('\n--- TEST 2: Chuyển kho (Quỳnh Mai ➔ Âu Cơ: 200 cuốn) ---');
  const transferDoc = `PCK-${Date.now()}`;
  const transferResult = await InventoryService.transfer({
    editionId: book.id,
    fromWarehouseId: whQuynhMai.id,
    toWarehouseId: whAuCo.id,
    quantity: 200,
    documentRef: transferDoc,
    actorContext: ICTX('Thu kho Quynh Mai'),
    idempotencyKey: `transfer-${transferDoc}`,
    note: 'Tiếp tế sách rời cho văn phòng Âu Cơ soạn đơn trực tuyến',
  });
  console.log(`✅ Chuyển kho thành công:`);
  console.log(`   - Quỳnh Mai (kho xuất): ${transferResult.fromWarehouse!.previousQuantity} ➔ ${transferResult.fromWarehouse!.newQuantity} cuốn`);
  console.log(`   - Âu Cơ (kho nhập):     ${transferResult.toWarehouse!.previousQuantity} ➔ ${transferResult.toWarehouse!.newQuantity} cuốn`);

  // 4. Test 3: Xuất bán lẻ 50 cuốn từ Kho 1 (Âu Cơ) cho khách hàng
  console.log('\n--- TEST 3: Xuất bán lẻ 50 cuốn từ Kho 1 (Âu Cơ) ---');
  const saleDoc = `PXK-${Date.now()}`;
  const saleResult = await InventoryService.recordMovement({
    editionId: book.id,
    warehouseId: whAuCo.id,
    eventType: 'DISPATCH_SALE',
    quantityDelta: -50,
    documentRef: saleDoc,
    actorId: 'Bộ phận Bán hàng Fanpage',
    note: 'Xuất giao các đơn đặt hàng đợt 1',
    idempotencyKey: `sale-${Date.now()}`,
  });
  console.log(`✅ Xuất bán lẻ 50 cuốn thành công. Số dư tại Âu Cơ: ${saleResult.newQuantity} cuốn`);

  // 5. Test 4: Xác thực số dư trên ma trận tồn kho toàn hệ thống
  console.log('\n--- TEST 4: Xác thực số dư thời gian thực trên Ma trận 3 Kho ---');
  const matrix = await InventoryService.getStockMatrix();
  const bookStock = matrix.find((item) => item.id === book.id)!;

  console.log(`📊 Kết quả tồn kho thực tế của [${bookStock.code}] ${bookStock.title}:`);
  console.log(`   - Kho 1 (Âu Cơ):     ${bookStock.stockAuCo} cuốn (Kỳ vọng: ${baseAuCo + 150})`);
  console.log(`   - Kho 2 (Quỳnh Mai): ${bookStock.stockQuynhMai} cuốn (Kỳ vọng: ${baseQuynhMai + 800})`);
  console.log(`   - Kho 3 (Dự phòng):  ${bookStock.stockDuPhong} cuốn (Kỳ vọng: ${baseDuPhong})`);
  console.log(`   - TỔNG TOÀN HỆ THỐNG: ${bookStock.totalStock} cuốn (Kỳ vọng: ${baseAuCo + baseQuynhMai + baseDuPhong + 950})`);

  if (
    bookStock.stockAuCo === baseAuCo + 150 &&
    bookStock.stockQuynhMai === baseQuynhMai + 800 &&
    bookStock.stockDuPhong === baseDuPhong &&
    bookStock.totalStock === baseAuCo + baseQuynhMai + baseDuPhong + 950
  ) {
    console.log('🎉 KHỚP SỐ DƯ TUYỆT ĐỐI 100%!');
  } else {
    throw new Error('❌ SAI LỆCH SỐ DƯ TỒN KHO!');
  }

  // 6. Test 5: Kiểm chứng tính năng Chặn Âm Kho (Negative Stock Prevention)
  console.log('\n--- TEST 5: Kiểm chứng tính năng Chặn Xuất Âm Kho ---');
  try {
    const currentAuCo = await InventoryService.getBalance(book.id, whAuCo.id, 'NEW');
    console.log(`👉 Thử nghiệm xuất ${currentAuCo + 100} cuốn từ Kho Âu Cơ (trong khi chỉ còn ${currentAuCo} cuốn)...`);
    await InventoryService.recordMovement({
      editionId: book.id,
      warehouseId: whAuCo.id,
      eventType: 'DISPATCH_SALE',
      quantityDelta: -(currentAuCo + 100),
      documentRef: 'PXK-FAIL-TEST',
      actorId: 'Tester',
      note: 'Cố tình xuất vượt tồn kho',
    });
    throw new Error('❌ LỖI NGHIÊM TRỌNG: Hệ thống đã cho phép xuất âm kho!');
  } catch (err: any) {
    if (err.message.includes('LỖI XUẤT ÂM KHO')) {
      console.log(`🛡️ THÀNH CÔNG: Hệ thống đã chặn đứng xuất âm kho với thông báo:`);
      console.log(`   "${err.message}"`);
    } else {
      throw err;
    }
  }

  // 7. Test 6: Kiểm tra tính bất biến của Sổ cái (Append-Only Audit Trail)
  console.log('\n--- TEST 6: Kiểm tra Sổ cái bất biến (Inventory Ledger Audit Trail) ---');
  const ledgerEntries = await InventoryService.getLedgerHistory(10);
  console.log(`📜 Tổng số bút toán trong Sổ cái: ${ledgerEntries.length}`);
  ledgerEntries.forEach((entry, idx) => {
    console.log(
      `   [${idx + 1}] ${entry.recordedAt} | ${entry.documentRef} | ${entry.eventType.padEnd(12)} | ` +
      `${(entry.quantityDelta > 0 ? '+' : '') + entry.quantityDelta} cuốn | ` +
      `Kho: ${entry.warehouseCode} | Người tạo: ${entry.actorId}`
    );
  });

  // 8. Test 7: Ma trận tồn kho CHỈ đếm bucket condition = 'NEW'.
  // 68/68 xanh KHÔNG nói được gì về thay đổi này: mọi suite cũ chỉ ghi
  // condition: 'NEW', nên có lọc hay không thì kết quả y hệt. Test này ghim
  // bucket KHÁC (cách ly) cho cùng một ấn bản rồi đòi ma trận phải y nguyên —
  // bỏ điều kiện `eq(stockBalances.condition, 'NEW')` là test này đỏ.
  console.log('\n--- TEST 7: Ma trận bỏ qua tồn KHÔNG phải NEW (cách ly / hỏng) ---');
  const matrixBefore = (await InventoryService.getStockMatrix()).find(
    (item) => item.id === book.id
  )!;
  const QUARANTINE_ROW_ID = `test-quarantine-${book.id}`;
  await db.delete(stockBalances).where(eq(stockBalances.id, QUARANTINE_ROW_ID));
  await db.insert(stockBalances).values({
    id: QUARANTINE_ROW_ID,
    editionId: book.id,
    warehouseId: whAuCo.id,
    condition: 'QUARANTINE',
    physicalQuantity: 77,
  });
  const cols = ['stockAuCo', 'stockQuynhMai', 'stockDuPhong', 'totalStock'] as const;
  try {
    const quarantined = await InventoryService.getBalance(book.id, whAuCo.id, 'QUARANTINE');
    console.log(`🧪 Đã cấm [${book.code}] tại Âu Cơ: 77 cuốn QUARANTINE (đọc lại: ${quarantined} cuốn)`);
    if (quarantined !== 77) {
      throw new Error('❌ Không ghi được bucket QUARANTINE — test vô nghĩa!');
    }

    const matrixAfter = (await InventoryService.getStockMatrix()).find(
      (item) => item.id === book.id
    )!;
    const diff: string[] = cols.filter((c) => matrixAfter[c] !== matrixBefore[c]);
    if (
      JSON.stringify(matrixAfter.stockByWarehouse) !== JSON.stringify(matrixBefore.stockByWarehouse)
    ) {
      diff.push('stockByWarehouse');
    }
    console.log(`📊 Trước: ${cols.map((c) => `${c}=${matrixBefore[c]}`).join(' · ')}`);
    console.log(`📊 Sau : ${cols.map((c) => `${c}=${matrixAfter[c]}`).join(' · ')}`);
    if (diff.length > 0) {
      throw new Error(
        `❌ MA TRẬN ĐÃ CỘNG NHẦM TỒN CÁCH LY! Khác ở: ${diff.join(', ')}. ` +
          'getStockMatrix phải lọc condition = NEW (transferBatch chỉ đụng NEW).'
      );
    }
    console.log('🎉 Tồn QUARANTINE bị loại khỏi ma trận — tổng ma trận khớp tổng tồn chuyển được.');
  } finally {
    await db.delete(stockBalances).where(eq(stockBalances.id, QUARANTINE_ROW_ID));
    const matrixRestored = (await InventoryService.getStockMatrix()).find(
      (item) => item.id === book.id
    )!;
    const left: string[] = cols.filter((c) => matrixRestored[c] !== matrixBefore[c]);
    if (left.length > 0) {
      throw new Error(`❌ Dọn dẹp thất bại, ma trận còn lệch ở: ${left.join(', ')}`);
    }
    console.log('🧹 Đã xoá bucket QUARANTINE, ma trận về đúng trạng thái ban đầu.');
  }

  console.log('\n===============================================');
  console.log('🎉 TẤT CẢ 7 BÀI KIỂM THỬ ĐÃ ĐẠT KẾT QUẢ XUẤT SẮC 100%!');
  console.log('===============================================\n');
  } finally {
    resetDirectTransferAllowlist();
  }
}

runInventoryTests().catch((err) => {
  console.error('❌ Kiểm thử thất bại:', err);
  process.exit(1);
});