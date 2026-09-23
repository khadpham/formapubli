import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_warehouse_creation.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

async function run() {
  console.log('--- TEST WAREHOUSE CREATION & MULTI-FAIR EVENT POS SUPPORT ---');

  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-warehouse-creation');

  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const { eq } = await import('drizzle-orm');
  const schema = await import('../src/db/schema');
  const { WarehouseService } = await import('../src/services/warehouse.service');

  const rawClient = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(rawClient);

  // 1. Tạo kho hội chợ mới thành công với tên tiếng Việt có dấu
  console.log('\n[Case 1] Tạo kho gian hàng Hội chợ Giảng Võ');
  const wh1 = await WarehouseService.createWarehouse(
    {
      name: 'Kho Hội Chợ Giảng Võ 2026',
      address: 'Gian B12, Triển lãm Giảng Võ, Ba Đình, Hà Nội',
      warehouseType: 'FAIR_EVENT',
      isSellableOnPos: true,
    },
    db
  );

  assert.equal(wh1.code, 'KHO_HOI_CHO_GIANG_VO_2026');
  assert.equal(wh1.warehouseType, 'FAIR_EVENT');
  assert.equal(wh1.isActive, true);
  assert.equal(wh1.isSellableOnPos, true);
  console.log(`✓ Đã tạo kho: ${wh1.code} (${wh1.id}) - isSellableOnPos: ${wh1.isSellableOnPos}`);

  // 2. Tạo kho hội chợ thứ hai chạy song song (Đà Nẵng)
  console.log('\n[Case 2] Mở thêm kho Hội Chợ Đà Nẵng chạy song song');
  const wh2 = await WarehouseService.createWarehouse(
    {
      name: 'Hội Chợ Sách Hải Châu Đà Nẵng',
      code: 'KHO_HC_DA_NANG',
      address: 'Công viên APEC, Hải Châu, Đà Nẵng',
      warehouseType: 'FAIR_EVENT',
      isSellableOnPos: true,
    },
    db
  );
  assert.equal(wh2.code, 'KHO_HC_DA_NANG');
  assert.equal(wh2.id, 'wh-kho-hc-da-nang');
  assert.equal(wh2.isSellableOnPos, true);
  console.log(`✓ Đã tạo kho song song: ${wh2.code} (${wh2.id})`);

  // 3. Tạo kho lưu trữ không bán lẻ trên POS
  console.log('\n[Case 3] Tạo kho lưu trữ không bán POS');
  const wh3 = await WarehouseService.createWarehouse(
    {
      name: 'Kho Dự Phòng Lưu Kho',
      code: 'KHO_DU_PHONG_STORAGE',
      warehouseType: 'PHYSICAL_MAIN',
      isSellableOnPos: false,
    },
    db
  );
  assert.equal(wh3.isSellableOnPos, false);
  console.log(`✓ Đã tạo kho lưu trữ: ${wh3.code} - isSellableOnPos: false`);

  // 4. Kiểm tra listSellable() nạp được cả 2 kho hội chợ
  console.log('\n[Case 4] Kiểm tra WarehouseService.listSellable()');
  const sellable = await WarehouseService.listSellable(db);
  const sellableCodes = sellable.map((w) => w.code);
  assert.ok(sellableCodes.includes(wh1.code), 'Kho Giảng Võ phải có trong listSellable');
  assert.ok(sellableCodes.includes(wh2.code), 'Kho Đà Nẵng phải có trong listSellable');
  assert.ok(!sellableCodes.includes(wh3.code), 'Kho Lưu Trữ không được có trong listSellable');
  console.log(`✓ Danh sách kho bán lẻ POS gồm: ${sellableCodes.join(', ')}`);

  // 5. Kiểm tra assertSellable() hoạt động chính xác
  console.log('\n[Case 5] Kiểm tra WarehouseService.assertSellable()');
  await WarehouseService.assertSellable(wh1.id, db);
  await WarehouseService.assertSellable(wh2.id, db);
  let blocked = false;
  try {
    await WarehouseService.assertSellable(wh3.id, db);
  } catch (err: any) {
    blocked = true;
    assert.ok(err.message.includes('không được phép bán trực tiếp'));
  }
  assert.ok(blocked, 'Kho không bật POS phải bị chặn bởi assertSellable');
  console.log('✓ assertSellable chặn đúng kho không được phép bán lẻ');

  // 6. Kiểm tra chặn trùng mã kho
  console.log('\n[Case 6] Chặn trùng mã kho');
  let duplicateBlocked = false;
  try {
    await WarehouseService.createWarehouse(
      {
        name: 'Đà Nẵng Chi Nhánh 2',
        code: 'KHO_HC_DA_NANG',
      },
      db
    );
  } catch (err: any) {
    duplicateBlocked = true;
    assert.ok(err.message.includes('đã tồn tại'));
  }
  assert.ok(duplicateBlocked, 'Phải chặn khi tạo kho trùng mã');
  console.log('✓ Chặn trùng mã kho thành công');

  // 7. Kiểm tra chặn tên kho rỗng
  console.log('\n[Case 7] Chặn tên kho rỗng');
  let emptyBlocked = false;
  try {
    await WarehouseService.createWarehouse({ name: '   ' }, db);
  } catch (err: any) {
    emptyBlocked = true;
  }
  assert.ok(emptyBlocked, 'Phải chặn khi tên kho rỗng');
  console.log('✓ Chặn tên kho rỗng thành công');

  console.log('\n>>> TẤT CẢ TEST CASES CHO TASK 9 ĐÃ PASS 100%! <<<');
  process.exit(0);
}

run().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
