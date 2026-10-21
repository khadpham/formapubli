import { removeAccents, matchesAcronym, phoneticSimplify } from './vietnamese';

export type ParseLookupBook = { id: string; title: string; code?: string | null; isbnLast4?: string | null };
export type ScoredCandidate = { id: string; title: string; score: number };
export type ParsedRow =
  | { status: "matched"; line: string; editionId: string; title: string; quantity: number; score: number }
  | { status: "needs_confirm"; line: string; quantity: number; candidates: ScoredCandidate[] }
  | { status: "not_found"; line: string; quantity: number };
export function parsePastedBookList(
  text: string,
  books: ParseLookupBook[],
  opts?: { defaultQuantity?: number; parseQuantity?: boolean }
): { rows: ParsedRow[]; summary: { matched: number; needsConfirm: number; notFound: number } };

export function parsePastedBookList(
  text: string,
  books: ParseLookupBook[],
  opts?: { defaultQuantity?: number; parseQuantity?: boolean }
): { rows: ParsedRow[]; summary: { matched: number; needsConfirm: number; notFound: number } } {
  const defaultQuantity = opts?.defaultQuantity ?? 1;

  const rows: ParsedRow[] = [];
  let matched = 0;
  let needsConfirm = 0;
  let notFoundCount = 0;

  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // Bo qua dong tieu de Excel, khong phan biet dau/hoa thuong.
    if (HEADERS.has(removeAccents(normalize(line)))) continue;

    // Mac dinh (2 modal kho): chi boc TEN SAN PHAM, bo qua moi con so so
    // luong trong dong. Rieng bao ban nhanh ky gui thi giu so luong.
    const { name, quantity: parsedQty } = splitNameAndQuantity(line);
    if (!name) continue;
    const quantity = opts?.parseQuantity ? (parsedQty ?? defaultQuantity) : defaultQuantity;

    const scored: ScoredCandidate[] = [];
    for (const b of books) {
      const score = scoreCandidate(name, b.title);
      if (score >= 60) scored.push({ id: b.id, title: b.title, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 3);
    const best = top[0];
    const second = top[1];

    if (
      best &&
      (best.score === 100 ||
        (best.score >= 84 && (!second || best.score - second.score >= 10)) ||
        (best.score >= 70 && (!second || best.score - second.score >= 20)))
    ) {
      matched++;
      rows.push({
        status: 'matched',
        line,
        editionId: best.id,
        title: best.title,
        quantity,
        score: best.score,
      });
    } else if (best) {
      needsConfirm++;
      rows.push({ status: 'needs_confirm', line, quantity, candidates: top });
    } else {
      notFoundCount++;
      rows.push({ status: 'not_found', line, quantity });
    }
  }

  return { rows, summary: { matched, needsConfirm, notFound: notFoundCount } };
}

/** Dong tieu de copy kem du lieu. Luu dang khong dau; luc so sanh dung
 *  removeAccents() nen bat duoc moi bien the co/khong dau, hoa/thuong. */
const HEADERS = new Set([
  'stt',
  'ten',
  'ten sach',
  'so luong',
  'soluong',
  'title',
  'quantity',
  'ma sach',
  'masach',
  'isbn',
]);

/** Collapse whitespace, trim, drop straight/curly double quotes anywhere. */
const normalize = (s: string) => s.replace(/["\u201c\u201d]/g, '').replace(/\s+/g, ' ').trim();

/** Chuan hoa de so sanh: thuong, khong dau, chi giu chu/so/khoang trang. */
const norm = (s: string) =>
  removeAccents(s).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Tach 1 dong dan thanh {ten san pham, so luong}. So luong duoc boc tu:
 * - "Ten sach \t 5" / "Ten sach, 5" / "Ten sach; 5" -> 5
 * - "Ten sach 5" (so dung cuoi dong) -> 5
 * Ten luon duoc lam sach: bo danh so dau dong ("1. ", "1) ", "1 - ").
 * Giu nguyen so nam trong ten ("1984" van la "1984", quantity null).
 */
function splitNameAndQuantity(rawLine: string): { name: string; quantity: number | null } {
  let s = normalize(rawLine);
  let quantity: number | null = null;
  const parts = s.split(/[\t;,]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1])) {
    const q = Number(parts[parts.length - 1]);
    if (q >= 1) {
      quantity = q;
      s = parts.slice(0, -1).join(' ');
    }
  }
  // Bo danh so dau dong: "1. ", "1) ", "1 - ", "1: "
  s = s.replace(/^\d+\s*[.)\-:]\s*/, '');
  // So luong cuoi dong dang "Ten sach 5". Giu lai neu phan con lai rong.
  if (quantity === null) {
    const m = s.match(/^(.*\S)\s+(\d+)$/);
    if (m && m[1].trim() && Number(m[2]) >= 1) {
      quantity = Number(m[2]);
      s = m[1].trim();
    }
  }
  return { name: s, quantity };
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let cur0 = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const next = Math.min(prev[j] + 1, cur0 + 1, prev[j - 1] + cost);
      prev[j - 1] = cur0;
      cur0 = next;
    }
    prev[b.length] = cur0;
  }
  return prev[b.length];
}

/**
 * Diem fuzzy 0-100 cho cap (ten dan, ten sach):
 * 100 khop tuyet doi | 92 ten sach bat dau bang cum dan | 88 cum dan chua
 * tron ten sach | 86 viet tat (tghls) | 82 moi tu cua cum dan deu co trong
 * ten sach | 41-75 theo khoang cach Levenshtein | 68 khop ngu am.
 */
function scoreCandidate(query: string, title: string): number {
  const q = norm(query);
  const t = norm(title);
  if (!q || !t) return 0;
  if (q === t) return 100;
  if (q.length >= 3 && t.startsWith(q)) return 92;
  if (t.length >= 4 && q.includes(t)) return 88;
  if (matchesAcronym(title, query)) return 86;
  const qTokens = q.split(' ');
  const tTokens = t.split(' ');
  if (qTokens.every((tok) => tTokens.some((tt) => tt === tok || tt.startsWith(tok)))) return 82;
  const maxLen = Math.max(q.length, t.length);
  const sim = 1 - levenshtein(q, t) / maxLen;
  if (sim >= 0.55) return Math.round(sim * 75);
  const pq = phoneticSimplify(query);
  const pt = phoneticSimplify(title);
  if (pq.length >= 4 && pt.includes(pq)) return 68;
  return 0;
}
