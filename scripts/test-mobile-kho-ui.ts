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
const batch = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/inventory/BatchTransferModal.tsx'),
  'utf8'
);
const portalPath = path.resolve(process.cwd(), 'src/components/PortalToBody.tsx');
const portalExists = fs.existsSync(portalPath);
const portal = portalExists ? fs.readFileSync(portalPath, 'utf8') : '';

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

// 3. The dropdown renders through the SHARED portal helper, closes on outside
//    click and Escape, and stays inside the viewport at 320px.
expect(
  /import \{ PortalToBody \} from '\.\/PortalToBody'/.test(matrix),
  'StockOverviewMatrix dùng helper portal dùng chung'
);
expect(
  /\{isTabMenuOpen && mounted && \(/.test(matrix) && /<PortalToBody className="fixed z-\[80\]">/.test(matrix),
  'Dropdown tab render qua PortalToBody'
);
expect(
  /\{showMagnetBar && mounted && \(/.test(matrix),
  'Thanh tìm kiếm nam châm render qua PortalToBody'
);
expect(
  /document\.addEventListener\('mousedown', handleOutsidePointer\)/.test(matrix),
  'Đóng dropdown khi bấm ra ngoài'
);
expect(
  /case 'Escape':[\s\S]{0,300}?setIsTabMenuOpen\(false\)/.test(matrix),
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

// ---------------------------------------------------------------------------
// 5. SHARED PORTAL HELPER — one pattern, reused by every floating surface.
//    A popup is only ever as safe as its weakest ancestor. Rather than
//    hand-rolling `createPortal` a third time, there is ONE helper.
// ---------------------------------------------------------------------------
expect(portalExists, 'Tồn tại helper dùng chung src/components/PortalToBody.tsx');
if (portalExists) {
  expect(
    /import \{ createPortal \} from 'react-dom'/.test(portal),
    'Helper dùng createPortal từ react-dom'
  );
  expect(
    /createPortal\([\s\S]*?document\.body\s*\)/.test(portal),
    'Helper mount vào document.body (không ancestor nào cắt được)'
  );
  expect(/typeof document === 'undefined'/.test(portal), 'Helper an toàn SSR (typeof document)');
  expect(/useState\(false\)/.test(portal) && /useEffect/.test(portal), 'Helper có mounted gate');
}
for (const [name, src] of [
  ['StockOverviewMatrix', matrix],
  ['BatchTransferModal', batch],
] as const) {
  expect(
    /from '@\/components\/PortalToBody'|from '\.\.\/PortalToBody'|from '\.\/PortalToBody'/.test(src),
    `${name} dùng helper portal dùng chung, không tự gọi createPortal`
  );
  expect(
    !/createPortal\([\s\S]{0,4000}?document\.body\)/.test(src),
    `${name} không còn tự gọi createPortal(...document.body) — đã hợp nhất về 1 pattern`
  );
}

// ---------------------------------------------------------------------------
// 6. BatchTransferModal book picker — the confirmed clipped popup.
//    It was `absolute z-20` living inside a `overflow-hidden` modal card whose
//    own body is `overflow-y-auto`. Two independent clipping ancestors: the
//    suggestion list was cut off on any screen, and unreachable.
// ---------------------------------------------------------------------------
expect(
  !/className="absolute z-20 left-0 right-0 mt-1/.test(batch),
  'Picker sách của BatchTransferModal không còn absolute z-20 trong modal overflow-hidden'
);
expect(
  /filteredBooksToAdd\.length > 0/.test(batch) && /PortalToBody/.test(batch),
  'Gợi ý sách render qua PortalToBody (thoát khỏi modal overflow-hidden)'
);
expect(
  /max-h-\[min\(20rem,calc\(100vh-2rem\)\)\]/.test(batch),
  'Dropdown gợi ý sách tự giới hạn chiều cao theo viewport (không tràn màn hình)'
);
expect(
  /whitespace-nowrap/.test(batch),
  'Dòng gợi ý sách mang whitespace-nowrap (tên sách không xuống dòng từng âm tiết)'
);
expect(
  /onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/.test(batch) ||
    /document\.addEventListener\('mousedown'/.test(batch),
  'Dropdown gợi ý sách đóng khi bấm ra ngoài, không nuốt mất focus ô tìm kiếm'
);

// ---------------------------------------------------------------------------
// 7. KEYBOARD NAVIGATION in the tab dropdown listbox.
//    Previously Enter/Escape existed but there was no way to MOVE between
//    options, so the listbox was mouse-only for its four entries.
// ---------------------------------------------------------------------------
expect(/aria-activedescendant/.test(matrix), 'Listbox tab công bố aria-activedescendant');
expect(/role="option"/.test(matrix), 'Mỗi dòng tab có role="option"');
expect(/role="listbox"/.test(matrix), 'Dropdown tab có role="listbox"');
expect(/aria-selected=\{tab\.id === activeTab\}/.test(matrix), 'Mỗi tab công bố aria-selected');
expect(/aria-haspopup="listbox"/.test(matrix), 'Nút trigger khai báo aria-haspopup="listbox"');
expect(/aria-expanded=\{isTabMenuOpen\}/.test(matrix), 'Nút trigger khai báo aria-expanded');
const navKeys = [
  ["case 'ArrowDown':", 'ArrowDown chuyển xuống option kế tiếp'],
  ["case 'ArrowUp':", 'ArrowUp chuyển lên option trước'],
  ["case 'Home':", 'Home nhảy về option đầu'],
  ["case 'End':", 'End nhảy tới option cuối'],
  ["case 'Enter':", 'Enter chọn option đang focus'],
] as const;
for (const [code, msg] of navKeys) {
  expect(matrix.includes(code), `Bàn phím: ${msg}`);
}
// Di chuyển có vòng lặp (wrap) ở hai đầu danh sách.
expect(
  /i >= lastIndex \? 0 : i \+ 1/.test(matrix) && /i <= 0 \? lastIndex : i - 1/.test(matrix),
  'ArrowDown/ArrowUp quay vòng ở đầu/cuối danh sách'
);
expect(
  /activeTabIndex/.test(matrix) && /setActiveTabIndex/.test(matrix),
  'Có state activeTabIndex điều hướng bằng bàn phím'
);
expect(
  /scrollIntoView|scrollIntoViewIfNeeded/.test(matrix) ||
    /ref=\{\(el\) =>/.test(matrix),
  'Option đang focus được cuộn vào khung nhìn'
);
// Arrow keys must not scroll the page away while navigating the listbox.
expect(
  /preventDefault\(\)/.test(matrix),
  'Phím điều hướng được preventDefault (không cuộn trang khi bấm mũi tên)'
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
