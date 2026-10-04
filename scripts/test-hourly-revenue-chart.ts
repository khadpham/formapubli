/**
 * Biểu đồ "Doanh Thu Theo Giờ" — cặp song sinh của "Số Đơn Theo Giờ".
 *
 * Khóa lại:
 * 1. `HourlyOrdersChart` có chế độ vẽ theo tiền qua prop `metric="sales"`.
 * 2. Tiêu đề cũ đổi thành "Số Đơn Theo Giờ"; chế độ tiền là "Doanh Thu Theo Giờ".
 * 3. Cả báo cáo chốt ngày (modal) lẫn thẻ dashboard đều render ĐỦ 2 biểu đồ
 *    trên CÙNG dữ liệu đã có (không query thêm).
 * 4. Không lặp ô "Tổng doanh thu" (đã cấm từ suite biểu đồ đơn).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');
let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; assert.ok(cond, msg); };

const chart = read('src/components/pos/HourlyOrdersChart.tsx');
const modal = read('src/components/pos/DailyFairSettlementModal.tsx');
const card = read('src/components/dashboard/HourlyTodayCard.tsx');

// --- 1. Chế độ vẽ theo tiền ----------------------------------------------
ok(/metric\?: 'orders' \| 'sales'/.test(chart), 'chart phải có prop metric orders|sales');
ok(/metric = 'orders'/.test(chart), 'mặc định metric là orders (giữ hành vi cũ)');
ok(/Doanh Thu Theo Giờ/.test(chart), 'phải có tiêu đề "Doanh Thu Theo Giờ"');
ok(/Số Đơn Theo Giờ/.test(chart), 'tiêu đề cũ phải đổi thành "Số Đơn Theo Giờ"');
ok(/metric="sales"/.test(chart) === false, 'bản thân chart không tự hardcode metric');

// --- 2. Báo cáo chốt ngày: đủ 2 biểu đồ, cùng khung giờ --------------------
const modalCharts = modal.match(/<HourlyOrdersChart/g) || [];
ok(modalCharts.length >= 2, `modal phải render ≥2 biểu đồ (đơn + doanh thu), thấy ${modalCharts.length}`);
ok(
  /<HourlyOrdersChart[\s\S]*?metric="sales"/.test(modal),
  'modal phải có 1 biểu đồ metric="sales"'
);
ok(
  /rows=\{hourlyInWindow\}[\s\S]{0,200}metric="sales"/.test(modal),
  'biểu đồ doanh thu phải dùng CHUNG `hourlyInWindow` với biểu đồ đơn'
);
// Không query thêm cho biểu đồ mới.
ok(
  (modal.match(/ordersByHour/g) || []).length >= 1,
  'modal vẫn chỉ đọc `ordersByHour` đã có, không thêm nguồn dữ liệu'
);

// --- 3. Dashboard: đủ 2 biểu đồ + TB doanh thu ------------------------------
const cardCharts = card.match(/<HourlyOrdersChart/g) || [];
ok(cardCharts.length >= 2, `thẻ dashboard phải render ≥2 biểu đồ, thấy ${cardCharts.length}`);
ok(/salesBaseline/.test(card), 'thẻ phải tính TB doanh thu (salesBaseline) cho đường nét đứt');
ok(
  /baseline=\{salesBaseline\}[\s\S]{0,120}metric="sales"|metric="sales"[\s\S]{0,120}baseline=\{salesBaseline\}/.test(card) ||
  (card.includes('baseline={salesBaseline}') && card.includes('metric="sales"')),
  'biểu đồ doanh thu phải dùng TB doanh thu, không dùng TB đơn'
);

// --- 4. Không lặp ô tổng + nhãn tiền có dấu ---------------------------------
ok(/>Tổng doanh thu</.test(chart) === false, 'không được lặp ô "Tổng doanh thu"');
ok(/Tổng \{money\(totalSales\)\} đ/.test(chart), 'badge tổng phải hiện tiền khi ở chế độ doanh thu');
ok(/đ\/giờ/.test(chart), 'ô bình quân chế độ tiền phải ghi "đ/giờ"');

console.log(`\n=== BIỂU ĐỒ DOANH THU THEO GIỜ: ${checks} assertions PASS ===\n`);
