/**
 * Task 2 — `AnalyticsService.stockSummary(warehouseId?)` lọc tồn kho theo kho.
 *
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-stock-summary-scope
 * DB cô lập RIÊNG cho suite này (dựng schema mới bằng migrateFresh, tự xoá
 * khi kết thúc) — không đụng formapubli.db production.
 *
 * Vì sao tự dựng DB thay vì dùng DB test chung: số kho trong DB chung là hạt
 * seed, mọi suite khác đều có thể thêm/xoá kho ⇒ assert "warehouseCount = 2"
 * sẽ đỏ ngẫu nhiên theo thứ tự chạy. Ở đây số kho do chính suite quyết định.
 */
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_stock_scope.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

async function run() {
  console.log('--- TEST: stockSummary lọc tồn kho theo kho ---');

  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-stock-summary-scope');

  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../src/db/schema');
  const { AnalyticsService } = await import('../src/services/analytics.service');

  const rawClient = createClient({ url: process.env.DATABASE_URL! });
  const seed = drizzle(rawClient);

  // 3 kho: 2 đang hoạt động + 1 đã NGƯNG (vẫn còn tồn) để chứng minh bộ lọc
  // `warehouses.is_active` của hàm cũ không bị rơi khi thêm tham số.
  await seed.insert(schema.warehouses).values([
    { id: 'wh-au-co', code: 'KHO_AU_CO_SCOPE', name: 'Kho Âu Cơ', warehouseType: 'PHYSICAL_MAIN', isSellableOnPos: true, isActive: true },
    { id: 'wh-quynh-mai', code: 'KHO_QUYNH_MAI_SCOPE', name: 'Kho Quỳnh Mai', warehouseType: 'PHYSICAL_MAIN', isSellableOnPos: true, isActive: true },
    { id: 'wh-tam-dung', code: 'KHO_TAM_DUNG_SCOPE', name: 'Kho Tạm Dừng', warehouseType: 'PHYSICAL_MAIN', isSellableOnPos: false, isActive: false },
  ]);

  await seed.insert(schema.works).values({
    id: 'work-scope-1', code: 'FORMA-SCOPE-1', title: 'Tác Phẩm Kiểm Tra', author: 'Forma', isActive: true,
  });

  await seed.insert(schema.editions).values([
    { id: 'ed-scope-1', code: 'SC-01', workId: 'work-scope-1', isbn: '9786049000011', isbnLast4: '0011', coverPrice: 100000, isActive: true },
    { id: 'ed-scope-2', code: 'SC-02', workId: 'work-scope-1', isbn: '9786049000022', isbnLast4: '0022', coverPrice: 200000, isActive: true },
    { id: 'ed-scope-3', code: 'SC-03', workId: 'work-scope-1', isbn: '9786049000033', isbnLast4: '0033', coverPrice: 300000, isActive: false },
  ]);

  await seed.insert(schema.stockBalances).values([
    { id: 'sb-scope-1', editionId: 'ed-scope-1', warehouseId: 'wh-au-co', physicalQuantity: 50, condition: 'NEW' },
    { id: 'sb-scope-2', editionId: 'ed-scope-2', warehouseId: 'wh-au-co', physicalQuantity: 20, condition: 'NEW' },
    { id: 'sb-scope-3', editionId: 'ed-scope-1', warehouseId: 'wh-quynh-mai', physicalQuantity: 10, condition: 'NEW' },
    // Kho đã ngưng + ấn bản đã khoá: tồn này KHÔNG được tính (giữ luật cũ).
    { id: 'sb-scope-4', editionId: 'ed-scope-1', warehouseId: 'wh-tam-dung', physicalQuantity: 999, condition: 'NEW' },
    { id: 'sb-scope-5', editionId: 'ed-scope-3', warehouseId: 'wh-au-co', physicalQuantity: 777, condition: 'NEW' },
  ]);

  const all = await AnalyticsService.stockSummary();
  const one = await AnalyticsService.stockSummary('wh-au-co');
  const other = await AnalyticsService.stockSummary('wh-quynh-mai');

  // 1. Không tham số = y hệt contract cũ (kho ngưng 999 + ấn bản khoá 777 bị loại)
  if (all.totalUnits !== 80) throw new Error(`Tổng tồn phải 80 (50+20+10), nhận ${all.totalUnits}.`);
  if (all.titlesWithStock !== 2) throw new Error(`titlesWithStock phải 2, nhận ${all.titlesWithStock}.`);
  if (all.totalSkus !== 2) throw new Error(`totalSkus phải 2 (ấn bản khoá không tính), nhận ${all.totalSkus}.`);
  if (all.warehouseCount !== 2) throw new Error(`warehouseCount phải 2 (kho Tạm Dừng đã ngưng), nhận ${all.warehouseCount}.`);
  if (all.warehouseNames.length !== 2) throw new Error(`warehouseNames phải có 2 tên, nhận ${all.warehouseNames.length}.`);
  if (all.warehouseCount < 2) throw new Error('Giả định test sai: cần >=2 kho.');

  // 2. Có tham số: chỉ tính kho đó, warehouseCount = 1, tên đúng kho đó
  if (one.warehouseCount !== 1) throw new Error(`warehouseCount phải =1, nhận ${one.warehouseCount}.`);
  if (one.totalUnits !== 70) throw new Error(`Tồn kho Âu Cơ phải 70 (50+20), nhận ${one.totalUnits}.`);
  if (!(one.totalUnits <= all.totalUnits)) throw new Error('Lọc kho sai: tồn kho con lớn hơn tồn toàn hệ thống.');
  if (one.titlesWithStock !== 2) throw new Error(`titlesWithStock kho Âu Cơ phải 2, nhận ${one.titlesWithStock}.`);
  if (one.warehouseNames.length !== 1 || one.warehouseNames[0] !== 'Kho Âu Cơ') {
    throw new Error(`warehouseNames phải đúng ['Kho Âu Cơ'], nhận ${JSON.stringify(one.warehouseNames)}.`);
  }
  // totalSkus là tổng SKU TOÀN hệ thống (catalog), KHÔNG lọc theo kho.
  if (one.totalSkus !== all.totalSkus) {
    throw new Error(`totalSkus phải giữ nguyên khi lọc kho (${all.totalSkus}), nhận ${one.totalSkus}.`);
  }

  // 3. Kho thứ hai: tồn phải vừa đúng số của kho đó, không lẫn kho trước
  if (other.warehouseCount !== 1) throw new Error(`warehouseCount kho Quỳnh Mai phải =1, nhận ${other.warehouseCount}.`);
  if (other.totalUnits !== 10) throw new Error(`Tồn kho Quỳnh Mai phải 10, nhận ${other.totalUnits}.`);
  if (other.warehouseNames[0] !== 'Kho Quỳnh Mai') {
    throw new Error(`warehouseNames sai, nhận ${JSON.stringify(other.warehouseNames)}.`);
  }

  rawClient.close();
  console.log('OK: stockSummary loc dung theo kho.');
}

run()
  .catch((err) => {
    console.error('❌ TEST THẤT BẠI:', err);
    process.exit(1);
  })
  .finally(() => {
    for (const s of ['', '-wal', '-shm', '-journal']) {
      try { fs.unlinkSync(DB_FILE + s); } catch {}
    }
  });