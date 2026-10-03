/**
 * Biểu đồ cột "Số đơn theo giờ" trên MÀN HÌNH của báo cáo chốt ngày.
 *
 * Vì sao cần suite này: dải giờ SVG trên BẢN IN đã có test riêng
 * (`test-settlement-print-css.ts`) nhưng trước đây màn hình không có biểu đồ —
 * số liệu theo giờ chỉ nhìn thấy sau khi in. Ở đây khóa lại:
 * 1. Biểu đồ phải nằm trong modal (tab Doanh Số) và dùng CHUNG dữ liệu đã có.
 * 2. Cột PHẢI là `<rect>`/`<text>` của SVG — không phải div có màu nền, vì
 *    Chrome bỏ màu nền khi in mặc định (bản in đã chống đúng lỗi này).
 * 3. Trục Y phải là mốc tròn thuận tiện, và phải có nhãn 0 để cột 0 đơn vẫn đọc
 *    được là "không có đơn" chứ không phải "thiếu dữ liệu".
 * 4. Rê/bấm cột phải ra số của đúng giờ đó (dải số bên dưới thay tooltip bay).
 * 5. Ngày không có đơn phải nói rõ, không vẽ biểu đồ rỗng rối mắt.
 * 6. Không được cài thêm thư viện biểu đồ chỉ để vẽ 24 cột.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');
let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; assert.ok(cond, msg); };

const chart = read('src/components/pos/HourlyOrdersChart.tsx');
const modal = read('src/components/pos/DailyFairSettlementModal.tsx');
const pkg = read('package.json');

// --- 1. Biểu đồ được gắn vào modal, dùng dữ liệu ĐÃ CÓ sẵn ------------------
ok(
  /import \{ HourlyOrdersChart \} from '\.\/HourlyOrdersChart'/.test(modal),
  'modal phải import HourlyOrdersChart'
);
ok(/<HourlyOrdersChart/.test(modal), 'modal phải render <HourlyOrdersChart>');
ok(
  /rows=\{hourlyInWindow\}[\s\S]{0,120}startHour=\{hourWin\.start\}[\s\S]{0,120}endHour=\{hourEndShown\}/.test(modal),
  'biểu đồ phải dùng CHUNG khung giờ `hourlyInWindow`/`hourWin` với dải giờ trên bản in'
);
// Không được tự query thêm: `ordersByHour` đã gom sẵn 24 bucket ở service.
ok(
  !/fetch\(`?\/api\/pos\/daily-settlement/.test(chart),
  'biểu đồ không được tự gọi API (dữ liệu đã nằm trong `ordersByHour`)'
);
ok(
  /ordersByHour/.test(read('src/services/daily-settlement.service.ts')),
  'service phải còn trả `ordersByHour` làm nguồn dữ liệu của biểu đồ'
);

// --- 2. Cột phải là SVG rect/text (in được), không dùng màu nền CSS ------------
ok(/<svg/.test(chart), 'biểu đồ phải là <svg>');
ok(/<rect/.test(chart), 'phải vẽ cột bằng <rect>');
ok(/<text/.test(chart), 'phải có nhãn bằng <text>');
ok(
  !/bg-(indigo|amber|emerald|violet)-\d{3}[^"']*style=/.test(chart),
  'không được tô cột bằng màu nền CSS — Chrome không in màu nền'
);
ok(/role="img"/.test(chart), 'svg phải có role="img"');
ok(
  /aria-label=\{`Biểu đồ số đơn theo từng giờ/.test(chart),
  'svg phải có aria-label nêu rõ giờ và giờ cao điểm (screen reader đọc được)'
);

// --- 3. Trục Y là mốc tròn thuận tiện + có mốc 0 -----------------------------
ok(
  /function niceCeil\(/.test(chart),
  'phải có hàm tròn trần trục Y (1/2/5×10ⁿ) để mốc lưới dễ đọc'
);
ok(
  /\[0, 0\.5, 1\]\.map/.test(chart),
  'phải vẽ 3 mốc lưới 0 / nửa / đỉnh — nếu thiếu mốc 0 thì cột 0 đơn đọc như hỏng'
);
ok(
  /strokeDasharray/.test(chart),
  'mốc lưới phải nét đứt, còn mặt đất (0) là nét liền đậm'
);

// --- 4. Tương tác: rê/bấm cột ra số của đúng giờ đó --------------------------
for (const handler of ['onMouseEnter', 'onMouseLeave', 'onClick'] as const) {
  ok(new RegExp(`${handler}=`).test(chart), `phải có ${handler} trên vùng bấm của cột`);
}
ok(
  /setHover\(r\.hour\)/.test(chart),
  'rê chuột phải set giờ đang xét theo đúng `r.hour` của cột bị rê'
);
ok(
  /setLocked\(\(p\) => \(p === r\.hour \? null : r\.hour\)\)/.test(chart),
  'bấm phải ghim/bỏ ghim đúng giờ của cột bấm vào'
);
ok(
  /const activeHour = hover \?\? locked \?\? peak\?\.hour \?\? null/.test(chart),
  'giờ đang xét phải theo thứ tự: rê > ghim > cao điểm > không có'
);
ok(
  /Ghim giờ/.test(chart),
  'phải nói rõ đang ghim giờ nào và bấm lại để bỏ ghim (trạng thái phải nhìn thấy được)'
);
ok(
  /bấm lại để bỏ ghim/.test(chart),
  'phải hướng dẫn cách bỏ ghim'
);
ok(
  /active\.orders/.test(chart) && /active\.sales/.test(chart),
  'dải số bên dưới phải hiện SỐ ĐƠN và TIỀN của giờ đang xét'
);
ok(
  /\(active\.orders \/ totalOrders\) \* 100/.test(chart),
  'phải hiện tỉ trọng đơn của giờ đó so với tổng ngày'
);

// --- 5. Ngày không có đơn: nói rõ, không vẽ biểu đồ rỗng ---------------------
ok(
  /if \(!list\.length \|\| \(totalOrders === 0 && !hasBaseline\)\)/.test(chart),
  'phải có nhánh riêng khi ngày không có đơn'
);
ok(
  /chưa có đơn nào để vẽ biểu đồ/.test(chart),
  'nhánh rỗng phải nói rõ chứ không để trống'
);
ok(
  /totalOrders === 0[\s\S]{0,400}Math\.round/.test(chart) === false,
  'không được chia tỉ lệ khi tổng đơn bằng 0 (NaN lọt lên UI)'
);

// --- 6. Bố cục: đọc được số mà không cần nhìn biểu đồ -----------------------
ok(/Đơn Theo Giờ/.test(chart), 'phải có tiêu đề tiếng Việt có dấu');
ok(/Giờ cao điểm/.test(chart), 'phải có ô số Giờ cao điểm');
ok(/đơn\/giờ/.test(chart), 'phải có ô số bình quân đơn/giờ');
// Ô số thứ ba là TIỀN BÌNH QUÂN mỗi giờ BÁN, và mẫu số phải là số giờ THỰC SỰ
// CÓ ĐƠN (`openHours`), KHÔNG phải độ dài khung giờ — chia hết khung giờ ra con
// số nhỏ giả tỉnh vì khung luôn kéo cả giờ nghỉ trưa không ai mua.
ok(
  /const openHours = list\.filter\(\(r\) => r\.orders > 0\)\.length/.test(chart),
  'phải đếm GIỜ THỰC SỰ CÓ ĐƠN làm mẫu số, không chia hết độ dài khung giờ'
);
ok(
  /salesPerOpenHour = openHours > 0 \? Math\.round\(totalSales \/ openHours\) : 0/.test(chart),
  'tiền bình quân phải chia TỔNG doanh thu cho SỐ GIỜ CÓ ĐƠN'
);
ok(
  /openHours > 0 \? Math\.round/.test(chart),
  'phải chặn chia 0 khi không có giờ nào có đơn (ra Infinity/NaN)'
);
ok(/Doanh thu mỗi giờ bán/.test(chart), 'ô số phải ghi "Doanh thu mỗi giờ bán"');
ok(
  /\{openHours\} giờ có đơn/.test(chart),
  'phải nêu rõ mẫu số để "bình quân" không bị đọc nhầm'
);
// Tổng doanh thu đã có chỗ khác (KPI "Thực thu" + bản in) — lặp lại ở đây chỉ tốn chỗ.
ok(
  />Tổng doanh thu</.test(chart) === false,
  'không được lặp lại ô "Tổng doanh thu" — đã có ở KPI Thực thu và bản in'
);
ok(/đơn\/giờ/.test(chart), 'nhãn bình quân phải có dấu');
ok(
  /role="img"[\s\S]{0,400}aria-label/.test(chart),
  'svg phải mô tả được bằng aria-label'
);
// Nhãn giờ phải tự giãn theo số cột, nếu không chữ chồng lên nhau ở khung 24h.
ok(
  /const labelStep = Math\.max\(1, Math\.ceil\(n \/ 15\)\)/.test(chart),
  'nhãn giờ phải giãn theo số cột'
);

// --- 7. Không thêm thư viện biểu đồ chỉ để vẽ 24 cột -----------------------
const deps = JSON.parse(pkg).dependencies || {};
for (const lib of ['recharts', 'chart.js', 'react-chartjs-2', 'victory', 'apexcharts', 'visx', 'echarts', '@nivo']) {
  ok(!(lib in deps), `không được thêm thư viện biểu đồ "${lib}" chỉ để vẽ dải giờ`);
}

console.log(`\n=== BIỂU ĐỒ CỘT SỐ ĐƠN THEO GIỜ (màn hình): ${checks} assertions PASS ===\n`);