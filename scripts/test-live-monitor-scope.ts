/**
 * TEST: Trạng Thái Hội Chợ chọn được 1 kho / 1 ngày và nhớ kho đã chọn.
 *
 * Vì sao quan trọng: trước đây màn này CHỈ xem được tất cả kho hội chợ và
 * chỉ hôm nay — không có đường vào một kho cụ thể. API thì ĐÃ hỗ trợ sẵn
 * `?warehouseId=` và `?date=`; thiếu đúng phần UI.
 *
 * CHẠY: npx tsx scripts/test-live-monitor-scope.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync('src/components/dashboard/LiveFairMonitorModal.tsx', 'utf8');
const route = fs.readFileSync('src/app/api/pos/live-monitor/route.ts', 'utf8');

// 1. Nhớ kho, KHÔNG nhớ ngày.
assert.ok(
  ui.includes('formapubli.liveMonitor.warehouseId'),
  'phải nhớ kho đã chọn qua localStorage'
);
assert.ok(
  !ui.includes('formapubli.liveMonitor.date'),
  'KHÔNG nhớ ngày — mở nhầm ngày cũ khiến người dùng tưởng hôm nay chưa bán được gì'
);

// 2. Gửi kho và ngày lên API (qua URLSearchParams cho gọn).
assert.ok(ui.includes("qs.set('warehouseId'"), 'phải gửi kho đang chọn lên API');
assert.ok(ui.includes("qs.set('date'"), 'phải gửi ngày đang xem lên API');

// 3. Có ô chọn rõ ràng, nhãn tiếng Việt có dấu.
assert.ok(ui.includes('Chọn kho hội chợ'), 'ô chọn kho phải có nhãn rõ');
assert.ok(ui.includes('Chọn ngày'), 'ô chọn ngày phải có nhãn rõ');
assert.ok(ui.includes('Tất cả kho hội chợ'), 'phải có lựa chọn "Tất cả kho hội chợ"');

// 4. Tiêu đề phải luôn nói ngày đang xem để không ai tưởng là hôm nay.
assert.ok(
  ui.includes('Trạng Thái Hội Chợ'),
  'giữ tiêu đề màn hình'
);

// 5. Nhận 2 khối chuyển sang từ Báo Cáo Chốt Ngày.
assert.ok(ui.includes('largestOrder'), 'dùng đơn lớn nhất từ API');
assert.ok(ui.includes('topSellers'), 'dùng top bán chạy từ API');
// Tên trường của live-monitor KHÁC báo cáo ngày: `copies` chứ không phải `soldCopies`.
// Dùng nhầm tên sẽ ra "undefined cuốn" — assert để chặn.
assert.ok(
  !ui.includes('soldCopies'),
  'live-monitor dùng `copies`, không phải `soldCopies` (đặt nhầm sẽ ra undefined)'
);

// 6. API phải có `largestOrder` thật, không phải chỉ ở UI.
assert.ok(route.includes('largestOrder'), 'API phải trả largestOrder');
assert.ok(
  route.includes('vnDayEq'),
  'truy vấn ngày phải dùng đúng helper vnDayEq đã có sẵn trong file'
);

// 7. Comment cũ nói báo cáo chốt ngày dùng ngày UTC là SAI.
//    Chỉ chặn câu claim sai đó, KHÔNG cấm nhắc tới UTC ở chỗ giải thích
//    "vì sao phải cộng 7 giờ" — đó là tài liệu đúng.
assert.ok(
  !route.includes('Báo cáo chốt ngày dùng ngày UTC nên'),
  'comment cũ nói báo cáo ngày dùng UTC là sai — cả hai màn đã dùng ngày VN'
);
assert.ok(
  route.includes("cùng mốc ngày với Báo Cáo Chốt Ngày"),
  'phải nói rõ hai màn dùng CHUNG một mốc ngày'
);

console.log('✓ test-live-monitor-scope PASS');