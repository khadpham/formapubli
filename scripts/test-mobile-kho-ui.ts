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
  'Xuất kho',
  'Chuyển kho',
  'Nhập in',
  'Cách Ly Sách Lỗi',
];
for (const label of LABELS) {
  expect(matrix.includes(label), `Nhãn "${label}" vẫn còn trong màn Kho hàng`);
}

// Thanh công cụ từng có 5 nút rời trùng chức năng với menu thu gọn
// ("Xuất Kho Đối Tác", "Chuyển kho" lần 2, "Chuyển hàng loạt", "Xuất bản",
// "Soạn Kệ") khiến người dùng thấy trùng lặp. Chức năng phải còn, nhưng chỉ
// còn MỘT đường vào: qua menu "Xuất kho" / "Chuyển kho".
// Đếm theo class đặc trưng của nút thanh công cụ (4 nút: Xuất kho, Chuyển kho,
// Nhập in, Cách Ly Sách Lỗi) + 4 nút cố định (chip tab, Mở Kho, Kho, TK Nhận Tiền).
const TOOLBAR_BTN_CLASS = 'className="flex items-center gap-1 whitespace-nowrap shrink-0 px-3 py-2';
const toolbarBtns = (matrix.match(new RegExp(TOOLBAR_BTN_CLASS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
expect(toolbarBtns === 4, `Thanh công cụ phải còn đúng 4 nút hành động (đang ${toolbarBtns}) — không được thêm nút trùng menu`);
for (const item of ['Cung ứng đối tác', 'Hàng loạt', '1 phiếu chuyển kho', 'Soạn kệ (gom theo kệ)', 'Bán lẻ / Quà tặng']) {
  expect(matrix.includes(item), `Mục menu "${item}" phải còn để không mất chức năng`);
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
// Shape-agnostic: the dropdown renders through the portal AND the wrapper is the
// positioned element. Pinned to the old one-line form it would have LOCKED IN the
// bug (fixed on the wrapper, measured top/left on the static child).
expect(
  /\{isTabMenuOpen && mounted && \(/.test(matrix) &&
    /<PortalToBody[\s\S]{0,200}?className="fixed z-\[80\]"[\s\S]{0,200}?style=\{\{ top: tabMenuPos\.top, left: tabMenuPos\.left \}\}/.test(
      matrix
    ),
  'Dropdown tab render qua PortalToBody, wrapper vừa fixed vừa mang toạ độ đo đạc'
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
// 03/10 (commit 2f96783): AI Copilot đã lên thanh header ⇒ KHÔNG còn FAB ở đáy.
// Test cũ đòi FAB phải còn, giờ đòi ngược lại: không được quay về FAB (hết dải
// trống đáy ở mọi tab), và nút header phải hiện trên điện thoại.
expect(!/fabBottom/.test(shell), 'FAB Copilot đã bỏ — nút nằm trên thanh header');
expect(!/mainBottomPadding = 'pb-28 lg:pb-8'/.test(shell), 'Không chừa padding-bottom cho FAB nữa');
expect(
  /className="flex items-center gap-1\.5 px-2 sm:px-3 py-1\.5 rounded-full text-xs font-bold text-indigo-700/.test(shell) &&
    !/canUseCopilot && \(\s*<button[^>]*?className="hidden sm:flex/.test(shell),
  'Nút Copilot ở header phải hiện trên mobile (chỉ ẩn chữ, không ẩn cả nút)'
);
expect(
  /mainBottomPadding = posMobileBar \? 'pb-32 lg:pb-8' : 'pb-20 lg:pb-8'/.test(shell),
  'Chỉ POS mới chừa padding-bottom (thanh giỏ + nút quét camera); tab khác dùng safe-area'
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

// ---------------------------------------------------------------------------
// 8. REGRESSION — the tab menu rendered OFF SCREEN while this whole file stayed
//    GREEN. Root cause: <PortalToBody className="fixed z-[80]"> puts `fixed` on
//    the portal WRAPPER, but the measured `top`/`left` lived on the INNER div,
//    which had no position class at all. A position:fixed wrapper with no
//    top/left falls back to its STATIC position (last child of body = far
//    below the fold), and the static inner div ignores top/left outright.
//    Net effect on a phone: click the "Ma trận" chip, nothing visibly happens.
//
//    This audit is SOURCE-level and applies to EVERY PortalToBody call site in
//    src, not just the one that broke: whenever a usage supplies measured
//    `top` and `left` (style object or Tailwind top-/left- classes), that SAME
//    element must also carry a position (fixed/absolute, class or style). The
//    mismatch is silent — no console error, no red test — so it has to be
//    asserted mechanically or it comes back.
// ---------------------------------------------------------------------------
// A Tailwind `top-4` class alone does NOT create a positioned element; only
// fixed/absolute/sticky (or an explicit `position:` style) does.
const POSITION_CLASS = /(^|[\s"'`])(fixed|absolute|sticky)([\s"'`]|$)/;
const hasPosition = (tag: string) =>
  POSITION_CLASS.test(tag) || /position:\s*'(fixed|absolute|sticky)'/.test(tag);
// Measured coordinates: style object `top:`+`left:`, or Tailwind `top-`+`left-`.
const hasCoords = (tag: string) => {
  const styleCoords =
    /style=\{\{[\s\S]*?\btop\s*:/.test(tag) && /style=\{\{[\s\S]*?\bleft\s*:/.test(tag);
  const classCoords =
    /className=/.test(tag) &&
    /(^|[\s"'`])top-/.test(tag) &&
    (/(^|[\s"'`])left-/.test(tag) || /(^|[\s"'`])inset-x-/.test(tag));
  return Boolean(styleCoords || classCoords);
};

/** Read one JSX opening tag starting at `i` (which must point at `<`). */
const readTag = (src: string, i: number): { tag: string; end: number } | null => {
  if (src[i] !== '<') return null;
  let depth = 0;
  let quote: string | null = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (c === '>' && depth === 0) return { tag: src.slice(i, j + 1), end: j + 1 };
  }
  return null;
};

const walkSrc = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walkSrc(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
};

const srcRoot = path.resolve(process.cwd(), 'src');
const portalUsages: string[] = [];
for (const file of walkSrc(srcRoot)) {
  if (path.basename(file) === 'PortalToBody.tsx') continue; // the helper itself
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(process.cwd(), file);
  let idx = src.indexOf('<PortalToBody');
  while (idx !== -1) {
    const line = src.slice(0, idx).split('\n').length;
    const wrapper = readTag(src, idx);
    if (wrapper) {
      // The first element INSIDE the portal is the child that may or may not
      // be the positioned one. Both must agree about position + coordinates.
      const childIdx = wrapper.end + (src.slice(wrapper.end).match(/^\s*/) as RegExpMatchArray)[0].length;
      const child = readTag(src, childIdx);
      for (const [role, tag] of [
        ['wrapper', wrapper.tag],
        ['child', child?.tag ?? ''],
      ] as const) {
        if (!tag || !hasCoords(tag)) continue;
        expect(
          hasPosition(tag),
          `${rel}:${line} PortalToBody ${role} mang top+left nhưng thiếu position (fixed/absolute) — menu sẽ rơi về vị trí static và nằm ngoài màn hình`
        );
        portalUsages.push(`${rel}:${line} (${role})`);
      }
    }
    idx = src.indexOf('<PortalToBody', idx + 1);
  }
}
expect(
  portalUsages.length >= 3,
  `Audit tìm thấy ${portalUsages.length} usage PortalToBody có toạ độ đo đạc (wrapper hoặc child)`
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
