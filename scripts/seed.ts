import fs from 'node:fs';
import path from 'node:path';
import { db, works, editions, warehouses, partners, staffAccounts } from '../src/db';
import { DEFAULT_STAFF_ACCOUNTS, hashStaffPasscodeV2 } from '../src/lib/auth-session';


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

async function main() {
  console.log('🚀 Starting Formapubli Seed Process...');

  // 1. Seed 3 Physical Warehouses
  console.log('📦 Seeding physical warehouses...');
  const warehouseData = [
    {
      id: 'wh-au-co',
      code: 'KHO_AU_CO',
      name: 'Kho 1 - Âu Cơ (Văn phòng chính & Xuất lẻ)',
      address: 'Âu Cơ, Tây Hồ, Hà Nội',
      isActive: true,
    },
    {
      id: 'wh-quynh-mai',
      code: 'KHO_QUYNH_MAI',
      name: 'Kho 2 - Quỳnh Mai (Kho Tổng & Lưu kho sỉ)',
      address: 'Quỳnh Mai, Hai Bà Trưng, Hà Nội',
      isActive: true,
    },
    {
      id: 'wh-du-phong',
      code: 'KHO_DU_PHONG',
      name: 'Kho 3 - Dự phòng (Hội chợ & Lưu động)',
      address: 'Linh hoạt theo địa điểm sự kiện',
      isActive: true,
    },
  ];

  for (const wh of warehouseData) {
    await db.insert(warehouses).values(wh).onConflictDoUpdate({
      target: warehouses.code,
      set: wh,
    });
  }
  console.log(`✅ Seeded ${warehouseData.length} warehouses.`);

  // 2. Seed Partners
  console.log('🤝 Seeding initial distribution partners...');
  const partnerData = [
    {
      id: 'part-direct',
      code: 'BAN_LE_DIRECT',
      name: 'Kênh Bán lẻ Trực tiếp (Fanpage, Web, Showroom)',
      type: 'INTERNAL',
      discountRate: 0.0,
      contactInfo: 'Văn phòng Âu Cơ',
    },
    {
      id: 'part-hoi-cho',
      code: 'HOI_CHO_EVENT',
      name: 'Gian hàng Hội chợ Sách Formapubli',
      type: 'INTERNAL',
      discountRate: 0.0,
      contactInfo: 'Lưu động theo mùa hội chợ',
    },
    {
      id: 'part-ca-chep',
      code: 'NS_CA_CHEP',
      name: 'Nhà sách Cá Chép',
      type: 'CONSIGNMENT',
      discountRate: 0.40,
      contactInfo: 'Hà Nội & TP.HCM',
    },
    {
      id: 'part-mao-dinh-le',
      code: 'NS_MAO_DINH_LE',
      name: 'Nhà sách Mão Đinh Lễ',
      type: 'CONSIGNMENT',
      discountRate: 0.40,
      contactInfo: 'Số 5 Đinh Lễ, Hoàn Kiếm, Hà Nội',
    },
    {
      id: 'part-library',
      code: 'THU_VIEN_DOI_TAC',
      name: 'Hệ thống Thư viện & Trường học',
      type: 'LIBRARY',
      discountRate: 0.20,
      contactInfo: 'Hợp tác phát triển văn hóa đọc',
    },
  ];

  for (const p of partnerData) {
    await db.insert(partners).values(p).onConflictDoUpdate({
      target: partners.code,
      set: p,
    });
  }
  console.log(`✅ Seeded ${partnerData.length} partners.`);

  // 3. Parse Catalog CSV
  const csvPath = path.join(process.cwd(), 'data_tabs', 'sheet1_danhmuc_gid_0.csv');
  const fileContent = fs.readFileSync(csvPath, 'utf-8').replace(/^\uFEFF/, '');
  const lines = fileContent.split('\n').filter((l) => l.trim().length > 0);

  const rows = lines.slice(1).map(parseCSVLine);
  console.log(`📚 Found ${rows.length} rows in catalog CSV.`);

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

    const coverPrice = parseFloat((rawPrice || '0').replace(/[^0-9]/g, '')) || 0;
    const pages = parseInt((rawPages || '').replace(/[^0-9]/g, ''), 10) || null;
    const pubYear = parseInt((rawYear || '').replace(/[^0-9]/g, ''), 10) || null;
    const isSoldOut = (statusCol || '').toLowerCase().includes('sold out');
    const status = isSoldOut ? 'SOLD_OUT' : 'IN_STOCK';
    const isbnLast4 = isbn.slice(-4);
    const shortCode = generateAcronym(title);

    let workId = `work-${itemCode.toLowerCase()}`;
    let editionNum = 1;

    if (itemCode === 'H36') {
      workId = 'work-h21'; // Shared work with H21 Le Spleen de Paris
      editionNum = 2;
    }

    if (itemCode !== 'H36') {
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

      await db.insert(works).values(workRecord).onConflictDoUpdate({
        target: works.code,
        set: workRecord,
      });
      insertedWorks++;
    }

    const editionRecord = {
      id: `ed-${itemCode.toLowerCase()}`,
      code: itemCode,
      workId,
      title,
      isbn,
      isbnLast4,
      editionNumber: editionNum,
      coverPrice,
      vatRate: 0.05,
      formatSize: formatSize || null,
      pages,
      publicationYear: pubYear,
      publisher: publisher || null,
      status,
      isActive: true,
    };

    await db.insert(editions).values(editionRecord).onConflictDoUpdate({
      target: editions.code,
      set: editionRecord,
    });
    insertedEditions++;
  }

  console.log(`✅ Successfully seeded ${insertedWorks} works and ${insertedEditions} editions.`);

  const shouldSeedStaff = process.env.SEED_DEFAULT_STAFF === 'true' || process.env.NODE_ENV === 'development';
  if (shouldSeedStaff) {
    console.log('👥 Seeding default staff accounts (DEV / EXPLICIT FLAG ONLY)...');
    for (const staff of DEFAULT_STAFF_ACCOUNTS) {
      const passcodeHash = await hashStaffPasscodeV2(staff.passcode, staff.salt);
      const staffRecord = {
        staffId: staff.staffId,
        fullName: staff.fullName,
        role: staff.role,
        passcodeHash,
        salt: staff.salt,
        isActive: true,
      };
      await db.insert(staffAccounts).values(staffRecord).onConflictDoUpdate({
        target: staffAccounts.staffId,
        set: staffRecord,
      });
    }
    console.log(`✅ Successfully seeded ${DEFAULT_STAFF_ACCOUNTS.length} default staff accounts.`);
  } else {
    console.log('🔒 Production seed: Bỏ qua default staff accounts (dùng tài khoản thực tế được cấp qua quy trình quản trị bảo mật).');
  }

  console.log('🎉 Formapubli Seed Process Complete!');

}

main().catch((err) => {
  console.error('❌ Seed error:', err);
  process.exit(1);
});