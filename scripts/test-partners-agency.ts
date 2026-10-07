import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { partners } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { importPartners, parseCsv, parseCompanyInfo } from './import-partners';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_partners_agency.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

async function run() {
  console.log('--- TEST PARTNERS AGENCY: cột giao nhận đại lý (migration 0044) ---');

  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-partners-agency');

  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const client = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(client, { schema: { partners } });

  // P1a: round-trip 6 cột mới (giá trị đọc lại phải khớp đã ghi).
  await db.insert(partners).values({
    id: 'part-ag-1',
    code: 'DL-BINH-BOOK',
    name: 'Bình bán Book',
    type: 'CONSIGNMENT',
    discountRate: 0.3,
    address: 'Số 5 Trần Quốc Hoàn, Hà Nội',
    phone: '0972605129',
    email: 'binhbook.official@gmail.com',
    taxCode: '0109641386',
    receiverName: 'Kho Bình Book',
    shipNote: 'Gọi trước khi giao',
  });
  const [row] = await db.select().from(partners).where(eq(partners.id, 'part-ag-1'));
  assert.equal(row.address, 'Số 5 Trần Quốc Hoàn, Hà Nội');
  assert.equal(row.phone, '0972605129');
  assert.equal(row.email, 'binhbook.official@gmail.com');
  assert.equal(row.taxCode, '0109641386');
  assert.equal(row.receiverName, 'Kho Bình Book');
  assert.equal(row.shipNote, 'Gọi trước khi giao');
  console.log('✓ Round-trip 6 cột giao nhận OK');

  // Cột cũ vẫn nguyên (không vỡ tương thích).
  assert.equal(row.type, 'CONSIGNMENT');
  assert.equal(row.discountRate, 0.3);
  console.log('✓ Cột cũ (type/discountRate) nguyên vẹn');

  // Đối tác cũ không có thông tin mới → null, không crash.
  await db.insert(partners).values({
    id: 'part-ag-2', code: 'DL-CU', name: 'Đại lý cũ', type: 'WHOLESALE', discountRate: 0.4,
  });
  const [old] = await db.select().from(partners).where(eq(partners.id, 'part-ag-2'));
  assert.equal(old.address, null);
  assert.equal(old.taxCode, null);
  console.log('✓ Đối tác cũ thiếu cột mới → null, không crash');

  // P1b: import fixture (dữ liệu GIẢ) — kỳ vọng đọc từ fixture, không từ code.
  const sample = fs.readFileSync(path.resolve(process.cwd(), 'scripts/fixtures/partners-sample.csv'), 'utf8');
  const parsed = parseCsv(sample);
  assert.ok(parsed.length >= 4, 'fixture phải có header + dòng tổng + 2 đại lý');
  const r1 = await importPartners(sample, db);
  assert.equal(r1.created, 6);
  assert.equal(r1.skipped, 1); // dòng tổng C/D trống
  console.log('✓ Import fixture: tạo 6, bỏ dòng tổng 1');
  const [kg] = await db.select().from(partners).where(eq(partners.code, 'DL-HIEU-SACH-GIA-LAP'));
  assert.equal(kg.type, 'CONSIGNMENT');
  assert.equal(kg.discountRate, 0.3);
  assert.equal(kg.taxCode, '0100000001');
  assert.equal(kg.phone, '0900000001');
  assert.equal(kg.email, 'gialap.official@gmail.com');
  const [bd] = await db.select().from(partners).where(eq(partners.code, 'DL-NHA-SACH-MINH-HOA'));
  assert.equal(bd.type, 'WHOLESALE');
  assert.equal(bd.discountRate, 0.4);
  console.log('✓ Tách E (MST/SĐT/mail) + G (% ck) đúng');
  const [vd] = await db.select().from(partners).where(eq(partners.code, 'DL-TIEM-SACH-VI-DU'));
  assert.equal(vd.type, 'WHOLESALE'); // "Mua đứt" = bán đứt phía ta
  assert.equal(vd.discountRate, 0.35);
  console.log('✓ "Mua đứt" map WHOLESALE đúng');
  // Ô nhãn Anh (Company's name / Tax code / Address / Sđt).
  const [en] = await db.select().from(partners).where(eq(partners.code, 'DL-HIEU-SACH-SONG-NGU'));
  assert.equal(en.type, 'CONSIGNMENT');
  assert.equal(en.discountRate, 0.45);
  assert.equal(en.taxCode, '0100000004');
  assert.equal(en.phone, '0900000004');
  assert.ok((en.address || '').includes('Số 4 Phố Dịch'), `địa chỉ EN sai: ${en.address}`);
  console.log('✓ Ô nhãn Anh tách đúng MST/SĐT/địa chỉ');
  // Ô không nhãn: địa chỉ lẫn Sđt trong câu + ghi chú ngoặc.
  const [nolbl] = await db.select().from(partners).where(eq(partners.code, 'DL-QUAN-SACH-KHONG-NHAN'));
  assert.equal(nolbl.phone, '0900000005');
  assert.ok((nolbl.address || '').includes('Chùa Mẫu'), `địa chỉ không nhãn sai: ${nolbl.address}`);
  assert.ok(!(nolbl.address || '').includes('có thể thay đổi'), 'ghi chú ngoặc phải bị lược');
  console.log('✓ Ô không nhãn tách SĐT + địa chỉ, lược ghi chú');
  // Ô số đứng đầu: tách SĐT đầu dòng, còn lại là địa chỉ.
  const [lead] = await db.select().from(partners).where(eq(partners.code, 'DL-TIEM-SACH-DAU-SO'));
  assert.equal(lead.type, 'WHOLESALE');
  assert.equal(lead.phone, '0900000006');
  assert.ok((lead.address || '').includes('Số 6 Đường Kẻ'), `địa chỉ đầu số sai: ${lead.address}`);
  console.log('✓ Ô số đứng đầu tách SĐT + địa chỉ');
  // Dấu ngoặc sót từ ô CSV không lọt vào địa chỉ.
  const quoted = parseCompanyInfo('"Tên đơn vị (Company\'s name): CÔNG TY MẪU Mã số thuế (Tax code): 0100000004 Địa chỉ (Address): Số 1 Phố Mẫu, Hà Nội, Việt Nam"');
  assert.equal(quoted.taxCode, '0100000004');
  assert.ok(!(quoted.address || '').includes('"'), `địa chỉ lẫn ngoặc: ${quoted.address}`);
  assert.ok((quoted.address || '').includes('Số 1 Phố Mẫu'), `địa chỉ sai: ${quoted.address}`);
  console.log('✓ Dấu ngoặc sót không lọt vào địa chỉ');
  const r2 = await importPartners(sample, db);
  assert.equal(r2.created, 0);
  assert.equal(r2.updated, 6);
  console.log('✓ Chạy lại idempotent: 0 tạo mới, 6 cập nhật');

  console.log('🎉 TOÀN BỘ TEST PARTNERS AGENCY PASS!');
}

run().catch((e) => { console.error('❌ FAIL:', e.message); process.exit(1); });
