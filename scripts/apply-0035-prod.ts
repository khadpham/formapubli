/**
 * CỔNG 3c — migration 0035 trên PRODUCTION: đường nối phê duyệt chiết khấu ↔ đơn.
 *
 * ⚠️ PHẢI chạy TRƯỚC khi deploy code đã merge. Không có cột này thì MỌI đơn có
 * phê duyệt trả 500: Drizzle `SELECT` đọc đúng danh sách cột của bảng `orders`,
 * nên thiếu `discount_approval_id` là chết ngay tại truy vấn.
 *
 * An toàn: chỉ ADD COLUMN NULLABLE + 2 index ⇒ không đụng dữ liệu cũ, không cần
 * backfill, không khóa bảng ghi.
 *
 * CÁCH CHẠY (coordinator, không tự chạy):
 *   npx tsx scripts/apply-0035-prod.ts
 * Chạy lại lần hai là an toàn — script tự bỏ qua cột đã có.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { requireExplicitTarget } from './prod-write-guard';

const env = Object.fromEntries(
  fs
    .readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const SQL_FILE = path.resolve(process.cwd(), 'src/db/migrations/0035_order_discount_approval.sql');

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
  const count = async (t: string) => {
    try {
      return Number((await rows(`SELECT COUNT(*) n FROM \`${t}\``))[0]?.n || 0);
    } catch {
      return -1;
    }
  };

  console.log('\n════ TRƯỚC ════');
  const before = {
    orders: await count('orders'),
    approvals: await count('discount_approval_requests'),
  };
  console.log(`  orders                          : ${before.orders}`);
  console.log(`  discount_approval_requests      : ${before.approvals}`);
  console.log(`  orders.discount_approval_id     : ${(await cols('orders')).includes('discount_approval_id')}`);
  console.log(
    `  approvals.client_order_code     : ${(await cols('discount_approval_requests')).includes('client_order_code')}`
  );

  const sql = fs.readFileSync(SQL_FILE, 'utf8');
  const statements = sql
    .split('--> statement-breakpoint')
    .map((c) =>
      c
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n')
        .trim()
    )
    .filter(Boolean);

  console.log(`\n════ CHẠY ${statements.length} CÂU ════`);
  for (let i = 0; i < statements.length; i++) {
    const head = statements[i].replace(/\s+/g, ' ').slice(0, 64);
    // `ALTER TABLE ADD COLUMN` không có `IF NOT EXISTS`; chạy lại lần hai sẽ
    // báo lỗi. Bỏ qua câu đó nếu cột đã có — script idempotent.
    const addCol = /^ALTER TABLE\s+`?(\w+)`?\s+ADD COLUMN\s+`?(\w+)`?/i.exec(statements[i]);
    if (addCol && (await cols(addCol[1])).includes(addCol[2])) {
      console.log(`  ▸ ${i + 1}/${statements.length}  bỏ qua (đã có ${addCol[1]}.${addCol[2]})`);
      continue;
    }
    const idx = /^CREATE INDEX\s+`?(\w+)`?/i.exec(statements[i]);
    if (idx) {
      const exists = await rows(
        `SELECT name FROM sqlite_master WHERE type='index' AND name='${idx[1]}'`
      );
      if (exists.length > 0) {
        console.log(`  ▸ ${i + 1}/${statements.length}  bỏ qua (đã có index ${idx[1]})`);
        continue;
      }
    }
    try {
      await db.execute(statements[i]);
      console.log(`  ✓ ${i + 1}/${statements.length}  ${head}`);
    } catch (e: any) {
      console.error(`\n❌ DỪNG Ở CÂU ${i + 1}: ${head}`);
      console.error(`   ${e?.message || e}`);
      process.exit(1);
    }
  }

  console.log('\n════ SAU ════');
  console.log(`  orders                          : ${await count('orders')} (trước ${before.orders})`);
  console.log(`  discount_approval_requests      : ${await count('discount_approval_requests')} (trước ${before.approvals})`);
  const hasOrderCol = (await cols('orders')).includes('discount_approval_id');
  const hasClientCol = (await cols('discount_approval_requests')).includes('client_order_code');
  console.log(`  orders.discount_approval_id     : ${hasOrderCol ? '✅ có' : '❌ thiếu'}`);
  console.log(`  approvals.client_order_code     : ${hasClientCol ? '✅ có' : '❌ thiếu'}`);

  const idxRows = await rows(
    `SELECT name FROM sqlite_master WHERE type='index'
      AND name IN ('idx_orders_discount_approval','idx_disc_appr_client_order')`
  );
  console.log(`  index                           : ${idxRows.map((r) => r.name).join(', ') || '❌ thiếu'}`);

  const fk = await rows(`PRAGMA foreign_key_check`);
  const ig = await rows(`PRAGMA integrity_check`);
  console.log(`  foreign_key_check               : ${fk.length === 0 ? 'SẠCH ✅' : `❌ ${fk.length}`}`);
  console.log(`  integrity_check                 : ${Object.values(ig[0])[0]}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('❌', e?.message || e);
  process.exit(1);
});