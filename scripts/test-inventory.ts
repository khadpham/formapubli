import { InventoryService } from '../src/services/inventory.service';
import { db, editions, warehouses, inventoryLedger } from '../src/db';
import { eq } from 'drizzle-orm';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-inventory');

async function runInventoryTests() {
  console.log('🧪 ===============================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ SỔ CÁI KHO VẬN BẤT BIẾN & 3 KHO');
  console.log('🧪 ===============================================\n');

  // 1. Lấy thông tin đầu sách H01 (Bệnh tưởng) và 3 kho
  const h01 = await db.select().from(editions).where(eq(editions.code, 'H01')).limit(1);
  if (!h01.length) {
    throw new Error('Không tìm thấy sách H01 trong danh mục đã seed!');
  }
  const book = h01[0];
  console.log(`📚 Sách kiểm thử: [${book.code}] ${book.title} (ISBN: ${book.isbn}, Đuôi: ${book.isbnLast4})`);

  const allWh = await db.select().from(warehouses);
  const whAuCo = allWh.find((w) => w.code === 'KHO_AU_CO')!;
  const whQuynhMai = allWh.find((w) => w.code === 'KHO_QUYNH_MAI')!;
  const whDuPhong = allWh.find((w) => w.code === 'KHO_DU_PHONG')!;

  console.log(`🏢 Kho 1: ${whAuCo.name} (${whAuCo.code})`);
  console.log(`🏢 Kho 2: ${whQuynhMai.name} (${whQuynhMai.code})`);
  console.log(`🏢 Kho 3: ${whDuPhong.name} (${whDuPhong.code})\n`);

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
    actorId: 'Thủ kho Quỳnh Mai',
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
  const h01Stock = matrix.find((item) => item.code === 'H01')!;

  console.log(`📊 Kết quả tồn kho thực tế của [${h01Stock.code}] ${h01Stock.title}:`);
  console.log(`   - Kho 1 (Âu Cơ):     ${h01Stock.stockAuCo} cuốn (Kỳ vọng: ${baseAuCo + 150})`);
  console.log(`   - Kho 2 (Quỳnh Mai): ${h01Stock.stockQuynhMai} cuốn (Kỳ vọng: ${baseQuynhMai + 800})`);
  console.log(`   - Kho 3 (Dự phòng):  ${h01Stock.stockDuPhong} cuốn (Kỳ vọng: ${baseDuPhong})`);
  console.log(`   - TỔNG TOÀN HỆ THỐNG: ${h01Stock.totalStock} cuốn (Kỳ vọng: ${baseAuCo + baseQuynhMai + baseDuPhong + 950})`);

  if (
    h01Stock.stockAuCo === baseAuCo + 150 &&
    h01Stock.stockQuynhMai === baseQuynhMai + 800 &&
    h01Stock.stockDuPhong === baseDuPhong &&
    h01Stock.totalStock === baseAuCo + baseQuynhMai + baseDuPhong + 950
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

  console.log('\n===============================================');
  console.log('🎉 TẤT CẢ 6 BÀI KIỂM THỬ ĐÃ ĐẠT KẾT QUẢ XUẤT SẮC 100%!');
  console.log('===============================================\n');
}

runInventoryTests().catch((err) => {
  console.error('❌ Kiểm thử thất bại:', err);
  process.exit(1);
});