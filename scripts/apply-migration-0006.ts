import { createClient } from '@libsql/client';
import * as fs from 'fs';
import * as path from 'path';

// Áp migration 0006 (phiếu luân chuyển kho 2 bước) theo đúng pattern
// apply-migration-0005 của repo: chạy từng statement riêng lẻ để tránh
// quirk batch của libsql local. Chạy: DATABASE_URL=... npx tsx scripts/apply-migration-0006.ts
async function main() {
  const client = createClient({
    url: process.env.DATABASE_URL || 'file:formapubli.db',
  });
  const sqlPath = path.join(__dirname, '../src/db/migrations/0006_transfer_shipments.sql');
  const sql = fs.readFileSync(sqlPath, 'utf-8');
  const stmts = sql.split('--> statement-breakpoint');

  console.log(`Applying ${stmts.length} statements from 0006_transfer_shipments.sql...`);
  for (const stmt of stmts) {
    const clean = stmt.trim();
    if (clean) {
      await client.execute(clean);
    }
  }
  console.log('Migration 0006 applied successfully to LibSQL database!');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
