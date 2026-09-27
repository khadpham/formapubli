/**
 * Batch paste parser contract (src/lib/batch-paste-parser.ts).
 *
 * A warehouse manager copies two columns out of Excel (title + quantity) and
 * pastes plain text. THE HARD RULE: a row may only become a transfer line when
 * the title is found EXACTLY in the catalog. Never guess a book.
 *
 * The central algorithm exists because the naive "last space token is the
 * quantity" rule is WRONG on the manager's real list: "Middlemarch - Tap 2"
 * would become title "Middlemarch - Tap" + qty 2, silently transferring the
 * wrong edition. So a line is tried as a WHOLE title first, and only if that
 * fails is a quantity split off.
 *
 * Pure assert-based script, same style as scripts/test-mobile-kho-ui.ts:
 * no DOM, no database, no new dependency.
 */
import assert from 'node:assert/strict';
import { parsePastedBookList, type ParseLookupBook, type ParsedRow } from '../src/lib/batch-paste-parser';

const checks: string[] = [];
const expect = (cond: unknown, msg: string) => {
  assert.ok(cond, msg);
  checks.push(`  ok  ${msg}`);
};

// ---------------------------------------------------------------------------
// Fixture catalog — the manager's real titles.
// ---------------------------------------------------------------------------
const CATALOG: ParseLookupBook[] = [
  { id: 'ed-mm2', title: 'Middlemarch - Tap 2' },
  { id: 'ed-mm1', title: 'Middlemarch - Tap 1' },
  { id: 'ed-sp-bia', title: 'Le Spleen de Paris (Bia tim)' },
  { id: 'ed-sp-bia-trang', title: 'Le Spleen de Paris (Tai ban) - Bia trang' },
  { id: 'ed-gil1', title: 'Truyen Gil-Blas (tap 1)' },
  { id: 'ed-gil2', title: 'Truyen Gil-Blas (tap 2)' },
  { id: 'ed-gloss', title: 'Doi to Heraclius Gloss' },
  { id: 'ed-benh', title: 'Benh tuong' },
  { id: 'ed-bienlan', title: 'Nguoi bien lan' },
  { id: 'ed-vinhbiet', title: 'Vinh biet' },
];

const byTitle = (t: string) => {
  const hit = CATALOG.find((b) => b.title === t);
  assert.ok(hit, `fixture thiếu "${t}"`);
  return hit.id;
};

const matched = (rows: ParsedRow[]) => rows.filter((r) => r.status === 'matched') as Extract<ParsedRow, { status: 'matched' }>[];
const confirm = (rows: ParsedRow[]) => rows.filter((r) => r.status === 'needs_confirm') as Extract<ParsedRow, { status: 'needs_confirm' }>[];
const notFound = (rows: ParsedRow[]) => rows.filter((r) => r.status === 'not_found') as Extract<ParsedRow, { status: 'not_found' }>[];

// ---------------------------------------------------------------------------
// 1. Title-only line -> default quantity 5.
// ---------------------------------------------------------------------------
{
  const { rows, summary } = parsePastedBookList('Benh tuong', CATALOG);
  expect(rows.length === 1, 'dòng chỉ có tên -> đúng 1 row');
  const r = matched(rows)[0];
  expect(!!r, 'dòng chỉ có tên -> matched');
  expect(r?.editionId === byTitle('Benh tuong'), 'matched đúng edition "Benh tuong"');
  expect(r?.quantity === 5, `số lượng mặc định = 5 (thực tế: ${r?.quantity})`);
  expect(r?.line === 'Benh tuong', 'giữ nguyên dòng gốc trong row.line');
  expect(summary.matched === 1 && summary.needsConfirm === 0 && summary.notFound === 0, 'summary: matched=1, 0, 0');
}

// ---------------------------------------------------------------------------
// 2. Title + quantity (tab separated) -> that quantity.
// ---------------------------------------------------------------------------
{
  const { rows } = parsePastedBookList('Doi to Heraclius Gloss\t7', CATALOG);
  const r = matched(rows)[0];
  expect(r?.editionId === byTitle('Doi to Heraclius Gloss'), 'tab: tách số lượng ở field cuối');
  expect(r?.quantity === 7, `tab: số lượng = 7 (thực tế: ${r?.quantity})`);

  const comma = parsePastedBookList('Nguoi bien lan, 12', CATALOG);
  expect(matched(comma.rows)[0]?.quantity === 12, 'dấu phẩy: số lượng = 12');

  const semi = parsePastedBookList('Vinh biet; 3', CATALOG);
  expect(matched(semi.rows)[0]?.quantity === 3, 'dấu chấm phẩy: số lượng = 3');
}

// ---------------------------------------------------------------------------
// 3. THE REGRESSION: "Middlemarch - Tap 2" must resolve to the FULL title.
// ---------------------------------------------------------------------------
{
  const { rows, summary } = parsePastedBookList('Middlemarch - Tap 2', CATALOG);
  const r = matched(rows)[0];
  expect(r?.editionId === byTitle('Middlemarch - Tap 2'), '"Middlemarch - Tap 2" khớp đúng TAP 2');
  expect(r?.quantity === 5, `"Middlemarch - Tap 2" dùng số lượng mặc định 5 (thực tế: ${r?.quantity})`);
  expect(r?.title === 'Middlemarch - Tap 2', 'title trả về là "Middlemarch - Tap 2"');
  expect(
    !rows.some((x) => x.status === 'matched' && x.title === 'Middlemarch - Tap'),
    'KHÔNG BAO GIỜ sinh ra title "Middlemarch - Tap" (đây là bug chuyển nhầm sách)'
  );
  expect(summary.matched === 1, 'summary matched = 1');

  // A real quantity at the end of a title that itself ends in a number:
  // the tab split must win over the naive last-space rule.
  const withQty = parsePastedBookList('Middlemarch - Tap 1\t4', CATALOG);
  const wr = matched(withQty.rows)[0];
  expect(wr?.editionId === byTitle('Middlemarch - Tap 1'), '"Middlemarch - Tap 1\\t4" khớp TAP 1');
  expect(wr?.quantity === 4, 'số lượng 4 lấy từ field cuối');
  expect(
    !withQty.rows.some((x) => x.status === 'matched' && x.title === 'Middlemarch - Tap'),
    '"Middlemarch - Tap 1\\t4" KHÔNG sinh ra title "Middlemarch - Tap"'
  );
}

// ---------------------------------------------------------------------------
// 4. Stray trailing quote still matches (quote stripped anywhere in the line).
// ---------------------------------------------------------------------------
{
  const straight = parsePastedBookList('Benh tuong"', CATALOG);
  expect(matched(straight.rows)[0]?.editionId === byTitle('Benh tuong'), 'dấu " thừa cuối dòng vẫn khớp');
  const curly = parsePastedBookList('\u201cVinh biet\u201d', CATALOG);
  expect(matched(curly.rows)[0]?.editionId === byTitle('Vinh biet'), 'dấu \u201c\u201d cong vẫn khớp');
}

// ---------------------------------------------------------------------------
// 5. Blank lines and header lines dropped silently.
// ---------------------------------------------------------------------------
{
  const text = ['STT', 'Ten sach', 'So luong', 'Title', 'Quantity', 'Ten', '', '   ', 'Benh tuong'].join('\n');
  const { rows } = parsePastedBookList(text, CATALOG);
  expect(rows.length === 1, `header + dòng trống bị bỏ, chỉ còn 1 row (thực tế: ${rows.length})`);
  expect(matched(rows)[0]?.editionId === byTitle('Benh tuong'), 'row còn lại là dòng sách thật');
}

// ---------------------------------------------------------------------------
// 6. Quantity must be an integer >= 1. 0 / âm / thập phân / chữ -> giữ trong title.
// ---------------------------------------------------------------------------
{
  for (const line of ['Nguoi bien lan 0', 'Nguoi bien lan -3', 'Nguoi bien lan 2.5', 'Nguoi bien lan abc']) {
    const { rows } = parsePastedBookList(line, CATALOG);
    const r = rows[0];
    expect(
      r?.status !== 'matched',
      `"${line}" KHÔNG được matched (số 0/âm/thập phân/chữ không phải số lượng)`
    );
    expect(r?.quantity === 5, `"${line}" dùng số lượng mặc định 5, không phải số viết cuối (thực tế: ${r?.quantity})`);
  }
}

// ---------------------------------------------------------------------------
// 7. Unknown title -> not_found, never a guess.
// ---------------------------------------------------------------------------
{
  const { rows, summary } = parsePastedBookList('Sach khong co trong kho', CATALOG);
  expect(rows[0]?.status === 'not_found', 'tên lạ -> not_found');
  expect(notFound(rows).length === 1 && matched(rows).length === 0, 'not_found tuyệt đối, không tự chọn sách nào');
  expect(summary.notFound === 1 && summary.matched === 0, 'summary notFound = 1');
}

// ---------------------------------------------------------------------------
// 8. Near miss "Le Spleen de Paris" -> needs_confirm with BOTH bia candidates.
// ---------------------------------------------------------------------------
{
  const { rows, summary } = parsePastedBookList('Le Spleen de Paris', CATALOG);
  expect(matched(rows).length === 0, 'gần đúng KHÔNG được matched (không bao giờ đoán sách)');
  const c = confirm(rows)[0];
  expect(!!c, 'gần đúng -> needs_confirm');
  const ids = c?.candidates.map((x) => x.id) ?? [];
  expect(ids.includes(byTitle('Le Spleen de Paris (Bia tim)')), 'needs_confirm có ứng viên Bia tim');
  expect(ids.includes(byTitle('Le Spleen de Paris (Tai ban) - Bia trang')), 'needs_confirm có ứng viên Bia trang');
  expect((c?.candidates.length ?? 0) <= 5, 'tối đa 5 ứng viên');
  expect(summary.needsConfirm === 1 && summary.matched === 0, 'summary needsConfirm = 1');
}

// ---------------------------------------------------------------------------
// 9. Duplicate lines: keep BOTH rows, summary counts UNIQUE editions.
// ---------------------------------------------------------------------------
{
  const { rows, summary } = parsePastedBookList('Vinh biet\nVinh biet', CATALOG);
  expect(rows.length === 2, `hai dòng giống nhau -> giữ cả 2 row (thực tế: ${rows.length})`);
  expect(rows.every((r) => r.status === 'matched'), 'cả 2 dòng đều matched');
  expect(
    summary.matched === 1,
    `summary.matched đếm BẢN DUY NHẤT = 1 dù có 2 dòng (thực tế: ${summary.matched})`
  );

  const mixed = parsePastedBookList('Vinh biet\nVinh biet\t2\nBenh tuong', CATALOG);
  expect(mixed.rows.length === 3, '3 row giữ đúng thứ tự dòng lệnh');
  expect(mixed.summary.matched === 2, 'summary.matched = 2 bản duy nhất (Vinh biet, Benh tuong)');
}

// ---------------------------------------------------------------------------
// 10. Order follows input order; custom defaultQuantity; match is case/ws-insensitive.
// ---------------------------------------------------------------------------
{
  const { rows } = parsePastedBookList('Vinh biet\t1\nBenh tuong\t2\nNguoi bien lan\t3', CATALOG);
  expect(
    rows.map((r) => (r.status === 'matched' ? r.line : '?')).join('|') === 'Vinh biet\t1|Benh tuong\t2|Nguoi bien lan\t3',
    'thứ tự row bám đúng thứ tự dòng lệnh'
  );
  expect(matched(rows).map((r) => r.quantity).join(',') === '1,2,3', 'số lượng bám đúng từng dòng');

  const custom = parsePastedBookList('Vinh biet', CATALOG, { defaultQuantity: 20 });
  expect(matched(custom.rows)[0]?.quantity === 20, 'opts.defaultQuantity được tôn trọng');

  const messy = parsePastedBookList('  benh   TUONG  ', CATALOG);
  expect(matched(messy.rows)[0]?.editionId === byTitle('Benh tuong'), 'khớp không phân biệt hoa/thường + nhiều khoảng trắng');
}

console.log('\nBatch paste parser contract - PASS');
for (const c of checks) console.log(c);
console.log(`\n${checks.length} assertions passed.\n`);
