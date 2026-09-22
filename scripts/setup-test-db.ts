/**
 * Chuẩn bị CSDL kiểm thử cách ly hoàn toàn với DB production.
 *
 * - DB test mặc định: file:formapubli_test.db (đổi qua TEST_DATABASE_FILE).
 * - KHÔNG BAO GIỜ chạm vào formapubli.db thật: script này tự tạo client
 *   riêng tới file test, không dùng shared `db` của ứng dụng.
 * - Full seed: 3 kho + 5 đối tác + 81 ấn bản từ data_tabs (giống seed prod)
 *   + số dư mở đầu OPENING_BALANCE 50 cuốn/ấn bản tại Kho Âu Cơ (ghi cả
 *   ledger lẫn balance để bất biến bảo toàn ledger == balance luôn đúng).
 * - Helpers parse CSV/acronym được sao chép từ scripts/seed.ts để file này
 *   tự chủ hoàn toàn (không import seed prod-bound).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrateFresh } from './migrate-fresh';
import {
  warehouses,
  partners,
  works,
  editions,
  inventoryLedger,
  stockBalances,
  staffAccounts,
} from '../src/db/schema';
import {
  DEFAULT_STAFF_ACCOUNTS,
  hashStaffPasscodeV2,
} from '../src/lib/auth-session';


export const TEST_DB_FILE =
  process.env.TEST_DATABASE_FILE || 'formapubli_test.db';

export const OPENING_QTY_PER_EDITION = 50;

function removeAccents(str: string): string {
  return str
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd');
}

function generateAcronym(title: string): string {
  const clean = removeAccents(title.toLowerCase())
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim();
  return clean.split(/\s+/).map((w) => w[0]).join('');
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

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

  // 2. Dựng schema từ đúng chuỗi journal 0000 -> 0008 qua migrate-fresh
  // (runner chuẩn bỏ qua chunk comment-only, nội dung SQL giữ nguyên).
  // Đồng thời dogfood đường migrate journal trên mọi lần chạy test.
  await migrateFresh({
    targetUrl: `file:${resolved}`,
    expectTables: [
      'works', 'editions', 'warehouses', 'partners', 'customers',
      'seasonal_bundles', 'bundle_items', 'customer_subscriptions',
      'customer_owned_books', 'inventory_ledger', 'stock_balances',
      'orders', 'order_items', 'audit_logs', 'cashbox_sessions',
      'counter_allocations', 'rma_tickets', 'transfer_shipments',
      'transfer_shipment_items', 'consignment_statements',
      'consignment_statement_lines', 'consignment_payments',
      'rights_contracts', 'return_orders', 'return_order_items',
      'staff_accounts', 'document_sequences', 'idempotency_keys',
    ],
  });


  const client = createClient({ url: `file:${resolved}` });
  const testDb = drizzle(client, {
    schema: { warehouses, partners, works, editions, inventoryLedger, stockBalances },
  });

  // 3. Seed 3 kho vật lý (giữ nguyên ID prod để test nào dùng ID cứng vẫn chạy).
  await testDb.insert(warehouses).values([
    { id: 'wh-au-co', code: 'KHO_AU_CO', name: 'Kho 1 - Âu Cơ (Test)', address: 'Test', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
    { id: 'wh-quynh-mai', code: 'KHO_QUYNH_MAI', name: 'Kho 2 - Quỳnh Mai (Test)', address: 'Test', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
    { id: 'wh-du-phong', code: 'KHO_DU_PHONG', name: 'Kho 3 - Dự phòng (Test)', address: 'Test', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
    { id: 'wh-in-transit', code: 'KHO_IN_TRANSIT', name: 'Kho ảo Trung chuyển (Test)', address: 'Test', isActive: true, isSellableOnPos: false, warehouseType: 'IN_TRANSIT' },
  ]);

  // 4. Seed đối tác (giữ nguyên ID prod).
  await testDb.insert(partners).values([
    { id: 'part-direct', code: 'BAN_LE_DIRECT', name: 'Kênh Bán lẻ Trực tiếp (Test)', type: 'INTERNAL', discountRate: 0.0, contactInfo: 'Test' },
    { id: 'part-hoi-cho', code: 'HOI_CHO_EVENT', name: 'Gian hàng Hội chợ (Test)', type: 'INTERNAL', discountRate: 0.0, contactInfo: 'Test' },
    { id: 'part-ca-chep', code: 'NS_CA_CHEP', name: 'Nhà sách Cá Chép (Test)', type: 'CONSIGNMENT', discountRate: 0.4, contactInfo: 'Test' },
    { id: 'part-mao-dinh-le', code: 'NS_MAO_DINH_LE', name: 'Nhà sách Mão Đinh Lễ (Test)', type: 'CONSIGNMENT', discountRate: 0.4, contactInfo: 'Test' },
    { id: 'part-library', code: 'THU_VIEN_DOI_TAC', name: 'Thư viện & Trường học (Test)', type: 'LIBRARY', discountRate: 0.2, contactInfo: 'Test' },
  ]);

  // 5. Seed 81 ấn bản từ catalog CSV (cùng logic seed prod).
  const csvPath = path.join(process.cwd(), 'data_tabs', 'sheet1_danhmuc_gid_0.csv');
  const fileContent = fs.readFileSync(csvPath, 'utf-8').replace(/^\uFEFF/, '');
  const rows = fileContent.split('\n').filter((l) => l.trim().length > 0).slice(1).map(parseCSVLine);

  let editionCount = 0;
  const editionIds: string[] = [];
  for (const r of rows) {
    const [
      _label, itemCode, isbn, title, rawPrice, formatSize, rawPages,
      author, translator, _vatCol, statusCol, category, rawYear, publisher,
    ] = r;
    if (!itemCode || !isbn) continue;

    const coverPrice = parseFloat((rawPrice || '0').replace(/[^0-9]/g, '')) || 0;
    const pages = parseInt((rawPages || '').replace(/[^0-9]/g, ''), 10) || null;
    const pubYear = parseInt((rawYear || '').replace(/[^0-9]/g, ''), 10) || null;
    const status = (statusCol || '').toLowerCase().includes('sold out') ? 'SOLD_OUT' : 'IN_STOCK';

    let workId = `work-${itemCode.toLowerCase()}`;
    let editionNum = 1;
    if (itemCode === 'H36') {
      workId = 'work-h21';
      editionNum = 2;
    }
    if (itemCode !== 'H36') {
      await testDb.insert(works).values({
        id: workId,
        code: `W-${itemCode}`,
        title: (title || '').replace(/\s*\([^)]*\)/g, '').trim(),
        author: author || 'Khuyết danh',
        translator: translator || null,
        category: category || null,
        shortCode: generateAcronym(title || ''),
        isActive: true,
      });
    }

    const editionId = `ed-${itemCode.toLowerCase()}`;
    await testDb.insert(editions).values({
      id: editionId,
      code: itemCode,
      workId,
      title,
      isbn,
      isbnLast4: isbn.slice(-4),
      editionNumber: editionNum,
      coverPrice,
      vatRate: 0.05,
      formatSize: formatSize || null,
      pages,
      publicationYear: pubYear,
      publisher: publisher || null,
      status,
      isActive: true,
    });
    editionIds.push(editionId);
    editionCount++;
  }

  // 6. Số dư mở đầu: mỗi ấn bản +50 tại Kho Âu Cơ (ledger + balance song hành
  // để bất biến ledger-sum == balance luôn đúng cho kiểm toán).
  for (const editionId of editionIds) {
    await testDb.insert(inventoryLedger).values({
      id: `led-opening-${editionId}`,
      editionId,
      warehouseId: 'wh-au-co',
      eventType: 'OPENING_BALANCE',
      quantityDelta: OPENING_QTY_PER_EDITION,
      condition: 'NEW',
      documentRef: 'OPENING-TEST-SEED',
      note: 'Số dư mở đầu DB test cách ly',
      actorId: 'setup-test-db',
      idempotencyKey: `idem-opening-${editionId}`,
      effectiveAt: new Date().toISOString(),
    });
    await testDb.insert(stockBalances).values({
      id: `sb-${editionId}-wh-au-co-NEW`,
      editionId,
      warehouseId: 'wh-au-co',
      condition: 'NEW',
      physicalQuantity: OPENING_QTY_PER_EDITION,
    });
  }

  // 7. Seed tài khoản nhân viên chuẩn hóa (staff_accounts - Đợt 0)
  for (const staff of DEFAULT_STAFF_ACCOUNTS) {
    const passcodeHash = await hashStaffPasscodeV2(staff.passcode, staff.salt);
    await testDb.insert(staffAccounts).values({
      staffId: staff.staffId,
      fullName: staff.fullName,
      role: staff.role,
      passcodeHash,
      salt: staff.salt,
      isActive: true,
    });
  }

  client.close();

  console.log(
    `✅ Test DB sẵn sàng: ${resolved} (3 kho, 5 đối tác, ${editionCount} ấn bản, ${DEFAULT_STAFF_ACCOUNTS.length} tài khoản nhân viên, mở đầu ${OPENING_QTY_PER_EDITION}/ấn bản tại Âu Cơ).`
  );

  return { dbFile: resolved, editionCount };
}

const invokedAsScript =
  process.argv[1] && path.basename(process.argv[1]) === 'setup-test-db.ts';

if (invokedAsScript) {
  setupTestDb().catch((err) => {
    console.error('❌ setup-test-db thất bại:', err);
    process.exit(1);
  });
}
