import { db, works, editions } from '../src/db';
import { InventoryService } from '../src/services/inventory.service';
import { OrderService } from '../src/services/order.service';
import { BundleService } from '../src/services/bundle.service';
import { eq } from 'drizzle-orm';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-bundle-engine');

async function runBundleTests() {
  console.log('🎁 ========================================================');
  console.log('🎁 KIỂM THỬ ĐỘNG CƠ COMBO / BOXSET & BOTTLENECK');
  console.log('🎁 ========================================================\n');

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

  const AUCO = 'wh-au-co';
  const books = await db.select().from(editions).limit(3);
  if (books.length < 3) throw new Error('Test DB chưa seed đủ ấn bản.');
  const [bookA, bookB, bookC] = books;

  // Dựng vỏ hộp pseudo-SKU + combo test (2 sách + 1 hộp).
  const boxWorkId = 'w-box-test';
  await db.insert(works).values({
    id: boxWorkId, code: 'W-BOX-TEST', title: 'Vỏ hộp test', author: 'formapubli', isActive: true,
  }).onConflictDoNothing();
  await db.insert(editions).values({
    id: 'ed-box-test', code: 'BOX-TEST', workId: boxWorkId, title: 'Vỏ hộp test',
    isbn: 'BOX-TEST-2026', isbnLast4: '2026', coverPrice: 50000, isActive: true,
  }).onConflictDoNothing();

  // Nạp tồn kho linh kiện tại Âu Cơ.
  const stockSetup: Array<[string, number]> = [
    [bookA.id, 10], [bookB.id, 6], [bookC.id, 100], ['ed-box-test', 7],
  ];
  for (const [editionId, qty] of stockSetup) {
    await InventoryService.recordMovement({
      editionId, warehouseId: AUCO, eventType: 'RECEIPT', quantityDelta: qty,
      condition: 'NEW', documentRef: 'TEST-BUNDLE-PREP', actorId: 'test-runner',
      idempotencyKey: `bundle-prep-${editionId}-${Date.now()}`,
    });
  }

  const sumCover = (bookA.coverPrice ?? 0) + (bookB.coverPrice ?? 0) + 50000;
  const comboPrice = 300000;
  const created = await BundleService.createBundle({
    code: `BOXSET-TEST-${Date.now().toString().slice(-4)}`,
    seasonName: 'Mùa Test',
    releaseDate: '2026-09-13',
    comboPrice,
    items: [
      { editionId: bookA.id, quantityInBundle: 1 },
      { editionId: bookB.id, quantityInBundle: 1 },
      { editionId: 'ed-box-test', quantityInBundle: 1 },
    ],
  });
  const bundleId = created.bundleId;

  // TEST 1: Bottleneck = min tồn linh kiện (tính trên số dư thực tế gồm tồn mở đầu).
  const preA = await InventoryService.getBalance(bookA.id, AUCO, 'NEW');
  const preB = await InventoryService.getBalance(bookB.id, AUCO, 'NEW');
  const preBox = await InventoryService.getBalance('ed-box-test', AUCO, 'NEW');
  const expectedAvail = Math.min(preA, preB, preBox);
  const avail = await BundleService.getAvailability(bundleId, AUCO);
  ok(avail.available === expectedAvail, 'Bottleneck = min tồn linh kiện', `khả dụng ${avail.available} bộ (kỳ vọng ${expectedAvail})`);

  // TEST 2: Bán 2 bộ -> trừ đồng thời 3 SKU, tổng tiền đúng comboPrice × 2.
  const balA0 = await InventoryService.getBalance(bookA.id, AUCO, 'NEW');
  const balB0 = await InventoryService.getBalance(bookB.id, AUCO, 'NEW');
  const box0 = await InventoryService.getBalance('ed-box-test', AUCO, 'NEW');
  const order = await OrderService.createOrder({
    warehouseId: AUCO,
    customerName: 'Khách mua combo test',
    fiscalScope: 'INTERNAL_MANAGEMENT',
    cashierId: 'cashier-bundle-test',
    items: [],
    bundles: [{ bundleId, quantity: 2 }],
  });
  ok(order.finalAmount === comboPrice * 2, `Tổng tiền đúng ${comboPrice * 2} đ`, `thực thu ${order.finalAmount} đ`);
  ok(
    (await InventoryService.getBalance(bookA.id, AUCO, 'NEW')) === balA0 - 2,
    'Trừ đồng thời sách A (-2)'
  );
  ok(
    (await InventoryService.getBalance(bookB.id, AUCO, 'NEW')) === balB0 - 2,
    'Trừ đồng thời sách B (-2)'
  );
  ok(
    (await InventoryService.getBalance('ed-box-test', AUCO, 'NEW')) === box0 - 2,
    'Trừ đồng thời vỏ hộp (-2)'
  );

  // TEST 3: Tổng phân bổ tỉ trọng khớp 100% comboPrice (kiểm tra từng dòng).
  const priced = await BundleService.priceLines(bundleId, 1);
  const sumUnits = priced.reduce((s, p) => s + p.unitSellingPrice, 0);
  ok(sumUnits === comboPrice, `Phân bổ tỉ trọng khớp 100% comboPrice`, `tổng ${sumUnits} đ`);

  // TEST 4: Vượt bottleneck bị chặn cứng + nêu đích danh đầu cạn.
  // Sau TEST 2: bookB = 50+6-2 = 54, hộp = 7-2 = 5 -> bottleneck = 5 (hộp).
  const availAfter = await BundleService.getAvailability(bundleId, AUCO);
  let blocked = false;
  let blockMsg = '';
  try {
    await OrderService.createOrder({
      warehouseId: AUCO,
      customerName: 'Khách mua vượt bottleneck',
      items: [],
      bundles: [{ bundleId, quantity: availAfter.available + 1 }],
    });
  } catch (err: any) {
    blocked = true;
    blockMsg = err.message || '';
  }
  ok(blocked && blockMsg.includes('BOX-TEST'), 'Vượt bottleneck bị chặn + nêu đích danh đầu cạn', blockMsg);

  // TEST 5: Đơn hỗn hợp lẻ + combo trong 1 transaction.
  const mixed = await OrderService.createOrder({
    warehouseId: AUCO,
    customerName: 'Khách mua hỗn hợp test',
    items: [{ editionId: bookC.id, quantity: 1 }],
    bundles: [{ bundleId, quantity: 1 }],
  });
  ok(mixed.itemsCount === 4, 'Đơn hỗn hợp: 1 dòng lẻ + 3 dòng linh kiện', `${mixed.itemsCount} dòng`);
  ok(mixed.finalAmount > 0, 'Tổng tiền hỗn hợp > 0');

  // TEST 6: Combo rỗng / số lượng 0 bị từ chối.
  let rejected = false;
  try {
    await OrderService.createOrder({
      warehouseId: AUCO, customerName: 'Khách test rỗng', items: [], bundles: [],
    });
  } catch {
    rejected = true;
  }
  ok(rejected, 'Đơn không có lẻ lẫn combo bị từ chối');

  console.log('\n========================================================');
  console.log(`🎉 HOÀN TẤT: ${passed}/${total} BÀI TEST BOXSET ENGINE ĐẠT 100%!`);
  console.log('========================================================\n');
}

runBundleTests().catch((err) => {
  console.error('❌ test-bundle-engine thất bại:', err);
  process.exit(1);
});
