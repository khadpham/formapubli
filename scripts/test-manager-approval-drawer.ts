/**
 * ManagerApprovalDrawer — 2 lỗi đã xác minh bằng đọc code:
 *
 * 1) DUYỆT NHẦM ĐƠN: `shortCode` = 4 ký tự cuối của 16 hex ngẫu nhiên
 *    (order.service.ts:559 `generateUUIDv7().slice(-16)` → extractShortCode,
 *    discount-approval.service.ts:128-131) ⇒ chỉ 65.536 giá trị, trùng chắc
 *    chắn xảy ra trong một hội chợ. Server so shortCode với CHÍNH request mà
 *    client chọn (discount-approval.service.ts:434-440) nên không chặn được:
 *    quản lý đọc mã A nhưng duyệt đơn B của thu ngân khác. Drawer cũ dùng
 *    `items.find(...)` ⇒ chọn bừa thẻ đầu tiên. Nay phải trả về TẤT CẢ đơn
 *    khớp và bắt quản lý chọn.
 *
 * 2) MỘT Ô BUSY DÙNG CHUNG: `actionInProgressId` là một ô cho cả duyệt và từ
 *    chối; `finally { setActionInProgressId(null) }` của thẻ nào xong trước
 *    sẽ xoá luôn trạng thái của thẻ đang bay còn lại (nút sáng lại, mất
 *    spinner) và cho bấm trùng. Nay khoá theo từng id.
 *
 * Kiểm thử tầng hành vi (hàm thuần export từ component) + hợp đồng mã nguồn.
 * Không DOM, không trình duyệt, không database.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  decideQuickApprove,
  addBusyId,
  removeBusyId,
  type PendingApprovalItem,
} from '../src/components/pos/ManagerApprovalDrawer';

const checks: string[] = [];
const expect = (cond: unknown, msg: string) => {
  assert.ok(cond, msg);
  checks.push(`  ok  ${msg}`);
};

const drawerPath = path.resolve(process.cwd(), 'src/components/pos/ManagerApprovalDrawer.tsx');
const source = readFileSync(drawerPath, 'utf8');

/** Đơn thật: 16 hex ngẫu nhiên, shortCode = 4 ký tự cuối (khớp server). */
function makeItem(over: Partial<PendingApprovalItem> & { orderCode: string; id: string }): PendingApprovalItem {
  const shortCode = over.orderCode.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase();
  return {
    warehouseId: 'KHO-HN',
    cashierId: 'thu-ngan-01',
    requestedDiscountRate: 0.2,
    originalAmount: 100000,
    discountAmount: 20000,
    finalAmount: 80000,
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    createdAt: new Date().toISOString(),
    cartSnapshot: null,
    ...over,
    shortCode,
  } as PendingApprovalItem;
}

const orderA = makeItem({ id: 'req-a', orderCode: 'ORD-20260929-9F3A11C2B4D64821', cashierId: 'thu-ngan-01' });
const orderB = makeItem({ id: 'req-b', orderCode: 'ORD-20260929-77C0A9E5B31D4821', cashierId: 'thu-ngan-02' });
const orderC = makeItem({ id: 'req-c', orderCode: 'ORD-20260929-1122334455AA7788' });

// --- LỖI 1: trùng mã 4 ký tự -------------------------------------------------
assert.equal(orderA.shortCode, '4821');
assert.equal(orderB.shortCode, '4821');
assert.equal(orderC.shortCode, '7788');

const none = decideQuickApprove([orderA, orderB], '0000');
expect(none.kind === 'none', 'Mã không khớp đơn nào → báo "không tìm thấy", không gọi API');
expect(none.code === '0000', 'Quyết định giữ lại mã đã nhập để hiện thông báo');

const single = decideQuickApprove([orderA, orderC], '7788');
expect(single.kind === 'single' && single.item.id === 'req-c', 'Mã khớp đúng 1 đơn → duyệt thẻ đó');
expect(single.kind === 'single' && single.code === '7788', 'Mã 4 ký tự được gửi kèm (SHORTCODE_BOUND)');

const ambiguous = decideQuickApprove([orderA, orderB, orderC], '4821');
expect(ambiguous.kind === 'ambiguous', 'Trùng mã ở 2 đơn → KHÔNG tự chọn bừa');
expect(
  ambiguous.kind === 'ambiguous' && ambiguous.items.length === 2,
  'Trả về đủ cả 2 đơn trùng mã để quản lý phân biệt'
);
expect(
  ambiguous.kind === 'ambiguous' && ambiguous.items.some((i) => i.id === 'req-a') && ambiguous.items.some((i) => i.id === 'req-b'),
  'Danh sách trùng mã giữ đúng mã đơn của từng thẻ'
);
expect(
  decideQuickApprove([orderA, orderB], '  4821 ').kind === 'ambiguous',
  'Khoảng trắng thừa / chữ thường vẫn nhận diện đúng (chuẩn hoá trước khi so)'
);

// --- Hợp đồng mã nguồn LỖI 1 --------------------------------------------------
expect(
  !/items\.find\(\s*\(?i?\)?\s*=>\s*i\.shortCode/.test(source),
  'Đã gỡ items.find(...) chọn bừa thẻ đầu tiên khi trùng mã'
);
expect(
  source.includes("setAmbiguous(") && source.includes("decideQuickApprove("),
  'Handler duyệt nhanh đi qua decideQuickApprove và mở bảng chọn khi trùng mã'
);
expect(
  /Trùng mã/.test(source) && /Duyệt đơn này/.test(source),
  'Bảng chọn hiện cảnh báo "Trùng mã" kèm nút "Duyệt đơn này" cho từng đơn'
);
expect(
  source.includes('item.cashierId') && source.includes('item.warehouseId'),
  'Bảng chọn hiện thu ngân + kho để phân biệt đơn trùng mã'
);

// --- LỖI 2: ô busy dùng chung ------------------------------------------------
expect(addBusyId([], 'req-a').length === 1, 'Bắt đầu duyệt req-a → khoá req-a');
expect(
  addBusyId(['req-a'], 'req-a').length === 1,
  'Bấm lại cùng thẻ đang bay không tạo khoá trùng'
);
expect(
  addBusyId(['req-a'], 'req-b').join(',') === 'req-a,req-b',
  'Duyệt req-b khi req-a chưa xong → cả hai cùng khoá'
);
expect(
  removeBusyId(['req-a', 'req-b'], 'req-a').join(',') === 'req-b',
  'req-a xong trước KHÔNG xoá khoá của req-b (lỗi cũ: set null xoá sạch)'
);
expect(
  removeBusyId(['req-b'], 'req-a').join(',') === 'req-b',
  'Bỏ khoá một id lạ không được xoá khoá của thẻ khác'
);
expect(removeBusyId(['req-a'], 'req-a').length === 0, 'Thẻ xong xử lý thì tự bỏ khoá');
expect(
  !/actionInProgressId/.test(source),
  'Đã gỡ ô busy dùng chung actionInProgressId'
);
expect(
  /clearBusy\(id\)|removeBusyId/.test(source) && /setBusyIds/.test(source),
  'handleApprove và handleReject cùng bỏ khoá đúng id của mình'
);

console.log(checks.join('\n'));
console.log(`\n✅ PASS — ${checks.length} assertion cho ManagerApprovalDrawer (trùng mã 4 số + ô busy dùng chung).`);
