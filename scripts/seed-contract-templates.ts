import path from 'node:path';
import { createClient, type Client } from '@libsql/client';
import PizZip from 'pizzip';

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '</Types>';

function build(paragraphs: string): string {
  const z = new PizZip();
  z.file('[Content_Types].xml', CONTENT_TYPES);
  z.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + paragraphs
    + '</w:body></w:document>'
  );
  return z.generate({ type: 'base64', compression: 'DEFLATE' });
}

const HEADER_A = '<w:p><w:r><w:t>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM / Độc lập - Tự do - Hạnh phúc</w:t></w:r></w:p>';
const FIELDS = (rows: string[]) => rows.map((r) => `<w:p><w:r><w:t>${r}</w:t></w:r></w:p>`).join('');

const T_XB = build(
  HEADER_A
  + FIELDS([
    'HỢP ĐỒNG XUẤT BẢN / SỐ: {so_hop_dong}',
    'Bên A: {ben_a_ten} — Đại diện: {ben_a_dai_dien}, {ben_a_chuc_vu}, MST: {ben_a_mst}, ĐC: {ben_a_dia_chi}, SĐT: {ben_a_sdt}',
    'Bên B: {ben_b_ten} — ĐD: {ben_b_dai_dien}, MST: {ben_b_cccd_mst}, ĐC: {ben_b_dia_chi}, SĐT: {ben_b_sdt}, {ben_b_email}',
    'Tác phẩm: {ten_tac_pham} / Tác giả: {tac_gia} / Dịch giả: {dich_gia}',
    'ISBN: {ma_isbn} — Giá bìa: {gia_bia_so} ({gia_bia_chu})',
    'Giá trị HĐ: {gia_tri_hd_so} ({gia_tri_hd_chu}) — CK {ty_le_chiet_khau} — Hạn trả {thoi_han_thanh_toan}',
    'Ngày ký: {ngay_ky}',
    'Điều khoản thanh toán: {dieu_khoan_thanh_toan}',
    'Điều khoản bổ sung: {dieu_khoan_bo_sung}',
  ])
);

const T_DL = build(
  HEADER_A
  + FIELDS([
    'HỢP ĐỒNG ĐẠI LÝ PHÁT HÀNH / SỐ: {so_hop_dong}',
    'Bên A: {ben_a_ten} — {ben_a_dai_dien}, {ben_a_chuc_vu}, MST: {ben_a_mst}, {ben_a_dia_chi}, {ben_a_sdt}',
    'Bên B: {ben_b_ten} — {ben_b_dai_dien}, {ben_b_cccd_mst}, {ben_b_dia_chi}, {ben_b_sdt}, {ben_b_email}',
    'Tác phẩm ký gửi: {ten_tac_pham} — ISBN {ma_isbn} — Giá bìa {gia_bia_so} ({gia_bia_chu})',
    'CK {ty_le_chiet_khau} — Hạn mức công nợ {han_muc_cong_no} — Thời hạn {thoi_han_thanh_toan}',
    'Ngày ký: {ngay_ky} — Thanh toán: {dieu_khoan_thanh_toan} — Bổ sung: {dieu_khoan_bo_sung}',
  ])
);

const T_DT = build(
  HEADER_A
  + FIELDS([
    'HỢP ĐỒNG DỊCH THUẬT / SỐ: {so_hop_dong}',
    'Bên A: {ben_a_ten} — {ben_a_dai_dien}, {ben_a_chuc_vu}, MST: {ben_a_mst}, {ben_a_dia_chi}, {ben_a_sdt}',
    'Bên B: {ben_b_ten} — {ben_b_dai_dien}, {ben_b_cccd_mst}, {ben_b_dia_chi}, {ben_b_sdt}, {ben_b_email}',
    'Tác phẩm: {ten_tac_pham} — Tác giả: {tac_gia} — Dịch giả: {dich_gia}',
    'ISBN: {ma_isbn} — Giá bìa: {gia_bia_so} ({gia_bia_chu})',
    'Giá trị HĐ: {gia_tri_hd_so} ({gia_tri_hd_chu}) — Ngày ký: {ngay_ky}',
    'Thanh toán: {dieu_khoan_thanh_toan} — Bổ sung: {dieu_khoan_bo_sung}',
  ])
);

function fieldsSchema(keys: string[]): string {
  return JSON.stringify(keys.map((key) => ({ key, label: key, type: 'text', required: false })));
}

const ALL_FIELD_KEYS = [
  'ben_a_ten', 'ben_a_dai_dien', 'ben_a_chuc_vu', 'ben_a_dia_chi', 'ben_a_mst', 'ben_a_sdt',
  'ben_b_ten', 'ben_b_cccd_mst', 'ben_b_dai_dien', 'ben_b_dia_chi', 'ben_b_sdt', 'ben_b_email',
  'ten_tac_pham', 'tac_gia', 'dich_gia', 'ma_isbn', 'gia_bia_so', 'gia_bia_chu',
  'so_hop_dong', 'ngay_ky', 'gia_tri_hd_so', 'gia_tri_hd_chu', 'ty_le_chiet_khau',
  'han_muc_cong_no', 'thoi_han_thanh_toan', 'dieu_khoan_thanh_toan', 'dieu_khoan_bo_sung',
];

export async function seedContractTemplates(targetUrl?: string) {
  const url = targetUrl || process.env.DATABASE_URL || 'file:formapubli.db';
  const client: Client = createClient({ url });
  const templates = [
    { code: 'HD_XUAT_BAN_SEED', title: 'Mẫu HĐ Xuất Bản (seed)', category: 'TAC_QUYEN', data: T_XB },
    { code: 'HD_DAI_LY_SEED', title: 'Mẫu HĐ Đại Lý Phát Hành (seed)', category: 'DAI_LY', data: T_DL },
    { code: 'HD_DICH_THUAT_SEED', title: 'Mẫu HĐ Dịch Thuật (seed)', category: 'DICH_THUAT', data: T_DT },
  ];
  for (const t of templates) {
    try {
      await client.execute({
        sql: `INSERT INTO contract_templates (id, code, title, category, template_filename, template_data, schema_fields, version, is_active)
              VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1) ON CONFLICT(code) DO UPDATE SET template_data=excluded.template_data, title=excluded.title`,
        args: [`ctpl-seed-${t.code}`, t.code, t.title, t.category, `${t.code}.docx`, t.data, fieldsSchema(ALL_FIELD_KEYS)],
      });
    } catch (e: any) {
      console.log(`seed ${t.code} skipped: ${(e?.message || '').slice(0, 60)}`);
    }
  }
  // Seed đối tác/tác phẩm/ấn bản tối thiểu cho E2E (không đụng dữ liệu thật).
  try {
    await client.execute({
      sql: `INSERT OR IGNORE INTO partners (id, code, name, type, discount_rate, tax_code, address, phone, email, credit_limit, payment_due_days, receiver_name) VALUES
            ('part-e2e-seed', 'DL_E2E_SEED', 'Nhà Sách E2E Seed', 'WHOLESALE', 0.35, '0100000099', 'Số 9 Phố Seed, Hà Nội', '0900000099', 'seed@test.vn', 5000000, 30, 'Bên B Seed')`,
      args: [],
    });
    await client.execute({
      sql: `INSERT OR IGNORE INTO works (id, code, title, author, translator) VALUES
            ('work-e2e-seed', 'W-E2E-SEED', 'Tác Phẩm E2E Seed', 'Tác Giả Seed', 'Dịch Giả Seed')`,
      args: [],
    });
    await client.execute({
      sql: `INSERT OR IGNORE INTO editions (id, code, work_id, isbn, isbn_last4, cover_price) VALUES
            ('ed-e2e-seed', 'E2E01', 'work-e2e-seed', '9780000000999', '0999', 125000)`,
      args: [],
    });
  } catch (e: any) {
    console.log(`seed refs skipped: ${(e?.message || '').slice(0, 60)}`);
  }
  client.close();
  console.log('seed-contract-templates: 3 mẫu + refs seeded.');
}

const invokedAsScript = process.argv[1] && path.basename(process.argv[1]).startsWith('seed-contract-templates');
if (invokedAsScript) {
  const targetArg = process.argv.find((a) => a.startsWith('--target='))?.slice('--target='.length);
  seedContractTemplates(targetArg).then(
    () => process.exit(0),
    (e) => { console.error('SEED FAIL:', e.message); process.exit(1); }
  );
}
