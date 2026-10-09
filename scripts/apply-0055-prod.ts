/**
 * Áp migration 0055 (orders.portal_ref) lên PRODUCTION — chỉ ADD COLUMN + INDEX.
 *
 * ⚠️ PHẢI chạy TRƯỚC khi deploy code đọc cột portal_ref, nếu không mọi truy vấn
 * bảng orders sẽ lỗi (Drizzle SELECT đọc đúng danh sách cột).
 *
 *   $env:ALLOW_PROD_WRITE='true'; $env:ALLOW_REMOTE_TARGET='<host>'
 *   npx tsx scripts/apply-0055-prod.ts
 *
 * Idempotent: chạy lại lần hai tự bỏ qua cột/index đã có.
 */
import fs from 'node:fs';
import path from 'node:path';
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

const SQL_FILE = path.resolve(process.cwd(), 'src/db/migrations/0055_orders_portal_ref.sql');

async function main() {
  requireExplicitTarget(env.TURSO_DATABASE_URL);
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  const rows = async (s: string) => (await db.execute(s)).rows as any[];
  const cols = async (t: string) => (await rows(`PRAGMA table_info(\`${t}\`)`)).map((r) => r.name);

  console.log('\n════ TRƯỚC ════');
  console.log(`  orders.portal_ref: ${(await cols('orders')).includes('portal_ref')}`);

  const sql = fs.readFileSync(SQL_FILE, 'utf8');
  const statements = sql
    .split('--> statement-breakpoint')
    .map((c) =>
      c
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n')
        .trim()
    )
    .filter(Boolean);

  requireProdWriteConsent('thêm cột orders.portal_ref + index (migration 0055)');
  console.log(`\n════ CHẠY ${statements.length} CÂU ════`);
  for (let i = 0; i < statements.length; i++) {
    const head = statements[i].replace(/\s+/g, ' ').slice(0, 64);
    const addCol = /^ALTER TABLE\s+`?(\w+)`?\s+ADD COLUMN\s+`?(\w+)`?/i.exec(statements[i]);
    if (addCol && (await cols(addCol[1])).includes(addCol[2])) {
      console.log(`  ▸ ${i + 1}/${statements.length}  bỏ qua (đã có ${addCol[1]}.${addCol[2]})`);
      continue;
    }
    const idx = /^CREATE INDEX\s+`?(\w+)`?/i.exec(statements[i]);
    if (idx) {
      const exists = await rows(`SELECT name FROM sqlite_master WHERE type='index' AND name='${idx[1]}'`);
      if (exists.length > 0) {
        console.log(`  ▸ ${i + 1}/${statements.length}  bỏ qua (đã có index ${idx[1]})`);
        continue;
      }
    }
    try {
      await db.execute(statements[i]);
      console.log(`  ✓ ${i + 1}/${statements.length}  ${head}`);
    } catch (e: any) {
      console.error(`\n❌ DỪNG Ở CÂU ${i + 1}: ${head}`);
      console.error(`   ${e?.message || e}`);
      process.exit(1);
    }
  }

  console.log('\n════ SAU ════');
  console.log(`  orders.portal_ref: ${(await cols('orders')).includes('portal_ref')}`);
  const idxRows = await rows(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_orders_portal_ref'"
  );
  console.log(`  index: ${idxRows.length ? '✅ có' : '❌ thiếu'}`);
  const fk = await rows('PRAGMA foreign_key_check');
  const ig = await rows('PRAGMA integrity_check');
  console.log(`  foreign_key_check: ${fk.length === 0 ? 'SẠCH ✅' : `❌ ${fk.length}`}`);
  console.log(`  integrity_check: ${Object.values(ig[0])[0]}`);
  try {
    (db as any).close?.();
  } catch {
    /* bỏ qua lỗi đóng client native trên Windows */
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('❌', e?.message || e);
  process.exit(1);
});
