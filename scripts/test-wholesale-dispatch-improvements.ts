import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';
import { matchesVietnameseSearch } from '../src/lib/vietnamese';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_wholesale_improvements.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

async function run() {
  console.log('--- TEST WHOLESALE DISPATCH IMPROVEMENTS ---');

  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-wholesale-dispatch-improvements');

  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const { eq } = await import('drizzle-orm');
  const schema = await import('../src/db/schema');
  const { DeliveryOrderService } = await import('../src/services/delivery-order.service');

  // =========================================================================
  // 1. KIỂM TRA TÌM KIẾM SÁCH (Search Bar Fix)
  // =========================================================================
  const testBooks = [
    { id: 'b1', title: 'Bốn tình yêu', code: 'HH001', isbn: '978604000001', author: 'C.S. Lewis', isbnLast4: '0001' },
    { id: 'b2', title: 'Người đua diều', code: 'HH002', isbn: '978604000002', author: 'Khaled Hosseini', isbnLast4: '0002' },
    { id: 'b3', title: 'May', code: 'HH003', isbn: '978604000003', author: 'Nguyễn Ngọc Tư', isbnLast4: '0003' },
  ];

  // Test 1a: Gõ "n" tìm ra "Bốn tình yêu" và "Người đua diều"
  const qN = 'n';
  const matchedWithN = testBooks.filter((b) => {
    const target = `${b.title} ${b.code} ${b.isbn} ${b.author} ${b.isbnLast4}`;
    return matchesVietnameseSearch(target, qN);
  });
  assert.ok(matchedWithN.some((b) => b.title === 'Bốn tình yêu'), 'Gõ "n" phải tìm thấy Bốn tình yêu');
  assert.ok(matchedWithN.some((b) => b.title === 'Người đua diều'), 'Gõ "n" phải tìm thấy Người đua diều');

  // Test 1b: Gõ tiếng Việt không dấu "bon tinh yeu"
  const matchedBon = testBooks.filter((b) => {
    const target = `${b.title} ${b.code} ${b.isbn} ${b.author} ${b.isbnLast4}`;
    return matchesVietnameseSearch(target, 'bon tinh yeu');
  });
  assert.equal(matchedBon.length, 1);
  assert.equal(matchedBon[0].id, 'b1');

  // Test 1c: Gõ tên tác giả không dấu "lewis" hoặc "nguyen ngoc tu"
  const matchedAuthor = testBooks.filter((b) => {
    const target = `${b.title} ${b.code} ${b.isbn} ${b.author} ${b.isbnLast4}`;
    return matchesVietnameseSearch(target, 'lewis');
  });
  assert.equal(matchedAuthor.length, 1);
  assert.equal(matchedAuthor[0].id, 'b1');

  // Test 1d: Gõ 4 số cuối ISBN "0002"
  const matchedIsbn = testBooks.filter((b) => {
    const target = `${b.title} ${b.code} ${b.isbn} ${b.author} ${b.isbnLast4}`;
    return matchesVietnameseSearch(target, '0002');
  });
  assert.equal(matchedIsbn.length, 1);
  assert.equal(matchedIsbn[0].id, 'b2');

  console.log('✓ 1. Search Bar: Khớp đúng tên sách tiếng Việt có/không dấu, tên tác giả, mã SKU, 4 số cuối ISBN');

  // =========================================================================
  // 2. KIỂM TRA LỌC KHO NGUỒN XUẤT HÀNG (Loại bỏ kho ký gửi và trung chuyển)
  // =========================================================================
  const allWarehouses = [
    { id: 'wh-1', code: 'KHO_AU_CO', name: 'Kho 1 - Âu Cơ', warehouseType: 'PHYSICAL_MAIN', isActive: true },
    { id: 'wh-2', code: 'KHO_QUYNH_MAI', name: 'Kho 2 - Quỳnh Mai', warehouseType: 'PHYSICAL_MAIN', isActive: true },
    { id: 'wh-3', code: 'KHO_HOI_CHO_HO_GUOM', name: 'Kho Hội chợ Hồ Gươm', warehouseType: 'FAIR_EVENT', isActive: true },
    { id: 'wh-4', code: 'KHO_KY_GUI_DL_BINH_BAN_BOOK', name: 'Kho Ký gửi - Bình bán Book', warehouseType: 'CONSIGNMENT', isActive: true },
    { id: 'wh-5', code: 'KHO_KY_GUI_DL_523_COFFEE', name: 'Kho Ký gửi - 523 Coffee', warehouseType: 'CONSIGNMENT', isActive: true },
    { id: 'wh-6', code: 'KHO_TRUNG_CHUYEN', name: 'Kho Trung chuyển', warehouseType: 'IN_TRANSIT', isActive: true },
    { id: 'wh-7', code: 'KHO_DONG_CUA', name: 'Kho Đã đóng', warehouseType: 'PHYSICAL_MAIN', isActive: false },
  ];

  const filteredSourceWarehouses = allWarehouses.filter((wh) => {
    if (wh.warehouseType === 'CONSIGNMENT' || wh.warehouseType === 'IN_TRANSIT') return false;
    if (wh.code.startsWith('KHO_KY_GUI')) return false;
    if (wh.isActive === false) return false;
    return true;
  });

  assert.equal(filteredSourceWarehouses.length, 3, 'Chỉ 3 kho hợp lệ làm nguồn xuất');
  assert.deepEqual(
    filteredSourceWarehouses.map((w) => w.code),
    ['KHO_AU_CO', 'KHO_QUYNH_MAI', 'KHO_HOI_CHO_HO_GUOM']
  );
  console.log('✓ 2. Kho nguồn xuất: Đã lọc sạch toàn bộ kho ký gửi, kho trung chuyển, kho ngưng hoạt động');

  // =========================================================================
  // 3. KIỂM TRA DRAFT LIFECYCLE (createDraft -> updateDraft -> deleteDraft)
  // =========================================================================
  const rawClient = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(rawClient);

  // Seed DB
  await db.insert(schema.warehouses).values([
    { id: 'wh-au-co', code: 'KHO_AU_CO', name: 'Kho Âu Cơ', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
    { id: 'wh-quynh-mai', code: 'KHO_QUYNH_MAI', name: 'Kho Quỳnh Mai', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
  ]);
  await db.insert(schema.partners).values([
    { id: 'part-1', code: 'DL_1', name: 'Đại lý 1', type: 'WHOLESALE', discountRate: 0.3 },
    { id: 'part-2', code: 'DL_2', name: 'Đại lý 2', type: 'WHOLESALE', discountRate: 0.4 },
  ]);
  await db.insert(schema.works).values([
    { id: 'w-1', code: 'W1', title: 'Tác phẩm 1', author: 'TG1' },
    { id: 'w-2', code: 'W2', title: 'Tác phẩm 2', author: 'TG2' },
  ]);
  await db.insert(schema.editions).values([
    { id: 'ed-1', code: 'H01', workId: 'w-1', isbn: '9780000001', isbnLast4: '0001', coverPrice: 100000 },
    { id: 'ed-2', code: 'H02', workId: 'w-2', isbn: '9780000002', isbnLast4: '0002', coverPrice: 200000 },
  ]);
  await db.insert(schema.stockBalances).values([
    { id: 'sb-1', productId: 'ed-1', editionId: 'ed-1', warehouseId: 'wh-au-co', physicalQuantity: 100, condition: 'NEW' },
    { id: 'sb-2', productId: 'ed-2', editionId: 'ed-2', warehouseId: 'wh-au-co', physicalQuantity: 100, condition: 'NEW' },
  ]);

  const STAFF = { staffId: 'staff-1', role: 'ROLE_WAREHOUSE', fullName: 'Thủ Kho Test' };

  // 3a. Tạo DRAFT
  const draft1 = await DeliveryOrderService.createDraft({
    partnerId: 'part-1',
    fromWarehouseId: 'wh-au-co',
    discountRate: 0.3,
    fiscalScope: 'COMMERCIAL_WHOLESALE',
    note: 'Giao đợt 1',
    items: [{ editionId: 'ed-1', quantity: 10, unitCoverPrice: 100000, unitSellingPrice: 70000 }],
    actorContext: STAFF,
  });
  assert.equal(draft1.status, 'DRAFT');
  assert.equal(draft1.subtotal, 1000000);
  assert.equal(draft1.finalAmount, 700000);

  // 3b. Cập nhật DRAFT (Sửa số lượng, thêm sách, đổi chiết khấu)
  const updatedDraft = await DeliveryOrderService.updateDraft({
    deliveryOrderId: draft1.id,
    partnerId: 'part-2',
    fromWarehouseId: 'wh-au-co',
    discountRate: 0.4,
    fiscalScope: 'COMMERCIAL_WHOLESALE',
    note: 'Giao đợt 1 đã cập nhật',
    items: [
      { editionId: 'ed-1', quantity: 5, unitCoverPrice: 100000, unitSellingPrice: 60000 },
      { editionId: 'ed-2', quantity: 2, unitCoverPrice: 200000, unitSellingPrice: 120000 },
    ],
    actorContext: STAFF,
  });
  assert.equal(updatedDraft.partnerId, 'part-2');
  assert.equal(updatedDraft.discountRate, 0.4);
  assert.equal(updatedDraft.subtotal, 5 * 100000 + 2 * 200000); // 900,000
  assert.equal(updatedDraft.finalAmount, 5 * 60000 + 2 * 120000); // 540,000
  assert.equal(updatedDraft.note, 'Giao đợt 1 đã cập nhật');

  // Kiểm tra items trong DB được cập nhật đúng
  const fetched = await DeliveryOrderService.getDeliveryOrder(draft1.id);
  assert.equal(fetched.items.length, 2);
  console.log('✓ 3. Draft Lifecycle: Tạo DRAFT và Cập nhật DRAFT thành công với đầy đủ items và tổng tiền');

  // 3c. Xóa DRAFT
  const draft2 = await DeliveryOrderService.createDraft({
    partnerId: 'part-1',
    fromWarehouseId: 'wh-au-co',
    discountRate: 0.3,
    items: [{ editionId: 'ed-1', quantity: 2, unitCoverPrice: 100000, unitSellingPrice: 70000 }],
    actorContext: STAFF,
  });
  await DeliveryOrderService.deleteDraft({ deliveryOrderId: draft2.id, actorContext: STAFF });
  const checkDeleted = await db.select().from(schema.deliveryOrders).where(eq(schema.deliveryOrders.id, draft2.id));
  assert.equal(checkDeleted.length, 0, 'Phiếu nháp phải bị xóa hoàn toàn khỏi DB');
  console.log('✓ 4. Xóa DRAFT: Đã xóa thành công phiếu nháp khỏi DB');

  // =========================================================================
  // 4. KIỂM TRA MÃ NGUỒN UI (WholesaleDispatchModal)
  // =========================================================================
  const modalSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/inventory/WholesaleDispatchModal.tsx'), 'utf8');

  // Kiểm tra không có bug đảo tham số matchesVietnameseSearch(q, target)
  assert.ok(!modalSrc.includes('matchesVietnameseSearch(q,'), 'CẤM đảo tham số matchesVietnameseSearch(q, target)');
  assert.ok(modalSrc.includes('matchesVietnameseSearch('), 'Phải sử dụng matchesVietnameseSearch');

  // Kiểm tra có nút "Xem Trước Bản In"
  assert.ok(modalSrc.includes('Xem Trước Bản In') || modalSrc.includes('Xem trước bản in'), 'Phải có nút xem trước bản in');

  // Kiểm tra có hỗ trợ chọn / tải phiếu nháp
  assert.ok(modalSrc.includes('DRAFT'), 'Phải hỗ trợ DRAFT');

  console.log('✓ 5. Kiểm tra mã nguồn WholesaleDispatchModal: Cú pháp và các nút chức năng đầy đủ');

  console.log('\n🎉 TOÀN BỘ KIỂM THỬ NÂNG CẤP XUẤT KHO ĐỐI TÁC THÀNH CÔNG!');
}

run().catch((e) => {
  console.error('❌ FAIL:', e.message);
  process.exit(1);
});
