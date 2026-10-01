/**
 * scripts/restore-prod.ts — KHÔI PHỤC DB từ file backup của `backup-prod.ts`.
 *
 * ⚠️ CỰC KỲ NGUY HIỂM. Script này GHI ĐÈ dữ liệu. Mặc định CHẠY THỬ (dry-run)
 * và chỉ ghi khi truyền `--thuc-hien` + `ALLOW_REMOTE_TARGET=<host>` khớp.
 *
 * GIỚI HẠN ĐÃ BIẾT — đọc trước khi dựa vào:
 * File backup CHỈ chứa câu `INSERT`, KHÔNG chứa `CREATE TABLE`. Nên khôi phục
 * ĐÒNG HỎI khi bảng còn tồn tại, và **HỎNG** khi bảng đã bị `DROP` (trường hợp
 * 0032 hỏng giữa chừng). Với trường hợp DROP thì phải tạo schema trước — xem
 * `apply-0032-prod.ts`.
 *
 * `--tao-schema` sẽ nạp DDL từ các file migration vào DB đích TRƯỚC khi nạp dữ
 * liệu, để phủ trường hợp bảng đã bị mất.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { requireExplicitTarget } from './prod-write-guard';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

function die(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const fileArg = args.find((a) => !a.startsWith('--'));
  const doIt = args.includes('--thuc-hien');
  const makeSchema = args.includes('--tao-schema');

  if (!fileArg) die('Thiếu đường dẫn file backup. Ví dụ: backups/prod-backup-<...>.sql');
  if (!fs.existsSync(fileArg)) die(`Không thấy file: ${fileArg}`);

  const targetUrl = process.env.DATABASE_URL || env.TURSO_DATABASE_URL;
  requireExplicitTarget(targetUrl);
  const isLocal = targetUrl.startsWith('file:');

  const db = createClient({ url: targetUrl, authToken: isLocal ? undefined : env.TURSO_AUTH_TOKEN });
  const q = async (s: string) => (await db.execute(s)).rows as any[];

  // --- Đếm trước / sau, để báo cáo trung thực.
  const snapshot = async () => {
    const out: Record<string, number> = {};
    for (const t of ['works', 'editions', 'warehouses', 'orders', 'order_items', 'stock_balances']) {
      try {
        out[t] = Number((await q(`SELECT COUNT(*) n FROM \`${t}\``))[0]?.n || 0);
      } catch {
        out[t] = -1;
      }
    }
    return out;
  };

  const before = await snapshot();
  console.log('\n════ ĐÍCH ════');
  console.log(`  ${isLocal ? 'DB LOCAL (dry-run)' : 'DB TỪ XA'}`);
  console.log(`  ${targetUrl.split('@').pop() || targetUrl}`);
  console.log(`  File : ${fileArg}`);
  console.log(`  Chế độ: ${doIt ? 'THỰC HIỆN' : 'CHỈ XEM (không ghi)'}`);
  console.log(`  Tạo schema: ${makeSchema ? 'có' : 'không'}`);

  console.log('\n════ TRẠNG THÁI ĐÍCH TRƯỚC ════');
  for (const [k, v] of Object.entries(before)) {
    console.log(`  ${k}: ${v === -1 ? 'BẢNG KHÔNG TỒN TẠI ⚠️' : v}`);
  }

  const raw = fs.readFileSync(fileArg, 'utf8');
  // BỎ comment dòng TRƯỚC khi tách. File backup viết `-- tên_bảng (N dòng)` giữa
  // các câu; không bỏ thì regex tách theo `;` không khớp và chỉ nhận 1 câu.
  const noComments = raw
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  const statements = noComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => /^INSERT INTO/i.test(s));

  console.log(`\n════ FILE BACKUP ════`);
  console.log(`  Câu INSERT: ${statements.length}`);

  if (!doIt) {
    console.log('\n🧪 DRY-RUN. Không có gì được ghi.');
    console.log('   Muốn ghi thật: thêm --thuc-hien');
    if (before.editions === -1) {
      console.log('\n   ⚠️ Bảng `editions` không tồn tại ⇒ cần thêm --tao-schema');
    }
    return;
  }

  if (makeSchema) {
    console.log('\n════ NẠP SCHEMA ════');
    const migDir = path.resolve(process.cwd(), 'src/db/migrations');
    const files = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      // PHẢI bỏ TỪNG DÒNG comment, không bỏ CẢ CHUNK khi chunk bắt đầu bằng
      // `--`. Cách sai đó nuốt luôn `CREATE TABLE` đứng sau khối comment →
      // bảng không được tạo → các câu sau báo "no such table". Đã xảy ra thật
      // và làm khôi phục mất 4 bảng.
      const sql = fs
        .readFileSync(path.join(migDir, f), 'utf8')
        .split('--> statement-breakpoint')
        .map((chunk) =>
          chunk
            .split('\n')
            .filter((l) => !l.trim().startsWith('--'))
            .join('\n')
            .trim()
        )
        .filter(Boolean);
      for (const s of sql) {
        try {
          await db.execute(s);
        } catch (e: any) {
          // ALTER TABLE ADD COLUMN không có IF NOT EXISTS nên chạy lại sẽ báo lỗi
          // — bỏ qua, vì schema ta cần là "đã có bảng/cột", phần thừa không sao.
          if (!/duplicate column name|already exists/i.test(String(e?.message))) {
            console.log(`  ⚠️  ${f}: ${String(e?.message || e).slice(0, 80)}`);
          }
        }
      }
      console.log(`  ✓ ${f}`);
    }
  }

  console.log('\n════ NẠP DỮ LIỆU ════');
  let okCount = 0;
  let failCount = 0;
  for (const s of statements) {
    const m = s.match(/INSERT INTO `([^`]+)`/);
    try {
      await db.execute(s);
      okCount++;
    } catch (e: any) {
      failCount++;
      const msg = String(e?.message || e);
      // Bản ghi đã tồn tại thì coi như đã có — không phải lỗi khôi phục.
      if (!/UNIQUE constraint failed/i.test(msg)) {
        console.log(`  ⚠️  ${m?.[1] || '?'}: ${msg.slice(0, 90)}`);
      }
    }
  }
  console.log(`  thành công: ${okCount}, lỗi: ${failCount}`);

  const after = await snapshot();
  console.log('\n════ KẾT QUẢ ════');
  for (const [k, v] of Object.entries(after)) {
    const b = before[k];
    console.log(`  ${k}: ${b} → ${v}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('❌', e?.message || e);
  process.exit(1);
});