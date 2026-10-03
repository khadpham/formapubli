import { requireProdWriteConsent, requireExplicitTarget } from './prod-write-guard';

requireProdWriteConsent(
  'migration 0037: thêm cột staff_accounts.allowed_warehouse_ids (TEXT JSON, default [] = mọi kho)'
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

  const cols = (await db.execute(`PRAGMA table_info(\`staff_accounts\`)`)).rows as any[];
  if (cols.map((c) => c.name).includes('allowed_warehouse_ids')) {
    console.log('= staff_accounts.allowed_warehouse_ids đã tồn tại — bỏ qua, không làm gì.');
    return;
  }
  await db.execute(
    "ALTER TABLE `staff_accounts` ADD COLUMN `allowed_warehouse_ids` text DEFAULT '[]'"
  );
  console.log('✓ staff_accounts.allowed_warehouse_ids đã thêm.');

  const n = (await db.execute(`SELECT COUNT(*) n FROM staff_accounts`)).rows as any[];
  console.log(`Tài khoản hiện có: ${Number(n[0]?.n || 0)} (toàn bộ [] = mọi kho, hành vi không đổi).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
