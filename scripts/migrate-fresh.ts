import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';

/**
 * Runner migrate fresh chuẩn của repo (thay cho `drizzle-kit migrate`).
 *
 * Lý do tồn tại: libsql client (dùng bởi drizzle-orm migrator lẫn
 * drizzle-kit CLI) choking với chunk pure-comment (vd. block /* *\/ ở cuối
 * 0003) và báo lỗi ma `SQLITE_OK: not an error`. Runner này đọc đúng thứ tự
 * meta/_journal.json, chạy từng statement riêng lẻ và BỎ QUA chunk chỉ còn
 * comment/trống — nội dung SQL gốc giữ nguyên 100%.
 *
 * - Mặc định TỪ CHỐI target formapubli.db (fresh provisioning không bao giờ
 *   trỏ vào DB prod). D1 fresh dùng `wrangler d1 migrations apply` (sqlite
 *   engine đọc comment bình thường).
 * - Dùng cho: setup-test-db, CI, dựng DB dev mới.
 */
export interface MigrateFreshOptions {
  targetUrl: string;
  expectTables?: string[];
}

interface JournalEntry {
  idx: number;
  tag: string;
}

export function stripToExecutable(chunk: string): string {
  const noBlockComments = chunk.replace(/\/\*[\s\S]*?\*\//g, '');
  const lines = noBlockComments
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .trim();
  return lines.replace(/--> statement-breakpoint/g, '').trim();
}

export async function migrateFresh(options: MigrateFreshOptions): Promise<{ appliedFiles: string[] }> {
  const { targetUrl, expectTables = [] } = options;

  if (/(^|[/:])formapubli\.db$/.test(targetUrl) && !targetUrl.startsWith('file:formapubli_test')) {
    throw new Error('REFUSED: migrate-fresh không bao giờ trỏ vào formapubli.db production!');
  }

  const journalPath = path.resolve(process.cwd(), 'src/db/migrations/meta/_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
  const entries: JournalEntry[] = [...journal.entries].sort((a, b) => a.idx - b.idx);

  const client = createClient({ url: targetUrl });
  const appliedFiles: string[] = [];

  for (const entry of entries) {
    const sqlPath = path.resolve(process.cwd(), 'src/db/migrations', `${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) {
      throw new Error(`Thiếu file migration cho journal idx ${entry.idx} (tag ${entry.tag}).`);
    }
    const raw = fs.readFileSync(sqlPath, 'utf-8');
    const chunks = raw.split('--> statement-breakpoint');
    let applied = 0;
    let skipped = 0;
    for (const chunk of chunks) {
      const stmt = stripToExecutable(chunk);
      if (!stmt) {
        skipped++;
        continue;
      }
      await client.execute(stmt);
      applied++;
    }
    appliedFiles.push(entry.tag);
    console.log(`  ✓ ${entry.tag}: ${applied} statements, bỏ qua ${skipped} chunk comment/trống.`);
  }

  if (expectTables.length > 0) {
    const rows = (await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    )).rows.map((r: any) => r.name ?? r[0]);
    const missing = expectTables.filter((t) => !rows.includes(t));
    if (missing.length > 0) {
      throw new Error(`Migrate fresh thiếu bảng: ${missing.join(', ')}`);
    }
    console.log(`  ✓ Đủ ${expectTables.length} bảng kỳ vọng.`);
  }

  client.close();
  return { appliedFiles };
}

const invokedAsScript =
  process.argv[1] && path.basename(process.argv[1]) === 'migrate-fresh.ts';

if (invokedAsScript) {
  const targetArg = process.argv.find((a) => a.startsWith('--target='))?.slice('--target='.length);
  const expectArg = process.argv.find((a) => a.startsWith('--expect='))?.slice('--expect='.length);
  migrateFresh({
    targetUrl: targetArg || 'file:formapubli_fresh.db',
    expectTables: expectArg ? expectArg.split(',').map((s) => s.trim()) : [],
  }).then(
    () => {
      console.log('✅ migrate-fresh hoàn tất.');
      process.exit(0);
    },
    (err) => {
      console.error('❌ migrate-fresh thất bại:', err);
      process.exit(1);
    }
  );
}
