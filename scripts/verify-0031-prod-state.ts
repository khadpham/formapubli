import fs from 'node:fs';
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

/** CHỈ ĐỌC. Không execute DDL/DML. Dùng để xác minh trạng thái. */
async function main() {
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

  const tables = (await db.execute(
    `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
  )).rows as any[];
  console.log('TỔNG SỐ BẢNG:', tables.length);

  const newTables = tables.map((t) => t.name).filter((n) =>
    ['products', 'promotions', 'promotion_gifts'].includes(n)
  );
  console.log('Bảng mới có mặt:', newTables.join(', ') || '(KHÔNG có)');

  const indexes = (await db.execute(
    `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('products','promotion_gifts') ORDER BY name`
  )).rows as any[];
  console.log('Index mới:', indexes.map((i) => i.name).join(', ') || '(không có)');

  console.log('\n--- Cột mới ---');
  for (const table of ['editions', 'order_items', 'inventory_ledger', 'stock_balances']) {
    const cols = (await db.execute(`PRAGMA table_info(\`${table}\`)`)).rows as any[];
    const added = cols.map((c) => c.name).filter((n) =>
      ['product_id', 'promotion_id', 'is_gift_line', 'is_manual'].includes(n)
    );
    console.log(`  ${table}: ${added.length ? added.join(', ') : '(chưa có)'}`);
  }

  console.log('\n--- SỐ LƯỢNG DỮ LIỆU (kiểm tra không mất dòng nào) ---');
  for (const t of ['editions', 'works', 'orders', 'order_items', 'inventory_ledger', 'stock_balances']) {
    const r = (await db.execute(`SELECT COUNT(*) n FROM \`${t}\``)).rows as any[];
    console.log(`  ${t}: ${Number(r[0]?.n || 0)}`);
  }

  console.log('\n--- BẢNG MỚI RỖNG? (chưa ai nhập gì) ---');
  for (const t of ['products', 'promotions', 'promotion_gifts']) {
    const r = (await db.execute(`SELECT COUNT(*) n FROM \`${t}\``)).rows as any[];
    console.log(`  ${t}: ${Number(r[0]?.n || 0)} dòng`);
  }

  console.log('\n--- Cột product_id đã backfill chưa? ---');
  for (const t of ['editions', 'order_items', 'inventory_ledger', 'stock_balances']) {
    const r = (await db.execute(
      `SELECT COUNT(*) n FROM \`${t}\` WHERE product_id IS NOT NULL`
    )).rows as any[];
    console.log(`  ${t}: ${Number(r[0]?.n || 0)} dòng đã có product_id`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌', e.message);
    process.exit(1);
  });