import fs from 'node:fs';
import path from 'node:path';
import { db, editions, warehouses, stockBalances } from '../src/db';
import { InventoryService } from '../src/services/inventory.service';
import { eq, and } from 'drizzle-orm';

/**
 * LỄ MỞ SỔ TỜ GIẤY TRẮNG (CLEAN SLATE CEREMONY).
 *
 * Nạp số kiểm đếm thực tế thành bút toán OPENING_BALANCE — mốc sạch duy nhất,
 * thay vì vác số rác Sheets cũ sang. Chữ ký Lan Anh + Giám đốc + mã biên bản
 * BB-KK-YYYYMMDD được khắc vào từng bút toán (documentRef/note) để kiểm toán.
 *
 * CSV chuẩn: sku,warehouse_id,condition_new,condition_quarantine,notes
 *
 *   npx tsx scripts/clean-slate-import.ts --file=kiem-dem.csv \
 *     --memo=BB-KK-20260915 --signers="Lan Anh, Giám đốc" \
 *     --freeze-at="2026-09-15 18:00:00" --dry-run
 *   # Soát bảng đối chiếu xong mới chạy thật:
 *   npx tsx scripts/clean-slate-import.ts --file=... --memo=... --confirm
 *
 * An toàn:
 * - BẮT BUỘC 1 trong 2 cờ --dry-run / --confirm (không cờ -> từ chối).
 * - --confirm bị từ chối nếu DB đã có OPENING_BALANCE (chống nạp 2 lần).
 * - Target mặc định là DB production theo DATABASE_URL (chính là mục đích
 *   mở sổ thật). Cấm trỏ vào formapubli_test.db.
 */
export interface CountRow {
  line: number;
  sku: string;
  warehouseId: string;
  conditionNew: number;
  conditionQuarantine: number;
  notes: string;
}

export interface ImportOptions {
  memo: string;
  signers: string;
  freezeAt: string;
}

export function parseCountCsv(content: string): CountRow[] {
  const lines = content.replace(/^\uFEFF/, '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error('File kiểm đếm rỗng.');
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const expected = ['sku', 'warehouse_id', 'condition_new', 'condition_quarantine', 'notes'];
  if (header.slice(0, 4).join(',') !== expected.slice(0, 4).join(',')) {
    throw new Error(`Header CSV phải là: ${expected.join(',')}`);
  }
  return lines.slice(1).map((line, idx) => {
    // notes có thể chứa dấu phẩy -> chỉ tách 5 cột đầu.
    const parts = line.split(',');
    if (parts.length < 4) throw new Error(`Dòng ${idx + 2} thiếu cột: ${line}`);
    const toInt = (v: string, col: string) => {
      const n = parseInt((v || '0').trim(), 10);
      if (!Number.isFinite(n) || n < 0) throw new Error(`Dòng ${idx + 2}: ${col} phải là số nguyên >= 0.`);
      return n;
    };
    return {
      line: idx + 2,
      sku: (parts[0] || '').trim(),
      warehouseId: (parts[1] || '').trim(),
      conditionNew: toInt(parts[2] || '0', 'condition_new'),
      conditionQuarantine: toInt(parts[3] || '0', 'condition_quarantine'),
      notes: parts.slice(4).join(',').trim(),
    };
  });
}

export async function validateRows(rows: CountRow[]) {
  const editionList = await db.select({ id: editions.id, code: editions.code }).from(editions);
  const editionByCode = new Map(editionList.map((e) => [e.code, e.id]));
  const warehouseList = await db.select({ id: warehouses.id }).from(warehouses);
  const warehouseIds = new Set(warehouseList.map((w) => w.id));

  const seen = new Set<string>();
  const errors: string[] = [];
  for (const r of rows) {
    if (!editionByCode.has(r.sku)) errors.push(`Dòng ${r.line}: SKU ${r.sku} không có trong danh mục.`);
    if (!warehouseIds.has(r.warehouseId)) errors.push(`Dòng ${r.line}: kho ${r.warehouseId} không tồn tại.`);
    const key = `${r.sku}|${r.warehouseId}`;
    if (seen.has(key)) errors.push(`Dòng ${r.line}: trùng cặp SKU+kho (${key}).`);
    seen.add(key);
  }
  if (errors.length > 0) throw new Error(`CSV không hợp lệ:\n- ${errors.join('\n- ')}`);
  return { editionByCode };
}

export interface VarianceLine {
  sku: string;
  warehouseId: string;
  condition: string;
  systemQty: number;
  countedQty: number;
  variance: number;
}

/** Đối chiếu tồn máy vs số đếm (không ghi gì cả) — dùng cho --dry-run. */
export async function buildVarianceReport(
  rows: CountRow[],
  editionByCode: Map<string, string>
): Promise<{ lines: VarianceLine[]; totals: Record<string, number> }> {
  const lines: VarianceLine[] = [];
  for (const r of rows) {
    const editionId = editionByCode.get(r.sku)!;
    for (const [condition, counted] of [
      ['NEW', r.conditionNew],
      ['QUARANTINE', r.conditionQuarantine],
    ] as const) {
      const systemQty = await InventoryService.getBalance(editionId, r.warehouseId, condition as any);
      lines.push({
        sku: r.sku,
        warehouseId: r.warehouseId,
        condition,
        systemQty,
        countedQty: counted,
        variance: counted - systemQty,
      });
    }
  }
  const totals = { system: 0, counted: 0, variance: 0 };
  for (const l of lines) {
    totals.system += l.systemQty;
    totals.counted += l.countedQty;
    totals.variance += l.variance;
  }
  return { lines, totals };
}

/** Nạp thật: mỗi ô > 0 thành 1 bút toán OPENING_BALANCE gắn mã biên bản + chữ ký. */
export async function executeImport(
  rows: CountRow[],
  editionByCode: Map<string, string>,
  opts: ImportOptions
): Promise<{ entries: number; totalBooks: number }> {
  let entries = 0;
  let totalBooks = 0;
  for (const r of rows) {
    const editionId = editionByCode.get(r.sku)!;
    const legs: Array<{ condition: 'NEW' | 'QUARANTINE'; qty: number }> = [
      { condition: 'NEW', qty: r.conditionNew },
      { condition: 'QUARANTINE', qty: r.conditionQuarantine },
    ];
    for (const leg of legs) {
      if (leg.qty <= 0) continue;
      await InventoryService.recordMovement({
        editionId,
        warehouseId: r.warehouseId,
        eventType: 'OPENING_BALANCE',
        quantityDelta: leg.qty,
        condition: leg.condition,
        documentRef: opts.memo,
        note: `Mở sổ Clean Slate (freeze ${opts.freezeAt}) — Ký: ${opts.signers}.${r.notes ? ` Ghi chú đếm: ${r.notes}` : ''}`,
        actorId: 'clean-slate-ceremony',
        idempotencyKey: `idem-opening-${opts.memo}-${r.sku}-${r.warehouseId}-${leg.condition}`,
      });
      entries++;
      totalBooks += leg.qty;
    }
  }
  return { entries, totalBooks };
}

function printReport(report: { lines: VarianceLine[]; totals: Record<string, number> }) {
  console.log('\n📊 BẢNG ĐỐI CHIẾU TỒN MÁY vs SỐ ĐẾM THỰC TẾ');
  console.log('SKU | Kho | Tình trạng | Tồn máy | Đếm thực | Chênh lệch');
  for (const l of report.lines) {
    if (l.systemQty === 0 && l.countedQty === 0) continue;
    const sign = l.variance > 0 ? '+' : '';
    console.log(`- ${l.sku} | ${l.warehouseId} | ${l.condition} | ${l.systemQty} | ${l.countedQty} | ${sign}${l.variance}`);
  }
  const t = report.totals;
  console.log(`\nTỔNG: máy ${t.system} | đếm ${t.counted} | chênh ${t.variance >= 0 ? '+' : ''}${t.variance}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const get = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const file = get('file');
  const memo = get('memo') || '';
  const signers = get('signers') || '';
  const freezeAt = get('freeze-at') || '';
  const dryRun = argv.includes('--dry-run');
  const confirm = argv.includes('--confirm');

  if (!file || !memo || !signers || !freezeAt) {
    console.error('Thiếu tham số: --file= --memo=BB-KK-YYYYMMDD --signers= --freeze-at=');
    process.exit(1);
  }
  if ((dryRun ? 1 : 0) + (confirm ? 1 : 0) !== 1) {
    console.error('Bắt buộc đúng 1 cờ: --dry-run (soát trước) hoặc --confirm (nạp thật).');
    process.exit(1);
  }
  if (!/^BB-KK-\d{8}$/.test(memo)) {
    console.error('Mã biên bản phải dạng BB-KK-YYYYMMDD (vd. BB-KK-20260915).');
    process.exit(1);
  }
  const dbUrl = process.env.DATABASE_URL || 'file:formapubli.db';
  if (dbUrl.includes('formapubli_test')) {
    console.error('REFUSED: mở sổ thật không bao giờ trỏ vào DB test.');
    process.exit(1);
  }

  const content = fs.readFileSync(path.resolve(process.cwd(), file), 'utf-8');
  const rows = parseCountCsv(content);
  console.log(`📄 Đọc ${rows.length} dòng kiểm đếm từ ${file}.`);
  const { editionByCode } = await validateRows(rows);
  console.log('✅ CSV hợp lệ (SKU + kho + không trùng).');

  if (dryRun) {
    const report = await buildVarianceReport(rows, editionByCode);
    printReport(report);
    console.log('\n🔍 DRY-RUN: chưa ghi gì. Soát xong chạy lại với --confirm.');
    process.exit(0);
  }

  // --confirm: chống nạp 2 lần cùng DB.
  const { inventoryLedger } = await import('../src/db');
  const { eq } = await import('drizzle-orm');
  const existing = await db
    .select({ id: inventoryLedger.id })
    .from(inventoryLedger)
    .where(eq(inventoryLedger.eventType, 'OPENING_BALANCE'))
    .limit(1);
  if (existing.length > 0) {
    console.error('REFUSED: DB đã có bút toán OPENING_BALANCE — chống nạp mở sổ 2 lần.');
    process.exit(1);
  }

  const result = await executeImport(rows, editionByCode, { memo, signers, freezeAt });
  console.log(`\n🎉 MỞ SỔ HOÀN TẤT: ${result.entries} bút toán, ${result.totalBooks} cuốn (biên bản ${memo}).`);
  process.exit(0);
}

const invokedAsScript =
  process.argv[1] && path.basename(process.argv[1]) === 'clean-slate-import.ts';
if (invokedAsScript) {
  main().catch((err) => {
    console.error('❌ clean-slate-import thất bại:', err.message || err);
    process.exit(1);
  });
}
