import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';
import PizZip from 'pizzip';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_contract_service.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '</Types>';

function buildTemplate(paragraphsXml: string): string {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + paragraphsXml
    + '</w:body></w:document>'
  );
  return zip.generate({ type: 'base64', compression: 'DEFLATE' });
}

function docTextFromBytes(u8: Uint8Array): string {
  const b64 = Buffer.from(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer).toString('base64');
  const zip = new PizZip(Buffer.from(b64, 'base64').toString('binary'));
  return zip.file('word/document.xml')!.asText();
}

async function run() {
  console.log('--- TEST CONTRACT SERVICE: số HĐ, autofill, snapshot, final, preset ---');

  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-contract-service');

  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const { eq } = await import('drizzle-orm');
  const schema = await import('../src/db/schema');
  const { ContractService } = await import('../src/services/contract.service');

  const rawClient = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(rawClient);
  await db.insert(schema.partners).values([
    { id: 'part-cs', code: 'DL_CS', name: 'Đại lý CS', type: 'WHOLESALE', discountRate: 0.35, taxCode: '0100000001', address: 'Số 1 Phố CS', phone: '0900000001', email: 'cs@test.vn', creditLimit: 5000000, paymentDueDays: 30 },
  ]);
  await db.insert(schema.works).values([
    { id: 'work-cs', code: 'W-CS', title: 'Tác phẩm CS', author: 'Tác giả CS', translator: 'Dịch giả CS' },
  ]);
  await db.insert(schema.editions).values([
    { id: 'ed-cs-1', code: 'C01', workId: 'work-cs', isbn: '9780000000125', isbnLast4: '0125', coverPrice: 125000 },
  ]);
  const tplBase64 = buildTemplate(
    '<w:p><w:r><w:t>Bên B: {ben_b_ten} — Số: {so_hop_dong} — Đại diện Bên A: {ben_a_dai_dien}</w:t></w:r></w:p>'
  );
  await db.insert(schema.contractTemplates).values({
    id: 'ctpl-cs-1', code: 'HD_XB_CS', title: 'Mẫu xuất bản CS', category: 'TAC_QUYEN',
    templateFilename: 'mau.docx', templateData: tplBase64,
    schemaFields: JSON.stringify([{ key: 'ben_b_ten', label: 'Tên Bên B', type: 'text' }]),
  });

  // 1. Auto-fill: Bên B từ partner, Bên A từ company_profile (giá trị expect
  // đặt trực tiếp trong test — 'Phạm Đam Ca' từ seed migration, không import).
  const auto = await ContractService.getAutoFillData({ partnerId: 'part-cs', workId: 'work-cs', editionId: 'ed-cs-1' });
  assert.equal(auto.ben_b_ten, 'Đại lý CS');
  assert.equal(auto.ben_a_dai_dien, 'Phạm Đam Ca');
  assert.equal(auto.ma_isbn, '9780000000125');
  assert.equal(auto.gia_bia_so, '125.000 VNĐ');
  console.log('✓ Auto-fill đọc đúng partner/work/edition + Bên A');

  // 2. Cấp số tuần tự 01 → 02 trong transaction.
  // Năm kỳ vọng tính độc lập bằng Intl (KHÔNG import vn-time của code — luật
  // AGENTS.md: test không dùng chung hằng/giá trị với code).
  const expectedYear = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date()).slice(0, 4);
  const d1 = await ContractService.createDocument({
    templateId: 'ctpl-cs-1', title: 'HĐ 1', category: 'TAC_QUYEN',
    payloadData: { ben_b_ten: 'Đại lý CS' }, partnerId: 'part-cs',
    signedDate: '2026-10-08', totalAmount: 10000000, createdBy: 'staff-admin',
  });
  assert.equal(d1.contractNumber, `01/${expectedYear}/HĐXB-FORMA`);
  const d2 = await ContractService.createDocument({
    templateId: 'ctpl-cs-1', title: 'HĐ 2', category: 'TAC_QUYEN',
    payloadData: { ben_b_ten: 'Đại lý CS' }, partnerId: 'part-cs',
    signedDate: '2026-10-08', totalAmount: 20000000, createdBy: 'staff-admin',
  });
  assert.equal(d2.contractNumber, `02/${expectedYear}/HĐXB-FORMA`);
  console.log('✓ Cấp số nguyên tử tuần tự 01 → 02');

  // 3. Snapshot rendered_docx: giải nén thấy text đã thay + đúng số HĐ.
  const [row1] = await db.select().from(schema.contractDocuments).where(eq(schema.contractDocuments.id, d1.id));
  assert.ok(row1.renderedDocx, 'phải lưu snapshot rendered_docx');
  const xml1 = docTextFromBytes(Uint8Array.from(Buffer.from(row1.renderedDocx!, 'base64')));
  assert.ok(xml1.includes(`01/${expectedYear}/HĐXB-FORMA`), 'snapshot phải chứa đúng số HĐ');
  assert.ok(!xml1.includes('{so_hop_dong}'), 'snapshot không còn placeholder số HĐ');
  console.log('✓ Snapshot rendered_docx chống hồi tố');

  // 4. Upload bản cuối thắng khi export.
  const finalTpl = buildTemplate('<w:p><w:r><w:t>BẢN CUỐI ĐÃ SỬA NGOÀI WORD {ben_b_ten}</w:t></w:r></w:p>');
  await ContractService.uploadFinalDocx(d1.id, finalTpl, 'final.docx');
  const [row1b] = await db.select().from(schema.contractDocuments).where(eq(schema.contractDocuments.id, d1.id));
  assert.equal(row1b.status, 'FINALIZED');
  const exported = await ContractService.exportDocx(d1.id);
  const xmlExp = docTextFromBytes(exported);
  assert.ok(xmlExp.includes('BẢN CUỐI ĐÃ SỬA NGOÀI WORD'), 'export phải trả bản cuối');
  console.log('✓ Upload bản cuối thắng khi export (D9)');

  // 5. Đổi tên công ty → autofill sau đó trả tên mới (không khóa cố định).
  await ContractService.updateCompanyProfile({ tenCongTy: 'Công ty Test Mới' });
  const auto2 = await ContractService.getAutoFillData({});
  assert.equal(auto2.ben_a_ten, 'Công ty Test Mới');
  // Trả lại tên seed để không ảnh hưởng case khác.
  await ContractService.updateCompanyProfile({ tenCongTy: 'FORMApubli' });
  console.log('✓ Thông tin Bên A sửa được, autofill theo tên mới');

  // 6. Preset D11: seed sẵn + CRUD + sortOrder.
  const presets0 = await ContractService.listPresets();
  assert.ok(presets0.some((p: any) => p.label === 'Giám đốc — Phạm Đam Ca'), 'thiếu preset seed');
  const np = await ContractService.createPreset({
    label: 'Phó Giám đốc — Test', valuesJson: JSON.stringify({ ben_a_dai_dien: 'TÊN TEST' }), sortOrder: 5,
  });
  const presets1 = await ContractService.listPresets();
  assert.equal(presets1.length, presets0.length + 1);
  assert.ok(presets1[presets1.length - 1].sortOrder >= presets1[0].sortOrder, 'giữ thứ tự sortOrder');
  await ContractService.updatePreset(np.id, { label: 'PGĐ Test Đổi Tên' });
  await ContractService.deletePreset(np.id);
  const presets2 = await ContractService.listPresets();
  assert.equal(presets2.length, presets0.length);
  console.log('✓ Preset seed + CRUD + sortOrder (D11)');

  console.log('Test Contract Service: PASS');
}

run().catch((e) => { console.error('❌ FAIL:', e.message); process.exit(1); });
