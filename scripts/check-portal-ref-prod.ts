/** Kiểm tra cột portal_ref trên PRODUCTION (CHỈ ĐỌC). */
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
    const cols = (await db.execute('PRAGMA table_info(orders)')).rows.map((r: any) => r.name);
    console.log(`portal_ref có: ${cols.includes('portal_ref')}`);
    console.log(`số cột orders: ${cols.length}`);
    const idx = await db.execute("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_orders_portal_ref'");
    console.log(`index: ${idx.rows.length ? 'có' : 'thiếu'}`);
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
