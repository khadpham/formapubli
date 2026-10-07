import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';
import { parsePastedBookList } from '../src/lib/batch-paste-parser';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_consignment_quick.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

async function run() {
  console.log('--- TEST CONSIGNMENT QUICK REPORT: dán báo bán vào kỳ DRAFT ---');

  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-consignment-quick-report');

  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const { eq, and } = await import('drizzle-orm');
  const schema = await import('../src/db/schema');
  const { ConsignmentService } = await import('../src/services/consignment.service');

  const rawClient = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(rawClient);
  await db.insert(schema.partners).values([
    { id: 'part-qr', code: 'DL_QR', name: 'Đại lý QR', type: 'CONSIGNMENT', discountRate: 0.3 },
  ]);
  await db.insert(schema.works).values([{ id: 'work-qr', code: 'W-QR', title: 'TP QR', author: 'TG' }]);
  await db.insert(schema.editions).values([
    { id: 'ed-qr-1', code: 'Q01', workId: 'work-qr', isbn: '9780000000911', isbnLast4: '0911', coverPrice: 100000 },
    { id: 'ed-qr-2', code: 'Q02', workId: 'work-qr', isbn: '9780000000922', isbnLast4: '0922', coverPrice: 200000 },
  ]);
  const partnerWh = await ConsignmentService.ensurePartnerWarehouse('part-qr');
  await db.insert(schema.stockBalances).values([
    { id: 'sb-qr-1', productId: 'ed-qr-1', editionId: 'ed-qr-1', warehouseId: partnerWh, physicalQuantity: 20, condition: 'NEW' },
    { id: 'sb-qr-2', productId: 'ed-qr-2', editionId: 'ed-qr-2', warehouseId: partnerWh, physicalQuantity: 10, condition: 'NEW' },
  ]);
  const { statementId } = await ConsignmentService.createStatement({
    partnerId: 'part-qr', periodStart: '2026-10-01', periodEnd: '2026-10-31', createdBy: 'staff-01',
  });

  // 1. Vòng dán → recordSale từng dòng (mô phỏng đúng QuickSaleReport).
  const stockLookup = [
    { id: 'ed-qr-1', title: 'Sách Báo A', code: 'Q01' },
    { id: 'ed-qr-2', title: 'Truyện Báo B', code: 'Q02' },
  ];
  const { rows, summary } = parsePastedBookList('Sách Báo A\t5\nTruyện Báo B\t3\nSách Ma\t2', stockLookup, { defaultQuantity: 1 });
  assert.equal(summary.matched, 2);
  assert.equal(summary.notFound, 1);
  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    if (r.status !== 'matched') continue;
    await ConsignmentService.recordSale({
      statementId, editionId: r.editionId, quantity: r.quantity, actorId: 'staff-01',
      idempotencyKey: `${statementId}-${r.editionId}-t1`,
    });
  }
  const lines = await db.select().from(schema.consignmentStatementLines)
    .where(eq(schema.consignmentStatementLines.statementId, statementId));
  const l1 = lines.find((l) => l.editionId === 'ed-qr-1')!;
  const l2 = lines.find((l) => l.editionId === 'ed-qr-2')!;
  assert.equal(l1.reportedSoldQty, 5);
  assert.equal(l2.reportedSoldQty, 3);
  // Công thức AR đọc từ DB thật: cover từ editions, CK từ partner (0.3).
  assert.equal(l1.lineAmount, Math.round(5 * 100000 * (1 - 0.3)));
  assert.equal(l2.lineAmount, Math.round(3 * 200000 * (1 - 0.3)));
  console.log('✓ Dán 3 dòng → ghi 2, bỏ 1 tên lạ; AR = sold × bìa × (1 − CK)');

  // 2. Retry cùng key không cộng dồn.
  const dup = await ConsignmentService.recordSale({
    statementId, editionId: 'ed-qr-1', quantity: 5, actorId: 'staff-01',
    idempotencyKey: `${statementId}-ed-qr-1-t1`,
  });
  assert.equal((dup as any).isDuplicate, true);
  const [l1b] = await db.select().from(schema.consignmentStatementLines)
    .where(and(
      eq(schema.consignmentStatementLines.statementId, statementId),
      eq(schema.consignmentStatementLines.editionId, 'ed-qr-1')
    ));
  assert.equal(l1b.reportedSoldQty, 5);
  console.log('✓ Retry cùng key: không ghi trùng, không cộng dồn');

  // 3. Báo vượt tồn quầy bị chặn, không tồn âm, không ghi bán.
  let blocked = false;
  try {
    await ConsignmentService.recordSale({
      statementId, editionId: 'ed-qr-2', quantity: 999, actorId: 'staff-01',
      idempotencyKey: `${statementId}-ed-qr-2-over`,
    });
  } catch { blocked = true; }
  assert.equal(blocked, true);
  const [bal] = await db.select().from(schema.stockBalances).where(eq(schema.stockBalances.id, 'sb-qr-2'));
  assert.equal(bal.physicalQuantity, 7); // 10 − 3, không trừ thêm
  console.log('✓ Báo vượt tồn bị chặn, tồn quầy nguyên vẹn');

  // 4. UI nối đúng API (partnerStock + record-sale + kỳ DRAFT).
  const src = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/partners/QuickSaleReport.tsx'), 'utf8'
  );
  for (const needle of ['partnerStock', `action: 'record-sale'`, 'status=DRAFT', 'parsePastedBookList', 'idempotencyKey']) {
    assert.ok(src.includes(needle), `QuickSaleReport thiếu: ${needle}`);
  }
  console.log('✓ UI nối đúng: tồn quầy + kỳ DRAFT + record-sale có key');

  console.log('🎉 TOÀN BỘ TEST CONSIGNMENT QUICK REPORT PASS!');
}

run().catch((e) => { console.error('❌ FAIL:', e.message); process.exit(1); });
