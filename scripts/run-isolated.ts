/**
 * Runner kiểm thử cách ly (cross-platform, không phụ thuộc cú pháp shell).
 *
 * - Mặc định: dựng formapubli_test.db từ Clean Slate (full seed 81 ấn bản),
 *   chạy TOÀN BỘ suites với DATABASE_URL=file:formapubli_test.db,
 *   rồi đối chiếu formapubli.db production phải nguyên vẹn từng byte.
 * - Lọc suite:  npx tsx scripts/run-isolated.ts --only=test-p0,test-d3-d4
 * - Bỏ qua setup (dùng DB test hiện có): ... --no-setup
 * - Liệt kê suites: ... --list
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setupTestDb, TEST_DB_FILE } from './setup-test-db';

const ALL_SUITES = [
  'scripts/test-discount-guard.ts',
  'scripts/test-p0-verification.ts',
  'scripts/test-inventory.ts',
  'scripts/test-order-sales.ts',
  'scripts/test-offline-engine.ts',
  'scripts/test-in-transit.ts',
  'scripts/test-consignment.ts',
  'scripts/test-settlement.ts',
  'scripts/test-clean-slate.ts',
  'scripts/test-bundle-engine.ts',
  'scripts/test-d3-d4.ts',
  'scripts/test-master-audit.ts',
  'scripts/test-vietnamese-search.ts',
  'scripts/test-barcode-engine.ts',
  'scripts/test-forecast.ts',
  'scripts/test-royalties.ts',
  'scripts/test-returns.ts',
  'scripts/test-online-orders.ts',
  'scripts/test-smart-parser.ts',
  'scripts/test-shipments.ts',
  'scripts/test-customer-tags.ts',
  'scripts/test-sponsorships.ts',
  'scripts/test-analytics.ts',
  'scripts/test-order-guards.ts',
  'scripts/test-patch02-laneA.ts',
  'scripts/test-patch02-laneB.ts',
  'scripts/test-pending-view.ts',
  'scripts/test-auth-gateway.ts',
  'scripts/test-auth-rbac.ts',
  'scripts/test-phase0-laneA.ts',
  'scripts/test-cp3-transfer-concurrency.ts',
  'scripts/test-cp3-migrations.ts',
  'scripts/test-cp3-return-concurrency.ts',
  'scripts/test-cp3-return-complete.ts',
  'scripts/test-cp3-return-exchange-void.ts',
  'scripts/test-cp3-reconciliation.ts',
  'scripts/eval-executive-ai.ts',
  'scripts/test-voice-order.ts',
  'scripts/test-monthly-digest.ts',
  'scripts/test-reader-persona.ts',
];

function suiteShortName(p: string): string {
  return path.basename(p, '.ts');
}

function statOrNull(p: string) {
  try {
    const s = fs.statSync(p);
    return { mtimeMs: s.mtimeMs, size: s.size };
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    console.log('Suites kiểm thử cách ly:');
    for (const s of ALL_SUITES) console.log(` - ${suiteShortName(s)} (${s})`);
    return;
  }

  const onlyArg = args.find((a) => a.startsWith('--only='));
  const suites = onlyArg
    ? ALL_SUITES.filter((s) =>
        onlyArg
          .slice('--only='.length)
          .split(',')
          .map((x) => x.trim())
          .includes(suiteShortName(s))
      )
    : ALL_SUITES;

  if (suites.length === 0) {
    console.error(`⛔ --only không khớp suite nào. Dùng --list để xem danh sách.`);
    process.exit(1);
  }

  const prodDb = path.resolve(process.cwd(), 'formapubli.db');
  const before = statOrNull(prodDb);

  if (!args.includes('--no-setup')) {
    await setupTestDb();
  } else {
    console.log('⏩ Bỏ qua setup, dùng test DB hiện có.');
  }

  let failed = 0;
  for (const suite of suites) {
    console.log(`\n▶ Chạy suite cách ly: ${suite}`);
    const isWin = process.platform === 'win32';
    const command = isWin ? 'cmd.exe' : 'npx';
    const cmdArgs = isWin ? ['/c', 'npx', 'tsx', suite] : ['tsx', suite];
    const suiteDb = suite.includes('test-cp3-reconciliation')
      ? 'file:formapubli_test_cp3_REC4.db'
      : `file:${TEST_DB_FILE}`;
    const res = spawnSync(command, cmdArgs, {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: suiteDb },
      stdio: 'inherit',
      shell: false,
    });
    if (res.status !== 0) {
      console.error(`❌ Suite ${suite} thất bại (exit ${res.status}). Dừng chuỗi.`);
      failed = res.status ?? 1;
      break;
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

  if (failed !== 0) process.exit(failed);
  console.log(`\n🎉 TOÀN BỘ ${suites.length} SUITES CÁCH LY ĐẠT!`);
}

main().catch((err) => {
  console.error('❌ run-isolated thất bại:', err);
  process.exit(1);
});
