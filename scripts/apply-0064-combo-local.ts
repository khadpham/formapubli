/**
 * Ap 0064 (combo_components) vao DB dev cuc bo (file:formapubli.db).
 * DDL doc NGUYEN VAN tu src/db/migrations/0064_combo_components.sql (khong tu viet).
 * Idempotent: co bang roi thi bo qua. Chi cham file cuc bo, KHONG cham Turso.
 */
import fs from 'node:fs';
import { createClient } from '@libsql/client';

async function main() {
  const bak = `formapubli.db.bak-${Date.now()}`;
  fs.copyFileSync('formapubli.db', bak);
  console.log(`Da sao luu: ${bak}`);

  const db = createClient({ url: 'file:formapubli.db' });
  const tables = await db.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='combo_components'"
  );
  if (tables.rows.length > 0) {
    console.log('0064: bang combo_components da co - bo qua.');
    return;
  }
  const sql = fs.readFileSync('src/db/migrations/0064_combo_components.sql', 'utf8');
  const statements = sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await db.execute(stmt);
  }
  console.log(`0064: da tao bang combo_components (${statements.length} cau).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
