import fs from 'node:fs';
import path from 'node:path';

/**
 * 2.4 — Snapshot SQLite local định kỳ (prodops).
 * Copy formapubli.db (+ sidecar -wal/-shm/-journal nếu có) vào backups/
 * với timestamp. Chạy tay hoặc gắn cron OS:
 *   npx tsx scripts/backup-db.ts [--source=formapubli.db] [--dir=backups]
 * D1 Cloudflare dùng cơ chế backup riêng, không qua script này.
 * Tuyệt đối không trỏ vào DB test (file vô nghĩa, phí đĩa).
 */
function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => `${n}`.padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function main() {
  const source = path.resolve(process.cwd(), arg('source', 'formapubli.db'));
  const dir = path.resolve(process.cwd(), arg('dir', 'backups'));

  if (path.basename(source) === 'formapubli_test.db' || source.includes('formapubli_test_review')) {
    throw new Error('REFUSED: không backup DB test/cách ly.');
  }
  if (!fs.existsSync(source)) {
    throw new Error(`Không thấy file DB nguồn: ${source}`);
  }
  fs.mkdirSync(dir, { recursive: true });

  const copied: string[] = [];
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const src = source + suffix;
    if (!fs.existsSync(src)) continue;
    const base = path.basename(source, '.db') || 'db';
    const dest = path.join(dir, `${base}-${stamp()}${suffix || '.db'}`);
    fs.copyFileSync(src, dest);
    copied.push(dest);
  }

  // Đối soát toàn vẹn: so byte size nguồn/đích file chính
  const main = copied.find((p) => p.endsWith('.db'));
  if (main) {
    const a = fs.statSync(source).size;
    const b = fs.statSync(main).size;
    if (a !== b) throw new Error(`Lệch toàn vẹn backup: nguồn ${a}B vs đích ${b}B.`);
  }
  console.log(`✅ Backup xong ${copied.length} file vào ${dir}:`);
  for (const p of copied) console.log(`   - ${p}`);
}

main().catch((err) => {
  console.error('❌ backup-db thất bại:', err.message || err);
  process.exit(1);
});
