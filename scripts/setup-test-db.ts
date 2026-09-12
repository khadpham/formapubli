/**
 * Chuẩn bị CSDL kiểm thử cách ly hoàn toàn với DB production.
 *
 * - DB test mặc định: file:formapubli_test.db (đổi qua TEST_DATABASE_FILE).
 * - KHÔNG BAO GIỜ chạm vào formapubli.db thật: script này tự tạo client
 *   riêng tới file test, không dùng shared `db` của ứng dụng.
 * - Seed tối thiểu deterministic: 3 kho + 6 ấn bản (gồm cặp trùng ISBN
 *   H21/H36) + tồn kho 100 cuốn/kho Âu Cơ, đủ cho test guard (<1s).
 * - Seed full 81 sách vẫn giữ ở scripts/seed.ts cho audit lớn.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import {
  warehouses,
  works,
  editions,
  stockBalances,
} from '../src/db/schema';

export const TEST_DB_FILE =
  process.env.TEST_DATABASE_FILE || 'formapubli_test.db';

export async function setupTestDb(dbFile: string = TEST_DB_FILE) {
  const resolved = path.resolve(process.cwd(), dbFile);

  // 0. Safety: cấm tuyệt đối trỏ vào DB production.
  if (path.basename(resolved) === 'formapubli.db') {
    throw new Error(
      'REFUSED: setup-test-db không bao giờ được trỏ vào formapubli.db production!'
    );
  }

  // 1. Clean Slate: xóa file test cũ (kèm -wal/-shm/-journal).
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const p = resolved + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  // 2. Dựng schema vào DB test qua `drizzle-kit push` (schema trực tiếp,
  // không replay lịch sử migration).
  // Lý do: `migrate` fresh trên libsql local hiện lỗi SQLITE_OK ở 0003
  // (ADD COLUMN ... REFERENCES) — đã ghi nhận cho team xử lý ở migration
  // gốc; DB test chỉ cần schema cuối đúng là đủ.
  const push = spawnSync('npx', ['drizzle-kit', 'push', '--config', 'drizzle.test.config.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, TEST_DATABASE_FILE: dbFile },
    stdio: 'pipe',
    shell: true,
  });
  if (push.status !== 0) {
    throw new Error(
      `drizzle-kit push (test DB) thất bại:\n${push.stdout?.toString()}\n${push.stderr?.toString()}`
    );
  }

  const client = createClient({ url: `file:${resolved}` });
  const testDb = drizzle(client, {
    schema: { warehouses, works, editions, stockBalances },
  });

  // 3. Seed tối thiểu deterministic.
  await testDb.insert(warehouses).values([
    { id: 'wh-au-co', code: 'KHO_AU_CO', name: 'Kho 1 - Âu Cơ (Test)', address: 'Test', isActive: true },
    { id: 'wh-quynh-mai', code: 'KHO_QUYNH_MAI', name: 'Kho 2 - Quỳnh Mai (Test)', address: 'Test', isActive: true },
    { id: 'wh-du-phong', code: 'KHO_DU_PHONG', name: 'Kho 3 - Dự phòng (Test)', address: 'Test', isActive: true },
  ]);

  await testDb.insert(works).values([
    { id: 'w-t01', code: 'TEST-001', title: 'Sách Test 01', author: 'Tác giả Test', isActive: true },
    { id: 'w-t02', code: 'TEST-002', title: 'Sách Test 02', author: 'Tác giả Test', isActive: true },
    { id: 'w-t-baudelaire', code: 'TEST-BAU', title: 'Le Spleen de Paris', author: 'Baudelaire', isActive: true },
    { id: 'w-t03', code: 'TEST-003', title: 'Sách Test 03', author: 'Tác giả Test', isActive: true },
  ]);

  await testDb.insert(editions).values([
    { id: 'ed-t01', code: 'H-T01', workId: 'w-t01', title: 'Sách Test 01', isbn: '9780000000001', isbnLast4: '0001', coverPrice: 100000, isActive: true },
    { id: 'ed-t02', code: 'H-T02', workId: 'w-t02', title: 'Sách Test 02', isbn: '9780000000002', isbnLast4: '0002', coverPrice: 120000, isActive: true },
    { id: 'ed-t21', code: 'H21', workId: 'w-t-baudelaire', title: 'Le Spleen de Paris (Bìa tím)', isbn: '9786044737690', isbnLast4: '7690', coverPrice: 150000, isActive: true },
    { id: 'ed-t36', code: 'H36', workId: 'w-t-baudelaire', title: 'Le Spleen de Paris (Tái bản) - Bìa trắng', isbn: '9786044737690', isbnLast4: '7690', coverPrice: 160000, isActive: true },
    { id: 'ed-t03', code: 'H-T03', workId: 'w-t03', title: 'Sách Test 03', isbn: '9780000000003', isbnLast4: '0003', coverPrice: 90000, isActive: true },
  ]);

  await testDb.insert(stockBalances).values([
    { id: 'sb-ed-t01-wh-au-co-NEW', editionId: 'ed-t01', warehouseId: 'wh-au-co', condition: 'NEW', physicalQuantity: 100 },
    { id: 'sb-ed-t02-wh-au-co-NEW', editionId: 'ed-t02', warehouseId: 'wh-au-co', condition: 'NEW', physicalQuantity: 100 },
    { id: 'sb-ed-t21-wh-au-co-NEW', editionId: 'ed-t21', warehouseId: 'wh-au-co', condition: 'NEW', physicalQuantity: 100 },
    { id: 'sb-ed-t36-wh-au-co-NEW', editionId: 'ed-t36', warehouseId: 'wh-au-co', condition: 'NEW', physicalQuantity: 100 },
    { id: 'sb-ed-t03-wh-au-co-NEW', editionId: 'ed-t03', warehouseId: 'wh-au-co', condition: 'NEW', physicalQuantity: 100 },
  ]);

  client.close();

  console.log(`✅ Test DB sẵn sàng: ${resolved} (3 kho, 5 ấn bản gồm cặp trùng ISBN H21/H36, tồn 100/kho Âu Cơ).`);
  return { dbFile: resolved };
}

const invokedAsScript =
  process.argv[1] && path.basename(process.argv[1]) === 'setup-test-db.ts';

if (invokedAsScript) {
  setupTestDb().catch((err) => {
    console.error('❌ setup-test-db thất bại:', err);
    process.exit(1);
  });
}
