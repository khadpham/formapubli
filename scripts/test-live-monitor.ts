/**
 * Hợp đồng Modal Trạng Thái Hội Chợ — endpoint + component + nút mở.
 *
 * Vì sao cần test khi mọi thứ đều là đọc: ba thuộc tính này KHÔNG tự bảo vệ
 * được. (1) Phân quyền — lộ doanh thu tức thời theo từng gian hàng thì nặng
 * hơn lỗ hiển thị. (2) `isOpen` là cổng DUY NHẤT quyết định có poll hay không —
 * sửa lỡ một chữ là mỗi quản lý mở app đều đốt 6 request/phút vô ích. (3) Ngày
 * nghiệp vụ phải là GIỜ VN, không phải UTC, nếu không thì 00:00-07:00 rơi sang
 * hôm trước.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');
let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; assert.ok(cond, msg); };

const route = read('src/app/api/pos/live-monitor/route.ts');
const modal = read('src/components/dashboard/LiveFairMonitorModal.tsx');
const dash = read('src/components/dashboard/ExecutiveDashboard.tsx');

// --- 1. Phân quyền: chỉ quản lý, và KHÔNG đụng header legacy ---------------------
ok(
  /requireSessionRole\(req, \['ROLE_OWNER', 'ROLE_MANAGER'\]/.test(route),
  'Endpoint phải chặn cứng: chỉ ROLE_OWNER và ROLE_MANAGER'
);
ok(
  !/x-formapubli-role/.test(route),
  'Không được đọc vai trò từ header — session cookie là nguồn duy nhất'
);
// ROLE_TAX bị chặn là đúng: tax phải cách ly dữ liệu nội bộ (roles.ts:61).
ok(
  !/'ROLE_TAX'\s*,\s*\]/.test(route),
  'ROLE_TAX không được vào allowlist của endpoint doanh thu tức thời'
);

// --- 2. Endpoint READ-ONLY: không được ghi bảng nào ------------------------------
ok(
  !/\.insert\(|\.update\(|\.delete\(|recordAuditLog/.test(route),
  'Endpoint trạng thái phải READ-ONLY — không insert/update/delete, không audit log'
);
ok(/export const dynamic = 'force-dynamic'/.test(route), 'Phải force-dynamic, không được cache');

// --- 3. Ngày nghiệp vụ theo GIỜ VIỆT NAM ---------------------------------------
ok(
  /timeZone: VN_TZ/.test(route) && /const VN_TZ = 'Asia\/Ho_Chi_Minh'/.test(route),
  'Ngày nghiệp vụ phải theo giờ VN, không phải UTC'
);
ok(
  /LIKE \$\{`\$\{date\}%`\}/.test(route) || /LIKE/.test(route),
  'Lọc ngày bằng tiền tố 10 ký tự — so timestamp đầy đủ giữa 2 họ định dạng là vô nghĩa'
);

// --- 4. Quy tắc hạn phải MƯỢN của OrderService, không tự chế ------------------
ok(
  /OrderService\.isPendingExpired/.test(route),
  'overdue phải dùng OrderService.isPendingExpired — tự chế là lệch với server'
);
ok(
  /OrderService\.getPendingEffectiveExpiry/.test(route),
  'minutesLeft phải dùng cùng quy tắc hạn (payment_expires_at, không thì TTL 48h)'
);
ok(
  !/cashboxSessions\.totalCashSales/.test(route),
  'expectedCashLive KHÔNG được đọc cột cashboxSessions.totalCashSales — đó là bản chốt lúc đóng ca, luôn 0 khi ca còn mở'
);

// --- 5. isOpen là cổng DUY NHẤT quyết định poll ---------------------------------
ok(
  /if \(!isOpen\) \{[\s\S]{0,200}clearTimeout/.test(modal),
  'Đóng modal phải huỷ hẳn timer poll — không ai xem thì không tốn request'
);
ok(
  /document\.visibilityState === 'hidden'/.test(modal),
  'Tab ẩn thì không poll (setInterval bị throttle khi màn hình khoá trên iOS)'
);
ok(/POLL_MS = 10_000/.test(modal), 'Chu kỳ poll 10 giây');
ok(
  /BACKOFF_MS = \[10_000, 20_000, 40_000\]/.test(modal),
  'Phải giãn dần khi lỗi mạng — hội chợ đông người, mạng LTE yếu'
);
ok(
  /window\.addEventListener\('focus'/.test(modal),
  'Quay lại tab phải nạp ngay, không bắt chờ tới lượt poll kế tiếp'
);

// --- 6. Bẫy focus + portal ------------------------------------------------------
ok(
  /useModalFocusTrap<HTMLDivElement>\(isOpen && mounted/.test(modal),
  'Modal phải dùng useModalFocusTrap'
);
ok(
  /createPortal\(/.test(modal) && /document\.body/.test(modal),
  'Modal phải createPortal trực tiếp ra document.body (không đi qua PortalToBody)'
);
ok(
  !/from '@\/components\/PortalToBody'/.test(modal) && !/<PortalToBody/.test(modal),
  "KHÔNG dùng PortalToBody: nó gate nội dung bằng state 'mounted' riêng nên ref " +
    "chưa có mặt lúc useModalFocusTrap chạy effect => mất bẫy focus và inert"
);

// --- 7. Tái dùng drawer duyệt chiết khấu, không viết lại logic -----------------
ok(
  /import \{ ManagerApprovalDrawer \}/.test(modal),
  'Phải tái dùng ManagerApprovalDrawer có sẵn thay vì viết lại luồng duyệt'
);

// --- 8. Nhãn UI tiếng Việt CÓ DẤU + dấu hiệu bấm rõ (AGENTS.md) -----------------
ok(/Xem Trạng Thái/.test(dash), 'Nút mở phải có nhãn tiếng Việt có dấu');
ok(
  /aria-label="Xem trạng thái bán hàng hội chợ lúc này"/.test(dash),
  'Nút mở phải có aria-label nói rõ thao tác'
);
ok(/Trạng Thái Hội Chợ/.test(modal), 'Tiêu đề modal tiếng Việt có dấu');
ok(
  /timezoneNote/.test(modal),
  'Modal phải hiện timezoneNote từ API'
);
ok(
  /timezoneNote:/.test(route) && /UTC/.test(route) && /Việt Nam/.test(route),
  'API phải nói rõ khác biệt ngày VN so với ngày UTC của báo cáo chốt ngày — không giấu'
);
ok(
  /Cập nhật lúc/.test(modal),
  'Chân modal phải hiện giờ cập nhật — số liệu đứng yên trông như còn đúng thì nguy hiểm'
);
ok(
  /Đã huỷ:/.test(modal),
  'Nút Huỷ phải báo trạng thái sau khi bấm'
);
ok(
  /Dự kiến trong két/.test(modal),
  'Ca đang mở phải hiện tiền mặt dự kiến trong két'
);
ok(/Quá hạn/.test(modal), 'Đơn quá hạn phải nói rõ, không im lặng');

console.log(`\n=== TRẠNG THÁI HỘI CHỢ: ${checks} assertions PASS ===`);
