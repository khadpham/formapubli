import { requireProdWriteConsent, requireExplicitTarget } from './prod-write-guard';

requireProdWriteConsent(
  'migration 0034: thêm cột promotions.warehouse_id (nullable — NULL = mọi kho)'
);

import fs from 'node:fs';
import { createClient } from '@libsql/client';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

async function main() {
  const url = env.TURSO_DATABASE_URL;
  requireExplicitTarget(url);
  const db = createClient({ url, authToken: env.TURSO_AUTH_TOKEN });

  const cols = (await db.execute(`PRAGMA table_info(\`promotions\`)`)).rows as any[];
  if (cols.map((c) => c.name).includes('warehouse_id')) {
    console.log('= promotions.warehouse_id đã tồn tại — bỏ qua, không làm gì.');
    return;
  }
  await db.execute(
    'ALTER TABLE `promotions` ADD COLUMN `warehouse_id` text REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action'
  );
  console.log('✓ promotions.warehouse_id đã thêm.');

  const check = (await db.execute(`PRAGMA foreign_key_check`)).rows as any[];
  console.log(check.length === 0 ? '✓ foreign_key_check sạch.' : `❌ FK vi phạm: ${JSON.stringify(check)}`);
  if (check.length > 0) process.exit(1);

  const n = (await db.execute(`SELECT COUNT(*) n FROM promotions`)).rows as any[];
  console.log(`Chiến dịch hiện có: ${Number(n[0]?.n || 0)} (toàn bộ NULL = mọi kho, hành vi không đổi).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
