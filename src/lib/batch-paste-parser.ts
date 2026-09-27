export type ParseLookupBook = { id: string; title: string; code?: string | null; isbnLast4?: string | null };
export type ParsedRow =
  | { status: "matched"; line: string; editionId: string; title: string; quantity: number }
  | { status: "needs_confirm"; line: string; quantity: number; candidates: { id: string; title: string }[] }
  | { status: "not_found"; line: string; quantity: number };
export function parsePastedBookList(
  text: string,
  books: ParseLookupBook[],
  opts?: { defaultQuantity?: number }
): { rows: ParsedRow[]; summary: { matched: number; needsConfirm: number; notFound: number } };

export function parsePastedBookList(
  text: string,
  books: ParseLookupBook[],
  opts?: { defaultQuantity?: number }
): { rows: ParsedRow[]; summary: { matched: number; needsConfirm: number; notFound: number } } {
  const defaultQuantity = opts?.defaultQuantity ?? 5;
  const index = new Map<string, ParseLookupBook>();
  for (const b of books) {
    const key = normalize(b.title).toLowerCase();
    if (key && !index.has(key)) index.set(key, b);
  }

  const rows: ParsedRow[] = [];
  const matchedEditions = new Set<string>();
  let needsConfirm = 0;
  let notFoundCount = 0;

  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const whole = normalize(line);
    if (!whole) continue;
    if (HEADERS.has(whole.toLowerCase())) continue;

    // Interpretations in priority order: WHOLE line first, then a quantity
    // split off. The first exact title match wins and carries its quantity.
    const interpretations: { title: string; quantity: number }[] = [
      { title: whole, quantity: defaultQuantity },
    ];

    if (/[\t,;]/.test(raw)) {
      const fields = raw.split(/[\t,;]/).map((f) => f.trim()).filter((f) => f !== '');
      if (fields.length >= 2) {
        const qty = asQuantity(fields[fields.length - 1]);
        if (qty !== null) {
          interpretations.push({ title: normalize(fields.slice(0, -1).join(' ')), quantity: qty });
        }
      }
    }

    const lastSpace = whole.lastIndexOf(' ');
    if (lastSpace > 0) {
      const qty = asQuantity(whole.slice(lastSpace + 1));
      if (qty !== null) {
        interpretations.push({ title: normalize(whole.slice(0, lastSpace)), quantity: qty });
      }
    }

    let hit: { book: ParseLookupBook; quantity: number } | null = null;
    for (const it of interpretations) {
      if (!it.title) continue;
      const book = index.get(it.title.toLowerCase());
      if (book) {
        hit = { book, quantity: it.quantity };
        break;
      }
    }

    if (hit) {
      matchedEditions.add(hit.book.id);
      rows.push({
        status: 'matched',
        line,
        editionId: hit.book.id,
        title: hit.book.title,
        quantity: hit.quantity,
      });
      continue;
    }

    // No exact match: offer near candidates, never auto pick.
    const seen = new Set<string>();
    const candidates: { id: string; title: string }[] = [];
    for (const it of interpretations) {
      if (!it.title) continue;
      const key = it.title.toLowerCase();
      for (const b of books) {
        const bt = normalize(b.title).toLowerCase();
        if (!bt || seen.has(b.id)) continue;
        if (isNearMatch(key, bt)) {
          seen.add(b.id);
          candidates.push({ id: b.id, title: b.title });
          if (candidates.length >= 5) break;
        }
      }
      if (candidates.length >= 5) break;
    }

    if (candidates.length > 0) {
      needsConfirm++;
      rows.push({ status: 'needs_confirm', line, quantity: defaultQuantity, candidates });
    } else {
      notFoundCount++;
      rows.push({ status: 'not_found', line, quantity: defaultQuantity });
    }
  }

  return { rows, summary: { matched: matchedEditions.size, needsConfirm, notFound: notFoundCount } };
}

/** Header-only lines copied along with the data. */
const HEADERS = new Set([
  'stt',
  'ten',
  'ten sach',
  'so luong',
  'soluong',
  'title',
  'quantity',
  'ten sách',
  'số lượng',
  'ma sach',
  'masach',
  'isbn',
]);

/** Collapse whitespace, trim, drop straight/curly double quotes anywhere. */
const normalize = (s: string) => s.replace(/["\u201c\u201d]/g, '').replace(/\s+/g, ' ').trim();

/** An integer >= 1, nothing else (0, -3, 2.5, "abc" are rejected). */
const asQuantity = (s: string): number | null => {
  const t = s.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 ? n : null;
};

const commonPrefixLen = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

/** One title starts with the other, or they share a plausibly-long prefix. */
const isNearMatch = (a: string, b: string) =>
  a.startsWith(b) || b.startsWith(a) || commonPrefixLen(a, b) >= 8;

