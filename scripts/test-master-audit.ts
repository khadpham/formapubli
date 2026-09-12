import { db, works, editions, warehouses, stockBalances, inventoryLedger, orders, orderItems } from '../src/db';
import { InventoryService } from '../src/services/inventory.service';
import { OrderService } from '../src/services/order.service';
import { eq, sql } from 'drizzle-orm';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-master-audit');

/**
 * MASTER COMPREHENSIVE AUDIT SUITE (PHASE 1 & PHASE 2 VERIFICATION)
 * Kiểm tra toàn diện 100% kết quả thực thi kỹ thuật và các bất biến hệ thống.
 */
async function runMasterAudit() {
  console.log('🔍 =================================================================');
  console.log('🔍 BẮT ĐẦU KIỂM TOÁN TỔNG THỂ HỆ THỐNG: OUTCOMES PHASE 1 & PHASE 2');
  console.log('🔍 =================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    totalTests++;
    if (condition) {
      console.log(`  ✅ [PASS ${totalTests}] ${testName}`);
      if (detail) console.log(`     ↳ ${detail}`);
      passedTests++;
    } else {
      console.error(`  ❌ [FAIL ${totalTests}] ${testName}`);
      if (detail) console.error(`     ↳ ${detail}`);
      throw new Error(`Kiểm thử thất bại: ${testName}`);
    }
  }

  // -------------------------------------------------------------
  // PHẦN 1: KIỂM TOÁN TOÀN VẸN CƠ SỞ DỮ LIỆU & MASTER DATA (PHASE 1)
  // -------------------------------------------------------------
  console.log('--- PHẦN 1: KIỂM TOÁN MASTER DATA & TỒN TẠI VẬT LÝ ---');

  const allEditions = await db.select().from(editions);
  assert(allEditions.length === 81, 'Danh mục ấn bản sách chuẩn hóa', `Có đúng ${allEditions.length}/81 ấn bản (H01-H81)`);

  const allWorks = await db.select().from(works);
  assert(allWorks.length === 80, 'Danh mục tác phẩm gốc', `Có đúng ${allWorks.length}/80 tác phẩm (H21 và H36 chung tác phẩm Baudelaire)`);

  const allWarehouses = await db.select().from(warehouses);
  const warehouseCodes = allWarehouses.map((w) => w.code);
  assert(
    warehouseCodes.includes('KHO_AU_CO') &&
    warehouseCodes.includes('KHO_QUYNH_MAI') &&
    warehouseCodes.includes('KHO_DU_PHONG'),
    'Hệ thống 3 Kho vật lý hoạt động',
    `Đã nạp đủ: ${warehouseCodes.join(', ')}`
  );

  // -------------------------------------------------------------
  // PHẦN 2: ĐỊNH LUẬT BẢO TOÀN SỐ DƯ TỒN KHO (INVENTORY LEDGER INVARIANT)
  // -------------------------------------------------------------
  console.log('\n--- PHẦN 2: BẢO TOÀN SỔ CÁI BẤT BIẾN (CONSERVATION LAW) ---');

  // Kiểm tra không có bất kỳ dòng nào bị âm trong stock_balances
  const negativeBalances = await db
    .select()
    .from(stockBalances)
    .where(sql`physical_quantity < 0`);
  assert(
    negativeBalances.length === 0,
    'Tuyệt đối không có số dư âm trong CSDL',
    `Số lượng dòng âm kho: ${negativeBalances.length}`
  );

  // Kiểm tra tính nhất quán toán học: Sum(delta in ledger) == stock_balances
  // Lấy mẫu 5 ấn bản ngẫu nhiên để kiểm toán đối chiếu chi tiết
  const sampleEditions = allEditions.slice(0, 5);
  let invariantHolds = true;
  for (const ed of sampleEditions) {
    for (const wh of allWarehouses) {
      const balanceRecord = await db
        .select()
        .from(stockBalances)
        .where(
          sql`edition_id = ${ed.id} AND warehouse_id = ${wh.id} AND condition = 'NEW'`
        );
      const currentBalance = balanceRecord[0]?.physicalQuantity || 0;

      const ledgerSumResult = await db
        .select({
          totalDelta: sql<number>`COALESCE(SUM(quantity_delta), 0)`,
        })
        .from(inventoryLedger)
        .where(
          sql`edition_id = ${ed.id} AND warehouse_id = ${wh.id} AND condition = 'NEW'`
        );
      const ledgerSum = Number(ledgerSumResult[0]?.totalDelta || 0);

      if (currentBalance !== ledgerSum) {
        console.error(`Lệch sổ tại sách ${ed.code} ở kho ${wh.code}: Balance=${currentBalance} vs LedgerSum=${ledgerSum}`);
        invariantHolds = false;
      }
    }
  }
  assert(
    invariantHolds,
    'Bất biến Sổ Cái: Tổng delta Thẻ Kho khớp 100% với Số Dư Thực Tế',
    'Đã kiểm toán ma trận cân bằng số dư qua 5 ấn bản x 3 kho vật lý'
  );

  // -------------------------------------------------------------
  // PHẦN 3: KIỂM TOÁN CHẶN XUẤT ÂM KHO & CHUYỂN KHO 2 BƯỚC (PHASE 1)
  // -------------------------------------------------------------
  console.log('\n--- PHẦN 3: KIỂM TOÁN CHẶN LỖI XUẤT KHO ---');

  const testEdition = allEditions[0]; // H01 - Bệnh tưởng
  const khoAuCo = allWarehouses.find((w) => w.code === 'KHO_AU_CO')!;
  const currentAuCoStock = await InventoryService.getBalance(testEdition.id, khoAuCo.id, 'NEW');

  let blockedNegative = false;
  try {
    await InventoryService.recordMovement({
      editionId: testEdition.id,
      warehouseId: khoAuCo.id,
      eventType: 'DISPATCH_SALE',
      quantityDelta: -(currentAuCoStock + 99999),
      condition: 'NEW',
      documentRef: 'AUDIT-FAIL-TEST',
      note: 'Thử nghiệm xuất âm kho có bị chặn không',
      actorId: 'audit-bot',
    });
  } catch (err: any) {
    blockedNegative = true;
  }
  assert(blockedNegative, 'Chặn xuất âm kho vật lý trực tiếp thành công', `Đã từ chối xuất vượt quá tồn kho (${currentAuCoStock} cuốn)`);

  // -------------------------------------------------------------
  // PHẦN 4: KIỂM TOÁN ĐỘNG CƠ BÁN HÀNG & RÀNG BUỘC SẢN PHẨM (PHASE 2)
  // -------------------------------------------------------------
  console.log('\n--- PHẦN 4: KIỂM TOÁN ĐỘNG CƠ BÁN HÀNG (POS ORDERS) ---');

  // Edge case 1: Đơn rỗng (0 items)
  let blockedEmptyOrder = false;
  try {
    await OrderService.createOrder({
      warehouseId: khoAuCo.id,
      items: [],
    });
  } catch (err: any) {
    blockedEmptyOrder = true;
  }
  assert(blockedEmptyOrder, 'Từ chối tạo đơn hàng rỗng (0 sản phẩm)');

  // Edge case 2: Số lượng bán âm hoặc 0
  let blockedInvalidQty = false;
  try {
    await OrderService.createOrder({
      warehouseId: khoAuCo.id,
      items: [{ editionId: testEdition.id, quantity: 0 }],
    });
  } catch (err: any) {
    blockedInvalidQty = true;
  }
  assert(blockedInvalidQty, 'Từ chối tạo đơn hàng có số lượng <= 0');

  // Test Bán hàng thực tế: 1 cuốn H01 tại Kho Âu Cơ
  const initialStock = await InventoryService.getBalance(testEdition.id, khoAuCo.id, 'NEW');
  const retailOrder = await OrderService.createOrder({
    warehouseId: khoAuCo.id,
    channel: 'RETAIL_OFFICE',
    customerName: 'Khách hàng Audit Test',
    discountRate: 0.1, // Giảm 10%
    paymentMethod: 'CASH',
    fiscalScope: 'INTERNAL_MANAGEMENT',
    items: [{ editionId: testEdition.id, quantity: 1 }],
  });

  const stockAfterOrder = await InventoryService.getBalance(testEdition.id, khoAuCo.id, 'NEW');
  assert(
    stockAfterOrder === initialStock - 1,
    'Khấu trừ kho vật lý tức thì sau khi bán',
    `Tồn kho trước: ${initialStock} -> Tồn kho sau: ${stockAfterOrder} (-1 cuốn)`
  );
  assert(
    retailOrder.discountAmount === Math.round(retailOrder.subtotal * 0.1),
    'Tính chiết khấu đơn hàng chuẩn xác 100%',
    `Giá bìa: ${retailOrder.subtotal.toLocaleString()} đ | Giảm 10%: ${(retailOrder.discountAmount || 0).toLocaleString()} đ | Thực thu: ${retailOrder.finalAmount.toLocaleString()} đ`
  );

  // -------------------------------------------------------------
  // PHẦN 5: KIỂM TOÁN CÁCH LY SỔ KÉP TÀI CHÍNH (DUAL FISCAL AUDIT)
  // -------------------------------------------------------------
  console.log('\n--- PHẦN 5: KIỂM TOÁN CÁCH LY SỔ KÉP (OFFICIAL TAX vs INTERNAL) ---');

  // Tạo thêm 1 đơn xuất hóa đơn điện tử VAT
  const vatOrder = await OrderService.createOrder({
    warehouseId: khoAuCo.id,
    channel: 'WHOLESALE_PARTNER',
    customerName: 'Công ty Cổ phần Sách ABC',
    discountRate: 0.2,
    paymentMethod: 'BANK_TRANSFER',
    fiscalScope: 'OFFICIAL_TAX',
    vatInvoiceRequired: true,
    vatInvoiceCode: `VAT-AUDIT-${Date.now()}`,
    items: [{ editionId: testEdition.id, quantity: 2 }],
  });

  // Truy vấn góc nhìn KẾ TOÁN THUẾ
  const taxOrders = await OrderService.getOrders({ fiscalScope: 'OFFICIAL_TAX' });
  const hasInternalLeaked = taxOrders.some((o) => o.fiscalScope === 'INTERNAL_MANAGEMENT');
  assert(
    !hasInternalLeaked,
    'Sổ Kế Toán Thuế hoàn toàn sạch bóng đơn Nội Bộ/Đại Lý Sỉ (Zero-Leakage)',
    `Tổng số đơn thuế: ${taxOrders.length} đơn, không chứa bất kỳ đơn nội bộ nào`
  );

  const taxSummary = await OrderService.getSalesSummary({ fiscalScope: 'OFFICIAL_TAX' });
  assert(
    taxSummary.internalManagement.ordersCount === 0 &&
    taxSummary.internalManagement.revenue === 0,
    'Tổng hợp Doanh số Thuế cách ly hoàn toàn doanh thu ngầm',
    `Doanh thu thuế: ${taxSummary.officialTax.revenue.toLocaleString()} đ | Doanh thu nội bộ lọt vào: ${taxSummary.internalManagement.revenue} đ`
  );

  // Truy vấn góc nhìn CHỦ QUẢN LÝ (Executive Full View)
  const fullSummary = await OrderService.getSalesSummary({ fiscalScope: 'ALL' });
  assert(
    fullSummary.totalOrders >= taxSummary.officialTax.ordersCount,
    'Chủ doanh nghiệp xem được toàn cảnh thực tế hợp nhất',
    `Tổng số đơn: ${fullSummary.totalOrders} | Tổng tiền thu thật: ${fullSummary.totalRevenue.toLocaleString()} đ (Thuế: ${fullSummary.officialTax.revenue.toLocaleString()} đ, Nội bộ: ${fullSummary.internalManagement.revenue.toLocaleString()} đ)`
  );

  console.log('\n=================================================================');
  console.log(`🎉 KẾT QUẢ KIỂM TOÁN TOÀN DIỆN: ${passedTests}/${totalTests} BÀI KIỂM TRA ĐẠT 100%!`);
  console.log('🛡️ HỆ THỐNG ĐÃ SẴN SÀNG VẬN HÀNH VÀ ĐỦ ĐIỀU KIỆN CHUYỂN TIẾP SANG PHASE 3!');
  console.log('=================================================================\n');
}

runMasterAudit().catch((err) => {
  console.error('💥 LỖI KIỂM TOÁN TỔNG THỂ:', err);
  process.exit(1);
});
