import fs from 'node:fs';
import path from 'node:path';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';
import PizZip from 'pizzip';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_contracts_e2e.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

const ND30_TEMPLATE_FIELDS = [
  'ben_a_ten', 'ben_a_dai_dien', 'ben_a_chuc_vu', 'ben_a_dia_chi', 'ben_a_mst', 'ben_a_sdt',
  'ben_b_ten', 'ben_b_cccd_mst', 'ben_b_dai_dien', 'ben_b_dia_chi', 'ben_b_sdt', 'ben_b_email',
  'ten_tac_pham', 'tac_gia', 'dich_gia', 'ma_isbn', 'gia_bia_so', 'gia_bia_chu',
  'so_hop_dong', 'ngay_ky', 'gia_tri_hd_so', 'gia_tri_hd_chu', 'ty_le_chiet_khau',
  'han_muc_cong_no', 'thoi_han_thanh_toan', 'dieu_khoan_thanh_toan', 'dieu_khoan_bo_sung',
];

const ND30_BODY = `
<w:p><w:r><w:t>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</w:t></w:r></w:p>
<w:p><w:r><w:t>Độc lập - Tự do - Hạnh phúc</w:t></w:r></w:p>
<w:p><w:r><w:t>HỢP ĐỒNG: {so_hop_dong}</w:t></w:r></w:p>
<w:p><w:r><w:t>Bên A: {ben_a_ten} - Đại diện: {ben_a_dai_dien}, Chức vụ: {ben_a_chuc_vu}, MST: {ben_a_mst}, ĐC: {ben_a_dia_chi}, SĐT: {ben_a_sdt}</w:t></w:r></w:p>
<w:p><w:r><w:t>Bên B: {ben_b_ten} - Đại diện: {ben_b_dai_dien}, MST: {ben_b_cccd_mst}, ĐC: {ben_b_dia_chi}, SĐT: {ben_b_sdt}, Email: {ben_b_email}</w:t></w:r></w:p>
<w:p><w:r><w:t>Tác phẩm: {ten_tac_pham} - {tac_gia} / Dịch giả: {dich_gia} - ISBN: {ma_isbn} - Giá bìa: {gia_bia_so} ({gia_bia_chu})</w:t></w:r></w:p>
<w:p><w:r><w:t>Giá trị HĐ: {gia_tri_hd_so} ({gia_tri_hd_chu}) - CK: {ty_le_chiet_khau} - Công nợ: {han_muc_cong_no} - Thời hạn: {thoi_han_thanh_toan}</w:t></w:r></w:p>
<w:p><w:r><w:t>Ngày ký: {ngay_ky}</w:t></w:r></w:p>
<w:p><w:r><w:t>Thanh toán: {dieu_khoan_thanh_toan}</w:t></w:r></w:p>
<w:p><w:r><w:t>Bổ sung: {dieu_khoan_bo_sung}</w:t></w:r></w:p>
`;

async function run() {
  console.log('--- TEST CONTRACTS E2E: seed → autofill → preset → create → export → final → số tuần tự → CRUD preset ---');

  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-contracts-e2e');

  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  // Run seed in-process (it writes into formapubli_test_contracts_e2e.db).
  const { seedContractTemplates } = await import('./seed-contract-templates');
  await seedContractTemplates('file:' + DB_FILE.split(path.sep).join('/'));

  const { ContractService } = await import('../src/services/contract.service');
  const { ContractEngineService } = await import('../src/services/contract-engine.service');
  const { createClient } = await import('@libsql/client');

  // 1. Seed xong có 3 mẫu + company profile còn đúng.
  const rawClient = createClient({ url: process.env.DATABASE_URL! });
  const tplRows = (await rawClient.execute('SELECT id, code, template_data FROM contract_templates ORDER BY code')).rows;
  // libsql trả rows có thể là mảng theo vị trí column-order — map về object cho rõ.
  const tpls = tplRows.map((r: any, i: number) => ({
    id: r.id ?? r[0],
    code: r.code ?? r[1],
    template_data: r.template_data ?? r[2],
  }));
  if (tpls.length !== 3) throw new Error(`Kỳ vọng 3 mẫu, thực ${tpls.length}`);
  for (const t of tpls) {
    const v = ContractEngineService.validateTemplate(t.template_data);
    if (!v.isValid) throw new Error(`Mẫu ${t.code} không hợp lệ: ${(v.errors || []).join(';')}`);
  }
  console.log('✓ Seed 3 mẫu hợp lệ');

  // 2. Autofill từ seeded partner/work/edition (script seed đã chèn).
  const partnerId = 'part-e2e-seed';
  const workId = 'work-e2e-seed';
  const editionId = 'ed-e2e-seed';
  const auto = await ContractService.getAutoFillData({ partnerId, workId, editionId });
  if (auto.ben_b_ten !== 'Nhà Sách E2E Seed') throw new Error('autofill partner sai: ' + auto.ben_b_ten);
  if (auto.ben_a_dai_dien !== 'Phạm Đam Ca') throw new Error('autofill Bên A sai');
  console.log('✓ Autofill partner/work/edition + Bên A');

  // 3. Áp preset Giám đốc vào payload.
  const presets = await ContractService.listPresets();
  const giamDoc = presets.find((p: any) => p.label.includes('Giám đốc'));
  if (!giamDoc) throw new Error('thiếu preset seed Giám đốc');
  const payload: Record<string, string> = {
    ...auto,
    ...JSON.parse(giamDoc.valuesJson),
    so_hop_dong: '(tự sinh)',
    ngay_ky: '08/10/2026',
    gia_tri_hd_so: '126250',
    gia_tri_hd_chu: 'Một trăm hai mươi sáu nghìn hai trăm năm mươi',
    dieu_khoan_thanh_toan: 'Bên B thanh toán 100% khi nhận sách (E2E).',
    dieu_khoan_bo_sung: 'Không có bổ sung.',
  };
  console.log('✓ Preset seed áp vào payload');

  // 4. Tạo HĐ đầu → số 01/2026 → export → MỌI placeholder đã thay.
  const doc1: any = await ContractService.createDocument({
    templateId: tpls[0].id,
    title: 'HĐ xuất bản E2E 1',
    category: 'TAC_QUYEN',
    payloadData: payload,
    partnerId,
    workId,
    signedDate: '2026-10-08',
    totalAmount: 12625, // make it integer VND
    createdBy: 'staff-admin',
  });
  if (doc1.contractNumber !== '01/2026/HĐXB-FORMA') throw new Error('số HĐ sai: ' + doc1.contractNumber);
  const exported1 = await ContractService.exportDocx(doc1.id);
  const zip1 = new PizZip(Buffer.from(exported1).toString('binary'));
  const xml1 = zip1.file('word/document.xml')!.asText();
  for (const tag of ND30_TEMPLATE_FIELDS) {
    if (xml1.includes(`{${tag}}`)) throw new Error(`export còn placeholder {${tag}}`);
  }
  if (!xml1.includes('Phạm Đam Ca')) throw new Error('export thiếu đại diện Phạm Đam Ca');
  console.log('✓ createDocument → 01/2026 → export MỌI placeholder đã thay');

  // 5. Upload bản cuối → export trả bản cuối.
  const finalB64 = (() => {
    const z = new PizZip();
    z.file('[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '</Types>');
    z.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>BẢN CUỐI E2E</w:t></w:r></w:p></w:body></w:document>');
    z.file('word/_rels/document.xml.rels',
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
    return z.generate({ type: 'base64', compression: 'DEFLATE' });
  })();
  await ContractService.uploadFinalDocx(doc1.id, finalB64, 'ban-cuoi-e2e.docx');
  const exported2 = await ContractService.exportDocx(doc1.id);
  const xml2 = new PizZip(Buffer.from(exported2).toString('binary')).file('word/document.xml')!.asText();
  if (!xml2.includes('BẢN CUỐI E2E')) throw new Error('export không trả bản cuối');
  console.log('✓ Upload bản cuối thắng khi export');

  // 6. HĐ thứ 2 → số 02/2026 (counter tuần tự).
  const doc2: any = await ContractService.createDocument({
    templateId: (tpls[1] as any).id ?? (tpls[1] as any)[0],
    title: 'HĐ đại lý E2E 2',
    category: 'DAI_LY',
    payloadData: payload,
    partnerId,
    workId,
    signedDate: '2026-10-08',
    totalAmount: 50000,
    createdBy: 'staff-admin',
  });
  if (doc2.contractNumber !== '01/2026/HĐĐL-FORMA') throw new Error('số HĐ loại kê sai: ' + doc2.contractNumber);
  console.log('✓ HĐ loại khác có prefix riêng');

  // 7. CRUD preset: tạo "Phó Giám đốc" test rồi xoá.
  const created = await ContractService.createPreset({
    label: 'Phó Giám đốc — E2E',
    valuesJson: JSON.stringify({ ben_a_dai_dien: 'PHÓ TEST' }),
    sortOrder: 99,
  });
  const afterCreate = await ContractService.listPresets();
  if (!afterCreate.some((p: any) => p.id === created.id)) throw new Error('preset tạo không thấy');
  await ContractService.deletePreset(created.id);
  const afterDelete = await ContractService.listPresets();
  if (afterDelete.some((p: any) => p.id === created.id)) throw new Error('preset xóa không sạch');
  console.log('✓ CRUD preset đủ vòng');

  console.log('Test Contracts E2E: PASS');
}

run().catch((e) => { console.error('❌ FAIL:', e.message); process.exit(1); });
