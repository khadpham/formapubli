import { createClient } from '@libsql/client';
import * as fs from 'fs';
import * as path from 'path';

// Áp migration 0008 (bundle_id/bundle_qty cho order_items) theo pattern
// apply-0005/0006/0007: chạy từng statement riêng lẻ.
async function main() {
  const client = createClient({
    url: process.env.DATABASE_URL || 'file:formapubli.db',
  });
  const sqlPath = path.join(__dirname, '../src/db/migrations/0008_boxset_bundles.sql');
  const sql = fs.readFileSync(sqlPath, 'utf-8');
  const stmts = sql.split('--> statement-breakpoint');

  console.log(`Applying ${stmts.length} statements from 0008_boxset_bundles.sql...`);
  for (const stmt of stmts) {
    const clean = stmt.trim();
    if (clean) {
      await client.execute(clean);
    }
  }
  console.log('Migration 0008 applied successfully to LibSQL database!');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
