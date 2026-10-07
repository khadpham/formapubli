import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_partner_detail.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

async function run() {
  console.log('--- TEST PARTNER DETAIL: sửa CK cố định + hồ sơ đại lý ---');

  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-partner-detail');

  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const { eq } = await import('drizzle-orm');
  const schema = await import('../src/db/schema');
  const { PartnerDebtService } = await import('../src/services/partner-debt.service');

  const rawClient = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(rawClient);
  await db.insert(schema.partners).values([
    { id: 'part-pd', code: 'DL_PD', name: 'Đại lý PD', type: 'WHOLESALE', discountRate: 0.3 },
  ]);

  // 1. Sửa CK cố định có hiệu lực, đọc lại đúng.
  const upd = await PartnerDebtService.updateTerms({ id: 'part-pd', discountRate: 0.35 });
  assert.equal(upd.discountRate, 0.35);
  const [row] = await db.select().from(schema.partners).where(eq(schema.partners.id, 'part-pd'));
  assert.equal(row.discountRate, 0.35);
  console.log('✓ Sửa CK cố định 30% → 35% có hiệu lực');

  // 2. Từ chối giá trị ngoài 0–1 và đại lý lạ.
  for (const bad of [-0.1, 1.5, NaN]) {
    let threw = false;
    try { await PartnerDebtService.updateTerms({ id: 'part-pd', discountRate: bad }); } catch { threw = true; }
    assert.equal(threw, true, `phải từ chối CK=${bad}`);
  }
  let threwUnknown = false;
  try { await PartnerDebtService.updateTerms({ id: 'part-khong-ton-tai', discountRate: 0.2 }); } catch { threwUnknown = true; }
  assert.equal(threwUnknown, true);
  const [unchanged] = await db.select().from(schema.partners).where(eq(schema.partners.id, 'part-pd'));
  assert.equal(unchanged.discountRate, 0.35);
  console.log('✓ Từ chối CK ngoài 0–1 và đại lý lạ, không đổi dữ liệu');

  // 3. UI nối đủ: bấm thẻ mở hồ sơ, sửa CK gọi PATCH, hồ sơ đọc 3 nguồn.
  const listSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/partners/PartnersListView.tsx'), 'utf8'
  );
  for (const needle of ['setSelectedId', '/api/partners/', 'PartnerDetail', 'Sửa chiết khấu cố định']) {
    assert.ok(listSrc.includes(needle), `PartnersListView thiếu: ${needle}`);
  }
  const detailSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/partners/PartnerDetail.tsx'), 'utf8'
  );
  for (const needle of ['partnerStock', '/api/partner-debt', 'Tồn tại quầy đại lý', 'Công nợ bán đứt', 'Kỳ đối soát ký gửi', 'Địa chỉ gửi sách']) {
    assert.ok(detailSrc.includes(needle), `PartnerDetail thiếu: ${needle}`);
  }
  const patchSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/app/api/partners/[id]/route.ts'), 'utf8'
  );
  assert.ok(patchSrc.includes('ROLE_OWNER') && patchSrc.includes('ROLE_MANAGER'), 'PATCH phải giới hạn OWNER/MANAGER');
  const debtSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/app/api/partner-debt/route.ts'), 'utf8'
  );
  assert.ok(debtSrc.includes('partnerId'), 'API công nợ thiếu partnerId');
  console.log('✓ UI + 2 API nối đủ dây');

  console.log('🎉 TOÀN BỘ TEST PARTNER DETAIL PASS!');
}

run().catch((e) => { console.error('❌ FAIL:', e.message); process.exit(1); });
