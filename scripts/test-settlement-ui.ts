/**
 * Báo cáo chốt ngày: nhãn nút + ô đếm giả + dòng đối soát bị ẩn.
 *
 * 1. Nút ghi "Chốt Ngày" nhưng chỉ mở báo cáo read-only (không có lệnh nào gọi
 *    closeDay). Người dùng tưởng đã chốt xong. Sửa: đổi nhãn + nói rõ ngày do
 *    máy chốt lúc 23:59. Có 2 nút: ExecutiveDashboard và PosCheckoutTerminal.
 * 2. Ô "Thực đếm" chỉ nằm trong useState, không POST đi đâu cả. Chủ sở hữu đã
 *    quyết định (2026-09-29) cuối ngày không đếm sách thật — tồn tính bằng
 *    "tồn kho − số bán", đúng bằng cột theoreticalStock. Nên bỏ ô nhập, hiện
 *    "Chưa kiểm kê" để không ai tưởng đã đếm.
 * 3. Dòng chênh lệch két biến mất im lặng khi còn ca mở — đúng dòng cần kiểm
 *    nhất. Phải nói rõ "chưa thể đối soát" thay vì trắng trơn.
 * 4. openShiftAlerts do API trả sẵn nhưng không màn hình nào đọc.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');
let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; assert.ok(cond, msg); };

const modal = read('src/components/pos/DailyFairSettlementModal.tsx');
const dash = read('src/components/dashboard/ExecutiveDashboard.tsx');
const pos = read('src/components/pos/PosCheckoutTerminal.tsx');

// --- 1. Nút "Chốt Ngày" phải nói đúng việc nó làm ------------------------------
for (const [name, src] of [['ExecutiveDashboard', dash], ['PosCheckoutTerminal', pos]] as const) {
  ok(
    !/>\s*Chốt Ngày\s*</.test(src) && !/<span>Chốt Ngày<\/span>/.test(src),
    `${name}: không được còn nút ghi "Chốt Ngày" khi nó chỉ mở báo cáo`
  );
  ok(
    /Báo Cáo Ngày/.test(src),
    `${name}: nút phải ghi "Báo Cáo Ngày"`
  );
  ok(
    /không chốt ngày/i.test(src),
    `${name}: phải có chú thích/tooltip nói rõ nút này KHÔNG chốt ngày`
  );
  ok(
    /23:59/.test(src),
    `${name}: phải nói ngày do máy chốt tự động lúc 23:59`
  );
}

// --- 2. Ô đếm giả phải biến mất, thay bằng nhãn trung thực -------------------
ok(!/actualCounts/.test(modal), 'modal không được còn state actualCounts (ô nhập không lưu gì)');
ok(!/handleActualCountChange/.test(modal), 'modal không được còn handler đổi số đếm');
ok(!/type="number"[\s\S]{0,200}onChange/.test(modal), 'không được còn ô nhập số trong bảng kiểm kê');
ok(/Chưa kiểm kê/.test(modal), 'phải hiện "Chưa kiểm kê" thay cho Khớp/Thừa/Thiếu giả');
ok(
  !/Thực đếm \(Kệ\)/.test(modal),
  'không được còn nhãn "Thực đếm (Kệ)" — gợi ý đã đếm thật'
);

// --- 3. Dòng đối soát không được biến mất im lặng ----------------------------
ok(
  /cashVariance === null/.test(modal),
  'phải có nhánh hiển thị riêng cho cashVariance === null'
);
ok(
  /Chưa thể đối soát/.test(modal),
  'phải nói rõ "Chưa thể đối soát" thay vì ẩn dòng'
);
ok(
  /openSessionCount/.test(modal),
  'phải nói số ca còn mở'
);

// --- 4. openShiftAlerts phải được đọc ĐÚNG SHAPE ---------------------------
// Bẫy đã dính: `getStaleOpenShiftCheck` trả OBJECT
// `{ serverTime, cutoff, cutoffSource, count, salesBlocked, shifts }`, không phải
// mảng. Đo `Array.isArray(data.openShiftAlerts)` ⇒ luôn false ⇒ cả khối cảnh báo
// chết MÀ test nguồn vẫn xanh. Không được lặp lại.
ok(
  /data\.openShiftAlerts\?\.shifts/.test(modal),
  'phải đọc data.openShiftAlerts.shifts — hàm trả OBJECT, đo Array.isArray là sai'
);
ok(
  !/Array\.isArray\(data\.openShiftAlerts\)/.test(modal),
  'KHÔNG được đo Array.isArray(data.openShiftAlerts) — đây là object, luôn false'
);
ok(
  /data\.openShiftAlerts\.shifts\.map/.test(modal),
  'phải map trên .shifts'
);
ok(
  /Ca chưa đóng/.test(modal),
  'phải hiện cảnh báo ca chưa đóng'
);

// --- 4b. Dòng đối soát: phải dùng cờ pending, không đoán qua null -----------
// `cashVariance === null` xảy ra khi còn ca mở LẪN khi không có ca nào. Nếu đo
// vậy, ngày không có ca nào sẽ hiện "còn 1 ca chưa đóng" ⇒ quản lý đi tìm ca
// không tồn tại hoặc kết luận sai két còn tiền.
ok(
  /cashVariancePending === true/.test(modal),
  'phải dùng cashVariancePending để phân biệt "còn ca mở" với "không có ca nào"'
);
ok(
  !/cashVariance\?\.cashVariance === null/.test(modal),
  'KHÔNG được suy đoán trạng thái qua cashVariance === null'
);
ok(
  !/\|\|\s*1\s*ca chưa đóng/.test(modal),
  'KHÔNG được ép openSessionCount về 1 khi bằng 0 — sẽ báo cáo ca không tồn tại'
);
ok(
  /openSessionCount/.test(modal),
  'phải hiện số ca còn mở lấy từ openSessionCount'
);

// --- 4c. Bản in bàn giao không được in số 0 giả cho phần kiểm kê -----------
ok(
  !/totalBookVariance/.test(modal),
  'không được giữ biến totalBookVariance cứng 0 — sẽ in "chênh lệch 0" lên biên bản ký'
);
ok(
  !/TỔNG CỘNG SỐ CUỐN KIỂM KÊ/.test(modal),
  'không được ghi "TỔNG CỘNG SỐ CUỐN KIỂM KÊ" khi không có kiểm kê thật'
);

// --- 5. Không được tự thêm lệnh ghi từ trình duyệt ----------------------------
ok(
  !/method:\s*'(POST|PUT|PATCH|DELETE)'/.test(modal),
  'modal KHÔNG được tự thêm lệnh ghi — chốt ngày là việc của cron, không hoàn tác được'
);

// --- 6. Ngày mặc định của modal phải là ngày VN, không phải UTC -------------
// `toISOString().slice(0,10)` là ngày UTC ⇒ 00:00-07:00 giờ VN modal mở báo cáo
// HÔM QUA, lệch với cron chốt ngày theo giờ VN.
ok(
  !/useState\(\(\) => new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\)/.test(modal),
  'selectedDate mặc định KHÔNG được lấy bằng toISOString() — đó là ngày UTC'
);
ok(
  /Asia\/Ho_Chi_Minh/.test(modal),
  'selectedDate mặc định phải theo giờ Việt Nam'
);

console.log(`\n=== BÁO CÁO CHỐT NGÀY: ${checks} assertions PASS ===`);
