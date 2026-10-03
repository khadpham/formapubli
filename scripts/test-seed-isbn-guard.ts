/**
 * scripts/test-seed-isbn-guard.ts — cổng chặn ISBN ở `scripts/seed.ts`.
 *
 * VÌ SAO CẦN: `seed.ts:228` là `onConflictDoUpdate({ target: editions.code, set:
 * editionRecord })` — GHI ĐÈ toàn bộ 88 ấn bản mỗi lần chạy. Ngày 03/10/2026 2
 * cuốn lọt ISBN sai lên production (`ed-h66` sai số kiểm, `ed-h41` đảo số 3–4)
 * đúng vì không có gì hỏi "mã này có đúng không" trước khi ghi.
 *
 * Test này chạy `seed.ts` thật như một tiến trình con trên DB RIÊNG
 * (`formapubli_test_seedisbn.db`) với CSV RIÊNG đã cố tình làm hỏng, rồi hỏi DB
 * kết quả: dòng hỏng phải KHÔNG có mặt, dòng sạch phải có, và mã miễn (H85)
 * vẫn phải vào.
 *
 * ⚠ Không chạy song song với DB test dùng chung (`formapubli_test.db`) — script
 * này tự migrate DB riêng.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createClient } from '@libsql/client';
import { migrateFresh } from './migrate-fresh';
import { isValidIsbn13 } from '../src/lib/isbn';

const DB_FILE = 'formapubli_test_seedisbn.db';
const CSV_FILE = 'formapubli_test_seedisbn.csv';

// 1 dòng thật trong danh mục, checksum hợp lệ. `9780306406158` = ĐỔI SỐ CUỐI
// của mã chuẩn `9780306406157` ⇒ sai checksum (đúng dạng lỗi ed-h66).
const GOOD_ISBN = '9780306406157';
const BAD_ISBN = '9780306406158';
assert.ok(isValidIsbn13(GOOD_ISBN), 'ISBN mẫu hợp lệ phải hợp lệ');
assert.ok(!isValidIsbn13(BAD_ISBN), 'ISBN mẫu hỏng phải hỏng — nếu không test vô nghĩa');

const row = (code: string, isbn: string, title: string) =>
  `Test,${code},${isbn},${title},10000,10 x 15 cm,100,Test Author,Test,,New,Văn học,2026,NXB Test,không`;

/** libsql trên Windows giữ handle vài giây sau khi tiến trình con đã thoát. */
function removeWithRetry(p: string) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (!fs.existsSync(p)) return;
    try {
      fs.unlinkSync(p);
      return;
    } catch (err: any) {
      if ((err.code === 'EBUSY' || err.code === 'EPERM') && attempt < 39) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
      } else {
        throw err;
      }
    }
  }
}

let checks = 0;
const ok = (c: boolean, m: string) => { checks++; assert.ok(c, m); };

async function main() {
  const dbPath = path.resolve(process.cwd(), DB_FILE);
  const csvPath = path.resolve(process.cwd(), CSV_FILE);
  assert.ok(dbPath.includes('formapubli_test'), 'DB test phải nằm trong formapubli_test*');

  for (const p of [dbPath, csvPath]) {
    for (const s of ['', '-wal', '-shm', '-journal']) removeWithRetry(p + s);
  }
  // CSV riêng: toàn bộ danh mục thật + 1 dòng sạch + 1 dòng hỏng checksum.
  const realCsv = fs
    .readFileSync(path.join(process.cwd(), 'data_tabs', 'sheet1_danhmuc_gid_0.csv'), 'utf8')
    .replace(/^\uFEFF/, '');
  fs.writeFileSync(
    csvPath,
    realCsv + row('ZZ998', GOOD_ISBN, 'Sach thu nghiem hop le') + '\n' +
      row('ZZ999', BAD_ISBN, 'Sach thu nghiem hong checksum') + '\n',
    'utf8'
  );

  await migrateFresh({ targetUrl: `file:${dbPath}` });

  const isWin = process.platform === 'win32';
  const res = spawnSync(
    isWin ? 'cmd.exe' : 'npx',
    isWin ? ['/c', 'npx', 'tsx', 'scripts/seed.ts'] : ['tsx', 'scripts/seed.ts'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: `file:${dbPath}`,
        SEED_CSV_PATH: csvPath,
        NODE_ENV: 'test',
      },
      encoding: 'utf8',
      shell: false,
    }
  );
  const out = `${res.stdout || ''}\n${res.stderr || ''}`;
  ok(res.status === 0, `seed.ts phải chạy xong (exit ${res.status})\n${out.slice(-2000)}`);

  const db = createClient({ url: `file:${dbPath}` });
  const rows = (await db.execute({ sql: `SELECT code, isbn FROM editions`, args: [] })).rows as any[];
  const byCode = new Map(rows.map((r) => [String(r.code), String(r.isbn)]));
  const found = (c: string) => byCode.get(c);

  // --- 1. DÒNG HỎNG CHECKSUM PHẢI BỊ CHẶN ---
  ok(!found('ZZ999'), `dòng ISBN sai checksum (ZZ999) phải KHÔNG được insert. Thực tế: ${found('ZZ999')}`);
  ok(
    out.includes('ZZ999'),
    'seed phải IN CẢNH BÁO to (bỏ qua âm thầm là hỏng — lần sau ai đó tưởng đã nhập)'
  );

  // --- 2. DÒNG SẠCH VẪN PHẢI VÀO ---
  ok(found('ZZ998') === GOOD_ISBN, `dòng ISBN hợp lệ (ZZ998) phải được insert. Thực tế: ${found('ZZ998')}`);

  // --- 3. MÃ MIỄN PHẢI VẪN VÀO (H85 = 14 số, chủ bảo giữ nguyên) ---
  // Nếu cổng chặn nuốt luôn H85 thì danh mục mất 1 cuốn thật, đang có tồn và
  // đơn trên production, và DB test lệch production (87 vs 88 ấn bản).
  ok(found('H85') === '97863203176313', `mã miễn H85 (14 số) phải vẫn vào danh mục. Thực tế: ${found('H85')}`);

  // --- 4. ISBN TRÙNG PHẢI ĐƯỢC BÁO CÁO (không chặn) ---
  ok(
    out.includes('9786044737690') && /HH032/.test(out) && /HH042/.test(out),
    'phải BÁO CÁO ISBN trùng đang dùng cho N ấn bản (trùng là hợp lệ — NXB tái bản chung mã)'
  );
  ok(Boolean(byCode.get('HH032') && byCode.get('HH042')), 'cả 2 ấn bản trùng ISBN vẫn phải được insert');

  // --- 5. ISBN HỢP LỆ KHÔNG ĐƯỢC BỊ CHẶN NHẦM ---
  const realBad = rows.filter((r) => !isValidIsbn13(String(r.isbn)));
  ok(
    realBad.length === 1 && realBad[0].code === 'H85',
    `trong danh mục thật chỉ được còn đúng 1 ISBN không chuẩn (H85). Thực tế: ${JSON.stringify(realBad.map((r) => r.code))}`
  );

  // --- 6. DB TEST KHÔNG ĐƯỢC LỆCH VỚI SEED ---
  // `setup-test-db.ts` chép logic của `seed.ts` để dựng DB test. Chỉ chặn ở
  // `seed.ts` thì dòng CSV hỏng vẫn vào DB test ⇒ 149 suite xanh trong khi
  // production đã bỏ dòng đó, tức test nói dối. Suite này không chạy
  // `setup-test-db.ts` (quá nặng), nên khoá bằng cách đòi CÙNG một lời gọi hàm.
  const setup = fs.readFileSync(path.join(process.cwd(), 'scripts', 'setup-test-db.ts'), 'utf8');
  ok(
    /isbnBlockReason\(isbn\)/.test(setup),
    'setup-test-db.ts phải dùng cùng cổng chặn ISBN với seed.ts'
  );

  db.close();
  // CHỈ xoá CSV. File `.db` KHÔNG xoá được trong chính tiến trình này: libsql
  // `file:` giữ handle tới khi tiến trình thoát (đo thử: retry 10s vẫn EBUSY), và
  // `setup-test-db.ts` cũng vậy — repo vốn để lại `formapubli_test*.db` cho tới
  // lần chạy sau. File này đã nằm trong `.gitignore` (`formapubli_test*.db`) và
  // đầu `main()` đã xoá nó trước khi dựng lại.
  for (const s of ['', '-wal', '-shm', '-journal']) removeWithRetry(csvPath + s);
  console.log(`\n=== CỔNG CHẶN ISBN Ở SEED: ${checks} assertions PASS ===`);
}

main().catch((e) => {
  console.error('❌ test-seed-isbn-guard thất bại:', e.message);
  process.exit(1);
});
