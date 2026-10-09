/**
 * Sửa portal_ref bị dính dấu câu cuối (backfill cắt \S+ quá tham).
 * CHỈ ĐỌC mặc định; --thuc-hien + cờ prod mới ghi.
 *
 *   $env:ALLOW_PROD_WRITE='true'; $env:ALLOW_REMOTE_TARGET='<host>'
 *   npx tsx scripts/fix-portal-ref-dots-prod.ts --thuc-hien
 */
import fs from 'node:fs';
import { createClient } from '@libsql/client';
import { requireProdWriteConsent, requireExplicitTarget } from './prod-write-guard';

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

const DO_IT = process.argv.includes('--thuc-hien');

async function main() {
  requireExplicitTarget(env.TURSO_DATABASE_URL);
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  try {
    const rows = (
      await db.execute("SELECT id, order_code, portal_ref FROM orders WHERE portal_ref LIKE '%.,' OR portal_ref LIKE '%.'")
    ).rows as any[];

    console.log(`\nportal_ref dính dấu chạm cuối: ${rows.length}`);
    for (const r of rows) {
      const clean = `${r.portal_ref}`.replace(/[.,;:]+$/, '');
      console.log(`  ${r.order_code}: "${r.portal_ref}" → "${clean}"`);
      if (!DO_IT) continue;
      await db.execute({ sql: 'UPDATE orders SET portal_ref = ? WHERE id = ?', args: [clean, r.id] });
    }
    if (!DO_IT) {
      console.log('\n🧪 CHỈ XEM — chưa sửa gì. Thêm --thuc-hien (+ ALLOW_PROD_WRITE).');
      return;
    }
    requireProdWriteConsent(`sửa ${rows.length} portal_ref dính dấu chạm`);
    console.log(`\n✅ Đã sửa ${rows.length} portal_ref`);
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
