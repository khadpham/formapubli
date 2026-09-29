import fs from 'node:fs';
import { createClient } from '@libsql/client';

/**
 * Áp `0027_stock_non_negative_check` lên production Turso.
 *
 * `npm run deploy` KHÔNG chạy migration, và app không tự migrate lúc khởi động,
 * nên trigger mới chỉ tồn tại trong file. Migration này là câu lệnh DDL thuần
 * thêm (CREATE TRIGGER IF NOT EXISTS) — không đụng dữ liệu, không rebuild bảng.
 *
 * CHẠY VỚI --apply để ghi. Mặc định chỉ đọc và in kế hoạch.
 */
const APPLY = process.argv.includes('--apply');
const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);
const url = env.TURSO_DATABASE_URL;
const token = env.TURSO_AUTH_TOKEN;
if (!url || !token) throw new Error('Thiếu TURSO_DATABASE_URL / TURSO_AUTH_TOKEN trong .env');

const sqlFile = 'src/db/migrations/0027_stock_non_negative_check.sql';
const raw = fs.readFileSync(sqlFile, 'utf8');
const stmt = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n')
  .trim();

async function main() {
  const db = createClient({ url, authToken: token });

  const before = await db.execute(
    `SELECT name FROM sqlite_master WHERE type='trigger' AND name='check_stock_non_negative'`
  );
  const neg = await db.execute(
    `SELECT COUNT(*) n FROM stock_balances WHERE physical_quantity < 0`
  );
  const total = await db.execute(`SELECT COUNT(*) n FROM stock_balances`);

  console.log(`PROD trigger check_stock_non_negative : ${before.rows.length ? 'ĐÃ CÓ' : 'CHƯA CÓ'}`);
  console.log(`PROD stock_balances                   : ${total.rows[0].n} dòng`);
  console.log(`PROD dòng tồn kho âm                  : ${neg.rows[0].n}`);

  if (before.rows.length) {
    console.log('\n→ Trigger đã tồn tại, không làm gì.');
    return;
  }
  if (Number(neg.rows[0].n) > 0) {
    throw new Error(
      `CÓ ${neg.rows[0].n} dòng tồn kho âm. Trigger chỉ chặn GHI MỚI, không sửa dữ liệu cũ. ` +
        `Cần xử lý dữ liệu âm trước, không tự ý áp trigger.`
    );
  }
  if (!APPLY) {
    console.log('\n→ Chạy lại với --apply để ghi.');
    return;
  }

  await db.execute(stmt);
  const after = await db.execute(
    `SELECT name FROM sqlite_master WHERE type='trigger' AND name='check_stock_non_negative'`
  );
  const negAfter = await db.execute(
    `SELECT COUNT(*) n FROM stock_balances WHERE physical_quantity < 0`
  );
  console.log(`\nSAU khi áp: trigger = ${after.rows.length ? 'ĐÃ CÓ' : 'VẪN THIẾU'}`);
  console.log(`SAU khi áp: dòng âm = ${negAfter.rows[0].n} (dữ liệu không đổi)`);
  if (!after.rows.length) throw new Error('Áp trigger thất bại.');
}
main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('\n❌', e.message); process.exit(1); });
