/**
 * ÁP MIGRATION 0038–0042 + TK SHP-01 vào DB PRODUCTION Turso (CHỈ THÊM).
 *
 * CHẠY: ALLOW_PROD_WRITE=1 npx tsx scripts/apply-0038-0042-prod.ts
 *
 * VÌ SAO CẦN: Workers deploy code mới nhưng production Turso chưa có 6 bảng
 * (5 bảng Shopee + expense_entries) ⇒ /api/shopee/status + /api/owner/finance
 * 500 ⇒ tab Shopee "đang tắt", tab Chủ "Đang tải số liệu…" mãi mãi. SHP-01
 * (Nhân viên Shopee) cũng chưa có trong staff_accounts ⇒ không đăng nhập được.
 *
 * AN TOÀN:
 *  · CHỈ THÊM bảng/index/dòng — KHÔNG UPDATE/XOÁ gì cả.
 *  · `CREATE ... IF NOT EXISTS` (chạy lại vô hại); SHP-01 bỏ qua nếu đã có.
 *  · Guard `requireProdWriteConsent` — bắt buộc ALLOW_PROD_WRITE=1.
 *  · Không in token/passcode ra log.
 */
import { requireProdWriteConsent } from './prod-write-guard';

requireProdWriteConsent(
  'migration 0038-0042: tạo 5 bảng Shopee + expense_entries + thêm TK SHP-01 (CHỈ THÊM, KHÔNG UPDATE/XOÁ)'
);

import fs from 'node:fs';
import { createClient } from '@libsql/client';
import { pbkdf2Sync } from 'node:crypto';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

// PBKDF2-SHA256 đúng như pbkdf2Hex (src/lib/auth-session.ts:351-370):
// baseKey = `${passcode}:${salt}`, salt = `formapubli-staff-v2:${salt}`,
// 100k vòng, 32 bytes, hex. KHÔNG import src để tránh side effect src/db.
function staffHashV2(passcode: string, salt: string, iterations = 100000): string {
  const hex = pbkdf2Sync(
    `${passcode}:${salt}`,
    `formapubli-staff-v2:${salt}`,
    iterations,
    32,
    'sha256'
  ).toString('hex');
  return `v2$${iterations}$${hex}`;
}

function verifyStaff(passcode: string, salt: string, stored: string): boolean {
  const parts = `${stored || ''}`.split('$');
  if (parts[0] !== 'v2') return false;
  const iter = parseInt(parts[1] || '', 10) || 100000;
  const expected = (parts[2] || '').toLowerCase();
  return staffHashV2(passcode, salt, iter) === `v2$${iter}$${expected}`;
}

const url = env.TURSO_DATABASE_URL;
const token = env.TURSO_AUTH_TOKEN;
if (!url || !token) {
  console.error('❌ Thiếu TURSO_DATABASE_URL/TURSO_AUTH_TOKEN trong .env');
  process.exit(1);
}
const client = createClient({ url, authToken: token });

let pass = 0;
let fail = 0;
async function step(label: string, sql: string, guard?: { table: string }) {
  if (guard) {
    const exists = await client.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='${guard.table}'`
    );
    if (exists.rows.length > 0) {
      pass++;
      console.log(`  ⏩ Bỏ qua (đã có): ${label}`);
      return;
    }
  }
  try {
    await client.execute(sql);
    pass++;
    console.log(`  ✓ ${label}`);
  } catch (e: any) {
    fail++;
    console.log(`  ✗ ${label} — ${e?.message}`);
  }
}

async function main() {
  console.log('\n=== ÁP 0038–0042 + SHP-01 vào PRODUCTION (CHỈ THÊM) ===');

  await step('0038 CREATE TABLE shopee_shop_tokens', `CREATE TABLE IF NOT EXISTS \`shopee_shop_tokens\` (
  \`shop_id\` integer PRIMARY KEY,
  \`shop_name\` text,
  \`access_token\` text NOT NULL,
  \`refresh_token\` text NOT NULL,
  \`expired_at\` integer NOT NULL,
  \`refresh_expired_at\` integer NOT NULL,
  \`updated_at\` text DEFAULT CURRENT_TIMESTAMP
)`);

  await step('0039 CREATE TABLE shopee_item_map', `CREATE TABLE IF NOT EXISTS \`shopee_item_map\` (
  \`shop_id\` integer NOT NULL,
  \`edition_id\` text NOT NULL,
  \`item_id\` integer NOT NULL,
  \`model_id\` integer NOT NULL DEFAULT 0,
  \`updated_at\` text DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`shop_id\`, \`edition_id\`)
)`);

  await step('0040 CREATE TABLE shopee_order_finance', `CREATE TABLE IF NOT EXISTS \`shopee_order_finance\` (
  \`order_sn\` text PRIMARY KEY,
  \`buyer_total\` real NOT NULL DEFAULT 0,
  \`escrow_amount\` real NOT NULL DEFAULT 0,
  \`commission_fee\` real NOT NULL DEFAULT 0,
  \`transaction_fee\` real NOT NULL DEFAULT 0,
  \`service_fee\` real NOT NULL DEFAULT 0,
  \`seller_discount\` real NOT NULL DEFAULT 0,
  \`shopee_discount\` real NOT NULL DEFAULT 0,
  \`cogs\` real,
  \`net_profit\` real,
  \`synced_at\` text DEFAULT CURRENT_TIMESTAMP
)`);

  await step('0041 CREATE TABLE shopee_settings', `CREATE TABLE IF NOT EXISTS \`shopee_settings\` (
  \`key\` text PRIMARY KEY,
  \`value\` text NOT NULL,
  \`updated_at\` text DEFAULT CURRENT_TIMESTAMP
)`);

  await step('0041 CREATE TABLE shopee_quarantine', `CREATE TABLE IF NOT EXISTS \`shopee_quarantine\` (
  \`id\` text PRIMARY KEY,
  \`order_sn\` text NOT NULL,
  \`sku\` text NOT NULL DEFAULT '',
  \`reason\` text NOT NULL,
  \`resolved\` integer NOT NULL DEFAULT 0,
  \`created_at\` text DEFAULT CURRENT_TIMESTAMP
)`);

  await step('0041 CREATE INDEX idx_quarantine_unresolved', 'CREATE INDEX IF NOT EXISTS `idx_quarantine_unresolved` ON `shopee_quarantine` (`resolved`, `created_at`)');

  await step('0042 CREATE TABLE expense_entries', `CREATE TABLE IF NOT EXISTS \`expense_entries\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`category\` text NOT NULL,
  \`amount\` real NOT NULL,
  \`note\` text,
  \`entry_date\` text NOT NULL,
  \`created_by\` text NOT NULL,
  \`created_at\` text DEFAULT CURRENT_TIMESTAMP
)`);

  await step('0042 CREATE INDEX idx_expense_entries_date', 'CREATE INDEX IF NOT EXISTS `idx_expense_entries_date` ON `expense_entries` (`entry_date`)');

  // SHP-01: Nhân viên Shopee, PIN dev 6789 + salt_shp_01 (đổi trước go-live thật).
  // Đã có nhưng hash KHÔNG khớp thuật toán đúng (bản tạo sai ngày 06/10) →
  // đính chính hash của dòng này, không đụng dòng nào khác.
  const shp = await client.execute(
    "SELECT staff_id, passcode_hash, salt FROM staff_accounts WHERE staff_id='SHP-01'"
  );
  if (shp.rows.length === 0) {
    const hash = staffHashV2('6789', 'salt_shp_01');
    await client.execute({
      sql: "INSERT INTO staff_accounts (staff_id, full_name, role, passcode_hash, salt, is_active) VALUES ('SHP-01', 'Nhân viên Shopee', 'ROLE_SHOPEE_OPS', ?, 'salt_shp_01', 1)",
      args: [hash],
    });
    pass++;
    console.log('  ✓ INSERT staff SHP-01 (ROLE_SHOPEE_OPS, PIN dev 6789)');
  } else if (!verifyStaff('6789', 'salt_shp_01', String(shp.rows[0].passcode_hash))) {
    const hash = staffHashV2('6789', 'salt_shp_01');
    await client.execute({
      sql: "UPDATE staff_accounts SET passcode_hash = ? WHERE staff_id = 'SHP-01'",
      args: [hash],
    });
    pass++;
    console.log('  ✓ ĐÍNH CHÍNH hash SHP-01 (bản cũ dùng thuật toán sai)');
  } else {
    pass++;
    console.log('  ⏩ SHP-01 đã đúng hash');
  }

  // Verify sau khi áp: bảng + staff phải có mặt.
  console.log('\n--- VERIFY ---');
  const tables = await client.execute("SELECT name FROM sqlite_master WHERE type='table'");
  const have = new Set(tables.rows.map((r) => String(r.name)));
  for (const t of ['shopee_shop_tokens', 'shopee_item_map', 'shopee_order_finance', 'shopee_settings', 'shopee_quarantine', 'expense_entries']) {
    if (have.has(t)) { pass++; console.log(`  ✓ ${t} có mặt`); }
    else { fail++; console.log(`  ✗ ${t} VẪN THIẾU`); }
  }
  const staff = await client.execute("SELECT staff_id, role, is_active FROM staff_accounts WHERE staff_id='SHP-01'");
  if (staff.rows.length > 0) { pass++; console.log(`  ✓ SHP-01 ${JSON.stringify(staff.rows[0])}`); }
  else { fail++; console.log('  ✗ SHP-01 VẪN THIẾU'); }

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('\n❌ apply crash:', e?.message || e);
  process.exit(1);
});
