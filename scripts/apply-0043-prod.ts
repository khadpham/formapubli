/**
 * ÁP MIGRATION 0043 vào DB PRODUCTION Turso (CHỈ THÊM 4 cột).
 *
 * CHẠY: ALLOW_PROD_WRITE=1 npx tsx scripts/apply-0043-prod.ts
 *
 * VÌ SAO CẦN: GĐ2 INSERT `recurrence` nhưng bảng prod chưa có cột ⇒ 500.
 * SQLite không có `ADD COLUMN IF NOT EXISTS` — script kiểm cột trước, đã có
 * thì bỏ qua (chạy lại vô hại). KHÔNG UPDATE/XOÁ gì.
 */
import { requireProdWriteConsent } from './prod-write-guard';

requireProdWriteConsent('migration 0043: ADD 4 cột expense_entries (staff_id/recurrence/updated_by/updated_at) — CHỈ THÊM');

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
const client = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

let pass = 0;
let fail = 0;
const STEPS: Array<{ label: string; column: string; sql: string }> = [
  { label: 'ADD COLUMN staff_id', column: 'staff_id', sql: "ALTER TABLE `expense_entries` ADD COLUMN `staff_id` text" },
  { label: 'ADD COLUMN recurrence', column: 'recurrence', sql: "ALTER TABLE `expense_entries` ADD COLUMN `recurrence` text NOT NULL DEFAULT 'ONE_TIME'" },
  { label: 'ADD COLUMN updated_by', column: 'updated_by', sql: "ALTER TABLE `expense_entries` ADD COLUMN `updated_by` text" },
  { label: 'ADD COLUMN updated_at', column: 'updated_at', sql: "ALTER TABLE `expense_entries` ADD COLUMN `updated_at` text" },
];

async function main() {
  console.log('\n=== ÁP 0043 vào PRODUCTION (CHỈ THÊM 4 cột) ===');
  const cols = await client.execute("PRAGMA table_info('expense_entries')");
  const have = new Set(cols.rows.map((r) => String(r.name)));
  for (const s of STEPS) {
    if (have.has(s.column)) {
      pass++;
      console.log(`  ⏩ Bỏ qua (đã có): ${s.label}`);
      continue;
    }
    try {
      await client.execute(s.sql);
      pass++;
      console.log(`  ✓ ${s.label}`);
    } catch (e: any) {
      fail++;
      console.log(`  ✗ ${s.label} — ${e?.message}`);
    }
  }
  // Verify.
  const after = await client.execute("PRAGMA table_info('expense_entries')");
  const haveAfter = new Set(after.rows.map((r) => String(r.name)));
  for (const s of STEPS) {
    if (haveAfter.has(s.column)) { pass++; console.log(`  ✓ verify ${s.column} có mặt`); }
    else { fail++; console.log(`  ✗ verify ${s.column} VẪN THIẾU`); }
  }
  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('\n❌ apply crash:', e?.message || e); process.exit(1); });
