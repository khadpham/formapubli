import { removeAccents } from './vietnamese';

/**
 * Bước 1 — Trợ lý Lên đơn Nhanh (Smart Paste / Quick Order Parser).
 * Thuần function (0 dependency, 0 schema) để unit-test dễ dàng.
 * Fail-safe: thứ gì không chắc → warnings để nhân viên xác nhận tay, không đoán bừa.
 */

export interface CatalogRef {
  editionId: string;
  code: string;
  title: string;
  author?: string | null;
}

export interface ParsedItem {
  editionId: string;
  code: string;
  title: string;
  quantity: number;
}

export interface SmartParseResult {
  phone?: string;
  address?: string;
  customerName?: string;
  items: ParsedItem[];
  warnings: string[];
  rawChat: string;
}

const PHONE_RE = /(?:\+84|0)(3|5|7|8|9)\d{8}\b/;
const ADDRESS_KEYWORDS = ['địa chỉ', 'dia chi', 'đến', 'den', 'gửi', 'gui', 'giao', 'ship', 'tới', 'toi'];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('84') && digits.length === 11) return '0' + digits.slice(2);
  return digits;
}

/** Tìm số lượng đứng gần vị trí nhắc tên sách (trước tối đa 16 ký tự, hoặc dạng xN sau). */
function guessQuantity(normText: string, matchIdx: number, matchLen: number): number {
  const before = normText.slice(Math.max(0, matchIdx - 16), matchIdx);
  const mBefore = before.match(/(\d+)\s*(cuon|cuốn|quyen|quyển|q|c|ban|bản|x)?\s*$/i);
  if (mBefore) {
    const n = parseInt(mBefore[1], 10);
    if (n > 0 && n <= 999) return n;
  }
  const after = normText.slice(matchIdx + matchLen, matchIdx + matchLen + 6);
  const mAfter = after.match(/^\s*x\s*(\d+)/i);
  if (mAfter) {
    const n = parseInt(mAfter[1], 10);
    if (n > 0 && n <= 999) return n;
  }
  return 1;
}

export function parseSmartOrder(chat: string, catalog: CatalogRef[]): SmartParseResult {
  const rawChat = (chat || '').trim();
  const warnings: string[] = [];
  const result: SmartParseResult = { items: [], warnings, rawChat };

  if (!rawChat) {
    warnings.push('Chưa dán nội dung chat.');
    return result;
  }

  // 1. SĐT Việt Nam (ưu tiên số đầu tiên)
  const phoneMatch = rawChat.match(PHONE_RE);
  if (phoneMatch) {
    result.phone = normalizePhone(phoneMatch[0]);
  } else {
    warnings.push('Không tách được SĐT — kiểm tra lại đoạn chat.');
  }

  // 2. Địa chỉ: dòng chứa từ khóa giao/nhận (lấy đoạn dài nhất)
  const lines = rawChat.split(/\n|;/).map((l) => l.trim()).filter(Boolean);
  let bestAddr = '';
  for (const line of lines) {
    const low = removeAccents(line.toLowerCase());
    const kwIdx = ADDRESS_KEYWORDS.map((k) => low.indexOf(k)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
    if (kwIdx === undefined) continue;
    let addr = line.slice(kwIdx).replace(/^[^:]*:\s*/, '');
    // Cắt SĐT ra khỏi địa chỉ để 2 trường sạch
    if (phoneMatch) addr = addr.replace(phoneMatch[0], '').trim();
    addr = addr.replace(/[,.\s]+$/, '').trim();
    if (addr.length > bestAddr.length) bestAddr = addr;
  }
  if (bestAddr) {
    result.address = bestAddr;
  } else {
    warnings.push('Không tách được địa chỉ — nhập tay giúp.');
  }

  // 3. Tên khách: chỉ nhận khi ghi rõ "tên (là) X" / "mình là X"
  const nameMatch = rawChat.match(/(?:tên|ten)\s+(?:là\s+)?([A-Za-zÀ-ỹ][A-Za-zÀ-ỹ ]{1,30})/i) ||
    rawChat.match(/(?:mình|em|anh|chị|chi|tôi|toi)\s+là\s+([A-Za-zÀ-ỹ][A-Za-zÀ-ỹ ]{1,30})/i);
  if (nameMatch) {
    result.customerName = nameMatch[1].split(/[,.\d]/)[0].trim();
  } else {
    warnings.push('Chưa rõ tên khách — nhập tay hoặc để "Khách FB".');
  }

  // 4. Sách: dò tên không dấu trong chat, số lượng theo số đứng gần nhất
  const normText = removeAccents(rawChat.toLowerCase());
  const merged = new Map<string, ParsedItem>();
  for (const book of catalog) {
    const normTitle = removeAccents((book.title || '').toLowerCase()).trim();
    if (!normTitle || normTitle.length < 4) continue;
    let idx = -1;
    if (normTitle.length >= 8) {
      idx = normText.indexOf(normTitle);
    } else {
      const m = normText.match(new RegExp(`(^|[^a-z0-9])${escapeRegExp(normTitle)}([^a-z0-9]|$)`, 'i'));
      idx = m && m.index !== undefined ? m.index + m[1].length : -1;
    }
    if (idx < 0) continue;
    const qty = guessQuantity(normText, idx, normTitle.length);
    const cur = merged.get(book.editionId);
    if (cur) cur.quantity += qty;
    else merged.set(book.editionId, { editionId: book.editionId, code: book.code, title: book.title, quantity: qty });
  }
  result.items = Array.from(merged.values());
  if (result.items.length === 0) {
    warnings.push('Không nhận diện được tên sách nào — chọn tay trong danh mục.');
  }

  // 5. Số lẻ không gắn được với sách nào → cảnh báo (trừ SĐT đã tách)
  const textNoPhone = phoneMatch ? rawChat.replace(phoneMatch[0], ' ') : rawChat;
  const strayNums = textNoPhone.match(/\b\d{2,}\b/g) || [];
  if (strayNums.length > 0 && result.items.every((it) => it.quantity === 1)) {
    warnings.push(`Có con số chưa rõ nghĩa (${strayNums.slice(0, 3).join(', ')}) — kiểm tra số lượng.`);
  }

  return result;
}

/** Dựng note chuẩn cho đơn FB: giữ raw chat phục vụ đối soát khiếu nại. */
export function buildFbNote(rawChat: string, extra?: string): string {
  const clean = (rawChat || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  return [`[FB]`, `[RAW_CHAT: ${clean}]`, extra?.trim()].filter((s) => s && s.trim()).join(' ');
}
