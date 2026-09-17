import { db, works, editions, warehouses, stockBalances, inventoryLedger, orders, orderItems } from '../src/db';
import { InventoryService } from '../src/services/inventory.service';
import { OrderService } from '../src/services/order.service';
import { eq } from 'drizzle-orm';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-order-sales');

async function runTests() {
  console.log('🧪 BẮT ĐẦU KIỂM THỬ ĐỘNG CƠ BÁN HÀNG SỔ KÉP (SALES ORDER & DUAL BOOKKEEPING TEST)\n');

  // Lấy 2 ấn bản mẫu từ cơ sở dữ liệu
  const allEditions = await db.select().from(editions).limit(3);
  if (allEditions.length < 2) {
    throw new Error('Chưa có đủ ấn bản để kiểm thử. Cần chạy seed trước.');
  }

  const bookA = allEditions[0]; // e.g. H01
  const bookB = allEditions[1]; // e.g. H02

  const whAuCo = 'wh-au-co';
  const whHoiCho = 'wh-du-phong';

  console.log(`📚 Sách kiểm thử A: [${bookA.code}] ${bookA.title || 'Ấn bản A'} (Giá bìa: ${bookA.coverPrice.toLocaleString('vi-VN')} đ)`);
  console.log(`📚 Sách kiểm thử B: [${bookB.code}] ${bookB.title || 'Ấn bản B'} (Giá bìa: ${bookB.coverPrice.toLocaleString('vi-VN')} đ)\n`);

  // BƯỚC 1: Nhập kho ban đầu để tạo số dư kiểm thử
  console.log('--- 1. Thiết lập tồn kho ban đầu (Baseline Stock) ---');
  await InventoryService.recordMovement({
    editionId: bookA.id,
    warehouseId: whAuCo,
    eventType: 'RECEIPT',
    quantityDelta: 50,
    condition: 'NEW',
    documentRef: 'TEST-INIT-AUCO-A',
    note: 'Nhập kho ban đầu cho test A tại Âu Cơ',
    actorId: 'test-runner',
    idempotencyKey: `init-a-${Date.now()}`,
  });

  await InventoryService.recordMovement({
    editionId: bookA.id,
    warehouseId: whHoiCho,
    eventType: 'RECEIPT',
    quantityDelta: 10,
    condition: 'NEW',
    documentRef: 'TEST-INIT-HOICHO-A',
    note: 'Nhập kho ban đầu cho test A tại Hội chợ',
    actorId: 'test-runner',
    idempotencyKey: `init-hc-a-${Date.now()}`,
  });

  await InventoryService.recordMovement({
    editionId: bookB.id,
    warehouseId: whAuCo,
    eventType: 'RECEIPT',
    quantityDelta: 30,
    condition: 'NEW',
    documentRef: 'TEST-INIT-AUCO-B',
    note: 'Nhập kho ban đầu cho test B tại Âu Cơ',
    actorId: 'test-runner',
    idempotencyKey: `init-b-${Date.now()}`,
  });

  const initBalAuCoA = await InventoryService.getBalance(bookA.id, whAuCo, 'NEW');
  const initBalHcA = await InventoryService.getBalance(bookA.id, whHoiCho, 'NEW');
  console.log(`✅ Tồn kho ban đầu Sách A tại Kho Âu Cơ: ${initBalAuCoA} cuốn`);
  console.log(`✅ Tồn kho ban đầu Sách A tại Kho Hội Chợ: ${initBalHcA} cuốn\n`);

  // BƯỚC 2: Bán lẻ tại Hội chợ (Khách mua lẻ, giảm 10%, tiền mặt, không hóa đơn)
  console.log('--- 2. Test Bán Lẻ Hội Chợ (Retail Cash Sale - INTERNAL_MANAGEMENT) ---');
  const retailOrder = await OrderService.createOrder({
    warehouseId: whHoiCho,
    channel: 'FAIR_EVENT',
    customerName: 'Bạn đọc Hội chợ Sách Hà Nội',
    discountRate: 0.10, // Giảm 10%
    paymentMethod: 'CASH',
    fiscalScope: 'INTERNAL_MANAGEMENT',
    cashierId: 'nhanvien-hoicho',
    note: 'Bán lẻ tại gian hàng Hội chợ',
    items: [
      { editionId: bookA.id, quantity: 2 },
    ],
  });

  console.log(`✅ Tạo đơn thành công: [${retailOrder.orderCode}]`);
  console.log(`   - Tổng giá bìa: ${retailOrder.subtotal.toLocaleString('vi-VN')} đ`);
  console.log(`   - Tiền chiết khấu (10%): ${(retailOrder.discountAmount || 0).toLocaleString('vi-VN')} đ`);
  console.log(`   - Thực thu: ${retailOrder.finalAmount.toLocaleString('vi-VN')} đ`);

  const balAfterRetail = await InventoryService.getBalance(bookA.id, whHoiCho, 'NEW');
  console.log(`✅ Tồn kho Sách A tại Hội Chợ sau khi bán: ${balAfterRetail} cuốn (Giảm đúng 2 cuốn: ${initBalHcA} -> ${balAfterRetail})\n`);
  if (balAfterRetail !== initBalHcA - 2) throw new Error('Sai lệch tồn kho sau bán lẻ!');

  // BƯỚC 3: Bán buôn cho Đại Lý Sỉ Đinh Lễ (Chiết khấu 40%, chuyển khoản cá nhân, không hóa đơn)
  console.log('--- 3. Test Bán Sỉ Đại Lý (Wholesale Partner - INTERNAL_MANAGEMENT) ---');
  const wholesaleOrder = await OrderService.createOrder({
    warehouseId: whAuCo,
    channel: 'WHOLESALE_PARTNER',
    customerName: 'Đại lý sỉ Đinh Lễ (Nhà sách sỉ)',
    discountRate: 0.40, // Chiết khấu sỉ 40%
    paymentMethod: 'BANK_TRANSFER',
    fiscalScope: 'INTERNAL_MANAGEMENT', // Bán buôn sỉ thực tế cho quản trị nội bộ
    cashierId: 'user-sales-lead',
    note: 'Xuất đại lý sỉ Đinh Lễ, tiền về tài khoản cá nhân quản lý',
    items: [
      { editionId: bookA.id, quantity: 20 },
      { editionId: bookB.id, quantity: 10 },
    ],
  });

  console.log(`✅ Tạo đơn sỉ thành công: [${wholesaleOrder.orderCode}]`);
  console.log(`   - Tổng giá bìa: ${wholesaleOrder.subtotal.toLocaleString('vi-VN')} đ`);
  console.log(`   - Tiền chiết khấu (40%): ${(wholesaleOrder.discountAmount || 0).toLocaleString('vi-VN')} đ`);
  console.log(`   - Thực thu: ${wholesaleOrder.finalAmount.toLocaleString('vi-VN')} đ`);

  const balAfterWholesaleA = await InventoryService.getBalance(bookA.id, whAuCo, 'NEW');
  console.log(`✅ Tồn kho Sách A tại Âu Cơ: ${balAfterWholesaleA} cuốn (Giảm đúng 20 cuốn)`);
  if (balAfterWholesaleA !== initBalAuCoA - 20) throw new Error('Sai lệch tồn kho sau bán sỉ A!');

  // BƯỚC 4: Bán chính thức cho Doanh nghiệp có Hóa đơn VAT (OFFICIAL_TAX)
  console.log('\n--- 4. Test Bán Công Ty Xuất Hóa Đơn VAT (B2B - OFFICIAL_TAX) ---');
  const vatOrder = await OrderService.createOrder({
    warehouseId: whAuCo,
    channel: 'RETAIL_OFFICE',
    customerName: 'Công ty Cổ phần Giáo dục Alpha',
    discountRate: 0.05, // Chiết khấu 5%
    paymentMethod: 'BANK_TRANSFER',
    fiscalScope: 'OFFICIAL_TAX',
    vatRate: 0.05,
    vatInvoiceRequired: true,
    vatInvoiceCode: 'HD-2026-0089',
    cashierId: 'ketoan-thue',
    note: 'Đơn hàng mua thư viện doanh nghiệp, xuất VAT qua tài khoản ngân hàng công ty',
    items: [
      { editionId: bookA.id, quantity: 5 },
    ],
  });

  console.log(`✅ Tạo đơn VAT thành công: [${vatOrder.orderCode}] (Cờ Sổ: ${vatOrder.fiscalScope})`);
  console.log(`   - Thực thu: ${vatOrder.finalAmount.toLocaleString('vi-VN')} đ (Hóa đơn: HD-2026-0089)`);

  const balAfterVatA = await InventoryService.getBalance(bookA.id, whAuCo, 'NEW');
  console.log(`✅ Tồn kho Sách A tại Âu Cơ sau đơn VAT: ${balAfterVatA} cuốn (Giảm tiếp 5 cuốn)`);
  if (balAfterVatA !== initBalAuCoA - 25) throw new Error('Sai lệch tồn kho sau bán VAT!');

  // BƯỚC 5: Kiểm thử cơ chế Chống Âm Kho (Negative Stock Guard)
  console.log('\n--- 5. Test Cơ Chế Chống Xuất Âm Kho (Negative Stock Prevention) ---');
  try {
    await OrderService.createOrder({
      warehouseId: whHoiCho,
      channel: 'FAIR_EVENT',
      customerName: 'Khách mua vượt tồn',
      items: [
        { editionId: bookA.id, quantity: 9999 }, // Tồn kho chỉ còn ~8 cuốn
      ],
    });
    console.error('❌ THẤT BẠI: Lẽ ra phải chặn lỗi xuất âm kho!');
    process.exit(1);
  } catch (err: any) {
    console.log(`🛡️ CHẶN THÀNH CÔNG: Hệ thống đã từ chối đơn hàng vượt tồn kho!`);
    console.log(`   Thông báo lỗi: "${err.message}"`);
  }

  // BƯỚC 6: Kiểm thử Phân tách Báo cáo Sổ Kép (Tax View vs Executive Reality View)
  console.log('\n--- 6. Test Phân Tách Báo Cáo Sổ Kép (Dual Bookkeeping Reports) ---');
  
  // Báo cáo góc nhìn Kế toán Thuế (Tax View)
  const taxSummary = await OrderService.getSalesSummary({ fiscalScope: 'OFFICIAL_TAX' });
  console.log('📊 [VIEW 1: KẾ TOÁN THUẾ - SẠCH BÓNG & CHÍNH THỨC]:');
  console.log(`   - Số đơn xuất trình thuế: ${taxSummary.totalOrders} đơn`);
  console.log(`   - Doanh thu kê khai thuế: ${taxSummary.totalRevenue.toLocaleString('vi-VN')} đ`);

  // Báo cáo góc nhìn Chủ Quản trị Toàn cảnh (Executive Reality View)
  const realitySummary = await OrderService.getSalesSummary({ fiscalScope: 'ALL' });
  console.log('\n📈 [VIEW 2: CHỦ QUẢN TRỊ - THỰC TẾ TOÀN CẢNH VẬN HÀNH]:');
  console.log(`   - Tổng đơn toàn hệ thống: ${realitySummary.totalOrders} đơn`);
  console.log(`   - Tổng doanh thu thực tế thu về: ${realitySummary.totalRevenue.toLocaleString('vi-VN')} đ`);
  console.log(`   - Tổng tiền chiết khấu hỗ trợ: ${realitySummary.totalDiscount.toLocaleString('vi-VN')} đ`);
  console.log(`   - Chi tiết Thuế (Official): ${realitySummary.officialTax.ordersCount} đơn | ${realitySummary.officialTax.revenue.toLocaleString('vi-VN')} đ`);
  console.log(`   - Chi tiết Nội bộ (Đại lý sỉ/Khách lẻ): ${realitySummary.internalManagement.ordersCount} đơn | ${realitySummary.internalManagement.revenue.toLocaleString('vi-VN')} đ`);

  console.log('\n===============================================================');
  console.log('🎉 TẤT CẢ 6/6 TEST CASES NGHIỆP VỤ BÁN HÀNG & SỔ KÉP ĐÃ VƯỢT QUA 100%!');
  console.log('===============================================================');
}

runTests().catch((err) => {
  console.error('❌ Lỗi kiểm thử:', err);
  process.exit(1);
});
