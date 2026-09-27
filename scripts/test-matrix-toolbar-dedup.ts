/**
 * Kho hàng: gộp nút trùng + nút Làm mới + nhãn tiếng Việt có dấu.
 *
 * Bug thật (xác nhận bằng ảnh chụp site chạy thật): dải hành động trên cùng có
 * 8 nút, còn thẻ "QUẢN LÝ KHO" bên dưới lặp lại "Mở kho mới" (trùng
 * setCreateWarehouseOpen với nút "Mở Kho") và "Soạn kệ" (trùng mục "Soạn kệ
 * (gom theo kệ)" trong menu "Chuyển kho"). Người dùng phải đoán xem bấm đâu.
 *
 * Luật sau khi gộp: MỖI hành động CHỈ CÓ MỘT đường vào. Thanh công cụ là nơi
 * duy nhất mở kho / panel kho / TK nhận tiền / soạn kệ; thẻ QUẢN LÝ KHO chỉ
 * còn TÓM TẮT trạng thái (bao nhiêu kho, bao nhiêu đang hoạt động), không lặp
 * lại hành động nào. Thêm nút "Làm mới" cho ROLE_OWNER/ROLE_MANAGER nạp lại
 * DỮ LIỆU (router.refresh) chứ không reload trang, để không mất việc đang dở.
 *
 * Assertions ở mức source (như các scripts/test-*.ts khác): không DOM, không
 * trình duyệt, không database.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const matrix = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/StockOverviewMatrix.tsx'),
  'utf8'
);

const checks: string[] = [];
const expect = (cond: unknown, msg: string) => {
  assert.ok(cond, msg);
  checks.push(`  ok  ${msg}`);
};

/** Cắt vùng JSX từ marker mở đến marker kế tiếp để assert đúng khối đã sửa. */
const region = (from: string, to: string): string => {
  const start = matrix.indexOf(from);
  assert.ok(start !== -1, `Không tìm thấy vùng cần kiểm tra: ${from}`);
  const end = matrix.indexOf(to, start);
  assert.ok(end !== -1, `Không tìm thấy điểm kết thúc vùng: ${to}`);
  return matrix.slice(start, end);
};

// Dải hành động: từ comment mở tới lớp nền đóng menu (nằm ngay sau `</div>`)
// nên vùng cắt đúng bằng dải nút, không lẫn menu tab render qua portal.
const toolbar = region('{/* Tab & Action Buttons with Keyboard Shortcut Tooltips.', '{actionMenu && (');
const summary = region('data-kho-ui="warehouse-summary"', '2.5 BANNER');

// ---------------------------------------------------------------------------
// 1. THANH CÔNG CỤ giữ nguyên shape: 4 nút hành động + 4 nút cố định.
// ---------------------------------------------------------------------------
const TOOLBAR_BTN_CLASS = 'className="flex items-center gap-1 whitespace-nowrap shrink-0 px-3 py-2';
const actionBtns = (toolbar.match(new RegExp(TOOLBAR_BTN_CLASS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
expect(actionBtns === 4, `Thanh công cụ giữ đúng 4 nút hành động (đang ${actionBtns})`);

for (const label of ['Mở Kho', 'TK Nhận Tiền', 'Xuất kho', 'Chuyển kho', 'Nhập in', 'Cách Ly Sách Lỗi']) {
  expect(toolbar.includes(label), `Thanh công cụ giữ nút "${label}"`);
}
// 4 nút cố định: chip tab + Mở Kho (setCreateWarehouseOpen) + Kho (panel) + TK Nhận Tiền.
expect(/id="kho-main-tab-trigger"/.test(toolbar), 'Thanh công cụ giữ chip chọn màn "Ma trận"');
expect(
  /setCreateWarehouseOpen\(true\)/.test(toolbar) && /setWarehousePanelOpen\(true\)/.test(toolbar) && /setBankManagerOpen\(true\)/.test(toolbar),
  'Ba nút kho (Mở Kho / Kho / TK Nhận Tiền) vẫn nằm trên thanh công cụ'
);
// "Soạn kệ" chỉ còn ở menu "Chuyển kho", đúng một đường vào.
const pickListEntries = (matrix.match(/setPickListOpen\(true\)/g) || []).length;
expect(pickListEntries === 1, `setPickListOpen chỉ còn 1 đường vào (đang ${pickListEntries})`);
expect(toolbar.includes('Soạn kệ (gom theo kệ)'), 'Hành động soạn kệ còn trong menu "Chuyển kho"');

// ---------------------------------------------------------------------------
// 2. THẺ QUẢN LÝ KHO không lặp hành động nào của thanh công cụ.
// ---------------------------------------------------------------------------
for (const handler of ['setCreateWarehouseOpen', 'setPickListOpen', 'setBankManagerOpen', 'setWarehousePanelOpen']) {
  expect(
    !summary.includes(handler),
    `Thẻ tóm tắt kho không gọi ${handler} nữa (đã gộp về thanh công cụ)`
  );
}
expect(summary.includes('QUẢN LÝ KHO'), 'Thẻ tóm tắt kho giữ tiêu đề "QUẢN LÝ KHO"');
expect(/đang hoạt động/.test(summary), 'Thẻ tóm tắt kho báo số kho đang hoạt động');
expect(/kho/.test(summary) && /\{/.test(summary), 'Thẻ tóm tắt kho hiện số liệu động, không phải chữ tĩnh');

// ---------------------------------------------------------------------------
// 3. NÚT LÀM MỚI cho quản lý: nạp lại dữ liệu, không reload trang.
// ---------------------------------------------------------------------------
expect(/RefreshCw/.test(matrix), 'Có icon RefreshCw');
const refreshBtn = /<button\b(?:(?!<\/button>)[\s\S])*?Làm mới[\s\S]*?<\/button>/.exec(matrix);
expect(refreshBtn !== null, 'Có nút "Làm mới" trên thanh công cụ');
if (refreshBtn) {
  const btn = refreshBtn[0];
  expect(/RefreshCw/.test(btn), 'Nút "Làm mới" dùng icon RefreshCw');
  expect(/onClick=\{\(\) => handleRefresh\(\)\}/.test(btn), 'Nút "Làm mới" gọi handleRefresh()');
  expect(/min-h-\[38px\]/.test(btn), 'Nút "Làm mới" có vùng bấm tối thiểu 38px');
  expect(/whitespace-nowrap/.test(btn), 'Nút "Làm mới" không xuống dòng');
  expect(/shrink-0/.test(btn), 'Nút "Làm mới" không bị bóp lại');
  expect(!TOOLBAR_BTN_CLASS.includes(btn), 'Nút "Làm mới" không lẫn vào bộ 4 nút hành động');
}
expect(
  /\{\(currentRole === 'ROLE_OWNER' \|\| currentRole === 'ROLE_MANAGER'\) && \([\s\S]{0,1200}?Làm mới[\s\S]{0,200}?<\/button>/.test(matrix),
  'Nút "Làm mới" chỉ hiện cho ROLE_OWNER và ROLE_MANAGER'
);
// Làm mới = nạp lại dữ liệu, KHÔNG mất việc đang dở.
expect(
  /const handleRefresh = \(\) => \{[\s\S]{0,400}?router\.refresh\(\)/.test(matrix),
  'handleRefresh gọi router.refresh() để nạp lại dữ liệu server'
);
expect(
  !/window\.location\.reload/.test(matrix),
  'Không còn window.location.reload (nó xóa việc quản lý đang làm dở)'
);
expect(/reloadWarehouseChips\(\)/.test(matrix), 'handleRefresh nạp lại cả danh sách kho');

// ---------------------------------------------------------------------------
// 4. Nhãn tiếng Việt CÓ DẤU trong vùng đã sửa.
// ---------------------------------------------------------------------------
const FORBIDDEN = [
  'Mo kho moi',
  'Lam moi',
  'Quan ly kho',
  'Ma tran',
  'Cach Ly',
  'Soan ke',
  'Nhan in',
  'Xuat kho',
  'Chuyen kho',
];
for (const bad of FORBIDDEN) {
  expect(
    !toolbar.includes(bad) && !summary.includes(bad),
    `Không còn nhãn không dấu "${bad}" trong vùng đã sửa`
  );
}
for (const good of ['Làm mới', 'QUẢN LÝ KHO', 'Ma trận']) {
  expect(matrix.includes(good), `Nhãn có dấu "${good}" còn trong file`);
}

console.log('\nKho hàng: gộp nút trùng + nút Làm mới - PASS');
for (const c of checks) console.log(c);
console.log(`\n${checks.length} assertions passed.\n`);
