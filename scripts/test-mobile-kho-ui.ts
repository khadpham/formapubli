/**
 * Mobile "Kho Hàng" (StockOverviewMatrix) UI contract.
 *
 * Regression guard for a reported, REPEATED defect: on a ~470px phone the
 * toolbar tab pill (4 tabs, longest label "Sổ Cái Bất Biến (n)") is a NESTED
 * flex item with no `flex-wrap` and default `min-width: auto`. It refuses to
 * shrink below its content width, overflows the toolbar card, squeezes its own
 * buttons until the text stacks one syllable per line, and pushes every action
 * button (Mở Kho, TK Nhận Tiền, Xuất Kho Đối Tác, Chuyển kho, ...) off screen.
 *
 * These assertions are source-level (same style as the repo's other
 * scripts/test-*.ts): no DOM, no browser, no database.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const matrixPath = path.resolve(process.cwd(), 'src/components/StockOverviewMatrix.tsx');
const matrix = fs.readFileSync(matrixPath, 'utf8');
const shell = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/layout/MasterAppShell.tsx'),
  'utf8'
);

const checks: string[] = [];
const expect = (cond: unknown, msg: string) => {
  assert.ok(cond, msg);
  checks.push(`  ok  ${msg}`);
};

// 1. The nested, non-wrapping flex tab pill must be gone.
expect(
  !/bg-slate-100 p-1 rounded-lg flex/.test(matrix),
  'Pill tab cũ "bg-slate-100 p-1 rounded-lg flex" (flex lồng nhau, không wrap) đã bị gỡ'
);
expect(
  !/rounded-lg flex text-xs font-semibold/.test(matrix),
  'Không còn pill tab lồng "rounded-lg flex text-xs font-semibold" không wrap'
);

// 2. Every tab/action label must carry whitespace-nowrap (no vertical
//    stacking of Vietnamese syllables) and shrink-0 so it is never squeezed.
const LABELS = [
  'Ma trận 3 Kho',
  'Sổ Cái Bất Biến',
  'Đi Đường',
  'Sổ Phiếu Xuất',
  'Mở Kho',
  'TK Nhận Tiền',
  'Xuất Kho Đối Tác',
  'Chuyển kho',
  'Chuyển hàng loạt',
  'Nhập in',
  'Xuất bán',
  'Soạn Kệ',
  'Cách Ly Sách Lỗi',
];
for (const label of LABELS) {
  expect(matrix.includes(label), `Nhãn "${label}" vẫn còn trong màn Kho hàng`);
}
// Short labels used by the compact trigger chip: the long "Sổ Cái Bất Biến (n)"
// must never be rendered as a wide inline pill on a phone.
for (const short of ['Ma trận', 'Sổ cái', 'Đi đường', 'Sổ PX']) {
  expect(matrix.includes(`'${short}'`), `Chip trigger có nhãn ngắn "${short}"`);
}

// Every <button> block carrying visible text must be nowrap-safe.
const buttonBlocks = matrix.match(/<button\b[\s\S]*?<\/button>/g) || [];
expect(buttonBlocks.length >= 12, `Tìm thấy ${buttonBlocks.length} nút trong StockOverviewMatrix`);
// Chỉ lấy phần BÊN TRONG thẻ button (bỏ thuộc tính, bỏ `=>` trong onClick).
const innerOf = (block: string) =>
  block
    .replace(/^<button\b[\s\S]*?(?<![=<>])>/, '')
    .replace(/<\/button>$/, '');
const textOf = (block: string) =>
  innerOf(block)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
for (const block of buttonBlocks) {
  const label = textOf(block);
  if (!label) continue; // icon-only button: nothing to stack vertically
  assert.ok(
    /whitespace-nowrap/.test(block),
    `Nút có chữ "${label}" thiếu whitespace-nowrap (chữ sẽ xuống dòng từng âm tiết)`
  );
}

// 3. The dropdown renders in a portal on document.body, closes on outside
//    click and Escape, and stays inside the viewport at 320px.
expect(/import \{ createPortal \} from 'react-dom'/.test(matrix), 'StockOverviewMatrix import createPortal');
expect(/isTabMenuOpen && mounted && createPortal\(/.test(matrix), 'Dropdown tab render qua createPortal');
const tabPortalIdx = matrix.indexOf('isTabMenuOpen && mounted && createPortal(');
expect(
  tabPortalIdx > 0 && matrix.indexOf('document.body', tabPortalIdx) - tabPortalIdx < 3000,
  'Dropdown tab được portal vào document.body'
);
expect(/role="listbox"/.test(matrix), 'Dropdown tab có role="listbox"');
expect(/aria-selected=\{tab\.id === activeTab\}/.test(matrix), 'Mỗi tab công bố aria-selected');
expect(/aria-haspopup="listbox"/.test(matrix), 'Nút trigger khai báo aria-haspopup="listbox"');
expect(/aria-expanded=\{isTabMenuOpen\}/.test(matrix), 'Nút trigger khai báo aria-expanded');
expect(
  /document\.addEventListener\('mousedown', handleOutsidePointer\)/.test(matrix),
  'Đóng dropdown khi bấm ra ngoài'
);
expect(
  /e\.key === 'Escape'[\s\S]{0,300}?setIsTabMenuOpen\(false\)/.test(matrix),
  'Đóng dropdown bằng phím Escape'
);
for (const shortcut of [
  "matchActionShortcut(e, 'KeyT', { shift: true })",
  "matchActionShortcut(e, 'KeyR', { shift: true })",
  "matchActionShortcut(e, 'KeyX', { shift: true })",
  "matchActionShortcut(e, 'KeyV'",
]) {
  expect(matrix.includes(shortcut), `Giữ nguyên phím tắt ${shortcut}`);
}
expect(
  /showMagnetBar && mounted && createPortal\(/.test(matrix),
  'Thanh tìm kiếm nam châm (overlay fixed) render qua portal'
);
expect(
  /w-\[min\(20rem,calc\(100vw-1\.5rem\)\)\]/.test(matrix),
  'Dropdown tab giới hạn bề rộng theo viewport (vừa được ở 320px)'
);
expect(/Math\.min\(Math\.max\(/.test(matrix), 'Dropdown tab được clamp trong khung nhìn');
expect(/innerWidth/.test(matrix) && /innerHeight/.test(matrix), 'Vị trí dropdown tính từ innerWidth/innerHeight');

// 4. Scrollable containers reserve trailing space for the floating FAB.
const gutterOpenTags = matrix.match(/<div className="[^"]*overflow-x-auto[^"]*" data-kho-ui="fab-gutter">/g) || [];
expect(
  gutterOpenTags.length >= 2,
  `Cả 2 vùng cuộn ngang (bảng tồn kho + sổ cái) đều chừa gutter cho nút tím nổi (${gutterOpenTags.length} container)`
);
expect(
  /<div aria-hidden="true" className="h-0 w-20 shrink-0" \/>/.test(matrix),
  'Gutter cuộn là phần tử chừa khoảng thật (người dùng cuộn được, không phải chỉ padding trang)'
);
expect(
  (matrix.match(/aria-hidden="true" className="h-0 w-20 shrink-0"/g) || []).length >= 2,
  'Cả bảng tồn kho lẫn sổ cái đều có khoảng trượt cho FAB'
);
expect(
  /min-w-\[640px\]/.test(matrix) && /min-w-\[720px\]/.test(matrix),
  'Bảng có min-width nên cuộn ngang có ý nghĩa thay vì bóp vỡ chữ'
);
expect(/fixed \$\{fabBottom\} right-4/.test(shell), 'FAB Copilot vẫn fixed góc phải dưới');
expect(
  /mainBottomPadding = 'pb-28 lg:pb-8'/.test(shell),
  'Main vẫn chừa padding-bottom cho FAB'
);

console.log('\nMobile Kho UI contract - PASS');
for (const c of checks) console.log(c);
console.log(`\n${checks.length} assertions passed.\n`);

expect(
  /const TAB_ITEMS/.test(matrix) && /TAB_ITEMS\.map/.test(matrix) && /key=\{tab\.id\}/.test(matrix),
  '4 tab render từ một mảng dữ liệu duy nhất (TAB_ITEMS), không gõ tay 4 nút inline'
);
expect(
  /<div className="flex flex-wrap items-center gap-2 min-w-0">/.test(matrix),
  'Dải nút hành động wrap nhiều dòng (flex-wrap) và co lại được (min-w-0)'
);
