/**
 * TEST: bỏ nút đơn vị chiết khấu + bản in có 2 bảng xếp theo tồn.
 *
 * Vì sao kiểm source: repo không có DOM harness cho test UI (xem
 * `scripts/test-order-code-13.ts`). Ở đây ta khẳng định thứ đã bị gỡ và thứ
 * đã có — đúng những thứ quyết định người dùng có đọc nhầm hay không.
 *
 * CHẠY: npx tsx scripts/test-settlement-print-stocktake.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const FILE = 'src/components/pos/DailyFairSettlementModal.tsx';
const src = fs.readFileSync(FILE, 'utf8');

// 1. Nút "Đơn vị CK" biến mất hoàn toàn — không còn state, không còn nút.
assert.ok(
  !src.includes('discountDisplayMode'),
  'đã bỏ hoàn toàn nút đơn vị chiết khấu (kể cả state)'
);
assert.ok(!src.includes('Đơn vị CK'), 'không còn nhãn "Đơn vị CK"');

// 2. Sắp xếp kiểm kê mặc định là Bé → Lớn, chỉ 2 trạng thái.
assert.ok(
  /useState<'ASC' \| 'DESC'>\('ASC'\)/.test(src),
  'sắp xếp kiểm kê mặc định là Bé → Lớn'
);
assert.ok(
  !src.includes("stocktakeSortMode === 'DEFAULT'"),
  'không còn chế độ "Mặc định" (thứ tự thô vô nghĩa khi đối chiếu)'
);
assert.ok(!src.includes("setStocktakeSortMode('ASC')"), 'không còn đoạn tự nhảy sang ASC');

// 3. Dùng chung helper với bản in.
assert.ok(src.includes('sortByStock'), 'màn hình và bản in dùng chung hàm sắp xếp');
assert.ok(src.includes('filterLowStock'), 'lọc sắp hết dùng chung hằng số ngưỡng');
assert.ok(src.includes('sortLabel'), 'nhãn thứ tự có dấu mũi tên');
assert.ok(
  /sortByStock\(\s*\(data\?\.inventoryReconciliation \|\| \[\]\)/.test(src),
  'bảng "đã bán" cũng phải xếp theo tồn'
);

// 4. Bản in có bảng sắp hết, nói rõ dùng để đếm, có chỗ điền tay.
assert.ok(src.includes('SẮP HẾT'), 'bản in có bảng sắp hết');
assert.ok(src.includes('CẦN ĐẾM CUỐI NGÀY'), 'bảng sắp hết nói rõ dùng để đếm');
assert.ok(src.includes('Số đếm thực tế'), 'bảng sắp hết có cột để nhân viên điền tay');
assert.ok(
  src.includes('chưa lưu số đếm'),
  'phải nói rõ hệ thống chưa lưu số đếm — không được làm người dùng tưởng đã lưu'
);

// 5. Ngưỡng sắp hết lấy từ hằng số chung, không hardcode.
assert.ok(src.includes('STOCK_THRESHOLD_WARNING'), 'dùng hằng STOCK_THRESHOLD_WARNING chung');
assert.ok(
  !/SẮP HẾT \(TỒN ≤ 5\)/.test(src),
  'không hardcode số 5 trong tiêu đề bảng in'
);

// 6. Mục trên giấy phải ĐÚNG THỨ TỰ. Lỗi đã gặp: bảng Sắp hết được chèn
// trước mục V nhưng lại đánh số VI ⇒ biên bản in ra "VI" rồi mới tới "V".
assert.ok(
  src.indexOf('V. SẮP HẾT') > 0 && src.indexOf('V. SẮP HẾT') < src.indexOf('VI. PHÂN TÍCH'),
  'trên giấy phải là mục V. SẮP HẾT rồi mới tới VI. PHÂN TÍCH'
);

console.log('✓ test-settlement-print-stocktake PASS');