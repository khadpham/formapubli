/**
 * scripts/apply-migration-0053.ts — Áp migration 0053 (bảng portal_settings)
 * lên DB production (Turso). Chạy lại an toàn (idempotent):
 * kiểm tra sqlite_master trước, có bảng rồi thì thoát, không ghi gì.
 *
 * Chỉ đọc (kiểm tra bảng đã có chưa):
 *   npx tsx scripts/apply-migration-0053.ts
 *
 * Ghi thật lên production (cần 2 cờ cố tình, theo scripts/prod-write-guard.ts):
 *   $env:ALLOW_PROD_WRITE="true"; $env:ALLOW_REMOTE_TARGET="<host>"; npx tsx scripts/apply-migration-0053.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { requireProdWriteConsent, requireExplicitTarget } from './prod-write-guard';

async function main() {
  const env = Object.fromEntries(
    fs.readFileSync('.env', 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.includes('='))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
      })
  );
  const url = env.TURSO_DATABASE_URL || '';
  const authToken = env.TURSO_AUTH_TOKEN || '';
  if (!url || !authToken) {
    console.error('REFUSED: thiếu TURSO_DATABASE_URL / TURSO_AUTH_TOKEN trong .env.');
    process.exit(1);
  }

  const client = createClient({ url, authToken });

  const check = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='portal_settings'",
    args: [],
  });
  if (check.rows.length > 0) {
    console.log('✅ Bảng portal_settings ĐÃ CÓ trên production — không cần làm gì.');
    process.exit(0);
  }
  console.log('⚠️ Bảng portal_settings CHƯA CÓ trên production — cần áp migration 0053.');

  requireProdWriteConsent('Tạo bảng portal_settings (migration 0053) trên production');
  requireExplicitTarget(url);

  const sqlPath = path.join(__dirname, '../src/db/migrations/0053_portal_settings.sql');
  const sql = fs.readFileSync(sqlPath, 'utf-8');
  for (const stmt of sql.split('--> statement-breakpoint')) {
    const clean = stmt.trim();
    if (clean) await client.execute(clean);
  }

  const verify = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='portal_settings'",
    args: [],
  });
  if (verify.rows.length === 0) throw new Error('Áp xong mà vẫn không thấy bảng portal_settings.');
  console.log('✅ Migration 0053 đã áp xong: bảng portal_settings đã có trên production.');
  process.exit(0);
}

main().catch((e) => {
  console.error('Lỗi:', e?.message || e);
  process.exit(1);
});
