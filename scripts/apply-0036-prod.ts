/**
 * Migration 0036 trên PRODUCTION: thứ tự sắp xếp kho hiển thị trên POS và quản trị.
 *
 * An toàn: chỉ ALTER TABLE `warehouses` ADD COLUMN `sort_order` integer DEFAULT 0;
 * Không đụng dữ liệu cũ, không khoá bảng.
 *
 * Chạy:
 *   $env:ALLOW_REMOTE_TARGET="formapubli-prod-phamkha9x.aws-ap-northeast-1.turso.io"; npx tsx scripts/apply-0036-prod.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { requireExplicitTarget } from './prod-write-guard';

const env: Record<string, string> = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx > 0) {
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
  }
}

const targetUrl = process.env.DATABASE_URL || env.TURSO_DATABASE_URL;
const isDryRun = Boolean(process.env.DATABASE_URL);

async function main() {
  requireExplicitTarget(targetUrl);
  if (isDryRun) console.log('\n🧪 DRY-RUN: DB LOCAL.');

  const db = createClient({
    url: targetUrl,
    authToken: isDryRun ? undefined : env.TURSO_AUTH_TOKEN,
  });

  const rows = async (s: string) => (await db.execute(s)).rows as any[];
  const cols = async (t: string) => (await rows(`PRAGMA table_info(\`${t}\`)`)).map((r) => r.name);

  console.log('\n════ TRƯỚC ════');
  const existingCols = await cols('warehouses');
  console.log(`  warehouses.sort_order hiện có: ${existingCols.includes('sort_order')}`);

  if (existingCols.includes('sort_order')) {
    console.log('✓ Cột sort_order đã tồn tại trên warehouses. Không cần chạy ALTER.');
  } else {
    console.log('\n════ ÁP DỤNG MIGRATION 0036 ════');
    await db.execute('ALTER TABLE `warehouses` ADD COLUMN `sort_order` integer DEFAULT 0;');
    console.log('✓ Đã chạy: ALTER TABLE `warehouses` ADD COLUMN `sort_order` integer DEFAULT 0;');
  }

  console.log('\n════ SAU ════');
  const afterCols = await cols('warehouses');
  console.log(`  warehouses.sort_order hiện có: ${afterCols.includes('sort_order')}`);

  const whList = await rows('SELECT id, name, sort_order, is_active FROM warehouses ORDER BY sort_order ASC, name ASC');
  console.log('\nDanh sách kho trên DB production:');
  console.table(whList);

  const stockCount = await rows('SELECT COUNT(*) as cnt, SUM(physical_quantity) as total FROM stock_balances');
  console.log('\nTồn kho thực tế (stock_balances) trên DB production:');
  console.table(stockCount);

  console.log('\n🎉 MIGRATION 0036 HOÀN TẤT THÀNH CÔNG!');
}

main().catch(console.error);
