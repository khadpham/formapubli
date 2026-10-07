import { db, partners } from '../src/db';
import { eq } from 'drizzle-orm';

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
}

/** Parse CSV tôn trọng ô ngoặc kép (kể cả xuống dòng trong ô). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const clean = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c === '\r') { /* bỏ */ }
    else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

function slugName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'dai-ly';
}

function parseCompanyInfo(info: string): { taxCode: string | null; phone: string | null; email: string | null; address: string | null } {
  const out = { taxCode: null as string | null, phone: null as string | null, email: null as string | null, address: null as string | null };
  const text = `${info || ''}`;
  // Chuẩn hóa nhãn ngoặc trước khi tách: "(Tax code)"/"(Address)" là một
  // phần của nhãn; ngoặc còn lại là ghi chú (vd "(Địa chỉ có thể thay đổi
  // mỗi lần đặt)") phải lược, không được ăn vào địa chỉ.
  const work = text
    .replace(/\(Tax code\)/gi, 'Taxcode')
    .replace(/\(Address\)/gi, 'Address')
    .replace(/\(Company's name\)/gi, ' ');
  // MST: nhãn Việt "MST:" hoặc Anh "Mã số thuế Taxcode:".
  const mst = work.match(/(?:MST|Mã số thuế(?:\s*Taxcode)?)\s*:?\s*([0-9][0-9\-\s]{8,16})/);
  if (mst) {
    const digits = mst[1].replace(/\D/g, '');
    if (digits.length === 10 || digits.length === 13) out.taxCode = digits;
  }
  // SĐT: nhãn "Sđt/Điện thoại/ĐT/Tel:" HOẶC số đứng đầu ô (kiểu "0937841998 - địa chỉ...").
  const phoneLbl = work.match(/(?:Sđt|SĐT|Điện thoại|ĐT|Tel)\s*:?\s*([0-9][0-9.\s]{7,14})/);
  let rest = work;
  if (phoneLbl) {
    const digits = phoneLbl[1].replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 12) out.phone = digits;
    rest = rest.replace(phoneLbl[0], ' ');
  } else {
    const lead = work.match(/^\s*([0-9]{9,11})\s*[-–—]\s*/);
    if (lead) {
      out.phone = lead[1];
      rest = rest.replace(lead[0], ' ');
    }
  }
  // Email: bắt mẫu trần ở bất cứ đâu trong ô.
  const email = work.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (email) {
    out.email = email[0];
    rest = rest.replace(email[0], ' ');
  }
  // Địa chỉ: nhãn "Địa chỉ Address:" tới nhãn tiếp theo (nhãn trong ngoặc
  // như "(Địa chỉ có thể thay đổi...)" là ghi chú, không phải nhãn).
  // Không nhãn thì lấy phần còn lại sau khi đã trừ SĐT/email/ghi chú ngoặc.
  const addrLbl = rest.match(/(?<!\()(?:Địa chỉ(?:\s*Address)?)\s*:?\s*([\s\S]+?)(?=(?:Sđt|SĐT|Điện thoại|ĐT|Tel|Email|FB|Mã số thuế|Taxcode|Tên đơn vị|$))/);
  let addr = addrLbl ? addrLbl[1] : rest;
  addr = addr
    .replace(/Tên đơn vị\s*:?/gi, ' ')
    .replace(/Mã số thuế\s*Taxcode\s*:?/gi, ' ')
    .replace(/Taxcode\s*:?/gi, ' ')
    .replace(/Address\s*:?/gi, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[,\-–—:;.\s]+|[,\-–—:;.\s]+$/g, '')
    .trim();
  out.address = addr || null;
  return out;
}

/**
 * Import đại lý từ CSV (cột C/D/E/G). Idempotent theo `code`:
 * đã có thì update, chưa có thì tạo. Không commit file CSV thật.
 */
export async function importPartners(csvText: string, txOrDb: any = db): Promise<ImportResult> {
  const rows = parseCsv(csvText);
  if (rows.length === 0) return { created: 0, updated: 0, skipped: 0 };
  const header = rows[0].map((h) => h.trim());
  const ci = (name: string) => header.indexOf(name);
  // Cột C/D/E/G theo header thật (không đoán vị trí cứng).
  const iType = ci('Type'), iName = ci('Đại Lý'), iInfo = ci('Thông tin công ty'), iCk = ci('% ck');
  if (iType < 0 || iName < 0 || iInfo < 0 || iCk < 0) {
    throw new Error('CSV thiếu một trong các cột: Type, Đại Lý, Thông tin công ty, % ck.');
  }
  const res: ImportResult = { created: 0, updated: 0, skipped: 0 };
  const usedCodes = new Set<string>();
  for (const r of rows.slice(1)) {
    const typeRaw = (r[iType] || '').trim();
    const name = (r[iName] || '').trim();
    if (!typeRaw || !name) { res.skipped++; continue; } // dòng tổng / dòng trống
    const type = /ký gửi/i.test(typeRaw) ? 'CONSIGNMENT' : /bán đứt|mua đứt/i.test(typeRaw) ? 'WHOLESALE' : null;
    if (!type) { res.skipped++; continue; }
    const ckNum = Number((r[iCk] || '').replace(/[^0-9.]/g, ''));
    const discountRate = Number.isFinite(ckNum) && ckNum >= 0 && ckNum < 100 ? ckNum / 100 : 0;
    const info = parseCompanyInfo(r[iInfo] || '');
    let code = 'DL-' + slugName(name).toUpperCase();
    let n = 2;
    while (usedCodes.has(code)) code = 'DL-' + slugName(name).toUpperCase() + '-' + n++;
    usedCodes.add(code);
    const existing = await txOrDb.select({ id: partners.id }).from(partners).where(eq(partners.code, code)).limit(1);
    const values = {
      name, type, discountRate,
      address: info.address, phone: info.phone, email: info.email, taxCode: info.taxCode,
      contactInfo: (r[iInfo] || '').slice(0, 500) || null,
    };
    if (existing.length > 0) {
      await txOrDb.update(partners).set(values).where(eq(partners.code, code));
      res.updated++;
    } else {
      await txOrDb.insert(partners).values({ id: `part-${Date.now().toString(36)}-${res.created}`, code, ...values });
      res.created++;
    }
  }
  return res;
}
