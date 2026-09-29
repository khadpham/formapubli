import { db, editions, inventoryLedger } from '../src/db';
import { InventoryService } from '../src/services/inventory.service';
import { eq } from 'drizzle-orm';
import { parseCountCsv, validateRows, buildVarianceReport, executeImport } from './clean-slate-import';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-clean-slate');

// Mã SKU đổi theo từng đợt cập nhật danh mục (H01..H81 → HH001/TP0004/...),
// nên CSV mẫu phải dựng từ 2 mã đầu tiên ĐANG CÓ trong CSDL thay vì hardcode.
async function buildSampleCsv(): Promise<string> {
  const codes = await db
    .select({ code: editions.code })
    .from(editions)
    .orderBy(editions.code)
    .limit(2)
    .then((r) => r.map((x) => x.code));
  const [skuA, skuB] = codes;
  if (!skuA || !skuB) throw new Error('Test DB chưa seed danh mục ấn bản.');
  return `sku,warehouse_id,condition_new,condition_quarantine,notes
${skuA},wh-au-co,42,2,Bìa xước 2 cuốn
${skuB},wh-quynh-mai,50,0,Đủ nguyên kiện`;
}

async function runCleanSlateTests() {
  console.log('📋 ========================================================');
  console.log('📋 KIỂM THỬ LỄ MỞ SỔ CLEAN SLATE (NHẬP KIỂM ĐẾM THỰC TẾ)');
  console.log('📋 ========================================================\n');

  const SAMPLE_CSV = await buildSampleCsv();
  const [skuA, skuB] = SAMPLE_CSV.split('\n').slice(1).map((l) => l.split(',')[0]);

  let passed = 0;
  let total = 0;
  const ok = (cond: boolean, name: string, detail = '') => {
    total++;
    if (cond) {
      passed++;
      console.log(`  ✅ [PASS ${total}] ${name}${detail ? `\n     ↳ ${detail}` : ''}`);
    } else {
      console.error(`  ❌ [FAIL ${total}] ${name}${detail ? ` — ${detail}` : ''}`);
      throw new Error(`Kiểm thử thất bại: ${name}`);
    }
  };

  // TEST 1: Parse CSV chuẩn.
  const rows = parseCountCsv(SAMPLE_CSV);
  ok(
    rows.length === 2 && rows[0].sku === skuA && rows[0].conditionNew === 42 &&
    rows[0].conditionQuarantine === 2 && rows[1].notes === 'Đủ nguyên kiện',
    'Parse CSV kiểm đếm chuẩn (2 dòng, notes giữ dấu phẩy)'
  );

  // TEST 2: Từ chối header sai.
  let badHeader = false;
  try {
    parseCountCsv(`sku,kho,soluong\n${skuA},wh-au-co,5`);
  } catch {
    badHeader = true;
  }
  ok(badHeader, 'Từ chối CSV sai header');

  // TEST 3: Từ chối số âm.
  let negative = false;
  try {
    parseCountCsv(`sku,warehouse_id,condition_new,condition_quarantine,notes\n${skuA},wh-au-co,-5,0,x`);
  } catch {
    negative = true;
  }
  ok(negative, 'Từ chối số lượng âm');

  // TEST 4: Validate SKU/kho/trùng.
  const { editionByCode } = await validateRows(rows);
  ok(editionByCode.has(skuA) && editionByCode.has(skuB), 'Validate SKU + kho hợp lệ');
  let dup = false;
  try {
    await validateRows([...rows, { ...rows[0] }]);
  } catch {
    dup = true;
  }
  ok(dup, 'Từ chối trùng cặp SKU+kho');
  let badSku = false;
  try {
    await validateRows([{ line: 2, sku: 'HXX', warehouseId: 'wh-au-co', conditionNew: 1, conditionQuarantine: 0, notes: '' }]);
  } catch {
    badSku = true;
  }
  ok(badSku, 'Từ chối SKU không có trong danh mục');

  // TEST 5: Dry-run đối chiếu đúng toán (không ghi gì).
  const ledgerBefore = (await db.select({ id: inventoryLedger.id }).from(inventoryLedger)).length;
  const report = await buildVarianceReport(rows, editionByCode);
  const skuANew = report.lines.find((l) => l.sku === skuA && l.condition === 'NEW')!;
  const liveSkuA = await InventoryService.getBalance(editionByCode.get(skuA)!, 'wh-au-co', 'NEW');
  ok(skuANew.systemQty === liveSkuA && skuANew.countedQty === 42 && skuANew.variance === 42 - liveSkuA, 'Dry-run: tồn máy vs đếm vs chênh khớp toán');
  const ledgerAfterDry = (await db.select({ id: inventoryLedger.id }).from(inventoryLedger)).length;
  ok(ledgerAfterDry === ledgerBefore, 'Dry-run không ghi bút toán nào');

  // TEST 6: Nạp thật gắn mã biên bản + chữ ký, tồn tăng đúng.
  const balBefore = await InventoryService.getBalance(editionByCode.get(skuA)!, 'wh-au-co', 'NEW');
  const result = await executeImport(rows, editionByCode, {
    memo: 'BB-KK-TEST01',
    signers: 'Lan Anh, Giám đốc',
    freezeAt: '2026-09-15 18:00:00',
  });
  const balAfter = await InventoryService.getBalance(editionByCode.get(skuA)!, 'wh-au-co', 'NEW');
  ok(result.entries === 3 && result.totalBooks === 94, 'Nạp 3 bút toán / 94 cuốn (42+2+50)', `${result.entries} entries`);
  ok(balAfter === balBefore + 42, `Tồn ${skuA} Âu Cơ tăng đúng 42`);

  // TEST 7: Bút toán mang dấu vết kiểm toán đầy đủ.
  const ledgerRows = await db
    .select()
    .from(inventoryLedger)
    .where(eq(inventoryLedger.documentRef, 'BB-KK-TEST01'));
  ok(
    ledgerRows.length === 3 &&
    ledgerRows.every((r) => r.eventType === 'OPENING_BALANCE') &&
    ledgerRows.every((r) => (r.note || '').includes('Lan Anh, Giám đốc') && (r.note || '').includes('2026-09-15 18:00:00')),
    'Mọi bút toán gắn mã BB + chữ ký + giờ G'
  );

  console.log('\n========================================================');
  console.log(`🎉 HOÀN TẤT: ${passed}/${total} BÀI TEST CLEAN SLATE ĐẠT 100%!`);
  console.log('========================================================\n');
}

runCleanSlateTests().catch((err) => {
  console.error('❌ test-clean-slate thất bại:', err);
  process.exit(1);
});
