/**
 * Nút "HÔM NAY" trong Sổ Doanh Số phải là NGÀY VIỆT NAM.
 *
 * `orders.created_at` là UTC. Trước đây preset ngày gửi
 * `toISOString().slice(0,10)` tức NGÀY UTC, và `getOrders` so chuỗi thô, nên:
 *   · đơn 00:00–07:00 giờ VN hôm nay nằm ở ngày UTC HÔM TRƯỚC ⇒ KHÔNG có trong
 *     báo cáo "hôm nay" ⇒ người dùng đối chiếu sổ với két thấy lệch
 *   · đơn 17:00–24:00 giờ VN hôm qua lại lọt vào "hôm nay"
 *
 * Ca này chỉ pass khi `createdAtBetween` hiểu ngày trần là ngày nghiệp vụ.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) =>
  fs.readFileSync(path.resolve(process.cwd(), p), 'utf8')
    // Bỏ comment để không tự khớp regex bằng chính chú thích giải thích lỗi cũ.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');

const svc = read('src/services/order.service.ts');
const ui = read('src/components/sales/SalesLedgerView.tsx');
// Task 4: logic ngày VN đã rút khỏi component vào helper dùng chung
// (`src/lib/sales-view.ts`) cho cả 4 panel. Component chỉ còn gọi helper, nên
// phải quét helper mới thấy múi giờ — quét mỗi component là giữ một bản sao
// logic ngày ở từng file, tức đúng lỗi Task 4 sửa.
const helper = read('src/lib/sales-view.ts');

let checks = 0;
const ok = (c: boolean, m: string) => { checks++; assert.ok(c, m); };

// 1. Ngày trần = ngày nghiệp vụ VN.
ok(
  /createdAtBetween/.test(svc) && /substr\(datetime\(/.test(svc),
  'order.service phải có createdAtBetween lọc theo ngày VN trong SQL'
);
ok(
  /BARE_DAY\.test\(startDate\)/.test(svc) && /BARE_DAY\.test\(endDate\)/.test(svc),
  'phải phân biệt ngày trần (ngày nghiệp vụ) với ISO đầy đủ (mốc UTC)'
);

// 2. getOrders dùng helper, không tự so chuỗi thô nữa.
const getOrders = svc.match(/static async getOrders[\s\S]{0,4000}/)?.[0] || '';
ok(
  /createdAtBetween\(orders\.createdAt, startDate, endDate\)/.test(getOrders),
  'getOrders phải dùng createdAtBetween'
);
ok(
  !/gte\(orders\.createdAt, startDate\)/.test(getOrders),
  'getOrders không được tự so chuỗi thô nữa'
);

// 3. Ngày VN lấy ở HELPER dùng chung, không phải trong từng component.
ok(
  /Asia\/Ho_Chi_Minh/.test(helper),
  'sales-view phải lấy ngày theo Asia/Ho_Chi_Minh'
);
ok(
  /timeZone:\s*VN_TZ/.test(helper) && /VN_TZ\s*=\s*'Asia\/Ho_Chi_Minh'/.test(helper),
  'múi giờ phải gom vào hằng VN_TZ và truyền qua timeZone (không rải chuỗi lệch giờ rải rác)'
);
// Component PHẢI gọi helper, không tự tính lại ngày (đó là lỗi gốc: mỗi file
// một bản "30 ngày" ⇒ các panel hiện số khác nhau trên cùng một bảng số).
ok(
  /monthPreset\(/.test(ui) && /lastNDays\(/.test(ui) && /vnToday\(/.test(ui),
  'SalesLedgerView phải dùng helper monthPreset/lastNDays/vnToday thay vì tự tính ngày'
);
ok(
  !/Date\.now\(\)\s*-\s*\d+\s*\*\s*24/.test(ui),
  'SalesLedgerView không được tự trừ N*24h — đó là "30 ngày trượt", không phải tháng lịch'
);
// 3b. Client gửi ngày VN, không gửi ngày UTC và không gửi hậu tố giờ.
ok(
  !/todayStr = now\.toISOString\(\)\.slice\(0, 10\)/.test(ui),
  'không được lấy ngày UTC bằng toISOString().slice(0,10)'
);
ok(
  !/T23:59:59/.test(ui),
  'không được gắn hậu tố T23:59:59 — nó đẩy cả hai đầu về nhánh so mốc UTC cũ'
);
ok(
  /setEndDate\(/.test(ui),
  'endDate phải được set (ngày trần từ helper) để bao trọn ngày nghiệp vụ'
);
ok(
  /setEndDate\([^)]*(toISOString|slice\(0, ?10\))/.test(ui) === false,
  'endDate không được lấy từ ISO/ngày UTC thô'
);

console.log(`\n=== NGÀY NGHIỆP VỤ SỔ DOANH SỐ: ${checks} assertions PASS ===`);
