/**
 * Kiểm tra DB dev (file:formapubli.db) đã đủ bảng của các migration chưa.
 * CHỈ ĐỌC — không sửa gì.
 */
import fs from 'node:fs';
import { createClient } from '@libsql/client';

async function main() {
  const db = createClient({ url: 'file:formapubli.db' });
  const t = await db.execute(`SELECT name FROM sqlite_master WHERE type='table'`);
  const have = new Set((t.rows as any[]).map((r) => String(r.name)));

  const dir = 'src/db/migrations';
  const migs = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const missing: string[] = [];
  for (const m of migs) {
    const sqlTxt = fs.readFileSync(`${dir}/${m}`, 'utf8');
    const tables = Array.from(
      sqlTxt.matchAll(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+[`"]?(\w+)/gi)
    ).map((x) => x[1]);
    if (tables.length && !tables.every((x) => have.has(x))) {
      missing.push(`${m} -> thiếu: ${tables.filter((x) => !have.has(x)).join(', ')}`);
    }
  }

  console.log(`Số bảng hiện có trong DB dev: ${have.size}`);
  console.log('Migration còn thiếu bảng:');
  if (!missing.length) console.log('  (không thiếu bảng nào)');
  missing.forEach((m) => console.log(`  ${m}`));

  const triggers = await db.execute(`SELECT name FROM sqlite_master WHERE type='trigger'`);
  console.log(`\nTrigger hiện có: ${(triggers.rows as any[]).map((r) => r.name).join(', ') || '(không có)'}`);
  process.exit(0);
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
