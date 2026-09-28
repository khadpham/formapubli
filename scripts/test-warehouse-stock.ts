/**
 * Warehouse-scoped stock contract (src/lib/warehouse-stock.ts).
 *
 * The bug: BatchTransferModal only knew THREE hardcoded warehouse ids and
 * fell through to `totalStock` for everything else. `totalStock` is the sum
 * over EVERY warehouse, so for any fair-event warehouse the "Tồn Nguồn"
 * column, the default quantity and the bulk-add button all showed numbers
 * that belong to the whole system, not to the warehouse being shipped from.
 *
 * THE HARD RULE: a warehouse's stock is that warehouse's stock, or 0. Never
 * the system total, never a guess.
 *
 * Pure assert-based script, same style as scripts/test-batch-paste-parser.ts:
 * no DOM, no database, no new dependency. The second half is source-text
 * assertions on the modal, same style as scripts/test-batch-paste-ui.ts.
 *
 * Run: npx tsx scripts/test-warehouse-stock.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stockOfWarehouse } from '../src/lib/warehouse-stock';

const checks: string[] = [];
const expect = (cond: unknown, msg: string) => {
  assert.ok(cond, msg);
  checks.push(`  ok  ${msg}`);
};

type Book = NonNullable<Parameters<typeof stockOfWarehouse>[0]>;
type Bookish = Book & { totalStock?: number };

// ---------------------------------------------------------------------------
// Fixture — one book that lives in five warehouses at once.
// `totalStock` (88) is deliberately the sum of all five, so ANY function that
// leaks it is immediately wrong for the fair warehouse.
// ---------------------------------------------------------------------------
const FAIR = 'wh-hoi-choi-2026-03';
const FIXED: Record<string, number> = {
  'wh-au-co': 10,
  'wh-quynh-mai': 20,
  'wh-du-phong': 5,
  [FAIR]: 3,
  'wh-kho-chinh': 50,
};
const BOOK = {
  stockByWarehouse: FIXED,
  stockAuCo: 10,
  stockQuynhMai: 20,
  stockDuPhong: 5,
  totalStock: 88,
};

// ---------------------------------------------------------------------------
// 1. THE REGRESSION: a fair-event warehouse returns ITS OWN stock.
// ---------------------------------------------------------------------------
expect(
  stockOfWarehouse(BOOK, FAIR) === 3,
  `kho hội chợ trả tồn RIÊNG của nó = 3, KHÔNG phải tổng 88 (thực tế: ${stockOfWarehouse(BOOK, FAIR)})`
);
expect(
  stockOfWarehouse(BOOK, FAIR) !== BOOK.totalStock,
  'kho hội chợ KHÔNG BAO GIỜ nhận giá trị totalStock'
);
expect(
  stockOfWarehouse(BOOK, 'wh-kho-chinh') === 50,
  'mọi kho động khác cũng lấy đúng tồn riêng, không cần code cứng'
);

// ---------------------------------------------------------------------------
// 2. Legacy warehouses still read their legacy field (fallback path).
// ---------------------------------------------------------------------------
expect(stockOfWarehouse(BOOK, 'wh-au-co') === 10, 'kho Âu Cố đọc stockAuCo');
expect(stockOfWarehouse(BOOK, 'wh-quynh-mai') === 20, 'kho Quỳnh Mai đọc stockQuynhMai');
expect(stockOfWarehouse(BOOK, 'wh-du-phong') === 5, 'kho Dự Phòng đọc stockDuPhong');
expect(
  stockOfWarehouse({ stockDuPhong: 7 }, 'wh-du-phong') === 7,
  'sách KHÔNG có stockByWarehouse vẫn đọc được 3 trường kho cũ'
);
expect(
  stockOfWarehouse({ stockByWarehouse: { 'wh-au-co': 1 }, stockAuCo: 99 }, 'wh-au-co') === 1,
  'stockByWarehouse thắng trường kho cũ khi cả hai đều có'
);

// ---------------------------------------------------------------------------
// 3. Unknown / absent warehouse -> 0, never the total.
// ---------------------------------------------------------------------------
expect(
  stockOfWarehouse(BOOK, 'wh-khong-ton-tai') === 0,
  'kho lạ (không có trong map) -> 0'
);
expect(
  stockOfWarehouse(BOOK, '') === 0,
  'warehouseId rỗng -> 0, không nổ vụng'
);
expect(
  stockOfWarehouse(BOOK, 'wh-au-co-ty') === 0,
  'kho lạ KHÔNG được đoán theo tiền tố giống kho cũ'
);

// ---------------------------------------------------------------------------
// 4. No stockByWarehouse at all -> 0 for any non-legacy warehouse.
// ---------------------------------------------------------------------------
const NO_MAP: Bookish = { stockAuCo: 10, stockQuynhMai: 20, stockDuPhong: 5, totalStock: 88 };
expect(
  stockOfWarehouse(NO_MAP, FAIR) === 0,
  'sách không có stockByWarehouse + kho hội chợ -> 0, TUYỆT ĐỐI không phải totalStock 88'
);
expect(stockOfWarehouse({}, FAIR) === 0, 'sách rỗng + kho hội chợ -> 0');
expect(stockOfWarehouse({ stockByWarehouse: {} }, FAIR) === 0, 'map rỗng -> 0');

// ---------------------------------------------------------------------------
// 5. Defensive shapes: nullish book, nullish/garbage values.
// ---------------------------------------------------------------------------
expect(stockOfWarehouse(undefined, FAIR) === 0, 'book undefined -> 0');
expect(stockOfWarehouse(null, FAIR) === 0, 'book null -> 0');
const UNDEF_VALUE: Book = { stockByWarehouse: { [FAIR]: undefined as unknown as number } };
expect(stockOfWarehouse(UNDEF_VALUE, FAIR) === 0, 'giá trị undefined trong map -> 0');
const NULL_VALUE: Book = { stockByWarehouse: { [FAIR]: null as unknown as number } };
expect(stockOfWarehouse(NULL_VALUE, FAIR) === 0, 'giá trị null trong map -> 0');
expect(
  stockOfWarehouse({ stockByWarehouse: { [FAIR]: NaN } }, FAIR) === 0,
  'giá trị NaN trong map -> 0'
);
expect(
  stockOfWarehouse({ stockByWarehouse: { [FAIR]: 0 } }, FAIR) === 0,
  'tồn bằng 0 trong map -> 0 (hết hàng ở kho này, không phải "chưa biết")'
);
expect(
  Object.prototype.hasOwnProperty.call(BOOK.stockByWarehouse, FAIR),
  'bản thân map có kho hội chợ — fixture đúng, số 0 ở trên là do giá trị, không do thiếu key'
);

// ---------------------------------------------------------------------------
// 6. SOURCE-TEXT: the modal no longer hardcodes warehouses in the stock lookup.
// ---------------------------------------------------------------------------
const modalPath = path.resolve(
  process.cwd(),
  'src/components/inventory/BatchTransferModal.tsx'
);
const src = fs.readFileSync(modalPath, 'utf8');

/** Body of a top-level `const <anchor> ... => { ... }` up to the next statement. */
const bodyOf = (anchor: string): string => {
  const at = src.indexOf(anchor);
  if (at === -1) return '';
  const rest = src.slice(at + anchor.length);
  const next = rest.search(/\n {2}(?:const|let|useEffect|if \(|return)\b/);
  return next === -1 ? rest : rest.slice(0, next);
};

const getFromStockBlock = bodyOf('const getFromStock');
expect(getFromStockBlock.length > 0, 'Tồn hàm getFromStock trong BatchTransferModal');
expect(
  /stockOfWarehouse\(\s*book\s*,\s*fromWarehouseId\s*\)/.test(getFromStockBlock),
  'getFromStock uỷ quyền cho stockOfWarehouse(book, fromWarehouseId)'
);
for (const legacyId of ['wh-au-co', 'wh-quynh-mai', 'wh-du-phong']) {
  expect(
    !getFromStockBlock.includes(legacyId),
    `getFromStock KHÔNG còn mã kho cứng "${legacyId}" bên trong`
  );
}
for (const leak of ['totalStock', 'stockAuCo', 'stockQuynhMai', 'stockDuPhong']) {
  expect(
    !getFromStockBlock.includes(leak),
    `getFromStock KHÔNG đọc "${leak}" nữa (đó chính là chỗ rò tổng mọi kho)`
  );
}
expect(
  /import \{ stockOfWarehouse \} from '@\/lib\/warehouse-stock'/.test(src),
  'Modal import stockOfWarehouse từ @/lib/warehouse-stock'
);
expect(
  /stockByWarehouse\?: Record<string, number>/.test(src),
  'BookItem trong modal có field stockByWarehouse'
);

// ---------------------------------------------------------------------------
// 7. SOURCE-TEXT: nút "Lấy tồn thật kho nguồn" — SL = tồn thật, KHÔNG cap 30.
// ---------------------------------------------------------------------------
const takeAllBlock = bodyOf('const handleAddAllSourceStock');
expect(takeAllBlock.length > 0, 'Tồn handler lấy tồn thật kho nguồn');
expect(
  /quantity: stock,/.test(takeAllBlock),
  'Mỗi dòng mới dùng quantity = tồn thật của kho nguồn (không cap)'
);
expect(
  !/Math\.min\(/.test(takeAllBlock),
  'Handler lấy tồn thật KHÔNG có trần Math.min(...) nào'
);
expect(
  /stock > 0/.test(takeAllBlock),
  'Chỉ lấy sách còn tồn > 0 ở kho nguồn'
);
expect(
  /existingIds\.has\(b\.id\)/.test(takeAllBlock),
  'BỎ QUA dòng đã có trong bảng — không đụng dòng người dùng tự nhập/sửa'
);
// Handler gọi invalidateCart() (wrapper gộp) thay vì gọi thẳng
// invalidateValidation() + setErrorMessage(null). Kiểm cả hai tầng để wrapper
// không thể nuốt mất hành vi mà assertion này bảo vệ.
const cartWrapperBlock = bodyOf('const invalidateCart');
expect(
  /invalidateCart\(\)/.test(takeAllBlock) &&
    /invalidateValidation\(\)/.test(cartWrapperBlock) &&
    /setErrorMessage\(null\)/.test(cartWrapperBlock),
  'Lấy tồn thật vô hiệu hoá kết quả kiểm tra tồn cũ + xoá lỗi cũ'
);
expect(/Đã thêm: /.test(src), 'Báo kết quả dạng "Đã thêm: N đầu sách, M cuốn"');
expect(
  /Lấy tồn thật kho nguồn/.test(src) && /onClick=\{handleAddAllSourceStock\}/.test(src),
  'Nút "Lấy tồn thật kho nguồn" tồn tại và gọi handler'
);

// ---------------------------------------------------------------------------
// 8. SOURCE-TEXT: nút cũ (cap 30) CÒN NGUYÊN, chỉ đổi nhãn cho dễ phân biệt.
// ---------------------------------------------------------------------------
const bulkBlock = bodyOf('const handleBulkAddInStock');
expect(bulkBlock.length > 0, 'Tồn handler thêm nhanh cũ');
expect(
  /quantity: Math\.min\(stock, 30\)/.test(bulkBlock),
  'Nút thêm nhanh CŨ vẫn cap 30 cuốn/đầu (không đổi hành vi)'
);
expect(
  /onClick=\{handleBulkAddInStock\}/.test(src) && /tối đa 30 cuốn\/đầu/.test(src),
  'Nhãn nút thêm nhanh cũ nói rõ "tối đa 30 cuốn/đầu" để phân biệt với nút mới'
);

// ---------------------------------------------------------------------------
// 9. SOURCE-TEXT: sau khi lấy hết, hướng dẫn Ngưng hoạt động (không phải Xoá).
// ---------------------------------------------------------------------------
const successPanel = src.slice(src.indexOf('Chuyển Kho Hàng Loạt Thành Công'));
expect(successPanel.length > 0, 'Tồn panel thành công');
expect(
  /Ngưng hoạt động/.test(successPanel),
  'Panel thành công nhắc hành động đúng: Ngưng hoạt động'
);
expect(
  /đừng bấm[\s\S]{0,120}?Xoá/.test(successPanel),
  'Panel thành công nói rõ KHÔNG Xoá (đừng bấm "Xoá" — kho đã có sổ kho nên xoá luôn bị 409)'
);

// ---------------------------------------------------------------------------
// 10. Vietnamese UI text must keep diacritics.
// ---------------------------------------------------------------------------
for (const good of ['Lấy tồn thật kho nguồn', 'tối đa 30 cuốn/đầu', 'Ngưng hoạt động']) {
  expect(src.includes(good), `Nhãn có dấu: "${good}"`);
}
for (const bad of ['Lay ton that', 'toi da 30', 'Nguang hoat dong', 'Lay ton that kho nguon']) {
  expect(!src.includes(bad), `KHÔNG có nhãn không dấu "${bad}" trong UI`);
}

console.log('\nWarehouse stock contract - PASS');
for (const c of checks) console.log(c);
console.log(`\n${checks.length} assertions passed.\n`);
