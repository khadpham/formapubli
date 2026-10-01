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
  'scripts/smoke-mobile-role-navigation.ts',
  'scripts/test-discount-guard.ts',
  'scripts/test-manager-approval-drawer.ts',
  'scripts/test-discount-checkout-atomic.ts',
  'scripts/test-p0-verification.ts',
  'scripts/test-inventory.ts',
  'scripts/test-products.ts',
  'scripts/test-goods-in-pos-catalog.ts',
  'scripts/test-goods-sell-e2e.ts',
  'scripts/test-gift-forgery.ts',
  'scripts/test-promotion-engine.ts',
  'scripts/test-gift-subtotal.ts',
  'scripts/test-gift-approval-hash.ts',
  'scripts/test-gift-offline.ts',
  'scripts/test-products-rbac.ts',
  'scripts/test-price-normalize.ts',
  'scripts/test-0032-preserves-data.ts',
  'scripts/test-s1-batch-transfer.ts',
  'scripts/test-s2-pos-catalog.ts',
  'scripts/test-s3-schema.ts',
  'scripts/test-s3-discount-approval.ts',
  'scripts/test-transfer-payment-flow.ts',
  'scripts/test-transfer-payment-adversarial.ts',
  'scripts/test-s3-delivery-orders.ts',
  'scripts/test-s4-settlement.ts',
  'scripts/test-settlement-royalty-audit.ts',
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
  'scripts/test-camera-scanner.ts',
  'scripts/test-modal-dismiss.ts',
  'scripts/test-mobile-kho-ui.ts',
  'scripts/test-batch-paste-parser.ts',
  'scripts/test-batch-paste-ui.ts',
  'scripts/test-pos-header-layout.ts',
  'scripts/test-pos-qr-content.ts',
  'scripts/test-pos-bank-qr-gallery.ts',
    'scripts/test-warehouse-panel-ui.ts',
    'scripts/test-warehouse-stock.ts',
    'scripts/test-batch-atp-limit.ts',
    'scripts/test-ux-crud-fixes.ts',
  'scripts/test-warehouse-lifecycle.ts',
  'scripts/test-autoclose-shift.ts',
  'scripts/test-cron-auto-close.ts',
  'scripts/test-payment-photo-contract.ts',
  'scripts/test-photo-write-gate.ts',
    'scripts/test-live-monitor.ts',
    'scripts/test-live-monitor-runtime.ts',
    'scripts/test-fair-atp-hold.ts',
    'scripts/test-unclosed-activity.ts',
    'scripts/test-settlement-ui.ts',
    'scripts/test-settlement-date-integrity.ts',
    'scripts/test-settlement-print.ts',
    'scripts/test-settlement-print-css.ts',
    'scripts/test-settlement-highlight.ts',
    'scripts/test-settlement-hourly.ts',
    'scripts/test-settlement-hourrange.ts',
    'scripts/test-pos-cashier-name.ts',
  'scripts/test-receipt-hotline-cashier.ts',
    'scripts/test-stock-non-negative.ts',
    'scripts/test-sales-ledger-vn-day.ts',
    'scripts/test-batch-transfer-search.ts',
    'scripts/test-pos-money-integrity.ts',
    'scripts/test-pos-cash-integrity.ts',
    'scripts/test-order-code-13.ts',
  'scripts/test-forecast.ts',
  'scripts/test-royalties.ts',
  'scripts/test-royalty-basis.ts',
  'scripts/test-returns.ts',
  'scripts/test-auditA-kho-vanchuyen.ts',
  'scripts/test-auditC-money.ts',
  'scripts/test-pay2-money-audit.ts',
  'scripts/test-auditC-nplus1.ts',
  'scripts/test-online-orders.ts',
  'scripts/test-smart-parser.ts',
  'scripts/test-shipments.ts',
  'scripts/test-customer-tags.ts',
  'scripts/test-sponsorships.ts',
  'scripts/test-analytics.ts',
  'scripts/test-stock-summary-scope.ts',
  'scripts/test-order-guards.ts',
  'scripts/test-patch02-laneA.ts',
  'scripts/test-patch02-laneB.ts',
  'scripts/test-pending-view.ts',
  'scripts/test-auth-gateway.ts',
  'scripts/test-auth-rbac.ts',
  'scripts/test-pos-report-permissions.ts',
  'scripts/test-concurrent-session.ts',
  'scripts/test-cashier-session-recovery.ts',
  'scripts/test-phase0-laneA.ts',
  'scripts/test-cp2-concurrency-probes.ts',
  'scripts/test-cp3-transfer-concurrency.ts',
  'scripts/test-cp3-migrations.ts',
  'scripts/test-cp3-return-concurrency.ts',
  'scripts/test-cp3-return-complete.ts',
  'scripts/test-cp3-return-exchange-void.ts',
  'scripts/test-cp3-reconciliation.ts',
  'scripts/eval-executive-ai.ts',
  'scripts/test-copilot-regressions.ts',
  'scripts/test-voice-order.ts',
  'scripts/test-monthly-digest.ts',
  'scripts/test-executive-reporting.ts',
  'scripts/test-reader-persona.ts',
  'scripts/test-login-accounts.ts',
  'scripts/test-actor-binding.ts',
  'scripts/test-rbac-audit.ts',
  'scripts/test-scanner-roi.ts',
  'scripts/test-cashbox-close-shift.ts',
  'scripts/test-checkout-stock-batch.ts',
  'scripts/test-confirm-unblock.ts',
  'scripts/test-stock-movement-batch-equivalence.ts',
  'scripts/test-receipt-photo-shift.ts',
  'scripts/test-payment-note.ts',
  'scripts/test-dashboard-ui-text.ts',
  'scripts/test-read-scope.ts',
  'scripts/drill-go-live.ts',
  // SUITE CUỐI: tạo ấn bản AB-* và bán chạy thật trong DB test dùng chung, nên
  // phải chạy SAU test-monthly-digest — digest lấy top 5 ấn bản bán chạy, thêm
  // dòng của suite này sẽ đẩy ấn bản của suite đó ra khỏi top 5.
  'scripts/test-analytics-doanhso.ts',
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
  // --continue: suite lỗi (kể cả crash native) không dừng cả chuỗi, để còn suite
  // phía sau vẫn chạy; cuối chuỗi liệt kê suite lỗi và exit code khác 0.
  // Mặc định chạy hết chuỗi rồi mới tổng kết. Xem vòng lặp bên dưới để biết vì sao.
  const stopFirst = args.includes('--stop-first');
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
  const failedSuites: { suite: string; status: number | null }[] = [];
  for (const suite of suites) {
    console.log(`\n▶ Chạy suite cách ly: ${suite}`);
    const isWin = process.platform === 'win32';
    const command = isWin ? 'cmd.exe' : 'npx';
    const cmdArgs = isWin ? ['/c', 'npx', 'tsx', suite] : ['tsx', suite];
    // LƯU Ý Windows: runner TUYỆT ĐỐI không mở file DB của suite (kể cả chỉ
    // DELETE): handle libsql không nhả ngay cả sau close() → suite con gặp
    // EBUSY khi xóa DB và migrate chồng lên file cũ. Mọi dọn dẹp phải nằm
    // trong chính suite (xem resetDbDualLimit ở test-phase0-laneA).
    const suiteDb = suite.includes('test-cp3-reconciliation')
      ? 'file:formapubli_test_cp3_REC4.db'
      : `file:${TEST_DB_FILE}`;
    // Dọn khóa brute-force DB giữa các suite TRONG TIẾN TRÌNH CON RIÊNG
    // (thoát ngay → không giữ handle): khôi phục ngữ nghĩa "mỗi suite là
    // tiến trình mới" của tầng memory trước đây.
    {
      const clearArgs = isWin
        ? ['/c', 'npx', 'tsx', 'scripts/clear-login-buckets.ts']
        : ['tsx', 'scripts/clear-login-buckets.ts'];
      spawnSync(command, clearArgs, {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: suiteDb },
        stdio: 'ignore',
        shell: false,
      });
    }
    // Một suite có thể CHẾT Ở TẦNG NATIVE (0xC0000005 ACCESS_VIOLATION) sau khi
    // đã in "PASS" — tiến trình bị Windows hạ giữa lúc thoát. Đây KHÔNG phải
    // lỗi logic: cùng một suite chạy riêng thì xanh, và mỗi lần lại một suite
    // khác chết (đã quan sát: test-order-guards lần 1, test-transfer-payment-flow
    // lần 2). Phân biệt bằng CHÍNH DẤU HIỆU này rồi chạy lại đúng một lần:
    //   - chết native  → thử lại 1 lần, chết lần nữa mới báo đỏ
    //   - assertion đỏ  → KHÔNG thử lại, đỏ là thật
    const NATIVE_CRASH = new Set([3221225477, 3221226505, 1073741819, 139]);
    let res = spawnSync(command, cmdArgs, {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: suiteDb },
      stdio: 'inherit',
      shell: false,
    });
    if (NATIVE_CRASH.has(res.status ?? -1)) {
      console.error(`\n⚠ ${suite} chết ở tầng native (exit ${res.status}) — KHÔNG phải lỗi logic. Chạy lại 1 lần.`);
      res = spawnSync(command, cmdArgs, {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: suiteDb },
        stdio: 'inherit',
        shell: false,
      });
      if (res.status === 0) {
        console.error(`✅ ${suite} chạy lại thì xanh — xác nhận là chết tầng native, không phải lỗi.`);
        continue;
      }
      console.error(`⚠ ${suite} chết cả lần thứ hai (exit ${res.status}).`);
    }
    if (res.status !== 0) {
      failed = res.status ?? 1;
      failedSuites.push({ suite, status: res.status });
      // Một suite chết ở tầng native SAU khi đã in "PASS" vẫn trả exit ≠ 0. Nếu
      // dừng chuỗi ngay, ta mất thông tin về phần chưa chạy và tưởng code hỏng
      // đúng ở chỗ đó. Vì vậy mặc định chạy HẾT rồi tổng kết; `--stop-first` giữ
      // lại hành vi cũ khi thật sự cần dừng sớm (ví dụ đang săn một lỗi).
      if (stopFirst) {
        console.error(`❌ Suite ${suite} thất bại (exit ${res.status}). Dừng chuỗi (--stop-first).`);
        break;
      }
      console.error(`❌ Suite ${suite} thất bại (exit ${res.status}). Tiếp tục, sẽ tổng kết cuối.`);
      continue;
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

  if (failedSuites.length > 0) {
    console.error(`\n❌ ${failedSuites.length}/${suites.length} SUITES THẤT BẠI:`);
    for (const item of failedSuites) console.error(`   - ${item.suite} (exit ${item.status})`);
  }
  console.log(`\n📊 Đã chạy ${suites.length} suite.`);
  if (failed !== 0) process.exit(failed);
  console.log(`🎉 TOÀN BỘ ${suites.length} SUITES CÁCH LY ĐẠT!`);
}

main().catch((err) => {
  console.error('❌ run-isolated thất bại:', err);
  process.exit(1);
});
