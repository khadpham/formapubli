import { removeAccents, matchesAcronym } from './vietnamese';

export type ParseLookupBook = { id: string; title: string; code?: string | null; isbnLast4?: string | null };
export type MatchCandidate = { id: string; title: string };
export type ParsedRow =
  | { status: 'matched'; id: string; line: string; editionId: string; title: string; quantity: number }
  | { status: 'needs_confirm'; id: string; line: string; quantity: number; candidates: MatchCandidate[] }
  | { status: 'not_found'; id: string; line: string; quantity: number };

type BookEntry = ParseLookupBook & { tTokens: string[] };

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
  const entries: BookEntry[] = books.map((b) => ({
    ...b,
    tTokens: norm(b.title).split(' ').filter(Boolean),
  }));

  const rows: ParsedRow[] = [];
  let rowSeq = 0;
  const nid = () => `r${rowSeq++}`;
  let matched = 0;
  let needsConfirm = 0;
  let notFoundCount = 0;
  const push = (r: ParsedRow) => {
    rows.push(r);
    if (r.status === 'matched') matched++;
    else if (r.status === 'needs_confirm') needsConfirm++;
    else notFoundCount++;
  };

  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // Bo qua dong tieu de Excel, khong phan biet dau/hoa thuong.
    if (HEADERS.has(removeAccents(normalize(line)))) continue;
    // Tach theo dau phay truoc; moi doan co the chua nhieu ten sach cach nhau
    // bang dau cach (vd "quai vat paris chau au chuyen di").
    for (const rawSeg of line.split(',')) {
      const seg = rawSeg.trim();
      if (!seg) continue;
      // Bo so thu tu dau doan ("1.", "1)"); bo qua doan chi la con so (so luong le).
      const segClean = seg.replace(/^\d+\s*[.)\-:]\s*/, '').trim();
      if (!segClean) continue;

      let qty = defaultQuantity;
      let textForMatch = segClean;
      if (opts?.parseQuantity) {
        // Bao ban nhanh ky gui: so luong = so da ban, van boc tu dong.
        const sq = splitNameAndQuantity(segClean);
        if (!sq.name) continue;
        textForMatch = sq.name;
        if (sq.quantity !== null) qty = sq.quantity;
      }
      for (const r of matchSegment(textForMatch, entries, qty, nid)) push(r);
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
 * Tach 1 doan thanh {ten, so luong} - chi dung cho che do parseQuantity
 * (bao ban nhanh ky gui). "Ten sach \t 5" / "Ten sach, 5" / "Ten sach 5" -> 5.
 * Giu nguyen so nam trong ten ("1984" -> quantity null).
 */
function splitNameAndQuantity(rawSeg: string): { name: string; quantity: number | null } {
  let s = normalize(rawSeg);
  let quantity: number | null = null;
  const parts = s.split(/[\t;,]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1])) {
    const q = Number(parts[parts.length - 1]);
    if (q >= 1) {
      quantity = q;
      s = parts.slice(0, -1).join(' ');
    }
  }
  s = s.replace(/^\d+\s*[.)\-:]\s*/, '');
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

/** Khop 1 token: khop tuyet doi, hoac sai chinh ta nhe (tu dai >= 4 ky tu). */
function tokenMatch(q: string, t: string): boolean {
  if (q === t) return true;
  if (q.length >= 4 && t.length >= 4 && levenshtein(q, t) <= 1) return true;
  return false;
}

type Found =
  | { kind: 'one'; book: BookEntry; length: number }
  | { kind: 'ambiguous'; candidates: BookEntry[]; length: number }
  | null;

/**
 * Tim sach khop dai nhat tai vi tri i (greedy, trai sang phai).
 * - L = so token lien tiep dai nhat cua doan khop trong ten sach.
 * - Uu tien khop tuyet doi tron ten (vd "benh tuong" -> "Benh tuong", khong
 *   phai "Benh tuong tuong").
 * - Hoa dung 2 ung vien: chon TEN DAI HON (xac dinh, vd "paris" -> ban Tai ban).
 * - Hoa tu 3 ung vien tro len: hoi xac nhan.
 */
function findBestAt(
  tokens: string[],
  i: number,
  books: BookEntry[],
  usedIds: Set<string>
): Found {
  let bestL = 0;
  let cands: { book: BookEntry; exact: boolean }[] = [];
  for (const b of books) {
    if (usedIds.has(b.id)) continue;
    const t = b.tTokens;
    if (t.length === 0) continue;
    let maxL = 0;
    for (let p = 0; p < t.length; p++) {
      let l = 0;
      while (i + l < tokens.length && p + l < t.length && tokenMatch(tokens[i + l], t[p + l])) l++;
      if (l > maxL) maxL = l;
    }
    if (maxL === 0) continue;
    // Khop tuyet doi tron ten: toan bo token cua ten sach khop chinh xac.
    let exact = false;
    if (maxL === t.length && i + t.length <= tokens.length) {
      exact = t.every((tt, k) => tokens[i + k] === tt);
    }
    if (maxL > bestL) {
      bestL = maxL;
      cands = [{ book: b, exact }];
    } else if (maxL === bestL) {
      cands.push({ book: b, exact });
    }
  }
  if (bestL === 0) return null;
  const exactOnes = cands.filter((c) => c.exact);
  if (exactOnes.length === 1) return { kind: 'one', book: exactOnes[0].book, length: bestL };
  if (exactOnes.length > 1) {
    return { kind: 'ambiguous', candidates: exactOnes.map((c) => c.book), length: bestL };
  }
  if (cands.length === 1) return { kind: 'one', book: cands[0].book, length: bestL };
  if (cands.length === 2) {
    const lenA = cands[0].book.tTokens.join(' ').length;
    const lenB = cands[1].book.tTokens.join(' ').length;
    if (lenA !== lenB) {
      const winner = lenA > lenB ? cands[0].book : cands[1].book;
      return { kind: 'one', book: winner, length: bestL };
    }
  }
  return { kind: 'ambiguous', candidates: cands.map((c) => c.book), length: bestL };
}

/**
 * Khop 1 doan van ban: greedy tim ten sach khop dai nhat, het doan thi thoi.
 * Token thua (so luong, tu thua nhu "Bia trang") tu dong bi bo qua.
 * Ve mang row; neu doan khong khop gi thi thu viet tat, cuoi cung la not_found.
 */
function matchSegment(
  segText: string,
  books: BookEntry[],
  quantity: number,
  nid: () => string
): ParsedRow[] {
  const trimmed = segText.trim();
  // Doan chi la con so: neu trung ten sach (vd "1984") thi nhan, nguoc lai bo
  // qua lang (do la so luong le, khong phai ten sach).
  if (/^\d+$/.test(trimmed)) {
    const hit = books.find((b) => norm(b.title) === norm(trimmed));
    if (!hit) return [];
    return [{ status: 'matched', id: nid(), line: segText, editionId: hit.id, title: hit.title, quantity }];
  }
  const tokens = norm(segText).split(' ').filter(Boolean);
  if (tokens.length === 0) return [];
  const rows: ParsedRow[] = [];
  const usedIds = new Set<string>(); // 1 doan khong khop trung 1 sach 2 lan
  let i = 0;
  let produced = false;
  while (i < tokens.length) {
    const found = findBestAt(tokens, i, books, usedIds);
    if (!found) {
      i++;
      continue;
    }
    produced = true;
    if (found.kind === 'ambiguous') {
      const list = found.candidates.slice(0, 3);
      rows.push({
        status: 'needs_confirm',
        id: nid(),
        line: segText,
        quantity,
        candidates: list.map((c) => ({ id: c.id, title: c.title })),
      });
      for (const c of list) usedIds.add(c.id);
    } else {
      rows.push({
        status: 'matched',
        id: nid(),
        line: segText,
        editionId: found.book.id,
        title: found.book.title,
        quantity,
      });
      usedIds.add(found.book.id);
    }
    i += found.length;
  }
  if (!produced) {
    // Viet tat kieu "tghls" -> "Truong gia hoc lam sang".
    const ac = books.filter((b) => matchesAcronym(b.title, segText));
    if (ac.length === 1) {
      rows.push({ status: 'matched', id: nid(), line: segText, editionId: ac[0].id, title: ac[0].title, quantity });
    } else if (ac.length > 1) {
      rows.push({
        status: 'needs_confirm', id: nid(), line: segText, quantity,
        candidates: ac.slice(0, 3).map((c) => ({ id: c.id, title: c.title })),
      });
    } else {
      rows.push({ status: 'not_found', id: nid(), line: segText, quantity });
    }
  }
  return rows;
}
