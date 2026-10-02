/**
 * TEST: khối tiền phải nằm ĐẦU tab "Tiền & Két".
 *
 * Vì sao kiểm source chứ không render: repo không có DOM harness cho test UI,
 * các test UI sẵn có cũng kiểm source bằng cách đọc file (xem
 * `scripts/test-order-code-13.ts`). Ở đây ta khẳng định thứ TỰ và sự
 * TỒN TẠI của các khối — đúng thứ đã làm người dùng phải cuộn.
 *
 * CHẠY: npx tsx scripts/test-settlement-money-header.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const FILE = 'src/components/pos/DailyFairSettlementModal.tsx';
const src = fs.readFileSync(FILE, 'utf8');

const iHeader = src.indexOf('function MoneyHeader');
assert.ok(iHeader > 0, 'phải có hàm MoneyHeader');

// Khối KPI cũ nằm sau "đơn lớn nhất" chính là thứ đã làm tiền bị chôn.
assert.ok(
  src.indexOf('KPI Cards') === -1,
  'khối "KPI Cards" cũ phải bị gỡ (nó nằm sau đơn lớn nhất và top 10)'
);

// 2 khối chuyển sang Trạng Thái Hội Chợ không được còn ở đây.
// LƯU Ý: file có HAI cặp so sánh activeTab — cặp đầu là điều kiện render
// nút, cặp sau mới là thân tab. Phải lấy `activeTab === 'X' && (` mới đúng.
const iFinancials = src.indexOf("{activeTab === 'FINANCIALS' && (");
const iStocktake = src.indexOf("{activeTab === 'STOCKTAKE' && (");
assert.ok(iFinancials > 0 && iStocktake > iFinancials, 'phải còn tab FINANCIALS và tab STOCKTAKE');
const financialsBody = src.slice(iFinancials, iStocktake);
assert.ok(
  !financialsBody.includes('Đơn Giá Trị Cao Nhất'),
  'đơn lớn nhất đã chuyển sang Trạng Thái Hội Chợ'
);
assert.ok(
  !financialsBody.includes('Top 10 Ấn Phẩm Bán Chạy'),
  'top 10 bán chạy đã chuyển sang Trạng Thái Hội Chợ'
);

// MoneyHeader phải được gắn vào ĐẦU tab, trước mọi thứ khác.
const iUse = financialsBody.indexOf('<MoneyHeader');
assert.ok(iUse >= 0, 'tab FINANCIALS phải render <MoneyHeader>');
assert.ok(
  iUse < financialsBody.indexOf('<HourlyOrdersChart'),
  'MoneyHeader phải nằm TRƯỚC biểu đồ giờ'
);

// Nội dung bắt buộc nằm trong THÂN hàm MoneyHeader; thân tab chỉ gọi nó.
const iMoney = src.indexOf("export function DailyFairSettlementModal", iHeader);
const moneyBlock = src.slice(iHeader, iMoney > 0 ? iMoney : undefined);
for (const need of ['Thực thu', 'pendingQr', 'expectedCashTotal', 'cashVariance']) {
  assert.ok(moneyBlock.includes(need), `khối tiền phải có "${need}"`);
}

// Dòng tiền chờ phải nói rõ CHƯA ghi nhận để không ai cộng tay vào Thực thu.
assert.ok(
  moneyBlock.includes('chưa ghi nhận'),
  'dòng đơn chờ phải ghi rõ "chưa ghi nhận vào Thực thu"'
);

// Thanh tab dính đầu + chân modal có nút In: trên điện thoại, tab cũ là thanh
// cuộn ngang không báo còn bao nhiêu mục, và nút In nằm trên cùng nên phải
// cuộn lên mới bấm được.
assert.ok(src.includes('sessionStorage'), 'nhớ tab đang xem qua sessionStorage');
assert.ok(src.includes('sticky top-0'), 'thanh tab phải dính đầu');
assert.ok(src.includes('sticky bottom-0'), 'chân modal phải dính đáy');
assert.ok(src.includes('role="tablist"'), 'thanh tab phải là tablist để trình đọc màn hình hiểu');
assert.ok(
  src.includes('Tiền & Két'),
  'tab phải có nhãn ngắn "Tiền & Két"'
);

console.log('✓ test-settlement-money-header PASS');