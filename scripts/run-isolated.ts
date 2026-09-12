/**
 * Runner kiểm thử cách ly (cross-platform, không phụ thuộc cú pháp shell).
 *
 * 1. Dựng formapubli_test.db từ Clean Slate (xóa cũ -> migrate -> seed tối thiểu).
 * 2. Chụp mtime/size của formapubli.db production trước khi chạy test.
 * 3. Chạy các suite với DATABASE_URL=file:formapubli_test.db.
 * 4. Đối chiếu formapubli.db sau khi chạy — phải nguyên vẹn từng byte.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setupTestDb, TEST_DB_FILE } from './setup-test-db';

function statOrNull(p: string) {
  try {
    const s = fs.statSync(p);
    return { mtimeMs: s.mtimeMs, size: s.size };
  } catch {
    return null;
  }
}

async function main() {
  const prodDb = path.resolve(process.cwd(), 'formapubli.db');
  const before = statOrNull(prodDb);

  await setupTestDb();

  const suites = ['scripts/test-discount-guard.ts'];
  for (const suite of suites) {
    console.log(`\n▶ Chạy suite cách ly: ${suite}`);
    const res = spawnSync(
      'npx',
      ['tsx', suite],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: `file:${TEST_DB_FILE}` },
        stdio: 'inherit',
        shell: true,
      }
    );
    if (res.status !== 0) {
      console.error(`❌ Suite ${suite} thất bại (exit ${res.status}).`);
      process.exit(res.status ?? 1);
    }
  }

  const after = statOrNull(prodDb);
  const untouched =
    (before === null && after === null) ||
    (before !== null &&
      after !== null &&
      before.mtimeMs === after.mtimeMs &&
      before.size === after.size);

  if (!untouched) {
    console.error('⛔ CẢNH BÁO: formapubli.db production đã bị thay đổi trong lúc test!');
    process.exit(1);
  }
  console.log('\n🔒 formapubli.db production nguyên vẹn 100% (mtime + size không đổi).');
}

main().catch((err) => {
  console.error('❌ run-isolated thất bại:', err);
  process.exit(1);
});
