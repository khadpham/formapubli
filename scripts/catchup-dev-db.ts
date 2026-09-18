/**
 * Vá cộng thêm (catch-up) cho DB dev/team-test cũ thiếu migration 0011→0016.
 *
 * Bối cảnh: formapubli.db dựng từ thời db:push cũ, thiếu bảng staff_accounts
 * (0015) và các bảng 0011-0014/0016 khiến /api/auth/accounts 500 và modal
 * login rơi về nhập tay. DB đang có dữ liệu thật nên TUYỆT ĐỐI không dựng mới.
 *
 * - Mặc định --dry-run: chỉ báo thiếu gì, không ghi 1 byte.
 * - Chạy thật: npx tsx scripts/catchup-dev-db.ts --confirm [--target=file:formapubli.db]
 * - Câu lệnh CREATE TABLE/INDEX đã tồn tại được bỏ qua (không lỗi).
 * - Seed 6 tài khoản ca idempotent: chỉ thêm mã còn thiếu, không ghi đè PIN.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { stripToExecutable } from './migrate-fresh';
import { DEFAULT_STAFF_ACCOUNTS, hashStaffPasscodeV2 } from '../src/lib/auth-session';

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');
const targetArg = args.find((a) => a.startsWith('--target='))?.slice('--target='.length);
const targetUrl = targetArg || 'file:formapubli.db';

async function main() {
  if (!targetUrl.startsWith('file:')) {
    throw new Error('REFUSED: catch-up chỉ chạy trên file: local (không chạy remote/D1).');
  }
  // Chốt chặn test-guard không áp ở đây (script chủ đích chạm DB dev),
  // nhưng cấm tuyệt đối trỏ vào file test để khỏi phá DB cách ly.
  if (targetUrl.includes('formapubli_test')) {
    throw new Error('REFUSED: không vá vào DB test cách ly.');
  }

  const journalPath = path.resolve(process.cwd(), 'src/db/migrations/meta/_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
  const entries = [...journal.entries]
    .sort((a: any, b: any) => a.idx - b.idx)
    .filter((e: any) => e.idx >= 11);

  const client = createClient({ url: targetUrl });
  console.log(`🎯 Target: ${targetUrl} (${confirm ? 'CONFIRM — sẽ ghi' : 'DRY-RUN — chỉ đọc'})`);

  // 1. Kiểm tra bảng đã có.
  const existing = new Set(
    (await client.execute(`SELECT name FROM sqlite_master WHERE type='table'`)).rows.map(
      (r: any) => `${r.name ?? r[0]}`
    )
  );

  // 2. Áp từng migration thiếu (bỏ qua "already exists").
  for (const entry of entries) {
    const sqlPath = path.resolve(process.cwd(), 'src/db/migrations', `${entry.tag}.sql`);
    const raw = fs.readFileSync(sqlPath, 'utf-8');
    let applied = 0;
    let skipped = 0;
    for (const chunk of raw.split('--> statement-breakpoint')) {
      const stmt = stripToExecutable(chunk);
      if (!stmt) {
        skipped++;
        continue;
      }
      if (!confirm) continue;
      try {
        await client.execute(stmt);
        applied++;
      } catch (err: any) {
        const msg = `${err?.message || err}`;
        if (/already exists/i.test(msg)) {
          skipped++;
          continue;
        }
        throw err;
      }
    }
    console.log(
      `${confirm ? '✓' : '○'} ${entry.tag}: ${confirm ? `${applied} applied, ${skipped} bỏ qua` : 'sẽ áp khi --confirm'}`
    );
  }

  // 3. Seed tài khoản ca (idempotent).
  const hasStaffTable = confirm
    ? true
    : existing.has('staff_accounts');
  if (!hasStaffTable) {
    console.log('○ staff_accounts: bảng chưa có → sẽ seed sau khi migration 0015 được áp (--confirm).');
  } else {
    const rows = (await client.execute('SELECT staff_id FROM staff_accounts')).rows.map(
      (r: any) => `${r.staff_id ?? r[0]}`
    );
    const missing = DEFAULT_STAFF_ACCOUNTS.filter((s) => !rows.includes(s.staffId));
    console.log(`○ staff_accounts: có ${rows.length}, thiếu ${missing.length} (${missing.map((m) => m.staffId).join(', ') || 'không thiếu'}).`);
    if (confirm) {
      for (const s of missing) {
        await client.execute({
          sql: 'INSERT INTO staff_accounts (staff_id, full_name, role, passcode_hash, salt, is_active) VALUES (?, ?, ?, ?, ?, 1)',
          args: [s.staffId, s.fullName, s.role, await hashStaffPasscodeV2(s.passcode, s.salt), s.salt],
        });
        console.log(`  + đã thêm ${s.staffId} (${s.role}).`);
      }
    }
  }

  client.close();
  if (!confirm) console.log('\nℹ️ DRY-RUN xong, chưa ghi gì. Chạy lại với --confirm để vá thật.');
  else console.log('\n🎉 Catch-up xong. Kiểm tra lại /api/auth/accounts.');
}

main().catch((err) => {
  console.error('❌ catch-up thất bại:', err?.message || err);
  process.exit(1);
});
