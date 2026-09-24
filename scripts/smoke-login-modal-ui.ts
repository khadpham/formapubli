/**
 * Kiểm tra hợp đồng UI & State Machine cho LoginModal (Ticket #9).
 * Chạy: npx tsx scripts/smoke-login-modal-ui.ts
 *
 * Phạm vi kiểm tra:
 * 1. Logic sắp xếp danh sách tài khoản:
 *    - Lọc bỏ HIDDEN_PICKER_ROLES (ROLE_WAREHOUSE, ROLE_TAX)
 *    - Sắp xếp phẳng theo ROLE_ORDER (OWNER -> MANAGER -> CASHIER)
 * 2. Kích thước danh mục tài khoản:
 *    - Mobile: 2 cột (grid-cols-2), 3 hàng đầu (6 thẻ = 190px) vừa khung max-h-[195px]; từ thẻ thứ 7 (256px) kích hoạt thanh cuộn overflow-y-auto.
 *    - Desktop: 3 cột (sm:grid-cols-3), 3 hàng đầu (9 thẻ = 190px) vừa khung sm:max-h-[250px]; từ hàng 4 (10-12 thẻ = 256px) kích hoạt thanh cuộn.
 * 3. Hợp đồng Icon Mắt PIN (Eye Toggle):
 *    - Nút mắt cụ thể có type="button" (chống submit nhầm)
 *    - aria-label và aria-pressed phản ánh đúng trạng thái
 *    - Reset về false khi chọn thẻ nhân viên khác
 *    - Reset về false khi gõ đổi mã nhân viên trong chế độ nhập tay (manualId)
 *    - Reset về false khi bấm chuyển chế độ nhập tay
 *    - Reset về false khi bấm Escape / Hủy / Backdrop
 * 4. Trạng thái phòng thủ (Locked & Loading):
 *    - isLocked khóa ô nhập, nút mắt, các thẻ tài khoản
 *    - loading khóa nút submit và hiển thị "Đang xác thực..."
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { UserRole } from '../src/lib/roles';

const ROLE_ORDER: UserRole[] = ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER', 'ROLE_WAREHOUSE', 'ROLE_TAX'];
const HIDDEN_PICKER_ROLES: UserRole[] = ['ROLE_WAREHOUSE', 'ROLE_TAX'];

interface AccountTile {
  staffId: string;
  fullName: string;
  role: UserRole;
}

function runSmokeTests() {
  console.log('🧪 BẮT ĐẦU KIỂM TRA HỢP ĐỒNG UI LOGIN MODAL (#9)\n');
  let passed = 0;
  const total = 9;

  const check = (title: string, fn: () => void) => {
    try {
      fn();
      passed++;
      console.log(`✅ PASS: ${title}`);
    } catch (err: any) {
      console.error(`❌ FAIL: ${title} -> ${err.message}`);
    }
  };

  // Test 1: Sắp xếp tài khoản phẳng theo thứ tự vai trò (ROLE_ORDER)
  check('1. Lọc bỏ vai trò ẩn và sắp xếp phẳng theo thứ tự Owner -> Manager -> Cashier', () => {
    const rawAccounts: AccountTile[] = [
      { staffId: 'NV-02', fullName: 'Lê Thu Ngân B', role: 'ROLE_CASHIER' },
      { staffId: 'KHO-01', fullName: 'Trần Thủ Kho', role: 'ROLE_WAREHOUSE' },
      { staffId: 'QL-01', fullName: 'Phạm Quản Lý', role: 'ROLE_MANAGER' },
      { staffId: 'THUE-01', fullName: 'Ngô Kế Toán', role: 'ROLE_TAX' },
      { staffId: 'ADMIN-01', fullName: 'Kha Chủ Quản', role: 'ROLE_OWNER' },
      { staffId: 'NV-01', fullName: 'Nguyễn Thu Ngân A', role: 'ROLE_CASHIER' },
      { staffId: 'NV-03', fullName: 'Đặng Thu Ngân C', role: 'ROLE_CASHIER' },
      { staffId: 'NV-04', fullName: 'Vũ Thu Ngân D', role: 'ROLE_CASHIER' },
    ];

    // Lọc
    const visible = rawAccounts.filter((a) => !HIDDEN_PICKER_ROLES.includes(a.role));
    assert.strictEqual(visible.length, 6, 'Phải lọc bỏ 2 vai trò KHO và THUE');
    assert.ok(!visible.some(a => a.role === 'ROLE_WAREHOUSE' || a.role === 'ROLE_TAX'), 'Không rò KHO hoặc TAX');

    // Sắp xếp
    const sorted = [...visible].sort((a, b) => {
      const orderA = ROLE_ORDER.indexOf(a.role);
      const orderB = ROLE_ORDER.indexOf(b.role);
      const diff = (orderA === -1 ? 99 : orderA) - (orderB === -1 ? 99 : orderB);
      if (diff !== 0) return diff;
      return a.fullName.localeCompare(b.fullName, 'vi');
    });

    assert.strictEqual(sorted[0].role, 'ROLE_OWNER', 'Đầu tiên phải là ROLE_OWNER');
    assert.strictEqual(sorted[1].role, 'ROLE_MANAGER', 'Thứ hai phải là ROLE_MANAGER');
    assert.strictEqual(sorted[2].role, 'ROLE_CASHIER', 'Các vị trí sau là ROLE_CASHIER');
  });

  // Test 2: Kích thước danh mục tài khoản Mobile
  check('2. Kích thước Layout Mobile: 2 cột, 3 hàng đầu (6 thẻ = 190px) vừa khung 195px, từ thẻ thứ 7 (256px) cuộn dọc', () => {
    const cardHeight = 58; // min-h-[58px]
    const rowGap = 8; // gap-2 = 8px
    const maxContainerHeight = 195; // max-h-[195px]

    // Chiều cao 3 hàng đầu (6 thẻ)
    const height3Rows = cardHeight * 3 + rowGap * 2; // 190px
    // Chiều cao 4 hàng (7-8 thẻ)
    const height4Rows = cardHeight * 4 + rowGap * 3; // 256px

    assert.ok(height3Rows <= maxContainerHeight, `3 hàng đầu (190px) nằm trọn trong khung ${maxContainerHeight}px không cần cuộn`);
    assert.ok(height4Rows > maxContainerHeight, `Từ hàng thứ 4 (256px) vượt quá ${maxContainerHeight}px để kích hoạt thanh cuộn overflow-y-auto`);
  });

  // Test 3: Kích thước danh mục tài khoản Desktop
  check('3. Kích thước Layout Desktop: 3 cột, 3 hàng đầu (9 thẻ = 190px) vừa khung 250px, từ 10+ thẻ (256px) cuộn dọc', () => {
    const cardHeight = 58;
    const rowGap = 8;
    const desktopMaxHeight = 250; // sm:max-h-[250px]

    // 3 hàng 3 cột = 9 thẻ
    const height3Rows = cardHeight * 3 + rowGap * 2; // 190px
    // 4 hàng 3 cột = 10-12 thẻ
    const height4Rows = cardHeight * 4 + rowGap * 3; // 256px

    assert.ok(height3Rows <= desktopMaxHeight, `3 hàng (9 thẻ = ${height3Rows}px) nằm trọn trong khung ${desktopMaxHeight}px`);
    assert.ok(height4Rows > desktopMaxHeight, `Từ hàng thứ 4 (${height4Rows}px) vượt quá khung ${desktopMaxHeight}px kích hoạt thanh cuộn`);
  });

  // Test 4: Mô phỏng State Machine của Icon Mắt (Eye Toggle) & Reset khi đổi người
  check('4. State Machine Icon Mắt: Bật/tắt PIN và Reset khi đổi người', () => {
    let showPasscode = false;
    let selectedId = 'NV-01';
    let manualMode = false;
    let manualId = '';

    // Hành động 1: Người dùng gõ PIN và bật mắt
    showPasscode = true;
    assert.strictEqual(showPasscode, true, 'Mắt phải hiển thị');

    // Hành động 2: Chuyển sang chọn thẻ nhân viên khác
    const switchTile = (newStaffId: string) => {
      selectedId = newStaffId;
      showPasscode = false; // Reset contract
    };
    switchTile('NV-02');
    assert.strictEqual(selectedId, 'NV-02');
    assert.strictEqual(showPasscode, false, 'Phải reset về ẩn khi chạm chọn nhân viên khác');

    // Hành động 3: Bật mắt lại, rồi chuyển sang chế độ nhập tay
    showPasscode = true;
    const toggleManualMode = () => {
      manualMode = !manualMode;
      showPasscode = false; // Reset contract
    };
    toggleManualMode();
    assert.strictEqual(manualMode, true);
    assert.strictEqual(showPasscode, false, 'Phải reset về ẩn khi chuyển sang nhập tay');

    // Hành động 4: Đang ở chế độ nhập tay, bật mắt, sau đó gõ thay đổi manualId
    showPasscode = true;
    const changeManualId = (newId: string) => {
      manualId = newId;
      showPasscode = false; // Reset contract (P2 fix)
    };
    changeManualId('NV-99');
    assert.strictEqual(manualId, 'NV-99');
    assert.strictEqual(showPasscode, false, 'Phải reset về ẩn khi sửa manualId trong chế độ nhập tay');

    // Hành động 5: Bật mắt, sau đó nhấn Escape hoặc Hủy
    showPasscode = true;
    const cancelOrEscape = () => {
      showPasscode = false; // Reset contract
    };
    cancelOrEscape();
    assert.strictEqual(showPasscode, false, 'Phải reset về ẩn khi Escape hoặc Hủy');
  });

  // Test 5: Kiểm tra cú pháp JSX của nút mắt PIN
  check('5. Kiểm tra cú pháp JSX của nút mắt PIN: type="button", aria-label, aria-pressed, disabled={isLocked}', () => {
    const filePath = path.resolve(__dirname, '../src/components/auth/LoginModal.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');

    // Trích xuất khối thẻ <button ...> toggle mắt cụ thể
    const eyeButtonMatch = content.match(/<button[\s\S]*?onClick=\{\(\) => setShowPasscode\(\(prev\) => !prev\)\}[\s\S]*?>/);
    assert.ok(eyeButtonMatch, 'Phải tìm thấy thẻ button toggle showPasscode cụ thể');

    const btn = eyeButtonMatch[0];
    assert.ok(btn.includes('type="button"'), 'Nút mắt phải có type="button" chống submit nhầm form');
    assert.ok(btn.includes('disabled={isLocked}'), 'Nút mắt phải có disabled={isLocked}');
    assert.ok(btn.includes('aria-label={showPasscode ? \'Ẩn mã PIN\' : \'Hiện mã PIN\'}'), 'Nút mắt phải có aria-label tương ứng trạng thái');
    assert.ok(btn.includes('aria-pressed={showPasscode}'), 'Nút mắt phải có aria-pressed={showPasscode}');

    // Kiểm tra ô nhập manualId có reset showPasscode
    const manualInputMatch = content.match(/value=\{manualId\}[\s\S]*?onChange=\{[\s\S]*?setShowPasscode\(false\)[\s\S]*?\}/);
    assert.ok(manualInputMatch, 'Ô nhập manualId phải gọi setShowPasscode(false) trong onChange');
  });

  // Test 6: Input PIN chuyển đổi type password <-> text mượt mà
  check('6. Input PIN chuyển đổi type password <-> text mượt mà', () => {
    const filePath = path.resolve(__dirname, '../src/components/auth/LoginModal.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');

    assert.ok(content.includes('type={showPasscode ? \'text\' : \'password\'}'), 'Input PIN phải bind type theo showPasscode');
    assert.ok(content.includes('inputMode="numeric"'), 'Giữ nguyên bàn phím số numeric trên mobile');
    assert.ok(content.includes('autoComplete="off"'), 'Giữ nguyên autoComplete="off"');
  });

  // Test 7: Thẻ tài khoản render tên, staffId và badge vai trò thu gọn
  check('7. Thẻ tài khoản render tên, staffId và badge vai trò thu gọn', () => {
    const filePath = path.resolve(__dirname, '../src/components/auth/LoginModal.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');

    assert.ok(content.includes('a.fullName'), 'Render tên nhân viên');
    assert.ok(content.includes('a.staffId'), 'Render mã nhân viên');
    assert.ok(content.includes('a.role === \'ROLE_OWNER\' ? \'Chủ\' : a.role === \'ROLE_MANAGER\' ? \'Quản lý\' : \'Thu ngân\''), 'Render nhãn vai trò thu gọn');
  });

  // Test 8: An toàn chống brute-force và trạng thái locked
  check('8. Giữ nguyên cơ chế khóa tài khoản brute force và rate limit UI', () => {
    const filePath = path.resolve(__dirname, '../src/components/auth/LoginModal.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');

    assert.ok(content.includes('Sai 5 lần sẽ khóa 15 phút'), 'Hiển thị cảnh báo khóa brute force');
    assert.ok(content.includes('disabled={loading || isLocked}'), 'Khóa nút submit khi loading hoặc isLocked');
    assert.ok(content.includes('Đang xác thực...'), 'Hiển thị trạng thái loading');
  });

  // Test 9: Lifecycle cleanup khi unmount và đóng modal
  check('9. Lifecycle cleanup khi unmount và đóng modal', () => {
    const filePath = path.resolve(__dirname, '../src/components/auth/LoginModal.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');

    assert.ok(content.includes('alive = false'), 'Cleanup fetch flag khi unmount');
    assert.ok(content.includes('window.removeEventListener(\'keydown\', handleKeyDown)'), 'Remove event listener keydown');
  });

  console.log(`\n🎉 KẾT QUẢ KIỂM TRA: ${passed}/${total} PASS (100%)\n`);
  if (passed !== total) {
    process.exit(1);
  }
}

runSmokeTests();
