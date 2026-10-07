import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { partners } from '../src/db/schema';
import { eq } from 'drizzle-orm';

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

  console.log('🎉 TOÀN BỘ TEST PARTNERS AGENCY PASS!');
}

run().catch((e) => { console.error('❌ FAIL:', e.message); process.exit(1); });
