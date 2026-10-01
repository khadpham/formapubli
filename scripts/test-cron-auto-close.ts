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
ok(/^\s*schedule:\s*$/m.test(wf), 'Workflow phải có schedule kích hoạt (không bị comment)');
ok(/^\s*-\s*cron:\s*['"][^'"]+['"]/m.test(wf), 'Schedule phải có cron kích hoạt (không bị comment)');
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

// ---------------------------------------------------------------------------
// 7. GIỚI HẠN SUBREQUEST CỦA WORKER (đã gặp thật trên production)
//    Gặp lỗi thật: "Too many subrequests by single Worker invocation" khi quét
//    cả 5 kho trong MỘT lần gọi — 2 kho xong, 3 kho chết. Local/Node KHÔNG có
//    giới hạn này nên test máy vẫn xanh. Phải mỗi lần gọi MỘT kho, vòng lặp
//    do workflow đảm nhiệm.
// ---------------------------------------------------------------------------
ok(
  /searchParams\.get\(['"]warehouse['"]\)/.test(src),
  'Endpoint phải nhận ?warehouse=CODE để mỗi lần gọi chỉ xử lý MỘT kho — quét nhiều kho trong một lần gọi sẽ vỡ giới hạn subrequest của Worker'
);
ok(
  /searchParams\.get\(['"]list['"]\)/.test(src),
  'Endpoint phải có ?list=1 để bên gọi biết cần quét những kho nào'
);
ok(
  /partial:/.test(src),
  'Response phải báo partial để bên gọi biết mới quét được một phần'
);
ok(
  /auto-close\?warehouse=/.test(wf),
  'Workflow phải gọi RIÊNG từng kho (auto-close?warehouse=CODE), không gọi một lần cho tất cả'
);
ok(
  /auto-close\?list=1/.test(wf),
  'Workflow phải lấy danh sách kho trước rồi mới quét từng kho'
);
ok(
  /errors/.test(wf),
  'Workflow phải ĐỌC errors[] trong payload và fail, không được coi 200 là xong'
);
ok(
  /truncated/.test(wf),
  'Workflow phải đọc truncated[] — ca bị bỏ sót vì chạm trần thì CHƯA xong, không được báo xanh'
);

// ---------------------------------------------------------------------------
// 8. Ngày lỡ trôt: cron chết vài ngày thì những ngày đó chưa từng được chốt.
//    Chỉ chốt "hôm qua" thì lỡ 3 ngày là mất 3 ngày số liệu.
// ---------------------------------------------------------------------------
ok(
  /searchParams\.get\(['"]date['"]\)/.test(src),
  'Endpoint phải nhận ?date=YYYY-MM-DD để quét được cả ngày đã lỡ trôt'
);
ok(
  /isRealDate/.test(src),
  'Phải kiểm ngày hợp lệ ở ranh giới tin cậy (chặn 2026-02-30, chuỗi rác)'
);
ok(
  /FUTURE_DATE/.test(src),
  'Phải từ chối chốt ngày CHƯA KẾT THÚC — chốt ngày đang chạy là chốt số liệu dở'
);
ok(
  /auto-close\?warehouse=.*&date=/.test(wf),
  'Workflow phải quét N ngày gần nhất cho mỗi kho, không chỉ hôm qua'
);
ok(
  /MAX_SHIFTS/.test(src),
  'Phải giới hạn số ca chốt mỗi lần gọi, nếu không sẽ vỡ giới hạn subrequest khi ca tồn đọng dồn'
);

// ---------------------------------------------------------------------------
// 9. P2 (2026-09-29): đơn PENDING HẾT HẠN không được chặn đóng ca / chốt ngày.
//    Trước đây cả hai chặn theo TRẠNG THÁI thô ⇒ một đơn quầy hết hạn sau 30
//    phút tê cả đường ống cron của kho đó.
// ---------------------------------------------------------------------------
ok(
  /cleanupExpiredPending/.test(src),
  'Cron phải dọn đơn PENDING hết hạn TRƯỚC khi đóng ca, không chỉ bấm tay'
);
ok(
  /pendingCleaned/.test(src),
  'Số đơn PENDING đã dọn phải được BÁO RA — có thay đổi dữ liệu thật, không được im lặng'
);
const orderSvc = fs.readFileSync(path.resolve(process.cwd(), 'src/services/order.service.ts'), 'utf8');
const daySvc = fs.readFileSync(path.resolve(process.cwd(), 'src/services/daily-settlement.service.ts'), 'utf8');
ok(
  /livePending/.test(orderSvc) && /isPendingExpired/.test(orderSvc),
  'autoCloseSession phải chỉ chặn đơn PENDING CÒN HẠN, không chặn cả đơn đã hết hạn'
);
ok(
  /livePending/.test(daySvc) && /isPendingExpired/.test(daySvc),
  'closeDay phải chỉ chặn đơn PENDING CÒN HẠN — nếu không thì một đơn kẹt chặn chốt ngày vô hạn'
);

// ---------------------------------------------------------------------------
// 10. P2 (2026-09-29): CHỐNG XANH GIẢ. Ngày lỡ trôt trượt khỏi BACK_DAYS sau
//     7 đêm sẽ không ai hỏi nữa ⇒ workflow xanh mà ngày chưa từng chốt.
// ---------------------------------------------------------------------------
ok(
  /unclosed/.test(src),
  'Endpoint phải có chế độ liệt kê ngày đã qua CHƯA CHỐT, độc lập cửa sổ BACK_DAYS'
);
ok(
  /unclosed/.test(wf) && /ucount/.test(wf),
  'Workflow phải hỏi danh sách ngày chưa chốt và FAIL nếu còn — không được báo xanh'
);

// ---------------------------------------------------------------------------
// 11. P6 (2026-09-29): chặn script migrate/seed ghi vào DB từ xa.
//     migrate-fresh không có bảng ghi migration (chạy lại từ 0000 mỗi lần),
//     seed ghi đè PIN 8 nhân viên mặc định.
// ---------------------------------------------------------------------------
const migrateFresh = fs.readFileSync(path.resolve(process.cwd(), 'scripts/migrate-fresh.ts'), 'utf8');
const seedSrc = fs.readFileSync(path.resolve(process.cwd(), 'scripts/seed.ts'), 'utf8');
ok(
  /ALLOW_REMOTE_MIGRATE/.test(migrateFresh),
  'migrate-fresh phải từ chối DB từ xa trừ khi có cờ ALLOW_REMOTE_MIGRATE tường minh'
);
ok(
  /SEED_STAFF_REMOTE/.test(seedSrc),
  'seed phải từ chối ghi đè PIN nhân viên mặc định lên DB từ xa trừ khi có cờ SEED_STAFF_REMOTE'
);

console.log(`\n=== SAFEGUARD CHỐT CA / CHỐT NGÀY: ${checks} assertions PASS ===`);
