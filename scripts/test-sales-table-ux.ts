/**
 * Hạ tầng bảng Doanh Số dùng chung: sort + mở rộng + xuất CSV.
 * RED trước, GREEN sau (TDD).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sortRows } from '../src/lib/table-ux';
import { buildWatermarkedCsv } from '../src/lib/sales-view';

const readSrc = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');
let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; assert.ok(cond, msg); };

// --- Task 1: sortRows runtime ---
const rows = [{ v: 3 }, { v: 1 }, { v: 2 }];
assert.deepEqual(sortRows(rows, 'v', 'asc', (r) => r.v).map((r) => r.v), [1, 2, 3], 'sort số tăng dần');
assert.deepEqual(sortRows(rows, 'v', 'desc', (r) => r.v).map((r) => r.v), [3, 2, 1], 'sort số giảm dần');

const withNull = [{ v: 2 }, { v: null }, { v: 1 }];
assert.deepEqual(
  sortRows(withNull, 'v', 'asc', (r) => r.v).map((r) => r.v),
  [1, 2, null],
  'null về cuối'
);

const words = [{ v: 'Trường' }, { v: 'An' }, { v: 'Bình' }];
assert.deepEqual(
  sortRows(words, 'v', 'asc', (r) => r.v).map((r) => r.v),
  ['An', 'Bình', 'Trường'],
  'sort chữ có dấu'
);

const stable = [{ v: 1, id: 'a' }, { v: 1, id: 'b' }];
assert.deepEqual(
  sortRows(stable, 'v', 'asc', (r) => r.v).map((r) => r.id),
  ['a', 'b'],
  'sort ổn định'
);

console.log('\n=== SALES TABLE UX (runtime sort): PASS ===\n');

// --- Task 2: helper CSV dùng chung ---
const built = buildWatermarkedCsv({
  filename: 'Qua_Tang_test.csv',
  headers: ['Sản phẩm', 'Tổng cuốn'],
  rows: [['"Bookmark"', '5']],
  rawObjects: [{ product: 'Bookmark', qty: 5 }],
  meta: { actorId: 'staff-1', actorRole: 'ROLE_OWNER', reportName: 'QUÀ TẶNG', fiscalScope: 'ALL' },
});
assert.equal(built.filename, 'Qua_Tang_test.csv', 'giữ tên file');
assert.ok(built.content.includes('Sản phẩm,Tổng cuốn'), 'có header');
assert.ok(built.content.includes('SHA-256'), 'có watermark hash');
assert.ok(built.content.includes('staff-1'), 'watermark ký actor thật');
console.log('=== SALES TABLE UX (Task 2 CSV): PASS ===\n');

// --- Task 3: TableExpandOverlay ---
const overlay = readSrc('src/components/sales/TableExpandOverlay.tsx');
ok(/TableExpandOverlay/.test(overlay), 'overlay tồn tại');
ok(/useModalFocusTrap/.test(overlay), 'overlay bẫy focus + Esc');
ok(/PortalToBody|createPortal/.test(overlay), 'overlay portal ra body');
ok(/Mở rộng/.test(overlay), 'nút Mở rộng đúng nhãn');
console.log(`=== SALES TABLE UX (Task 3 overlay): PASS ===\n`);

// --- Task 4: sổ đơn sort + overlay ---
const ledger = readSrc('src/components/sales/SalesLedgerView.tsx');
ok(/SortableTh[^>]*sortKey="finalAmount"/.test(ledger), 'cột Thực thu sort được');
ok(/SortableTh[^>]*sortKey="discountAmount"/.test(ledger), 'cột Chiết khấu sort được');
ok(/SortableTh[^>]*sortKey="createdAt"/.test(ledger), 'cột Thời gian sort được');
ok(/<TableExpandOverlay/.test(ledger), 'bảng đơn mở rộng được');
{
  const big = Array.from({ length: 5000 }, (_, i) => ({ v: 5000 - i }));
  const t0 = Date.now();
  sortRows(big, 'v', 'asc', (r: any) => r.v);
  assert.ok(Date.now() - t0 < 1000, 'sort 5000 dòng dưới 1s');
}
// --- Task 5: sách bán chạy Top 100 + sort + overlay ---
const topEditions = readSrc('src/components/sales/TopEditionsPanel.tsx');
ok(/value=\{100\}/.test(topEditions), 'có option Top 100 (= trần API)');
ok(/SortableTh[^>]*sortKey="qty"/.test(topEditions), 'cột SL bán sort được');
ok(/SortableTh[^>]*sortKey="orders"/.test(topEditions), 'cột Số đơn sort được');
ok(/SortableTh[^>]*sortKey="revenue"/.test(topEditions), 'cột Doanh thu sort được');
ok(/<TableExpandOverlay/.test(topEditions), 'bảng bán chạy mở rộng được');
// --- Task 6: bảng quà xuất CSV + sort + overlay ---
const gift = readSrc('src/components/sales/GiftReportPanel.tsx');
ok(/downloadWatermarkedCsv/.test(gift), 'bảng quà xuất CSV watermark');
ok(/Xuất Excel\/CSV/.test(gift), 'nút xuất đúng nhãn');
ok(/<TableExpandOverlay/.test(gift), 'bảng quà mở rộng được');
ok(/SortableTh[^>]*sortKey="totalQty"/.test(gift), 'cột Tổng cuốn sort được');
console.log(`=== SALES TABLE UX (Task 6): PASS ===\n`);
