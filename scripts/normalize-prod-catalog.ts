import fs from 'node:fs';
import { createClient } from '@libsql/client';

/**
 * Chuẩn hoá dữ liệu danh mục trên production (giai đoạn test, đang dựng bộ sách).
 *
 * 1. KHOÁ H85 "Đốt kho" — ISBN sai (14 số). Dùng TP104 "Đốt kho" bản đúng thay thế.
 *    `pos-catalog.service.ts` đã có `if (e.isActive === false) continue` nên
 *    is_active = 0 là khoá thật, POS không hiện nữa. KHÔNG xoá hàng: còn tác
 *    giả (`editions.id` giữ nguyên để lịch sử không đứt liên kết), sau này bỏ khoá
 *    được bằng 1 lệnh.
 * 2. MỖI ĐẦU SÁCH 1000 CUỐN Ở MỖI KHO. Số tồn hiện tại lẻ tẻ (1005/1000/955/
 *    30/29/0) do quá trình test, theo yêu cầu thì không cần giữ.
 * 3. `status` về IN_STOCK cho mọi cuốn còn hoạt động, vì mỗi kho đều còn hàng.
 *
 * Không đụng `orders`, `inventory_ledger` hay bất kỳ lịch sử nào.
 */
const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const LOCK_CODES = ['H85'];
const QTY = 1000;

import { requireProdWriteConsent } from './prod-write-guard';

  // Ghi production: phải bật cờ tường minh, xem scripts/prod-write-guard.ts.
  requireProdWriteConsent('normalize-prod-catalog.ts');
async function main() {
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  const q = async (sql: string, ...a: any[]) => (await db.execute({ sql, args: a })).rows;
  const run = (sql: string, ...a: any[]) => db.execute({ sql, args: a });
  const ph = LOCK_CODES.map(() => '?').join(',');

  console.log('--- TRƯỚC ---');
  const b = await q(
    `SELECT (SELECT COUNT(*) FROM editions) an, (SELECT COUNT(*) FROM editions WHERE is_active=1) an_active,
            (SELECT COUNT(*) FROM stock_balances) dong,
            (SELECT COALESCE(SUM(physical_quantity),0) FROM stock_balances) tong`
  );
  console.log(`  ${JSON.stringify(b[0])}`);

  // 1. Khoá các đầu sách lỗi.
  await run(`UPDATE editions SET is_active = 0 WHERE code IN (${ph})`, ...LOCK_CODES);
  console.log(`\n1. Đã khoá: ${LOCK_CODES.join(', ')} (is_active = 0)`);

  // 2. Tồn kho: 1000 cho mọi cuốn còn hoạt động; cuốn bị khoá để 0.
  const s1 = await run(
    `UPDATE stock_balances SET physical_quantity = 1000
     WHERE edition_id IN (SELECT id FROM editions WHERE is_active = 1)`
  );
  const s2 = await run(
    `UPDATE stock_balances SET physical_quantity = 0
     WHERE edition_id IN (SELECT id FROM editions WHERE code IN (${ph}))`,
    ...LOCK_CODES
  );
  console.log(`2. Tồn kho → ${QTY} cuốn/kho (${s1.rowsAffected} dòng); cuốn bị khoá → 0 (${s2.rowsAffected} dòng)`);

  // 3. Trạng thái: còn hàng ở mọi kho thì IN_STOCK. Cuốn bị khoá thì SOLD_OUT để
  //    không ai hiểu nhầm là còn bán được.
  const t1 = await run(
    `UPDATE editions SET status = 'IN_STOCK' WHERE is_active = 1`
  );
  const t2 = await run(
    `UPDATE editions SET status = 'SOLD_OUT' WHERE code IN (${ph})`,
    ...LOCK_CODES
  );
  console.log(`3. status → IN_STOCK (${t1.rowsAffected}), cuốn bị khoá → SOLD_OUT (${t2.rowsAffected})`);

  console.log('\n--- SAU ---');
  const a = await q(
    `SELECT (SELECT COUNT(*) FROM editions) an, (SELECT COUNT(*) FROM editions WHERE is_active=1) an_active,
            (SELECT COUNT(*) FROM stock_balances) dong,
            (SELECT COALESCE(SUM(physical_quantity),0) FROM stock_balances) tong,
            (SELECT COUNT(*) FROM stock_balances WHERE physical_quantity < 0) am`
  );
  console.log(`  ${JSON.stringify(a[0])}`);

  const missing = await q(`
    SELECT COUNT(*) n FROM (
      SELECT e.id, w.id AS wid FROM editions e CROSS JOIN warehouses w
      LEFT JOIN stock_balances sb ON sb.edition_id = e.id AND sb.warehouse_id = w.id
      WHERE sb.id IS NULL)`);
  console.log(`  thiếu dòng tồn kho: ${missing[0].n}`);

  const dist = await q(
    `SELECT physical_quantity q, COUNT(*) n FROM stock_balances GROUP BY physical_quantity ORDER BY q DESC LIMIT 6`
  );
  console.log('  phân bố tồn:');
  dist.forEach((r: any) => console.log(`    ${String(r.q).padStart(5)}: ${r.n} dòng`));

  console.log('\n--- TP104 (thay thế H85) ---');
  const t = await q(
    `SELECT e.code, e.title, e.isbn, e.status,
            (SELECT COALESCE(SUM(physical_quantity),0) FROM stock_balances sb WHERE sb.edition_id = e.id) ton
     FROM editions e WHERE e.code IN ('H85','TP104') ORDER BY e.code`
  );
  t.forEach((r: any) =>
    console.log(`  ${r.code.padEnd(7)} | ${r.title} | isbn='${r.isbn}' | active=${r.is_active} | ${r.status} | tồn=${r.ton}`)
  );

  const orphan = await q(
    `SELECT COUNT(*) n FROM order_items i LEFT JOIN editions e ON e.id = i.edition_id WHERE e.id IS NULL`
  );
  const fk = await q(`PRAGMA foreign_key_check`);
  console.log(`\n  order_items mồ côi: ${orphan[0].n} · vi phạm khoá ngoại: ${fk.length}`);
  console.log('\n✅ Xong.');
}
main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('\n❌', e.message); process.exit(1); });

