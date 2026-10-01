/**
 * Sao lưu DB production (Turso) ra file SQL — CHỈ ĐỌC.
 *
 * VÌ SAO CẦN: KHÔNG có script backup nào trong repo làm được việc này.
 * `backup-db.ts` chỉ copy file .db cục bộ, còn production là Turso từ xa.
 * Plan (Cổng 1b) yêu cầu backup trước khi chạy `UPDATE` hàng loạt — không
 * có backup thì không chạy.
 *
 * CÁCH LÀM: dump từng bảng thành câu INSERT. Turso không có cơ chế restore
 * ghi ngược, nên đây là đường khôi phục DUY NHẤT mà ta tự kiểm soát được.
 *
 * CHỈ ĐỌC — không có DDL/DML nào trong file này.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

/** Thứ tự phụ thuộc: bảng cha trước. Trùng rồi sửa ở đây. */
const TABLES = [
  'works', 'editions', 'warehouses', 'partners', 'customers',
  'stock_balances', 'inventory_ledger', 'orders', 'order_items',
  'cashbox_sessions', 'staff_accounts', 'discount_approval_requests',
  'products', 'promotions', 'promotion_gifts',
];

function lit(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'bigint') return v.toString();
  const s = String(v).replace(/'/g, "''");
  return `'${s}'`;
}

async function main() {
  const outDir = path.join(process.cwd(), 'backups');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(outDir, `prod-backup-${stamp}.sql`);

  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  const q = async (sql: string) => (await db.execute(sql)).rows as any[];

  const header =
    `-- Sao lưu production ${new Date().toISOString()}\n` +
    `-- CHỈ ĐỌC khi sinh file này. Khôi phục: nạp tay theo thứ tự bảng.\n` +
    `-- KHÔNG chứa token/khoá.\n\n`;

  const parts: string[] = [header];
  const stats: string[] = [];

  for (const t of TABLES) {
    const exists = await q(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='${t}'`
    );
    if (!exists.length) {
      stats.push(`  ${t}: KHÔNG CÓ — bỏ qua`);
      continue;
    }
    const rows = await q(`SELECT * FROM \`${t}\``);
    stats.push(`  ${t}: ${rows.length} dòng`);
    if (!rows.length) continue;

    const cols = Object.keys(rows[0]);
    parts.push(`-- ${t} (${rows.length} dòng)`);
    parts.push(
      `INSERT INTO \`${t}\` (${cols.map((c) => `\`${c}\``).join(',')}) VALUES`
    );
    parts.push(
      rows
        .map((r) => `  (${cols.map((c) => lit(r[c])).join(',')})`)
        .join(',\n') + ';'
    );
    parts.push('');
  }

  fs.writeFileSync(outFile, parts.join('\n'), 'utf8');
  const sizeKb = Math.round(fs.statSync(outFile).size / 1024);

  console.log('=== SAO LƯU PRODUCTION ===');
  for (const s of stats) console.log(s);
  console.log(`\nFile : ${outFile}`);
  console.log(`Dung lượng: ${sizeKb} KB`);
  console.log(`Ghi lúc   : ${new Date().toISOString()}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('❌', e?.message || e);
  process.exit(1);
});