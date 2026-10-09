/** Liệt kê portal_ref + email khách của đơn ONLINE trên PRODUCTION (CHỈ ĐỌC). */
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
    const rows = (
      await db.execute(
        `SELECT o.order_code, o.portal_ref, o.customer_name, c.email
         FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
         WHERE o.channel='ONLINE' ORDER BY o.created_at`
      )
    ).rows as any[];
    console.log(`Đơn ONLINE (${rows.length}):`);
    for (const r of rows) {
      console.log(`  ${r.order_code} | portal_ref=${r.portal_ref || 'NULL'} | ${r.customer_name} <${r.email || '?'}>`);
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
