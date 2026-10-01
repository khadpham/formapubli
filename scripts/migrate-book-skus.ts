/**
 * scripts/migrate-book-skus.ts
 *
 * Di chuyển và chuẩn hóa mã SKU ấn bản sách (editions.code):
 * - Cập nhật 81 ấn bản cũ từ mã H01-H81 sang mã mới (HH001-HH047, TP0004-TP105, HH0079)
 * - Nạp 7 ấn bản mới năm 2026 (H82-H88) vào bảng works và editions
 * - Giữ nguyên hoàn toàn khóa chính `editions.id` ('ed-h01'...) để bảo vệ tính toàn vẹn của
 *   lịch sử đơn hàng, tồn kho và sổ cái di chuyển kho.
 *
 * Cách chạy:
 *   npx tsx scripts/migrate-book-skus.ts            # Chạy thật trên DB hiện tại (local hoặc Turso nếu có DATABASE_URL)
 *   npx tsx scripts/migrate-book-skus.ts --dry-run  # Xem trước thay đổi, không ghi DB
 */

import fs from 'node:fs';
import path from 'node:path';
import { db, works, editions, stockBalances, warehouses } from '../src/db';
import { eq } from 'drizzle-orm';

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

function removeAccents(str: string): string {
  return str
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd');
}

function generateAcronym(title: string): string {
  const clean = removeAccents(title.toLowerCase())
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim();
  const words = clean.split(/\s+/);
  return words.map((w) => w[0]).join('');
}

// Bảng ánh xạ mã cũ (Hxx) sang mã mới từ Google Sheets & danh mục đối chiếu
const SKU_MAPPING: Record<string, string> = {
  H01: 'HH001',
  H02: 'HH002',
  H03: 'HH003',
  H04: 'HH004',
  H05: 'HH005',
  H06: 'HH006',
  H07: 'HH007',
  H08: 'HH008',
  H09: 'HH009',
  H10: 'HH010',
  H11: 'HH011',
  H12: 'HH012',
  H13: 'HH013',
  H14: 'HH014',
  H15: 'HH015',
  H16: 'HH016',
  H17: 'HH028',
  H18: 'HH029',
  H19: 'HH030',
  H20: 'HH031',
  H21: 'HH032',
  H22: 'HH018',
  H23: 'HH019',
  H24: 'HH020',
  H25: 'HH021',
  H26: 'HH025',
  H27: 'HH026',
  H28: 'HH022',
  H29: 'HH037',
  H30: 'HH027',
  H31: 'HH033',
  H32: 'HH041',
  H33: 'HH017',
  H34: 'HH039',
  H35: 'HH038',
  H36: 'HH042',
  H37: 'HH046',
  H38: 'HH045',
  H39: 'HH047',
  H40: 'HH035',
  H41: 'HH034',
  H42: 'HH040',
  H43: 'HH044',
  H44: 'HH036',
  H45: 'HH043',
  H46: 'TP0006',
  H47: 'TP0004',
  H48: 'TP0005',
  H49: 'TP0007',
  H50: 'TP0012',
  H51: 'TP0011',
  H52: 'TP0010',
  H53: 'TP0019',
  H54: 'TP0014',
  H55: 'TP0013',
  H56: 'TP0020',
  H57: 'TP0015',
  H58: 'TP0016',
  H59: 'TP0021',
  H60: 'TP0023',
  H61: 'TP0018',
  H62: 'TP0025',
  H63: 'TP0024',
  H64: 'TP0027',
  H65: 'TP0048',
  H66: 'TP0030',
  H67: 'TP0076',
  H68: 'TP0075',
  H69: 'TP0074',
  H70: 'TP0073',
  H71: 'TP0081',
  H72: 'TP0079',
  H73: 'TP0099',
  H74: 'TP0082',
  H75: 'TP0101',
  H76: 'TP0102',
  H77: 'TP0100',
  H78: 'TP103',
  H79: 'TP104',
  H80: 'HH0079',
  H81: 'TP105',
};

// Set các mã mới của 81 cuốn đã map để nhận biết các cuốn mới chưa có trong SKU_MAPPING
const KNOWN_NEW_CODES = new Set(Object.values(SKU_MAPPING));

async function run() {
  const isDryRun = process.argv.includes('--dry-run');
  console.log(`📦 Bắt đầu tiến trình Migration mã sách SKU... [Chế độ: ${isDryRun ? 'DRY-RUN (chỉ kiểm tra)' : 'THỰC THI THẬT'}]`);

  // CHỐT AN TOÀN: từ chối ghi vào DB TỪ XA trừ khi có cờ tường minh.
  // Script này đổi mã của 81 ấn bản và nạp 7 cuốn mới — chạy nhầm là mất dữ liệu
  // danh mục production. Đây là cùng quy tắc đã áp cho `migrate-fresh.ts` và
  // `seed.ts` (mục P6 của kế hoạch); bản gốc của script thiếu nên thêm vào đây.
  const url = process.env.DATABASE_URL || '';
  const isLocal = url.includes('.db') || url.startsWith('file:');
  const allowRemote = process.env.ALLOW_REMOTE_SKU_MIGRATION === 'true';
  if (!isLocal && !isDryRun && !allowRemote) {
    throw new Error(
      'TỪ CHỐI: DATABASE_URL trỏ tới DB từ xa. Để ghi production phải đặt ' +
        'ALLOW_REMOTE_SKU_MIGRATION=true, hoặc chạy --dry-run để xem trước.'
    );
  }
  if (!isLocal) {
    console.log(
      allowRemote && !isDryRun
        ? '⚠️  ĐANG GHI VÀO DB TỪ XA — thao tác này không hoàn tác được.'
        : '🔍 Chế độ dry-run trên DB từ xa: không ghi gì.'
    );
  }

  // 1. Kiểm tra trạng thái hiện tại của database
  const currentEditions = await db.select().from(editions);
  console.log(`📊 Tổng số ấn bản hiện có trong DB: ${currentEditions.length}`);

  const editionsByCode = new Map(currentEditions.map((e) => [e.code, e]));
  const editionsById = new Map(currentEditions.map((e) => [e.id, e]));

  // 2. Thực hiện cập nhật mã SKU cho các ấn bản đã có (H01 -> H81)
  let updatedCount = 0;
  for (const [oldCode, newCode] of Object.entries(SKU_MAPPING)) {
    const existing = editionsByCode.get(oldCode) || editionsById.get(`ed-${oldCode.toLowerCase()}`);
    if (!existing) {
      console.warn(`⚠️ Không tìm thấy ấn bản tương ứng với mã cũ ${oldCode} (id: ed-${oldCode.toLowerCase()})`);
      continue;
    }

    if (existing.code !== newCode) {
      if (!isDryRun) {
        await db
          .update(editions)
          .set({ code: newCode })
          .where(eq(editions.id, existing.id));
      }
      updatedCount++;
    }
  }
  console.log(`✅ ${isDryRun ? '[DRY-RUN] Sẽ cập nhật' : 'Đã cập nhật'} mã SKU cho ${updatedCount} ấn bản.`);

  // 3. Đọc dữ liệu từ file CSV để nạp các sách mới (7 cuốn mới 2026: H82 - H88)
  const csvPath = path.join(process.cwd(), 'data_tabs', 'sheet1_danhmuc_gid_0.csv');
  const fileContent = fs.readFileSync(csvPath, 'utf-8').replace(/^\uFEFF/, '');
  const lines = fileContent.split('\n').filter((l) => l.trim().length > 0);
  const rows = lines.slice(1).map(parseCSVLine);

  // Lấy danh sách kho đang hoạt động để tạo bản ghi tồn kho ban đầu (0 cuốn)
  const activeWarehouses = await db.select().from(warehouses).where(eq(warehouses.isActive, true));

  let insertedWorks = 0;
  let insertedEditions = 0;

  for (const r of rows) {
    const [
      label,
      itemCode,
      isbn,
      title,
      rawPrice,
      formatSize,
      rawPages,
      author,
      translator,
      vatCol,
      statusCol,
      category,
      rawYear,
      publisher,
    ] = r;

    if (!itemCode || !isbn) continue;

    // Bỏ qua nếu đây là 1 trong 81 cuốn đã cập nhật mã
    if (KNOWN_NEW_CODES.has(itemCode)) continue;

    // Bỏ qua nếu đã tồn tại trong DB
    const editionId = `ed-${itemCode.toLowerCase()}`;
    const existing = editionsById.get(editionId) || editionsByCode.get(itemCode);
    if (existing) continue;

    const coverPrice = parseFloat((rawPrice || '0').replace(/[^0-9]/g, '')) || 0;
    const pages = parseInt((rawPages || '').replace(/[^0-9]/g, ''), 10) || null;
    const pubYear = parseInt((rawYear || '').replace(/[^0-9]/g, ''), 10) || null;
    const status = (statusCol || '').toLowerCase().includes('sold out') ? 'SOLD_OUT' : 'IN_STOCK';
    const isbnDigits = isbn.replace(/[^0-9]/g, '');
    const isbnLast4 = isbnDigits.slice(-4) || '0000';
    const shortCode = generateAcronym(title);
    const workId = `work-${itemCode.toLowerCase()}`;

    if (!isDryRun) {
      // 3.1 Insert tác phẩm vào `works`
      const workRecord = {
        id: workId,
        code: `W-${itemCode}`,
        title: title.replace(/\s*\([^)]*\)/g, '').trim(),
        author: author || 'Khuyết danh',
        translator: translator || null,
        category: category || null,
        shortCode,
        isActive: true,
      };

      await db.insert(works).values(workRecord).onConflictDoNothing();
      insertedWorks++;

      // 3.2 Insert ấn bản vào `editions`
      const editionRecord = {
        id: editionId,
        code: itemCode,
        workId,
        title,
        isbn: isbnDigits,
        isbnLast4,
        editionNumber: 1,
        coverPrice,
        vatRate: 0.05,
        formatSize: formatSize || null,
        pages,
        publicationYear: pubYear,
        publisher: publisher || null,
        status,
        isActive: true,
      };

      await db.insert(editions).values(editionRecord).onConflictDoNothing();
      insertedEditions++;

      // 3.3 Khởi tạo stock_balances = 0 cho các kho đang active
      for (const wh of activeWarehouses) {
        await db.insert(stockBalances).values({
          id: `sb-${editionId}-${wh.id}-NEW`,
          productId: editionId,
          editionId,
          warehouseId: wh.id,
          condition: 'NEW',
          physicalQuantity: 0,
        }).onConflictDoNothing();
      }
    } else {
      insertedWorks++;
      insertedEditions++;
    }

    console.log(`  ➕ Sách mới [${itemCode}] ${title} (${author})`);
  }

  console.log(`✅ ${isDryRun ? '[DRY-RUN] Sẽ nạp thêm' : 'Đã nạp thêm'} ${insertedWorks} tác phẩm mới và ${insertedEditions} ấn bản mới.`);

  // 4. Kiểm tra lại sau migration
  if (!isDryRun) {
    const afterEditions = await db.select().from(editions);
    console.log(`\n🎉 KẾT QUẢ SAU MIGRATION:`);
    console.log(`- Tổng số ấn bản trong DB: ${afterEditions.length}`);
    const sampleH01 = afterEditions.find((e) => e.id === 'ed-h01');
    console.log(`- Kiểm tra ed-h01: mã mới = '${sampleH01?.code}' (Tựa: ${sampleH01?.title})`);
    const sampleH46 = afterEditions.find((e) => e.id === 'ed-h46');
    console.log(`- Kiểm tra ed-h46: mã mới = '${sampleH46?.code}' (Tựa: ${sampleH46?.title})`);
    const sampleH80 = afterEditions.find((e) => e.id === 'ed-h80');
    console.log(`- Kiểm tra ed-h80: mã mới = '${sampleH80?.code}' (Tựa: ${sampleH80?.title})`);
    const sampleH82 = afterEditions.find((e) => e.id === 'ed-h82');
    console.log(`- Kiểm tra ed-h82 (mới): mã = '${sampleH82?.code}' (Tựa: ${sampleH82?.title})`);
  }
}

run().catch((err) => {
  console.error('❌ Lỗi khi thực hiện migration:', err);
  process.exit(1);
});
