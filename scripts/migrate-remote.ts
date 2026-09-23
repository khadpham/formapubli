/**
 * Migrate DB remote (Turso) cho go-live — chạy 1 lần từ máy local.
 *
 *   # PowerShell
 *   $env:TURSO_DATABASE_URL="libsql://...turso.io"; $env:TURSO_AUTH_TOKEN="..."; npx tsx scripts/migrate-remote.ts
 *   # bash
 *   TURSO_DATABASE_URL="libsql://..." TURSO_AUTH_TOKEN="..." npx tsx scripts/migrate-remote.ts
 *
 * Chạy lại an toàn (idempotent): CREATE TABLE IF NOT EXISTS + ALTER... lưu ý
 * SQLite không có IF NOT EXISTS cho ADD COLUMN — migrate-fresh chạy fresh,
 * nên script này CHỈ dùng cho DB trống lần đầu. Nâng cấp DB đã có dữ liệu:
 * dùng drizzle-kit push với credential tương ứng.
 */
import { migrateFresh } from './migrate-fresh';

const EXPECTED_TABLES = [
  'orders',
  'order_items',
  'inventory_ledger',
  'stock_balances',
  'staff_accounts',
  'audit_logs',
  'editions',
  'works',
  'bank_accounts',
  'login_attempt_buckets',
];

async function main() {
  const url = `${process.env.TURSO_DATABASE_URL || ''}`.trim();
  const token = `${process.env.TURSO_AUTH_TOKEN || ''}`.trim();
  if (!url.startsWith('libsql://') && !url.startsWith('https://')) {
    console.error('REFUSED: TURSO_DATABASE_URL phải là URL remote (libsql://... hoặc https://...).');
    process.exit(1);
  }
  if (!token) {
    console.error('REFUSED: thiếu TURSO_AUTH_TOKEN.');
    process.exit(1);
  }
  const { appliedFiles } = await migrateFresh({ targetUrl: url, authToken: token, expectTables: EXPECTED_TABLES });
  console.log(`OK: applied ${appliedFiles.length} migration files lên Turso.`);
  console.log('Tiếp theo: seed danh mục (DATABASE_URL remote + npx tsx scripts/seed.ts), rồi bootstrap owner.');
}

main().catch((err) => {
  console.error('Migrate remote thất bại:', err?.message || err);
  process.exit(1);
});
