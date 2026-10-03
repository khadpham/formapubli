import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';

console.log('--- Running Test: POS Header Layout (empty mobile frame fix) ---');

const posFilePath = path.join(process.cwd(), 'src', 'components', 'pos', 'PosCheckoutTerminal.tsx');
const content = fs.readFileSync(posFilePath, 'utf8');

const failures: string[] = [];
function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS: ${label}`);
  } catch (err) {
    failures.push(label);
    console.log(`FAIL: ${label}`);
    console.log(`      ${(err as Error).message.split('\n')[0]}`);
  }
}

const slice = (from: number, to: number) => content.slice(from, to);

// Panel chọn kho trên mobile phải NẰM TRONG luồng (KHÔNG sticky). Chỉ thanh tìm kiếm
// mới được nổi khi cuộn. (Người dùng yêu cầu 2026-10-03.)
const mobilePanelIdx = content.indexOf('panel chọn kho nằm TRONG luồng');
const cardIdx = content.indexOf('hidden md:flex bg-white rounded-2xl p-3 md:p-5 border border-slate-200/80 shadow-sm flex-col md:flex-row');
const searchStickyIdx = content.indexOf('sticky top-[max(3.5rem');

check('mobile warehouse panel exists and is NOT sticky', () => {
  assert(mobilePanelIdx > -1, 'mobile warehouse panel (panel chọn kho …) not found');
  const divIdx = content.indexOf('<div', mobilePanelIdx);
  const openTag = content.slice(divIdx, content.indexOf('>', divIdx));
  assert(!openTag.includes('sticky'), 'nút chọn kho KHÔNG được sticky — thứ nổi phải là search bar');
});

check('POS search bar IS sticky (the floating element)', () => {
  assert(searchStickyIdx > -1, 'search container must be sticky (sticky top-[max(3.5rem...) not found)');
  const searchTag = content.slice(Math.max(0, searchStickyIdx - 260), searchStickyIdx + 120);
  assert(searchTag.includes('searchContainerRef'), 'sticky search wrapper must be the searchContainerRef element');
});

// ---------------------------------------------------------------------------
// 1. The standalone card must not render on mobile at all (no empty frame).
// ---------------------------------------------------------------------------
check('standalone header card is hidden on mobile (hidden md:flex)', () => {
  assert(
    content.includes('hidden md:flex bg-white rounded-2xl p-3 md:p-5 border border-slate-200/80 shadow-sm flex-col md:flex-row'),
    'Top Header Controls card must be `hidden md:flex` so it renders nothing on a phone',
  );
});

check('header card no longer hides its controls via shiftPanelExpanded', () => {
  assert(
    !content.includes("${shiftPanelExpanded ? 'flex' : 'hidden'} md:flex"),
    'The controls container must not be a shiftPanelExpanded flex/hidden toggle anymore (that made both card children hidden on mobile)',
  );
});

// ---------------------------------------------------------------------------
// 2. The controls must live INSIDE the mobile sticky panel, behind the toggle.
// ---------------------------------------------------------------------------
const controlsMount = '{posHeaderControls}';
const firstMount = content.indexOf(controlsMount);
const lastMount = content.lastIndexOf(controlsMount);

check('controls are extracted into a single shared element', () => {
  assert(firstMount > -1, 'expected a shared `posHeaderControls` element mounted twice (mobile panel + desktop card)');
  assert(firstMount !== lastMount, 'posHeaderControls must be mounted in two places: mobile sticky panel and desktop card');
});

check('first posHeaderControls mount is inside the mobile warehouse panel', () => {
  assert(cardIdx > -1, 'desktop header card not found');
  assert(
    firstMount > mobilePanelIdx && firstMount < cardIdx,
    `mobile controls mount (char ${firstMount}) must sit between the mobile panel (${mobilePanelIdx}) and the desktop card (${cardIdx})`,
  );
});

check('mobile controls render only when shiftPanelExpanded', () => {
  const mobileRegion = slice(mobilePanelIdx, cardIdx);
  assert(
    /shiftPanelExpanded && \(/.test(mobileRegion) && mobileRegion.includes(controlsMount),
    'inside the mobile sticky panel the controls must be rendered behind a `shiftPanelExpanded && (...)` guard',
  );
});

check('collapsed mobile state renders no card/frame at all', () => {
  const mobileRegion = slice(mobilePanelIdx, cardIdx);
  const cardishFrames = mobileRegion.match(/bg-white rounded-2xl border border-slate-200\/80 shadow-sm p-3/g) ?? [];
  assert(
    cardishFrames.length === 1,
    `mobile panel may wrap the controls in exactly one frame, and only behind the expand guard (found ${cardishFrames.length})`,
  );
  // The single frame must be inside the expanded guard, i.e. after `{shiftPanelExpanded && (`.
  const guardIdx = mobileRegion.indexOf('shiftPanelExpanded && (');
  const frameIdx = mobileRegion.indexOf('bg-white rounded-2xl border border-slate-200/80 shadow-sm p-3');
  assert(guardIdx > -1 && frameIdx > guardIdx, 'the mobile controls frame must live inside the shiftPanelExpanded guard');
});

// ---------------------------------------------------------------------------
// 3. Desktop must be untouched: card shows title left, controls right.
// ---------------------------------------------------------------------------
check('desktop card still renders the page title and the controls', () => {
  const cardStart = content.indexOf('hidden md:flex bg-white rounded-2xl p-3 md:p-5');
  assert(cardStart > -1, 'desktop header card not found');
  const desktopRegion = slice(cardStart, cardStart + 1200);
  assert(desktopRegion.includes('Quầy Thu Ngân POS'), 'desktop card must still show the POS page title');
  assert(desktopRegion.includes('hidden md:block'), 'desktop title block must stay md-only');
  assert(desktopRegion.includes(controlsMount), 'desktop card must still mount the network + warehouse controls');
  assert(
    desktopRegion.includes('flex-col md:flex-row items-start md:items-center justify-between'),
    'desktop card must keep title-left / controls-right layout',
  );
});

// ---------------------------------------------------------------------------
// 4. Collapsed summary row: both facts readable, open state obvious.
// ---------------------------------------------------------------------------
const summaryStart = content.indexOf('aria-expanded={shiftPanelExpanded}');
const summaryRegion = slice(summaryStart > -1 ? summaryStart : 0, Math.max(summaryStart + 1, 0) + 2500);

check('summary toggle keeps aria-expanded and the 38px touch target', () => {
  assert(summaryStart > -1, 'summary toggle with aria-expanded={shiftPanelExpanded} not found');
  assert(content.includes('min-h-[38px]'), 'summary toggle must keep the minimum 38px touch target');
  assert(
    /aria-expanded=\{shiftPanelExpanded\}[\s\S]{0,400}min-h-\[38px\]/.test(content),
    'aria-expanded and min-h-[38px] must stay on the summary toggle',
  );
});

check('summary row separates warehouse name and cashbox state (no single truncating string)', () => {
  assert(
    !/flex-1 text-left truncate[^<]*\n[^<]*\{sellableWarehouses/.test(summaryRegion),
    'the collapsed row must not put warehouse name and cashbox state into one truncating text run',
  );
  const warehouseSeg = /<span className="flex-1 min-w-0 text-left truncate">/.test(summaryRegion);
  assert(warehouseSeg, 'warehouse name should occupy its own truncating segment');
  assert(
    summaryRegion.includes('Két mở') && summaryRegion.includes('Két chưa mở'),
    'cashbox state must be spelled out as text, not just a dot color',
  );
});

check('open cashbox state is visually obvious (left accent border + filled pill)', () => {
  assert(
    /border-l-4/.test(summaryRegion) && /border-l-emerald-500/.test(summaryRegion),
    'open state needs a strong non-dot cue such as a left accent border',
  );
  assert(
    /bg-emerald-600 text-white/.test(summaryRegion) && /bg-slate-100/.test(summaryRegion),
    'cashbox pill must be filled when open and muted when closed',
  );
});

// ---------------------------------------------------------------------------
console.log('');
if (failures.length > 0) {
  console.log('======================================================');
  console.log(`>>> ${failures.length} POS HEADER LAYOUT CHECK(S) FAILED <<<`);
  console.log('======================================================\n');
  process.exit(1);
}
console.log('======================================================');
console.log('>>> ALL POS HEADER LAYOUT CHECKS PASSED! <<<');
console.log('======================================================\n');
