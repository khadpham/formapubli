import * as XLSX from 'xlsx';
import { eq, and, desc } from 'drizzle-orm';
import { db, bankStatements, bankStatementMatches, orders, customers } from '@/db';
import { generateUUIDv7 } from '@/lib/uuidv7';
import { AppError } from './app-error';

/**
 * Doi soat sao ke ngan hang MB Bank tu dong.
 *
 * File xlsx, sheet "Thong tin giao dich". Doc cot theo TEN header (khong cung
 * vi tri cot) de file doi mau van chay. Ma don tim bang regex ORD day du
 * (ORD + YYMMDD + base36 4 ky tu) - regex `ORD\d+` cat mat hau to base36.
 */

export interface ParsedStatementRow {
  ngayGiaoDich: string; // YYYY-MM-DD
  ngayHachToan: string;
  phatSinhNo: number;
  phatSinhCo: number;
  soDu: number | null;
  donVi: string;
  noiDung: string;
  butToan: string;
}

export const ORDER_CODE_RE = /ORD\d{6}[0-9A-Z]{4}/;
const AMOUNT_TOLERANCE = 1000;

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = `${v ?? ''}`.replace(/[.\s]/g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// Excel serial (ngay 1900) hoac chuoi dd/mm/yyyy, yyyy-mm-dd.
function toISODate(v: unknown): string {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const ms = Math.round((v - 25569) * 86400 * 1000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = `${v ?? ''}`.trim().slice(0, 10);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
  return '';
}

export function parseMbStatement(buf: Buffer): ParsedStatementRow[] {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const ws = wb.Sheets['Thông tin giao dịch'] ?? wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('File khong co sheet nao.');
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' }) as unknown[][];

  // Tim dong header chua "BUT TOAN" (dau bang that, bo dong tieu de file).
  const norm = (s: unknown) =>
    `${s ?? ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toUpperCase().replace(/\s+/g, ' ').trim();
  const hi = grid.findIndex((r) => r.some((c) => norm(c).includes('BUT TOAN')));
  if (hi < 0) throw new Error('Khong tim thay dong tieu de (thieu cot BUT TOAN).');
  const heads = grid[hi].map(norm);
  const col = (...names: string[]) => heads.findIndex((h) => names.some((n) => h.includes(n)));
  const cDate = col('NGAY GIAO DICH');
  const cBook = col('NGAY HACH TOAN');
  const cNo = col('PHAT SINH NO');
  const cCo = col('PHAT SINH CO');
  const cBal = col('SO DU');
  const cUnit = col('DON VI');
  const cNote = col('NOI DUNG');
  const cRef = col('BUT TOAN');
  if (cDate < 0 || cCo < 0 || cRef < 0) throw new Error('Thieu cot bat buoc (NGAY GIAO DICH / PHAT SINH CO / BUT TOAN).');

  const rows: ParsedStatementRow[] = [];
  for (const r of grid.slice(hi + 1)) {
    const butToan = `${r[cRef] ?? ''}`.trim();
    if (!butToan) continue; // dong trang / dong tong
    rows.push({
      ngayGiaoDich: toISODate(r[cDate]),
      ngayHachToan: cBook >= 0 ? toISODate(r[cBook]) : '',
      phatSinhNo: cNo >= 0 ? num(r[cNo]) : 0,
      phatSinhCo: num(r[cCo]),
      soDu: cBal >= 0 && `${r[cBal]}`.trim() !== '' ? num(r[cBal]) : null,
      donVi: `${r[cUnit] ?? ''}`.trim().slice(0, 200),
      noiDung: `${r[cNote] ?? ''}`.trim().slice(0, 500),
      butToan: butToan.slice(0, 100),
    });
  }
  return rows;
}

export function extractOrderCode(noiDung: string): string | null {
  return ORDER_CODE_RE.exec(`${noiDung || ''}`.toUpperCase())?.[0] ?? null;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  high: number;
  medium: number;
  low: number;
  unprocessed: number;
}

export async function importStatements(rows: ParsedStatementRow[], actorId?: string): Promise<ImportResult> {
  const res: ImportResult = { imported: 0, skipped: 0, high: 0, medium: 0, low: 0, unprocessed: 0 };
  for (const r of rows) {
    if (!r.butToan || !r.ngayGiaoDich) { res.skipped++; continue; }
    const id = `bs-${generateUUIDv7()}`;
    try {
      await db.insert(bankStatements).values({
        id,
        ngayGiaoDich: r.ngayGiaoDich,
        ngayHachToan: r.ngayHachToan || null,
        phatSinhNo: r.phatSinhNo,
        phatSinhCo: r.phatSinhCo,
        soDu: r.soDu,
        donVi: r.donVi || null,
        noiDung: r.noiDung || null,
        butToan: r.butToan,
      });
      res.imported++;
    } catch {
      res.skipped++; // but_toan trung = da import truoc do
      continue;
    }
    const level = await autoMatch(id, r, actorId);
    if (level === 'HIGH') res.high++;
    else if (level === 'MEDIUM') res.medium++;
    else if (level === 'LOW') res.low++;
    else res.unprocessed++;
  }
  return res;
}

// Tra ve confidence da match, hoac null neu khong match gi.
async function autoMatch(statementId: string, r: ParsedStatementRow, actorId?: string): Promise<string | null> {
  // Chi dong TIEN VAO moi khop don (tien ra la chi hoat dong, ke toan xu ly tay).
  if (r.phatSinhCo <= 0) return null;

  const save = async (orderId: string, confidence: string, note: string) => {
    await db.insert(bankStatementMatches).values({
      id: `bsm-${generateUUIDv7()}`,
      statementId,
      orderId,
      matchType: 'AUTO',
      confidence,
      matchedBy: actorId ?? null,
      note,
    });
  };

  // 1. Ma don trong noi dung.
  const code = extractOrderCode(r.noiDung);
  if (code) {
    const ord = (await db.select().from(orders).where(eq(orders.orderCode, code)).limit(1))[0];
    if (ord) {
      const diff = Math.abs(Number(ord.finalAmount || 0) - r.phatSinhCo);
      if (diff < AMOUNT_TOLERANCE) {
        await save(ord.id, 'HIGH', `Ma + tien khop (lech ${Math.round(diff)}d)`);
        await db.update(orders).set({ codStatus: 'RECEIVED' }).where(eq(orders.id, ord.id));
        return 'HIGH';
      }
      await save(ord.id, 'MEDIUM', `Ma khop, tien lech ${Math.round(diff)}d (don ${Math.round(Number(ord.finalAmount || 0))}d, ve ${Math.round(r.phatSinhCo)}d)`);
      return 'MEDIUM';
    }
    // Ma co nhung khong thay don: dem LOW de dua vao review, KHONG luu dong
    // match ao (giu FK sach). UI goi y lai ma tu noi_dung khi hien.
    return 'LOW';
  }

  // 2. Khong co ma: thu theo SDT trong noi dung/don vi -> don ONLINE moi nhat chua thu.
  const phone = /(\d{9,11})/.exec(`${r.noiDung} ${r.donVi}`)?.[1];
  if (phone) {
    const cust = (await db.select({ id: customers.id }).from(customers).where(eq(customers.phone, phone)).limit(1))[0]
      ?? (await db.select({ id: customers.id }).from(customers).where(eq(customers.phone, `0${phone}`)).limit(1))[0];
    if (cust) {
      const ord = (
        await db
          .select()
          .from(orders)
          .where(and(eq(orders.customerId, cust.id), eq(orders.codStatus, 'NONE')))
          .orderBy(desc(orders.createdAt))
          .limit(5)
      ).find((o) => Math.abs(Number(o.finalAmount || 0) - r.phatSinhCo) < AMOUNT_TOLERANCE);
      if (ord) {
        await save(ord.id, 'LOW', `Khop SDT ${phone} + tien khop (khong co ma don)`);
        return 'LOW';
      }
    }
  }
  return null;
}

/**
 * Ke toan xac nhan dong review: chap nhan goi y AUTO hoac gan tay orderCode.
 * Match chuyen MANUAL + matched_by. Don duoc xac nhan danh dau RECEIVED.
 */
export async function confirmMatch(statementId: string, orderCodeOrId: string | null, actorId?: string) {
  const st = (await db.select().from(bankStatements).where(eq(bankStatements.id, statementId)).limit(1))[0];
  if (!st) throw AppError.invalid('Khong thay dong sao ke.');
  const prev = (await db.select().from(bankStatementMatches).where(eq(bankStatementMatches.statementId, statementId)).limit(1))[0];
  const key = `${orderCodeOrId || ''}`.trim() || prev?.orderId;
  if (!key) throw AppError.invalid('Chua co don de xac nhan - nhap ma don gan tay.');
  // Nhan ca order_id (goi noi bo) lan order_code (goi tu UI nhap tay).
  const ord =
    (await db.select().from(orders).where(eq(orders.id, key)).limit(1))[0] ||
    (await db.select().from(orders).where(eq(orders.orderCode, key.toUpperCase())).limit(1))[0];
  if (!ord) throw AppError.invalid('Don gan khong ton tai.');
  const targetOrderId = ord.id;
  if (prev) {
    await db
      .update(bankStatementMatches)
      .set({
        orderId: targetOrderId,
        matchType: 'MANUAL',
        confidence: 'HIGH',
        matchedBy: actorId ?? null,
        note: targetOrderId !== prev.orderId ? 'Gan tay lai don' : prev.note,
      })
      .where(eq(bankStatementMatches.id, prev.id));
  } else {
    await db.insert(bankStatementMatches).values({
      id: `bsm-${generateUUIDv7()}`,
      statementId,
      orderId: targetOrderId,
      matchType: 'MANUAL',
      confidence: 'HIGH',
      matchedBy: actorId ?? null,
      note: 'Xac nhan tay',
    });
  }
  await db.update(orders).set({ codStatus: 'RECEIVED' }).where(eq(orders.id, targetOrderId));
  return { statementId, orderId: targetOrderId, orderCode: ord.orderCode };
}

/** Bo qua dong review: xoa match (neu co), dong ve CHUA_XU_LY. Don giu nguyen. */
export async function skipStatement(statementId: string) {
  await db.delete(bankStatementMatches).where(eq(bankStatementMatches.statementId, statementId));
  return { statementId, status: 'UNPROCESSED' };
}
