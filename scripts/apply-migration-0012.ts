import { createClient } from '@libsql/client';
import * as fs from 'fs';
import * as path from 'path';

// Áp migration 0012 (SPX & COD columns) theo pattern apply-0005..0011.
// Target mặc định formapubli.db local; D1 dùng wrangler d1 migrations apply.
async function main() {
  const client = createClient({
    url: process.env.DATABASE_URL || 'file:formapubli.db',
  });
  const sqlPath = path.join(__dirname, '../src/db/migrations/0012_spx_cod_tracking.sql');
  const sql = fs.readFileSync(sqlPath, 'utf-8');
  const stmts = sql.split('--> statement-breakpoint');

  console.log(`Applying ${stmts.length} statements from 0012_spx_cod_tracking.sql...`);
  for (const stmt of stmts) {
    const clean = stmt.trim();
    if (clean) {
      await client.execute(clean);
    }
  }
  console.log('Migration 0012 applied successfully to LibSQL database!');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
