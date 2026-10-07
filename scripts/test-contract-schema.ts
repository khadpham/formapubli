import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_contract_schema.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

async function run() {
  console.log('--- TEST CONTRACT SCHEMA: Migrations & CRUD Constraints ---');

  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-contract-schema');

  await migrateFresh({
    targetUrl: process.env.DATABASE_URL!,
    expectTables: ['contract_templates', 'contract_documents', 'contract_counters', 'contract_company_profile', 'contract_presets'],
  });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../src/db/schema');
  const { eq } = await import('drizzle-orm');

  const rawClient = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(rawClient);

  // 1. Thêm template
  await db.insert(schema.contractTemplates).values({
    id: 'ctpl-test-01',
    code: 'HD_XUAT_BAN_TEST',
    title: 'Hợp đồng xuất bản mẫu',
    category: 'TAC_QUYEN',
    templateFilename: 'test.docx',
    templateData: 'UEsDBBQAAAAIA...',
    schemaFields: JSON.stringify([{ key: 'ten_doi_tac', label: 'Tên đối tác', type: 'text' }]),
    version: 1,
    isActive: true,
  });

  const [tpl] = await db.select().from(schema.contractTemplates).where(eq(schema.contractTemplates.id, 'ctpl-test-01'));
  assert.equal(tpl.title, 'Hợp đồng xuất bản mẫu');
  assert.equal(tpl.category, 'TAC_QUYEN');
  console.log('✓ Insert + select contract_templates');

  // 2. Thêm contract document
  await db.insert(schema.contractDocuments).values({
    id: 'cdoc-test-01',
    contractNumber: '01/2026/HĐXB-FORMA',
    templateId: 'ctpl-test-01',
    templateVersion: 1,
    title: 'HĐXB - Đồi Gió Hú',
    status: 'DRAFT',
    payloadData: JSON.stringify({ ten_doi_tac: 'Nguyễn Văn A' }),
    createdBy: 'staff-admin',
    totalAmount: 15000000,
  });

  const [doc] = await db.select().from(schema.contractDocuments).where(eq(schema.contractDocuments.id, 'cdoc-test-01'));
  assert.equal(doc.contractNumber, '01/2026/HĐXB-FORMA');
  assert.equal(doc.totalAmount, 15000000);
  assert.equal(doc.status, 'DRAFT');
  assert.equal(doc.templateVersion, 1);
  assert.equal(doc.signedDate, null); // người dùng nhập, không tự gán
  console.log('✓ Insert + select contract_documents (INTEGER tiền, signed_date null)');

  // 3. UNIQUE chặn trùng số HĐ
  let threw = false;
  try {
    await db.insert(schema.contractDocuments).values({
      id: 'cdoc-test-02',
      contractNumber: '01/2026/HĐXB-FORMA',
      templateId: 'ctpl-test-01',
      title: 'Trùng số',
      payloadData: '{}',
      createdBy: 'staff-admin',
    });
  } catch { threw = true; }
  assert.equal(threw, true, 'UNIQUE contract_number phải chặn trùng');
  console.log('✓ UNIQUE chặn trùng số HĐ');

  // 4. Company profile seed sẵn dòng 'main' — giá trị expect đặt trong TEST, không import từ code
  const [profile] = await db.select().from(schema.contractCompanyProfile).where(eq(schema.contractCompanyProfile.id, 'main'));
  assert.ok(profile, 'company_profile phải có dòng main');
  assert.equal(profile.daiDien, 'Phạm Đam Ca');
  assert.equal(profile.chucVu, 'Giám đốc');
  console.log('✓ contract_company_profile seed sẵn (Phạm Đam Ca / Giám đốc)');

  // 5. Preset seed sẵn + CRUD
  const [preset] = await db.select().from(schema.contractPresets).where(eq(schema.contractPresets.id, 'preset-giam-doc'));
  assert.ok(preset, 'preset ví dụ phải có sẵn');
  assert.equal(preset.label, 'Giám đốc — Phạm Đam Ca');
  const presetValues = JSON.parse(preset.valuesJson);
  assert.equal(presetValues.ben_a_dai_dien, 'Phạm Đam Ca');
  assert.equal(presetValues.ben_a_chuc_vu, 'Giám đốc');
  assert.equal(preset.sortOrder, 0);

  await db.insert(schema.contractPresets).values({
    id: 'preset-test-02',
    label: 'Phó Giám đốc — <tên test>',
    valuesJson: JSON.stringify({ ben_a_dai_dien: 'TÊN TEST', ben_a_chuc_vu: 'Phó Giám đốc' }),
    sortOrder: 1,
  });
  const [preset2] = await db.select().from(schema.contractPresets).where(eq(schema.contractPresets.id, 'preset-test-02'));
  assert.equal(preset2.sortOrder, 1);
  await db.update(schema.contractPresets).set({ label: 'Đổi tên preset' }).where(eq(schema.contractPresets.id, 'preset-test-02'));
  const [preset2b] = await db.select().from(schema.contractPresets).where(eq(schema.contractPresets.id, 'preset-test-02'));
  assert.equal(preset2b.label, 'Đổi tên preset');
  await db.delete(schema.contractPresets).where(eq(schema.contractPresets.id, 'preset-test-02'));
  const after = await db.select().from(schema.contractPresets);
  assert.equal(after.length, 1);
  console.log('✓ contract_presets seed + CRUD + sortOrder');

  console.log('Test Contract Schema: PASS');
}

run().catch((e) => { console.error('❌ FAIL:', e.message); process.exit(1); });
