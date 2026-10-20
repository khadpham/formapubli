import * as XLSX from 'xlsx';
import { eq } from 'drizzle-orm';
import { db, spxSettlements, spxSettlementMatches, orders } from '@/db';
import { generateUUIDv7 } from '@/lib/uuidv7';
import { AppError } from './app-error';

/**
 * Doi soat bao cao tai chinh SPX tu dong.
 *
 * File xlsx bao cao SPX. Doc cot theo TEN header (khong cung vi tri).
 * Match ma_van_don voi orders.tracking_code, kiem tra 3 diem: COD thu ho
 * vs cod_amount, phi van chuyen vs phi du kien, so tien dieu chinh.
 */

export interface ParsedSpxRow {
  maVanDon: string;
  trangThai: string;
  tienThuHo: number;
  tongPhi: number;
  phiGiaoHang: number;
  phiBaoHiem: number;
  phiHoanHang: number;
  soTienDieuChinh: number;
  lyDoDieuChinh: string;
  tongTienVe: number;
}

const MONEY_TOLERANCE = 1000;
// Phi thuc te lech qua nguong nay so voi phi du kien (orders.shipping_fee)
// thi danh dau bat thuong de ke toan xem.
const FEE_ANOMALY_THRESHOLD = 10000;

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = `${v ?? ''}`.replace(/[.\s]/g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function parseSpxReport(buf: Buffer): ParsedSpxRow[] {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('File khong co sheet nao.');
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' }) as unknown[][];

  const norm = (s: unknown) =>
    `${s ?? ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toUpperCase().replace(/\s+/g, ' ').trim();
  // Dong header la dong dau tien chua "VAN DON" (ma hoac trang thai).
  const hi = grid.findIndex((r) => r.some((c) => norm(c).includes('VAN DON')));
  if (hi < 0) throw new Error('Khong tim thay dong tieu de (thieu cot VAN DON).');
  const heads = grid[hi].map(norm);
  const col = (...names: string[]) => heads.findIndex((h) => names.some((n) => h.includes(n)));
  const cTrack = col('MA VAN DON', 'MAVANDON', 'TRACKING');
  const cStatus = col('TRANG THAI');
  const cCod = col('THU HO', 'COD');
  const cFee = col('TONG PHI', 'PHI PHAI TRA');
  const cShip = col('PHI GIAO HANG', 'PHI VAN CHUYEN');
  const cIns = col('BAO HIEM');
  const cRet = col('HOAN HANG', 'HOAN');
  const cAdj = col('DIEU CHINH');
  const cReason = col('LY DO');
  const cTotal = col('SO DU', 'TONG TIEN VE', 'THUC NHAN');
  if (cTrack < 0) throw new Error('Thieu cot MA VAN DON.');

  const rows: ParsedSpxRow[] = [];
  for (const r of grid.slice(hi + 1)) {
    const maVanDon = `${r[cTrack] ?? ''}`.trim();
    if (!maVanDon) continue;
    rows.push({
      maVanDon: maVanDon.slice(0, 100),
      trangThai: cStatus >= 0 ? `${r[cStatus] ?? ''}`.trim().slice(0, 100) : '',
      tienThuHo: cCod >= 0 ? num(r[cCod]) : 0,
      tongPhi: cFee >= 0 ? num(r[cFee]) : 0,
      phiGiaoHang: cShip >= 0 ? num(r[cShip]) : 0,
      phiBaoHiem: cIns >= 0 ? num(r[cIns]) : 0,
      phiHoanHang: cRet >= 0 ? num(r[cRet]) : 0,
      soTienDieuChinh: cAdj >= 0 ? num(r[cAdj]) : 0,
      lyDoDieuChinh: cReason >= 0 ? `${r[cReason] ?? ''}`.trim().slice(0, 300) : '',
      tongTienVe: cTotal >= 0 ? num(r[cTotal]) : 0,
    });
  }
  return rows;
}

export interface SpxImportResult {
  imported: number;
  skipped: number;
  clean: number;
  needReview: number;
  unmatched: number;
}

export function vnToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
}

export async function importSpxSettlements(rows: ParsedSpxRow[], actorId?: string): Promise<SpxImportResult> {
  const res: SpxImportResult = { imported: 0, skipped: 0, clean: 0, needReview: 0, unmatched: 0 };
  for (const r of rows) {
    if (!r.maVanDon) { res.skipped++; continue; }
    const id = `spx-${generateUUIDv7()}`;
    try {
      await db.insert(spxSettlements).values({
        id,
        maVanDon: r.maVanDon,
        trangThai: r.trangThai || null,
        tienThuHo: r.tienThuHo,
        tongPhi: r.tongPhi,
        phiGiaoHang: r.phiGiaoHang,
        phiBaoHiem: r.phiBaoHiem,
        phiHoanHang: r.phiHoanHang,
        soTienDieuChinh: r.soTienDieuChinh,
        lyDoDieuChinh: r.lyDoDieuChinh || null,
        tongTienVe: r.tongTienVe,
        ngayImport: vnToday(),
      });
      res.imported++;
    } catch {
      res.skipped++; // ma_van_don trung = da import
      continue;
    }
    const level = await autoMatchSpx(id, r, actorId);
    if (level === 'CLEAN') res.clean++;
    else if (level === 'REVIEW') res.needReview++;
    else res.unmatched++;
  }
  return res;
}

async function autoMatchSpx(settlementId: string, r: ParsedSpxRow, actorId?: string): Promise<string | null> {
  const ord = (await db.select().from(orders).where(eq(orders.trackingCode, r.maVanDon)).limit(1))[0];
  if (!ord) return null;

  const codKhop = Math.abs(Number(ord.codAmount || 0) - r.tienThuHo) < MONEY_TOLERANCE;
  const phiBatThuong = Math.abs(Number(ord.shippingFee || 0) - r.tongPhi) > FEE_ANOMALY_THRESHOLD;
  const coDieuChinh = Math.abs(r.soTienDieuChinh) > 0;
  const notes: string[] = [];
  if (!codKhop) notes.push(`COD lech (don ${Math.round(Number(ord.codAmount || 0))}d, SPX thu ${Math.round(r.tienThuHo)}d)`);
  if (phiBatThuong) notes.push(`Phi lech (du kien ${Math.round(Number(ord.shippingFee || 0))}d, SPX ${Math.round(r.tongPhi)}d)`);
  if (coDieuChinh) notes.push(`Co dieu chinh ${Math.round(r.soTienDieuChinh)}d: ${r.lyDoDieuChinh || 'chua ro ly do'}`);

  await db.insert(spxSettlementMatches).values({
    id: `spxm-${generateUUIDv7()}`,
    settlementId,
    orderId: ord.id,
    codKhop,
    phiBatThuong,
    matchType: 'AUTO',
    matchedBy: actorId ?? null,
    note: notes.length ? notes.join('; ') : 'COD + phi khop',
  });

  const clean = codKhop && !phiBatThuong && !coDieuChinh;
  if (clean && Number(ord.codAmount || 0) > 0) {
    await db.update(orders).set({ codStatus: 'RECEIVED' }).where(eq(orders.id, ord.id));
  }
  return clean ? 'CLEAN' : 'REVIEW';
}

/** Ke toan xac nhan dong SPX (sau khi xem ly do lech/dieu chinh). */
export async function confirmSpxMatch(settlementId: string, actorId?: string) {
  const m = (await db.select().from(spxSettlementMatches).where(eq(spxSettlementMatches.settlementId, settlementId)).limit(1))[0];
  if (!m) throw AppError.invalid('Chua co dong khop de xac nhan.');
  await db.update(spxSettlementMatches).set({ matchType: 'MANUAL', matchedBy: actorId ?? null, note: `${m.note || ''} | Da duyet`.slice(0, 500) }).where(eq(spxSettlementMatches.id, m.id));
  await db.update(orders).set({ codStatus: 'RECEIVED' }).where(eq(orders.id, m.orderId));
  return { settlementId, orderId: m.orderId };
}

/** Bo qua dong SPX: xoa match, ve chua xu ly. */
export async function skipSpxSettlement(settlementId: string) {
  await db.delete(spxSettlementMatches).where(eq(spxSettlementMatches.settlementId, settlementId));
  return { settlementId, status: 'UNPROCESSED' };
}
