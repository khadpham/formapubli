/**
 * Hạ tầng bảng Doanh Số dùng chung: sort + mở rộng + xuất CSV.
 * RED trước, GREEN sau (TDD).
 */
import assert from 'node:assert/strict';
import { sortRows } from '../src/lib/table-ux';

const rows = [{ v: 3 }, { v: 1 }, { v: 2 }];
const asc = sortRows(rows, 'v', 'asc', (r) => r.v).map((r) => r.v);
assert.deepEqual(asc, [1, 2, 3], 'sort số tăng dần');

const desc = sortRows(rows, 'v', 'desc', (r) => r.v).map((r) => r.v);
assert.deepEqual(desc, [3, 2, 1], 'sort số giảm dần');

// null về cuối mọi chiều
const withNull = [{ v: 2 }, { v: null }, { v: 1 }];
assert.deepEqual(
  sortRows(withNull, 'v', 'asc', (r) => r.v).map((r) => r.v),
  [1, 2, null],
  'null về cuối'
);

// chữ tiếng Việt
const words = [{ v: 'Trường' }, { v: 'An' }, { v: 'Bình' }];
assert.deepEqual(
  sortRows(words, 'v', 'asc', (r) => r.v).map((r) => r.v),
  ['An', 'Bình', 'Trường'],
  'sort chữ có dấu'
);

// ổn định: bằng nhau giữ thứ tự gốc
const stable = [{ v: 1, id: 'a' }, { v: 1, id: 'b' }];
assert.deepEqual(
  sortRows(stable, 'v', 'asc', (r) => r.v).map((r) => r.id),
  ['a', 'b'],
  'sort ổn định'
);

console.log('\n=== SALES TABLE UX (runtime): PASS ===\n');

// --- Task 3: TableExpandOverlay ---
import fs from 'node:fs';
import path from 'node:path';
const readSrc = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');
let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; assert.ok(cond, msg); };

const overlay = readSrc('src/components/sales/TableExpandOverlay.tsx');
ok(/TableExpandOverlay/.test(overlay), 'overlay tồn tại');
ok(/useModalFocusTrap/.test(overlay), 'overlay bẫy focus + Esc');
ok(/PortalToBody|createPortal/.test(overlay), 'overlay portal ra body');
ok(/Mở rộng/.test(overlay), 'nút Mở rộng đúng nhãn');
console.log(`\n=== SALES TABLE UX (regex overlay): ${checks} assertions PASS ===\n`);
import { buildWatermarkedCsv } from '../src/lib/sales-view';
import assert2 from 'node:assert/strict';
const built = buildWatermarkedCsv({
  filename: 'Qua_Tang_test.csv',
  headers: ['Sản phẩm', 'Tổng cuốn'],
  rows: [['"Bookmark"', '5']],
  rawObjects: [{ product: 'Bookmark', qty: 5 }],
  meta: { actorId: 'staff-1', actorRole: 'ROLE_OWNER', reportName: 'QUÀ TẶNG', fiscalScope: 'ALL' },
});
assert2.equal(built.filename, 'Qua_Tang_test.csv', 'giữ tên file');
assert2.ok(built.content.includes('Sản phẩm,Tổng cuốn'), 'có header');
assert2.ok(built.content.includes('SHA-256'), 'có watermark hash');
assert2.ok(built.content.includes('staff-1'), 'watermark ký actor thật');
