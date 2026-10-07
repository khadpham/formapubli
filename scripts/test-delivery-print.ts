import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_delivery_print.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

async function run() {
  console.log('--- TEST DELIVERY PRINT: thông tin đại lý + bản ký gửi ---');

  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-delivery-print');

  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const { eq } = await import('drizzle-orm');
  const schema = await import('../src/db/schema');
  const { DeliveryOrderService } = await import('../src/services/delivery-order.service');

  const rawClient = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(rawClient);
  await db.insert(schema.warehouses).values([
    { id: 'wh-au-co', code: 'KHO_AU_CO', name: 'Kho Âu Cơ', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
  ]);
  await db.insert(schema.partners).values([
    {
      id: 'part-pr', code: 'DL_PR', name: 'Đại lý PR', type: 'WHOLESALE', discountRate: 0.35,
      address: 'Số 9 Phố In, Hà Nội', phone: '0909009009', taxCode: '0109009009',
      receiverName: 'Anh Nhận Hàng', shipNote: 'Giao giờ hành chính',
    },
    { id: 'part-naked', code: 'DL_NK', name: 'Đại lý Không Địa Chỉ', type: 'WHOLESALE', discountRate: 0.3 },
  ]);
  await db.insert(schema.works).values([{ id: 'work-pr', code: 'W-PR', title: 'TP PR', author: 'TG' }]);
  await db.insert(schema.editions).values([
    { id: 'ed-pr-1', code: 'P01', workId: 'work-pr', isbn: '9780000000911', isbnLast4: '0911', coverPrice: 100000 },
  ]);
  const STAFF = { staffId: 'staff-tk', role: 'ROLE_WAREHOUSE', fullName: 'Thủ Kho' };

  // 1. Phiếu bán đứt: getDeliveryOrder trả đủ thông tin đại lý cho khối in.
  const sale = await DeliveryOrderService.createDraft({
    partnerId: 'part-pr',
    fromWarehouseId: 'wh-au-co',
    discountRate: 0.35,
    fiscalScope: 'COMMERCIAL_WHOLESALE',
    items: [{ editionId: 'ed-pr-1', quantity: 10, unitCoverPrice: 100000, unitSellingPrice: 65000 }],
    actorContext: STAFF,
  });
  const got = await DeliveryOrderService.getDeliveryOrder(sale.id);
  assert.equal(got.partnerName, 'Đại lý PR');
  assert.equal(got.partnerAddress, 'Số 9 Phố In, Hà Nội');
  assert.equal(got.partnerPhone, '0909009009');
  assert.equal(got.partnerReceiverName, 'Anh Nhận Hàng');
  assert.ok(Number.isInteger(got.finalAmount), 'tiền phiếu phải nguyên đồng VND');
  console.log('✓ getDeliveryOrder trả đủ địa chỉ/SĐT/người nhận, tiền nguyên đồng');

  // 2. Đại lý thiếu địa chỉ → null, phiếu không crash.
  const naked = await DeliveryOrderService.createDraft({
    partnerId: 'part-naked',
    fromWarehouseId: 'wh-au-co',
    discountRate: 0.3,
    items: [{ editionId: 'ed-pr-1', quantity: 1, unitCoverPrice: 100000, unitSellingPrice: 70000 }],
    actorContext: STAFF,
  });
  const gotNaked = await DeliveryOrderService.getDeliveryOrder(naked.id);
  assert.equal(gotNaked.partnerAddress, null);
  assert.equal(gotNaked.partnerPhone, null);
  assert.equal(gotNaked.partnerReceiverName, null);
  console.log('✓ Đại lý thiếu địa chỉ → null, không crash');

  // 3. Phiếu ký gửi đọc được scope (bản in ẩn cột tiền theo fiscalScope).
  const cons = await DeliveryOrderService.createDraft({
    partnerId: 'part-pr',
    fromWarehouseId: 'wh-au-co',
    discountRate: 0.35,
    fiscalScope: 'CONSIGNMENT_DISPATCH',
    items: [{ editionId: 'ed-pr-1', quantity: 5, unitCoverPrice: 100000, unitSellingPrice: 65000 }],
    actorContext: STAFF,
  });
  const gotCons = await DeliveryOrderService.getDeliveryOrder(cons.id);
  assert.equal(gotCons.fiscalScope, 'CONSIGNMENT_DISPATCH');
  console.log('✓ Phiếu ký gửi giữ đúng scope cho bản in');

  // 4. Mẫu in có đủ: khối địa chỉ giao hàng + bản ký gửi không tiền.
  const src = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/inventory/DeliveryReceiptPrint.tsx'), 'utf8'
  );
  for (const needle of [
    'partnerReceiverName',
    'partnerAddress',
    'Địa chỉ giao hàng',
    'PHIẾU XUẤT KHO KÝ GỬI ĐẠI LÝ',
    'chưa thu tiền',
  ]) {
    assert.ok(src.includes(needle), `mẫu in thiếu: ${needle}`);
  }
  console.log('✓ Mẫu in đủ khối đại lý + bản ký gửi');

  console.log('🎉 TOÀN BỘ TEST DELIVERY PRINT PASS!');
}

run().catch((e) => { console.error('❌ FAIL:', e.message); process.exit(1); });
