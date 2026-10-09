/** Kiểm tra chi tiết đơn portal mới nhất: portal_ref + dòng quà (product_id). */
import fs from 'node:fs';
import { createClient } from '@libsql/client';
import { requireExplicitTarget } from './prod-write-guard';

const env = Object.fromEntries(
  fs
    .readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

async function main() {
  requireExplicitTarget(env.TURSO_DATABASE_URL);
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  try {
    const o = (
      await db.execute(
        "SELECT order_code, portal_ref, status, shipping_status, created_at FROM orders WHERE channel='ONLINE' ORDER BY created_at DESC LIMIT 1"
      )
    ).rows[0] as any;
    console.log(`Đơn mới nhất: ${o.order_code}, portal_ref=${o.portal_ref || 'NULL'}, status=${o.status}, shipping_status=${o.shipping_status}`);
    const items = (
      await db.execute({
        sql: 'SELECT edition_id, product_id, quantity, is_gift_line FROM order_items WHERE order_id = (SELECT id FROM orders WHERE order_code = ?)',
        args: [o.order_code],
      })
    ).rows as any[];
    for (const it of items) {
      const p = it.product_id
        ? (await db.execute({ sql: 'SELECT code, name FROM products WHERE id = ?', args: [it.product_id] })).rows[0]
        : null;
      console.log(
        `  - edition=${it.edition_id || 'NULL'} product=${p ? `${p.code} (${p.name})` : it.product_id} qty=${it.quantity} gift=${it.is_gift_line}`
      );
    }
  } finally {
    try {
      (db as any).close?.();
    } catch {
      /* bỏ qua */
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('❌', e?.message || e);
  process.exit(1);
});
