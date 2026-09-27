/**
 * Panel "Kho" — danh sách kho + Ngưng hoạt động / Mở lại / Xóa.
 *
 * Vấn đề người dùng báo: "xóa kho ở đâu, xem tổng số kho và tổng sách trong
 * từng kho". Đo được: API đã có `PATCH/DELETE /api/warehouses/[id]` (kho còn
 * tồn → 409 kèm hướng dẫn "Ngưng hoạt động") nhưng KHÔNG component nào gọi →
 * khả năng không với tới được từ UI.
 *
 * Hợp đồng source-level (cùng style với scripts/test-*.ts khác): không DOM,
 * không browser, không database.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const panelPath = path.resolve(process.cwd(), 'src/components/inventory/WarehouseManagerPanel.tsx');
const matrixPath = path.resolve(process.cwd(), 'src/components/StockOverviewMatrix.tsx');
const trapPath = path.resolve(process.cwd(), 'src/hooks/useModalFocusTrap.ts');

const panelExists = fs.existsSync(panelPath);
const panel = panelExists ? fs.readFileSync(panelPath, 'utf8') : '';
const matrix = fs.readFileSync(matrixPath, 'utf8');
const trap = fs.readFileSync(trapPath, 'utf8');

const checks: string[] = [];
const expect = (cond: unknown, msg: string) => {
  assert.ok(cond, msg);
  checks.push(`  ok  ${msg}`);
};

assert.ok(panelExists, 'Thiếu src/components/inventory/WarehouseManagerPanel.tsx');

// 1. Dùng hook focus trap CÓ SẴN, không tự viết focus trap mới.
expect(
  /import \{ useModalFocusTrap \} from '@\/hooks\/useModalFocusTrap'/.test(panel),
  'Panel dùng lại hook useModalFocusTrap sẵn có (không tự viết focus trap)'
);
expect(
  /useModalFocusTrap<HTMLDivElement>\(isOpen && mounted/.test(panel),
  'Panel gọi useModalFocusTrap đúng pattern PaymentProofCamera (isOpen && mounted + onClose)'
);
expect(/event\.key === 'Escape'/.test(trap), 'Hook sẵn có tự xử lý phím thoát');
expect(
  !/addEventListener\('keydown'/.test(panel) && !/Escape/.test(panel),
  'Panel KHÔNG tự bắt phím — phím thoát đến từ useModalFocusTrap'
);

// 2. Dialog đúng chuẩn trợ năng.
expect(/role="dialog"/.test(panel), 'Dialog có role="dialog"');
expect(/aria-modal="true"/.test(panel), 'Dialog có aria-modal="true"');
expect(/aria-label="[^"]+"/.test(panel), 'Dialog có tên truy cập được (aria-label)');

// 3. Dùng endpoint có sẵn, KHÔNG tạo endpoint mới.
expect(
  /fetch\('\/api\/warehouses\?all=true'/.test(panel),
  'Panel lấy danh sách bằng GET /api/warehouses?all=true (endpoint đã tồn tại)'
);
expect(!/router\.refresh|revalidatePath/.test(panel), 'Không tạo đường dẫn dữ liệu mới');
expect(
  panel.includes('stockQuantity') && panel.includes('isActive') && panel.includes('warehouseType'),
  'Panel dùng đúng field endpoint trả về: isActive + stockQuantity + warehouseType'
);

// 5. Nhãn ngắn đúng quy tắc dự án — không câu dài.
for (const label of ['Ngung hoat dong', 'Mo lai', 'Xoa']) {
  expect(panel.includes(label), `Panel có nhãn hành động "${label}"`);
}
for (const bad of ['Quản lý kho hàng', 'Quan ly kho hang', 'Xóa kho hàng', 'Ngưng hoạt động kho']) {
  expect(!panel.includes(bad), `Panel KHÔNG dùng nhãn dài "${bad}"`);
}

// 6. LỖI 409 PHẢI hiện message của server + đề nghị "Ngung hoat dong".
expect(/status === 409/.test(panel), 'Panel nhận diện 409 từ server (kho còn tồn)');
expect(
  /j\?\.error/.test(panel) && /setError\(e\?\.message/.test(panel),
  'Panel hiện đúng message server trả về, không báo lỗi chung chung'
);
expect(
  /setDeleteBlock/.test(panel) &&
    /Ngung hoat dong/.test(panel.slice(panel.indexOf('setDeleteBlock'))),
  'Khi xóa bị chặn, panel mời dùng "Ngung hoat dong" làm đường thay thế'
);

// 7. Xóa phải có bước xác nhận và phải GỌI TÊN KHO.
expect(/confirmDelete/.test(panel), 'DELETE có bước xác nhận riêng (không xóa thẳng)');
expect(
  /Xoa kho \[/.test(panel) || /Xoá kho \[/.test(panel),
  'Bước xác nhận nêu tên kho cụ thể'
);

// 8. Sau mỗi hành động thành công: nạp lại danh sách + báo lên để refresh chip row.
expect(/const load = async/.test(panel), 'Panel có hàm nạp lại danh sách kho');
expect(
  /await load\(\)/.test(panel) && /onChanged\?\.\(\)/.test(panel),
  'Mọi hành động thành công đều nạp lại list rồi gọi onChanged (refresh chip row)'
);

// 9. Mobile: không tràn ngang, nhãn không xuống dòng, vùng chạm >= 38px.
expect(
  /flex flex-wrap items-center gap-2 min-w-0/.test(panel),
  'Dải nút hành động: flex-wrap + min-w-0 (không tràn ngang)'
);
const panelButtons = panel.match(/<button\b[\s\S]*?<\/button>/g) || [];
expect(panelButtons.length >= 6, `Tìm thấy ${panelButtons.length} nút trong panel`);
for (const block of panelButtons) {
  const inner = block
    .replace(/^<button\b[\s\S]*?(?<![=<>])>/, '')
    .replace(/<\/button>$/, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!inner) continue; // nút chỉ có icon
  assert.ok(
    /whitespace-nowrap/.test(block),
    `Nút có chữ "${inner}" thiếu whitespace-nowrap (chữ xuống dòng từng âm tiết)`
  );
  assert.ok(/shrink-0/.test(block), `Nút có chữ "${inner}" thiếu shrink-0 (bị bóp trên máy)`);
}
expect(/min-h-\[38px\]/.test(panel), 'Nút trong panel có vùng chạm tối thiểu 38px');
expect(/max-w-\[min\(/.test(panel), 'Bề rộng panel giới hạn theo viewport (vừa ở 320px)');
expect(/min-w-0/.test(panel) && !/w-screen/.test(panel), 'Panel có min-w-0 và không dùng w-screen');

// 10. Panel render qua helper portal chung (không tự createPortal).
expect(/from '\.\.\/PortalToBody'/.test(panel), 'Panel dùng helper portal dùng chung PortalToBody');
expect(!/createPortal\(/.test(panel), 'Panel không tự gọi createPortal — một pattern duy nhất');
expect(!/tabMenuPos/.test(panel), 'Panel không đụng cơ chế toạ độ dropdown tab');

// 11. Nút "Kho" trên toolbar, cạnh "Mở Kho", chỉ OWNER/MANAGER.
expect(/setWarehousePanelOpen\(true\)/.test(matrix), 'StockOverviewMatrix có state mở panel kho');
expect(
  /<WarehouseManagerPanel/.test(matrix) && /from '\.\/inventory\/WarehouseManagerPanel'/.test(matrix),
  'StockOverviewMatrix render WarehouseManagerPanel'
);
const moKhoIdx = matrix.indexOf('/> Mở Kho');
// Nút "Kho" là JSX: <Icon /> Kho rồi </button> — neo vào chính nút đó.
// Dùng regex vì file có thể CRLF.
const khoMatch = /\/> Kho\s*<\/button>/.exec(matrix);
const khoBtnIdx = khoMatch ? khoMatch.index : -1;
assert.ok(moKhoIdx !== -1, 'Không tìm thấy nút "Mở Kho" trên toolbar');
assert.ok(khoBtnIdx !== -1, 'Không tìm thấy nút "Kho" trên toolbar');
expect(
  khoBtnIdx > moKhoIdx && khoBtnIdx - moKhoIdx < 900,
  'Nút "Kho" nằm ngay cạnh nút "Mở Kho" trên toolbar'
);
const khoGate = matrix.slice(Math.max(0, khoBtnIdx - 900), khoBtnIdx);
expect(
  /currentRole === 'ROLE_OWNER' \|\| currentRole === 'ROLE_MANAGER'/.test(khoGate),
  'Nút "Kho" chỉ hiện cho OWNER/MANAGER'
);
expect(
  /<WarehouseManagerPanel[\s\S]{0,400}?onChanged=\{/.test(matrix),
  'Panel được nối onChanged để refresh số kho trên chip row'
);
expect(
  /localWarehouses \|\| \[\]/.test(matrix) && /setLocalWarehouses/.test(matrix),
  'Chip row đọc từ localWarehouses (cập nhật được sau khi panel thao tác)'
);

console.log('\nWarehouse Manager Panel UI contract - PASS');
for (const c of checks) console.log(c);
console.log(`\n${checks.length} assertions passed.\n`);


// 4. Ba hành động, mỗi hành động gọi đúng API.
// Một hàm setActive dùng chung, hai call site truyền đúng giá trị.
expect(
  /method: 'PATCH'/.test(panel) && /body: JSON\.stringify\(\{ isActive \}\)/.test(panel),
  'Ngưng hoạt động / Mở lại → PATCH isActive qua một hàm dùng chung'
);
expect(
  /setActive\(w, false\)/.test(panel) && /setActive\(w, true\)/.test(panel),
  'Cả hai chiều bật/tắt đều được gọi (isActive false và isActive true)'
);
expect(/method: 'DELETE'/.test(panel), 'Xóa → DELETE /api/warehouses/[id]');
