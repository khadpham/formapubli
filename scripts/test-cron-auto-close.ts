/**
 * Test SAFEGUARD chốt ca / chốt ngày tự động — /api/cron/auto-close
 *
 * Bối cảnh: thu ngân quên chốt ca thì ca treo vô hạn, ngày không chốt, số
 * liệu sai. Cơ chế cũ chỉ chạy khi có người MỞ app, nên cần một đường gọi
 * không phụ thuộc con người. Test khoá lại các tính chất không được nới lỏng:
 *   1. Fail-closed: không có CRON_SECRET hoặc sai token → 401.
 *   2. Idempotent: chạy lại không ghi thêm bản ghi.
 *   3. Không bịa tiền: ca chưa kiểm đếm phải để NULL + đánh dấu UNVERIFIED.
 *   4. Lỗi một kho không được làm hỏng kho khác.
 *   5. Bảo đảm gọi được tự động: có lịch (workflow) gọi vào endpoint này.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Test này chỉ đọc mã nguồn + workflow, KHÔNG mở database nên không cần
// assertIsolatedTestDb (giống test-mobile-kho-ui.ts).

const routePath = path.resolve(process.cwd(), 'src/app/api/cron/auto-close/route.ts');
const src = fs.readFileSync(routePath, 'utf8');
let checks = 0;
const ok = (cond: boolean, msg: string) => {
  checks++;
  assert.ok(cond, msg);
};

// ---------------------------------------------------------------------------
// 1. Bảo vệ bằng secret, so sánh constant-time, fail-closed
// ---------------------------------------------------------------------------
ok(/CRON_SECRET/.test(src), 'Phải đọc CRON_SECRET');
ok(/if \(!secret\) return false/.test(src), 'Thiếu CRON_SECRET thì fail-closed, KHÔNG mở cửa');
ok(/timingSafeEqual/.test(src), 'So sánh secret phải constant-time');
ok(/status: 401/.test(src), 'Không được phép thì trả 401');
ok(
  src.split('401').length >= 3,
  'Cả GET và POST đều phải chặn — không để lọt qua một method'
);
ok(/export async function POST/.test(src) && /export async function GET/.test(src), 'Hỗ trợ cả GET và POST cho cron');

// ---------------------------------------------------------------------------
// 2. Chốt ca QUÁ GIỜ, không chốt ca còn trong giờ
// ---------------------------------------------------------------------------
ok(/getStaleOpenShiftCheck/.test(src), 'Phải dò ca quá giờ theo cutoff từng kho');
ok(/autoCloseSession/.test(src), 'Phải gọi autoCloseSession');
ok(
  /reason: 'CRON_SAFEGUARD'/.test(src) && /actorId: 'CRON_SAFEGUARD'/.test(src),
  'Audit phải ghi rõ đây là chốt tự động, không giả vờ người'
);
ok(
  !/closingCashActual\s*[:=]\s*\d/.test(src),
  'TUYỆT ĐỐI không được bịa closingCashActual trong safeguard'
);

// ---------------------------------------------------------------------------
// 3. Chốt ngày nghiệp vụ ĐÃ QUA, chỉ khi chưa có bản chốt
// ---------------------------------------------------------------------------
ok(/getDayCloseRecord/.test(src), 'Phải kiểm tra đã có bản chốt ngày chưa trước khi chốt');
ok(/if \(!existing\)/.test(src), 'Chỉ chốt ngày khi CHƯA có bản chốt — chạy lại là idempotent');
ok(/closeDay/.test(src), 'Phải gọi closeDay');
ok(
  /Asia\/Ho_Chi_Minh/.test(src),
  'Ngày nghiệp vụ phải theo giờ Việt Nam, không theo UTC'
);

// ---------------------------------------------------------------------------
// 4. Một kho lỗi không được chặn các kho khác
// ---------------------------------------------------------------------------
ok(/catch \(e: any\)/.test(src), 'Phải bắt lỗi theo từng kho');
ok(
  /errors\.push/.test(src),
  'Phải gom lỗi theo từng kho để một kho hỏng không chặn kho khác'
);

// ---------------------------------------------------------------------------
// 5. Có lịch thật gọi endpoint — nếu không có thì endpoint chết, im lặng
// ---------------------------------------------------------------------------
const cronWorkflow = path.resolve(process.cwd(), '.github/workflows/auto-close-shift.yml');
ok(fs.existsSync(cronWorkflow), 'Phải có workflow lịch gọi safeguard — không có thì tính năng chết lặng lẽ');
const wf = fs.readFileSync(cronWorkflow, 'utf8');
ok(/schedule:/.test(wf), 'Workflow phải có schedule');
ok(/curl/.test(wf), 'Workflow phải gọi HTTP vào endpoint');
ok(/CRON_SECRET/.test(wf), 'Workflow phải dùng CRON_SECRET');
ok(
  /\/api\/cron\/auto-close/.test(wf),
  'Workflow phải trỏ đúng endpoint safeguard'
);

// ---------------------------------------------------------------------------
// 6. Ghi rõ giới hạn: cron của Cloudflare KHÔNG dùng được với worker này
// ---------------------------------------------------------------------------
const wrangler = fs.readFileSync(path.resolve(process.cwd(), 'wrangler.toml'), 'utf8');
ok(
  !/crons\s*=/.test(wrangler),
  'Không khai báo [triggers] crons: worker do @opennextjs/cloudflare sinh ra KHÔNG có export `scheduled`, nên cron của Cloudflare sẽ bắn vào chỗ không ai nghe và tính năng chết âm thầm. Nếu sau này worker có scheduled thì mới bật.'
);
const workerBundle = path.resolve(process.cwd(), '.open-next/worker.js');
if (fs.existsSync(workerBundle)) {
  const w = fs.readFileSync(workerBundle, 'utf8');
  ok(
    !/async scheduled\s*\(/.test(w),
    'Worker bundle phải có handler `scheduled` thì [triggers] crons mới dùng được — hiện chưa có'
  );
}

console.log(`\n=== SAFEGUARD CHỐT CA / CHỐT NGÀY: ${checks} assertions PASS ===`);
