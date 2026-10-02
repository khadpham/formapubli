import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  USER_ROLES,
  getDefaultTabForRole,
  getSettingsAccess,
  type UserRole,
} from '../src/lib/roles';

const cashierNav = USER_ROLES.ROLE_CASHIER.allowedNavItems;
assert.deepEqual(cashierNav, ['pos', 'settings']);

assert.equal(getDefaultTabForRole('ROLE_OWNER'), 'dashboard');
assert.equal(getDefaultTabForRole('ROLE_MANAGER'), 'dashboard');
assert.equal(getDefaultTabForRole('ROLE_CASHIER'), 'pos');
assert.equal(getDefaultTabForRole('ROLE_WAREHOUSE'), 'inventory');
assert.equal(getDefaultTabForRole('ROLE_TAX'), 'sales');

// P4 (crash fix): role KHÔNG có trong registry từng làm `USER_ROLES[role].allowed...`
// ném lỗi NGAY TRONG useState initializer của MasterAppShell — trước cả guard
// isKnownRole kịp chạy. Nay phải trả '' (không phải 'dashboard').
//
// LÝ DO BẢO MẬT: 'dashboard' nằm trong allowedNavItems của OWNER và MANAGER.
// Nếu fallback là 'dashboard', một cookie phiên cũ / session tự chế (role bịa,
// tên vai trò đã đổi) sẽ được mở thẳng Bảng Quản Trị — mọi includes('') đều
// false nên caller buộc phải rơi về nhánh "không có quyền".
const asRole = (value: string) => value as unknown as UserRole;
const UNKNOWN_ROLES = [
  'ROLE_SUPERADMIN',
  'ROLE_ADMIN',
  'role_owner',
  'ROLE_OWNER ',
  '__proto__',
  'constructor',
  'toString',
];
for (const bad of UNKNOWN_ROLES) {
  assert.equal(
    getDefaultTabForRole(asRole(bad)),
    '',
    `Vai trò lạ "${bad}" không được mở tab nào (rỗng), tuyệt đối KHÔNG phải 'dashboard'`
  );
  // Củng cố: rỗng không nằm trong allowedNavItems của bất kỳ role nào ⇒ caller
  // rơi về nhánh không có quyền thay vì render 1 tab bất kỳ.
  for (const known of Object.keys(USER_ROLES) as UserRole[]) {
    assert.ok(
      !USER_ROLES[known].allowedNavItems.includes(''),
      `Tab rỗng phải nằm ngoài allowedNavItems của ${known}`
    );
  }
}
// Chuỗi rỗng / rác cũng không được ném lỗi (throw ở đây = app sập trắng).
for (const junk of ['', ' ', '0', 'null', 'undefined', 'ROLE_', '🙂']) {
  assert.doesNotThrow(
    () => getDefaultTabForRole(asRole(junk)),
    `getDefaultTabForRole không được ném lỗi với chuỗi rác "${junk}"`
  );
  assert.equal(getDefaultTabForRole(asRole(junk)), '', `Chuỗi rác "${junk}" → tab rỗng`);
}
// Tab mặc định của 5 role thật vẫn phải là tab ĐẦU TIÊN trong allowedNavItems
// (hồi quy guard): getDefaultTabForRole không được tự ý trả tab ngoài registry.
for (const known of Object.keys(USER_ROLES) as UserRole[]) {
  assert.equal(
    getDefaultTabForRole(known),
    USER_ROLES[known].allowedNavItems[0],
    `getDefaultTabForRole(${known}) = tab đầu tiên trong allowedNavItems`
  );
}

assert.deepEqual(getSettingsAccess('ROLE_OWNER'), {
  canManageAccounts: true,
  canManageBanks: true,
  canManagePrinter: true,
});
assert.deepEqual(getSettingsAccess('ROLE_MANAGER'), {
  canManageAccounts: true,
  canManageBanks: true,
  canManagePrinter: true,
});
assert.deepEqual(getSettingsAccess('ROLE_CASHIER'), {
  canManageAccounts: false,
  canManageBanks: false,
  canManagePrinter: true,
});
assert.deepEqual(getSettingsAccess('ROLE_WAREHOUSE'), {
  canManageAccounts: false,
  canManageBanks: false,
  canManagePrinter: false,
});
assert.deepEqual(getSettingsAccess('ROLE_TAX'), {
  canManageAccounts: false,
  canManageBanks: false,
  canManagePrinter: false,
});

const shellPath = path.resolve(process.cwd(), 'src/components/layout/MasterAppShell.tsx');
const shell = fs.readFileSync(shellPath, 'utf8');
assert.doesNotMatch(shell, /Mobile Bottom Navigation Dock/);
assert.doesNotMatch(shell, /currentTab === 'pos' \? 'hidden md:flex' : 'flex'/);
assert.match(shell, /<header className="[^"]*h-\[max\(3\.5rem,calc\(2\.75rem_\+_env\(safe-area-inset-top\)\)\)\][^"]*"/);
assert.match(shell, /effectiveTab === 'pos'/);
// Bảo mật: không được có fallback 'ROLE_OWNER' khi chưa biết phiên. Nếu có,
// thu ngân sẽ thấy Bảng Quản Trị trước khi app giới hạn lại về POS.
assert.doesNotMatch(shell, /\|\|\s*'ROLE_OWNER'/);
assert.match(shell, /useState<UserRole \| null>\(initialSession\?\.role \?\? null\)/);
assert.match(shell, /currentRole && effectiveTab === 'dashboard'/);
// Rớt lease (heartbeat 401) KHÔNG được xoá vai trò — POS sẽ unmount và mất sạch
// giỏ hàng. Đăng xuất tường minh thì phải xoá.
assert.match(shell, /if \(res\.status === 401\) \{\s*setSession\(null\);/);
// Vai trò lạ (cookie cũ, tên vai trò đã đổi, session tự chế) là chuỗi hợp lệ
// về kiểu nên index thẳng vào USER_ROLES sẽ ném lỗi lúc render. Bắt buộc
// có guard theo key thật, không tin vào kiểu UserRole.
assert.match(shell, /function isKnownRole\(value: UserRole \| null\): value is UserRole \{\s*return !!value && Object\.prototype\.hasOwnProperty\.call\(USER_ROLES, value\);/);
assert.match(shell, /const currentRole: UserRole \| null = isKnownRole\(role\) \? role : null;/);
assert.match(shell, /const roleConfig: RoleConfig = isKnownRole\(currentRole\) \? USER_ROLES\[currentRole\] : NO_ROLE_CONFIG;/);
// Config rỗng phải là hằng số cấp module: tạo inline trong component sẽ đổi
// danh tính mỗi render, kéo theo useEffect phím tắt và useMemo chuông POS
// tháo gắn/đăng ký lại liên tục.
const emptyConfigStart = shell.indexOf('const NO_ROLE_CONFIG: RoleConfig = {');
const emptyConfigEnd = shell.indexOf('};', emptyConfigStart);
assert.ok(emptyConfigStart >= 0 && emptyConfigEnd > emptyConfigStart, 'Phải có hằng số config rỗng ở cấp module');
assert.ok(
  emptyConfigStart < shell.indexOf('export function MasterAppShell'),
  'Config rỗng phải nằm NGOÀI thân component để danh tính object ổn định'
);
const emptyConfig = shell.slice(emptyConfigStart, emptyConfigEnd);
assert.match(emptyConfig, /allowedNavItems: \[\]/);
assert.doesNotMatch(emptyConfig, /function/, 'Hằng số config rỗng không được chứa hàm');
assert.equal((shell.match(/id: '' as UserRole/g) || []).length, 1, 'Config rỗng chỉ được khai báo đúng 1 lần ở cấp module, không tạo inline trong component');
// Drawer Copilot không được nhận vai trò bịa trước khi đăng nhập (nó in ra
// "Vai trò hiện tại của bạn: ..." ở chân drawer).
assert.doesNotMatch(shell, /currentRole \?\? 'ROLE_CASHIER'/, 'Không được rò vai trò giả vào CopilotDrawer');
assert.match(shell, /\{currentRole && \(\s*<CopilotDrawer[\s\S]*?currentRole=\{currentRole\}[\s\S]*?onApplyDraft=\{handleApplyDraft\}\s*\/>\s*\)\}/);
// currentTab phải được đồng bộ ngược từ effectiveTab, chỉ set khi hai bên lệch.
assert.match(shell, /if \(currentTab !== effectiveTab\) setCurrentTab\(effectiveTab\);/);
assert.match(shell, /\}, \[currentTab, effectiveTab\]\);/);
assert.match(shell, /mainBottomPadding = canUseCopilot \? 'pb-44 lg:pb-8' : 'pb-32 lg:pb-8'/);
assert.match(shell, /bottom-\[calc\(max\(1rem,env\(safe-area-inset-bottom\)\)_\+_5\.5rem\)\]/);
assert.match(shell, /isPosCheckoutBusy/);
assert.match(shell, /actorId=\{session\?\.actorId\}/);
assert.match(shell, /onBusyChange=\{setIsPosCheckoutBusy\}/);
assert.match(shell, /isNavigationDisabled=\{isPosCheckoutBusy \|\| copilotView !== 'closed'\}/);
assert.match(shell, /disabled=\{isPosCheckoutBusy \|\| copilotView !== 'closed'\}/);
assert.match(shell, /isShellInteractionBlocked=\{isMobileSidebarOpen\}/);
assert.match(shell, /if \(isPosCheckoutBusy \|\| isMobileSidebarOpen \|\| copilotView !== 'closed'\) return;/);
assert.match(shell, /const handleApplyDraft = [\s\S]*if \(isPosCheckoutBusy\) return;/);
assert.match(shell, /if \(!isPosCheckoutBusy\) return;[\s\S]*setCopilotView\('closed'\)/);
assert.match(shell, /disabled=\{isPosCheckoutBusy \|\| copilotView !== 'closed'\}/);
assert.match(shell, /id="app-main-content"/);
assert.match(shell, /aria-label="Mở menu"/);
// Chuông POS thứ hai đã bỏ: nay chỉ CÓ MỘT chuông thông báo, gộp cả nguồn POS lẫn nghiệp vụ.
assert.doesNotMatch(shell, /aria-label="Mở thông báo POS"/, 'Chuông POS thứ hai đã bỏ — chỉ giữ 1 chuông');
assert.match(shell, /<NotificationBell/, 'Phải còn chuông thông báo gộp');
assert.equal((shell.match(/<NotificationBell/g) || []).length, 1, 'Chỉ được render NotificationBell đúng 1 lần trong shell');

const sidebarPath = path.resolve(process.cwd(), 'src/components/layout/AppSidebar.tsx');
const sidebar = fs.readFileSync(sidebarPath, 'utf8');
assert.match(sidebar, /roleConfig\.allowedNavItems\.flatMap/);
assert.match(sidebar, /isNavigationDisabled/);
assert.match(sidebar, /disabled=\{isNavigationDisabled\}/);
assert.match(sidebar, /useState<boolean \| null>\(null\)/);
assert.match(sidebar, /sidebar\.setAttribute\('inert', ''\)/);
assert.match(sidebar, /sidebar\.removeAttribute\('inert'\)/);
assert.match(sidebar, /aria-hidden=\{isMobileViewport === null/);
assert.match(sidebar, /document\.activeElement/);
assert.match(sidebar, /event\.key !== 'Tab'/);
assert.match(sidebar, /event\.preventDefault\(\);\s*event\.stopPropagation\(\)/);
assert.match(sidebar, /getElementById\('app-main-content'\)/);
assert.match(sidebar, /setAttribute\('inert', ''\)/);
assert.match(sidebar, /item\.id === 'partners'/);
assert.match(sidebar, /item\.id === 'pos'/);
assert.match(sidebar, /item\.id === 'settings'/);
assert.match(sidebar, /pt-\[env\(safe-area-inset-top\)\]/);
assert.match(sidebar, /pb-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\]/);
assert.match(sidebar, /role=\{isMobileViewport \? 'dialog' : undefined\}/);
assert.match(sidebar, /aria-modal=\{isMobileViewport && isMobileOpen \? true : undefined\}/);
assert.match(sidebar, /aria-label="Menu điều hướng"/);

const settingsPath = path.resolve(process.cwd(), 'src/components/settings/SettingsRbacView.tsx');
const settings = fs.readFileSync(settingsPath, 'utf8');
assert.doesNotMatch(settings, /overflow-x-auto/);
assert.doesNotMatch(settings, /Phím Tắt/);
assert.doesNotMatch(settings, /lowStockAlertThreshold|Ngưỡng cảnh báo/);
assert.match(settings, /parsed\.themeMode && \['light', 'dark', 'system'\]\.includes\(parsed\.themeMode\)/);
assert.match(settings, /parsed\.tableDensity && \['comfortable', 'compact'\]\.includes\(parsed\.tableDensity\)/);
assert.match(settings, /typeof parsed\.enableSound === 'boolean'/);
assert.match(settings, /parsed\.language && \['vi', 'en'\]\.includes\(parsed\.language\)/);
assert.match(settings, /parsed\.printerPaper && \['K80', 'K57'\]\.includes\(parsed\.printerPaper\)/);
assert.match(settings, /typeof parsed\.autoPrintOnCheckout === 'boolean'/);
assert.match(settings, /parsed\.receiptFooterText\.length <= 200/);
assert.match(settings, /maxLength=\{200\}/);
assert.match(settings, /aria-label="Tự động bật hộp thoại in bill"/);
assert.match(settings, /<label className="flex h-11 w-11/);
assert.match(settings, /min-h-11/);
assert.match(settings, /aria-live="polite"/);
assert.match(settings, /aria-label="Lời cảm ơn in chân trang"/);
assert.match(settings, /aria-pressed=\{enableSound\}/);
assert.match(settings, /onClick=\{playSuccessTone\}[\s\S]*min-h-11/);
assert.ok((settings.match(/aria-pressed=/g) || []).length >= 8, 'Các lựa chọn Settings phải trạng thái selected cho trình đọc màn hình');

const posPath = path.resolve(process.cwd(), 'src/components/pos/PosCheckoutTerminal.tsx');
const pos = fs.readFileSync(posPath, 'utf8');
assert.match(pos, /isShellInteractionBlocked/);
assert.match(pos, /if \(isShellInteractionBlocked\) return;/);
assert.match(pos, /formapubli_settings/);
assert.match(pos, /autoPrintOnCheckout/);
assert.match(pos, /printThermalReceipt\([^)]*receiptFooterText/);
assert.match(pos, /sticky top-\[max\(3\.5rem,calc\(2\.75rem_\+_env\(safe-area-inset-top\)\)\)\]/);
assert.match(pos, /fixed bottom-\[max\(1rem,env\(safe-area-inset-bottom\)\)\]/);
assert.match(pos, /autoPrintedOrderCodes\.current\.add/);
assert.match(pos, /isCartFrozen[\s\S]*checkoutLockRef\.current/);
assert.match(pos, /checkoutLockRef\.current = true;[\s\S]{0,200}setIsSubmitting\(true\)/);
assert.match(pos, /printThermalReceipt\([\s\S]*autoPrintedOrderCodes\.current\.add/);
assert.match(pos, /const handleCancelApproval = async \(\) => \{\s*if \(checkoutLockRef\.current \|\| isSubmitting \|\| isCancellingApproval\) return;/);
assert.match(pos, /disabled=\{isCancellingApproval \|\| isSubmitting \|\| checkoutLockRef\.current\}/);
assert.match(pos, /pb-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\]/);
assert.match(pos, /onKeyDown=\{\(e\) => \{[\s\S]{0,160}e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*applyCustomDiscount\(\);/);
assert.match(pos, /const isInteractionLocked = isCartFrozen \|\| isParserImporting/);
assert.match(pos, /onBusyChange\?\.\(isSubmitting \|\| isInteractionLocked \|\| isPosOverlayOpen\)/);
assert.match(pos, /const isPosOverlayOpen/);
assert.match(pos, /return \(\) => onBusyChange\?\.\(false\)/);
const fallbackStart = pos.indexOf('const fallbackToOffline');
const fallbackEnd = pos.indexOf('\n    // A. Nếu trình duyệt', fallbackStart);
assert.ok(fallbackStart >= 0 && fallbackEnd > fallbackStart, 'Phải xác định được luồng fallback offline');
const fallback = pos.slice(fallbackStart, fallbackEnd);
const resetStart = pos.indexOf('const resetPostCheckoutState');
const resetEnd = pos.indexOf('\n    };', resetStart);
assert.ok(resetStart >= 0 && resetEnd > resetStart, 'Phải xác định được reset sau checkout');
const reset = pos.slice(resetStart, resetEnd);
assert.match(reset, /setIsApprovalPending\(false\)/);
assert.match(reset, /setIsDiscountApprovalModalOpen\(false\)/);
assert.match(reset, /setPendingDiscountRate\(null\)/);
assert.match(reset, /setPendingApprovalRequestId\(null\)/);
assert.match(reset, /setApprovedDiscountRequestId\(null\)/);
// HỢP ĐỒNG MỚI 2026-09-29: đường rẽ PIN quản lý ở đơn chiết khấu đã bị gỡ khỏi
// server. State `approvedPin` chỉ tồn tại để gửi PIN vốn luôn undefined, nên xoá
// cho khỏi giữ một state chết. Giữ assertion này ở dạng phủ định để không ai
// cấy lại plumbing không dùng.
assert.doesNotMatch(reset, /setApprovedPin\(null\)/, 'POS không được còn state PIN chết');
assert.doesNotMatch(pos, /approvedPin/, 'POS không được còn tham chiếu approvedPin');
assert.match(reset, /setIsManagerOverride\(false\)/);
assert.match(reset, /setActiveOrderCode\(createOrderCode\(\)\)/);
// POS chỉ bán lẻ nên tên mặc định là "Khách lẻ" (trước đây là "Khách lẻ vãng lai").
assert.match(reset, /setCustomerName\('Khách lẻ'\)/);
assert.doesNotMatch(
  reset,
  /vãng lai/,
  'reset giỏ không được gán lại tên "vãng lai" — POS chỉ bán lẻ, mặc định là "Khách lẻ"'
);
assert.match(reset, /setFiscalScope\('INTERNAL_MANAGEMENT'\)/);
assert.match(reset, /setPaymentMethod\('BANK_TRANSFER'\)/);
assert.match(reset, /setGiftReason\(''\)/);
assert.match(reset, /setCustomDiscountInput\(''\)/);
assert.match(fallback, /resetPostCheckoutState\(\)/);
assert.match(pos, /disabled=\{isSubmitting \|\| isInteractionLocked \|\| pendingAddToCartCountRef\.current > 0\}/);
assert.match(pos, /if \(isSubmitting \|\| isInteractionLocked \|\| pendingAddToCartCountRef\.current > 0\) return;/);
assert.match(pos, /handleRequestDiscount[\s\S]*addToCartAbortRef\.current\?\.abort\(\)/);
assert.match(pos, /addToCartAbortRef\.current\?\.abort\(\)[\s\S]{0,200}setSelectedWarehouseId\(e\.target\.value\)/);
assert.match(pos, /new AbortController\(\)/);
assert.match(pos, /signal: controller\.signal/);
assert.match(pos, /addToCartAbortRef\.current\?\.abort\(\)/);
assert.match(pos, /checkoutLockRef\.current/);
assert.match(pos, /syncLockRef\.current/);
assert.match(pos, /syncPendingOrdersRef\.current\(\)/);
assert.match(pos, /aria-pressed=\{paperPreset === 'K80'\}/);
assert.match(pos, /aria-pressed=\{paperPreset === 'K57'\}/);
assert.match(pos, /handleParserOrderRef\.current\(\{/);
assert.match(pos, /const selectedWarehouseIdRef = useRef\(selectedWarehouseId\)/);
assert.match(pos, /const cartFrozenRef = useRef\(isCartFrozen\)/);
assert.match(pos, /parserImportLockRef/);
assert.match(pos, /parserImportSucceededRef/);
assert.match(pos, /const handleCloseParser = React\.useCallback\(\(\) => \{[\s\S]*parserImportAbortRef\.current\?\.abort\(\)/);
assert.match(pos, /ref=\{parserModalRef\}/);
assert.match(pos, /ref=\{receiptModalRef\}/);
assert.match(pos, /ref=\{mobileCheckoutModalRef\}/);
assert.match(pos, /isMobileCheckoutSheetOpen && mounted && createPortal\(/);
assert.doesNotMatch(pos, /const warehouseId = selectedWarehouseId;\s*addToCartAbortRef\.current\?\.abort\(\);/);
assert.match(pos, /pendingAddToCartCountRef\.current > 0/);
assert.match(pos, /pendingAddToCartCountRef\.current \+= 1/);
assert.match(pos, /pendingAddToCartCountRef\.current === 0 && setCart\(\[\]\)/);
assert.match(pos, /isAddingToCart/);
assert.match(pos, /disabled=\{isSubmitting \|\| isInteractionLocked \|\| pendingAddToCartCountRef\.current > 0\}/);
assert.match(pos, /const nextCart = snapshot\.cart\.map/);
assert.match(pos, /parserImportSucceededRef\.current = true/);
assert.doesNotMatch(pos, /handleAddToCart\(book, it\.quantity, controller\)/);
assert.match(pos, /pendingDiscountRate !== null \? approvalDiscountAmount : discountAmount/);
// Đã bỏ toggle "Đã nhận tiền" cho chuyển khoản/QR: thay bằng phiên chuyển khoản
// phải đóng lại và dọn trạng thái sau khi chốt, không còn state cầm tay.
assert.match(pos, /setTransferSession\(null\)/);
assert.match(pos, /postCheckoutResetRef\.current\?\.\(\)/);
assert.match(pos, /const approvalPricedCart = useMemo/);
assert.match(pos, /aria-labelledby="pos-receipt-dialog-title"/);
assert.match(pos, /idem-\$\{activeOrderCode\}/);
assert.match(pos, /không ghi đơn offline để tránh mất quyền duyệt/);
assert.match(pos, /aria-labelledby="mobile-checkout-title"/);
assert.match(pos, /id="mobile-pos-error-message"/);
assert.match(pos, /aria-label="Nạp đơn từ chat khách"/);
assert.match(pos, /const handleCloseParser = React\.useCallback/);
assert.match(pos, /selectedWarehouseIdRef\.current !== warehouseId/);
assert.match(pos, /onApproved=\{\(data\) => \{[\s\S]*pendingApprovalRequestId !== data\.requestId/);
assert.match(pos, /const clearApprovalState = \(closeModal = true\) =>/);
assert.match(pos, /clearApprovalState\(\)/);
assert.match(pos, /onTerminal=\{\(_status, requestId\) =>/);
assert.match(pos, /const orderCode = activeOrderCode;/);
assert.match(pos, /function createOrderCode\(\): string/);
assert.match(pos, /setActiveOrderCode\(createOrderCode\(\)\)/);
assert.match(pos, /action: 'CANCEL'/);
assert.match(pos, /cashboxSessionId: activeSession\?\.id/);
assert.match(pos, /const openScanner = \(\) =>/);
assert.match(pos, /setIsMobileCheckoutSheetOpen\(false\);\s*setIsScannerOpen\(true\)/);
assert.match(pos, /onClick=\{openScanner\}/);
assert.match(pos, /getPendingOfflineOrders\(cashierActorId\)/);
assert.match(pos, /cashierId: cashierActorId/);
assert.match(pos, /if \(!actorId\?\.trim\(\)\)/);
assert.match(pos, /const cashierActorId = actorId \|\| `UNSCOPED-\$\{currentRole\}`/);
assert.match(pos, /discountApprovalId: approvedDiscountRequestId \|\| undefined/);
assert.match(pos, /disabled=\{isSubmitting \|\| checkoutLockRef\.current\}/);
assert.match(pos, /\[isShellInteractionBlocked, handleCheckout, handleCloseParser, isSubmitting, isSubmittingSession, isApprovalPendingState, isParserImporting,[\s\S]*cart,/);

const receiptPath = path.resolve(process.cwd(), 'src/lib/thermalReceipt.ts');
const receipt = fs.readFileSync(receiptPath, 'utf8');
const pricingPath = path.resolve(process.cwd(), 'src/lib/pricing.ts');
const pricing = fs.readFileSync(pricingPath, 'utf8');
assert.match(pricing, /export function priceLine/);
assert.match(pricing, /Math\.round\(safeCoverPrice \* \(1 - safeDiscountRate\)\)/);
assert.match(receipt, /receiptFooterText/);
assert.match(receipt, /escapeHtml\(safeReceiptFooterText\)/);
assert.match(receipt, /<title>Hoa_Don_\$\{escapeHtml\(order\.orderCode\)\}<\/title>/);
assert.match(receipt, /const safeNumber/);
assert.match(receipt, /Number\.isFinite\(parsed\) \? Math\.max\(0, parsed\) : 0/);
assert.match(receipt, /const total = safeNumber\(price \* quantity\)/);
assert.match(receipt, /const discountRate = Math\.min\(1, Math\.max\(0, safeNumber\(order\.discountRate\)\)\)/);
assert.match(receipt, /Array\.isArray\(order\.items\)/);
assert.match(receipt, /safeNumber\(order\.finalAmount\)/);
assert.match(receipt, /order\.qrDataUrl\.length <= 2_000_000/);
assert.match(receipt, /receiptFooterText\.slice\(0, 200\)/);
assert.match(receipt, /function escapeHtml\(text: unknown\)/);
assert.match(receipt, /String\(text \?\? ''\)/);
assert.match(receipt, /safeQrDataUrl/);
assert.match(receipt, /data:image\\\/\(\?:png\|jpeg\|webp\);base64/);

const modalPath = path.resolve(process.cwd(), 'src/components/pos/DiscountApprovalModal.tsx');
const modal = fs.readFileSync(modalPath, 'utf8');
assert.match(modal, /useModalFocusTrap/);
assert.match(modal, /ref=\{modalRef\}/);
assert.match(modal, /role="dialog"/);
assert.match(modal, /aria-modal="true"/);
assert.match(modal, /currentRole: UserRole/);
assert.match(modal, /currentRole === 'ROLE_CASHIER'/);
assert.match(modal, /req\.status === 'SUPERSEDED' \|\| req\.status === 'CONSUMED'/);
assert.match(modal, /onTerminalRef\.current\?\.\('REJECTED', req\.id\)/);
assert.match(modal, /onTerminalRef/);
assert.match(modal, /onTerminalRef\.current\?\.\('EXPIRED', req\.id\)/);
assert.match(modal, /itemsKey/);
assert.match(modal, /const generation = requestGenerationRef\.current/);
// Chặn đua response: mọi cập nhật state phải so `generation` để response cũ từ
// yêu cầu trước không ghi đè. Trước đây dòng này kiểm trong `handleVerifyManagerOtp`
// — hàm đã gỡ cùng nhánh QR/OTP chết — nên nó kiểm một thứ không tồn tại.
// Nay kiểm ở đường ĐI SỐNG: hỏi server lúc tạo yêu cầu và lúc poll.
assert.match(
  modal,
  /if \(isMounted && generation === requestGenerationRef\.current\)/,
  'đường đi sống phải chặn đua response bằng requestGenerationRef'
);
assert.match(
  modal,
  /if \(generation === requestGenerationRef\.current\)/,
  'đường poll phải chặn đua response bằng requestGenerationRef'
);
// Nhánh QR/OTP không bao giờ tới được (endpoint chỉ nhận ROLE_CASHIER) nên không
// được để lại mảnh vỡ của nó trong modal.
assert.doesNotMatch(
  modal,
  /handleVerifyManagerOtp|qrContainerRef|BrowserQRCodeSvgWriter/,
  'modal không được còn code của nhánh QR/OTP đã gỡ'
);
// Mã khẩn cấp đã gỡ: modal không được còn gửi phương thức mà server từ chối.
assert.doesNotMatch(modal, /OFFLINE_EMERGENCY/, 'Modal không được còn gửi OFFLINE_EMERGENCY');
assert.doesNotMatch(modal, /EMG-/, 'Modal không được còn lời hứa mã khẩn cấp EMG-');
assert.doesNotMatch(modal, /1 trong 5 mã khẩn cấp/, 'Xoá lời hứa "1 trong 5 mã khẩn cấp" — không có mã nào được sinh');
// P5 sửa 2026-09-29: đồng hồ đếm lùi về 0 KHÔNG được tự khai EXPIRED. Nếu
// Quản lý duyệt đúng trong ~2.5s cuối (chu kỳ poll) thì client bỏ rơi một
// duyệt hợp lệ. Bắt buộc hỏi server một lần trước khi khai hết hạn.
assert.match(modal, /const settled = await syncRef\.current\(\)/, 'Đếm lùi về 0 phải hỏi server trước khi khai EXPIRED');
assert.match(modal, /if \(settled\) return;/, 'Server đã trả lời thì không được khai EXPIRED đè lên');
assert.match(modal, /const syncFromServer = useCallback/, 'Logic hỏi trạng thái phải là MỘT hàm dùng chung cho cả poll lẫn đếm lùi');
assert.match(modal, /generation !== requestGenerationRef\.current/);
assert.match(modal, /requestAbortRef/);
assert.match(modal, /requestController\.abort\(\)/);
assert.match(modal, /requestTimeout = window\.setTimeout\(\(\) => requestController\.abort\(\), 15000\)/);
assert.match(modal, /onApprovedRef/);
assert.match(modal, /providedDiscountAmount/);
assert.match(modal, /providedFinalAmount/);
assert.match(modal, /onCancel\?:/);
assert.match(modal, /cancelError/);
assert.match(pos, /approvalCancelError/);
assert.match(pos, /onCancel=\{handleCancelApproval\}/);

const hookPath = path.resolve(process.cwd(), 'src/hooks/useModalFocusTrap.ts');
const hook = fs.readFileSync(hookPath, 'utf8');
assert.match(hook, /container\.setAttribute\('tabindex', '-1'\)/);
assert.match(hook, /event\.preventDefault\(\);\s*container\.focus\(\)/);

const scannerPath = path.resolve(process.cwd(), 'src/components/scanner/InAppBarcodeScanner.tsx');
const scanner = fs.readFileSync(scannerPath, 'utf8');
assert.match(scanner, /useModalFocusTrap/);
assert.match(scanner, /ref=\{modalRef\}/);
assert.match(scanner, /role="dialog"/);
assert.match(scanner, /aria-modal="true"/);

const offlineDbPath = path.resolve(process.cwd(), 'src/lib/offline-db.ts');
const offlineDb = fs.readFileSync(offlineDbPath, 'utf8');
assert.match(offlineDb, /cashboxSessionId\?: string/);
assert.match(offlineDb, /discountApprovalId\?: string/);
assert.match(offlineDb, /moneyReceived\?: boolean/);
// moneyReceived giờ là hằng số false khi tạo đơn (tiền mặt/quà tặng không có toggle),
// và đồng bộ offline phải chuyển tiếp giá trị của đơn.
assert.match(pos, /moneyReceived: false/);
assert.match(pos, /moneyReceived: order\.moneyReceived/);
assert.match(offlineDb, /getPendingOfflineOrders\(cashierId\?: string\)/);
assert.match(offlineDb, /claimLegacyOfflineOrders/);
assert.match(pos, /legacyOfflineCount > 0 && actorId/);
assert.match(offlineDb, /\^UNSCOPED-/);
assert.match(pos, /handleClaimLegacyOrders/);
assert.match(pos, /getPendingOrdersCount\(cashierActorId\)/);
assert.match(pos, /warehouseId=\$\{encodeURIComponent\(selectedWarehouseId\)\}/);
assert.match(pos, /operationRequestId !== cashboxRequestRef\.current/);
assert.match(pos, /setActiveSession\(null\);\s*addToCartAbortRef\.current\?\.abort/);
assert.match(pos, /setIsSubmittingSession\(false\);\s*setActiveSession\(null\)/);
assert.match(pos, /cashboxRequestRef/);
// 30/09: lệnh ĐỌC ca phải tự có token riêng. Trước đây nó dùng chung
// `cashboxRequestRef` với lệnh ghi, nên một lần tải ca nền vô hiệu hoá lệnh ghi
// đang chờ ⇒ nút "Khóa Két & Kết Ca" kẹt "Đang chốt..." vĩnh viễn.
assert.match(pos, /requestId !== cashboxReadRef\.current/);
assert.match(pos, /data\.warehouseId === selectedWarehouseId/);
assert.match(pos, /setActiveSession\(null\);\s*fetchActiveCashboxSession\(\)/);
assert.match(pos, /cashboxSessionId: order\.cashboxSessionId/);
assert.match(offlineDb, /Phiên két ca/);
assert.match(offlineDb, /getOfflineOrderRepairAction/);
assert.match(offlineDb, /updateOfflineOrderForRetry/);
assert.match(pos, /handleRepairOfflineOrder/);
assert.match(pos, /Gán vào ca mới/);
assert.match(pos, /Xác nhận đã nhận tiền/);

const rbacPath = path.resolve(process.cwd(), 'src/lib/rbac-guard.ts');
const rbac = fs.readFileSync(rbacPath, 'utf8');
assert.match(rbac, /params\.id/);
assert.match(rbac, /onConflictDoNothing/);
assert.match(rbac, /params\.required/);
const ordersRoutePath = path.resolve(process.cwd(), 'src/app/api/orders/route.ts');
const ordersRoute = fs.readFileSync(ordersRoutePath, 'utf8');
assert.match(ordersRoute, /moneyReceived !== true/);
assert.match(ordersRoute, /requiredAudit/);
assert.match(ordersRoute, /discountApprovalId,/);
// Verify phê duyệt chiết khấu đã được TÁCH sang service (origin/main) thay vì
// so sánh status inline. Assertion cũ bám vào code inline nên hỏng khi merge,
// nhưng thuộc tính bảo mật thì phải còn: guard chỉ nhận APPROVED, và lần ghi
// lại (replay) thì bỏ qua verify vì approval đã CONSUMED.
assert.match(ordersRoute, /DiscountApprovalService\.assertValidForCheckout/);
assert.match(ordersRoute, /!isReplay && exceedsHardCap/);
assert.match(ordersRoute, /verifiedApprovalId = discountApprovalId/);
assert.match(ordersRoute, /approvalApproverId/);
assert.match(ordersRoute, /approvalApproverRole/);
assert.match(ordersRoute, /SYSTEM_MANAGER_PIN/);
assert.match(ordersRoute, /approvalAuditActorId/);
assert.match(ordersRoute, /approvalAuditRole/);
assert.match(ordersRoute, /actorId: approvalAuditActorId/);
assert.match(ordersRoute, /aud-order-\$\{result\.orderId\}-mutate/);
assert.match(ordersRoute, /id: 'discount-approval'/);
assert.match(ordersRoute, /id: 'gift-approval'/);
assert.match(ordersRoute, /approvalSource = appr\?\.approvedBy/);
assert.match(ordersRoute, /phê duyệt bởi: \$\{approvalSource\}/);
assert.doesNotMatch(ordersRoute, /actorId: cashierId/);
assert.doesNotMatch(ordersRoute, /cashier: \$\{cashierId/);
assert.doesNotMatch(ordersRoute, /Không thể tiêu thụ discount approval/);

const approvalRoutePath = path.resolve(process.cwd(), 'src/app/api/pos/discount-approvals/[id]/route.ts');
const approvalRoute = fs.readFileSync(approvalRoutePath, 'utf8');
// HỢP ĐỒNG MỚI 2026-09-29: thu ngân chỉ được CANCEL yêu cầu của chính mình.
// Cửa sổ "mã OTP / mã khẩn cấp" bị gỡ khỏi route: nó là no-op (service chặn
// mọi role ≠ OWNER/MANAGER) và chỉ là lời hứa không có thật — không có bảng mã.
assert.match(approvalRoute, /session\.role === 'ROLE_CASHIER'/);
assert.match(approvalRoute, /session\.role === 'ROLE_CASHIER' && action !== 'CANCEL'/);
assert.match(approvalRoute, /session\.role === 'ROLE_CASHIER' && `\$\{data\.cashierId\}` !== `\$\{session\.actorId\}`/, 'Thu ngân không được xem yêu cầu của người khác');
assert.match(approvalRoute, /action === 'CANCEL'/);
assert.doesNotMatch(approvalRoute, /isOtpFlow/, 'Route không được mở lại cửa sổ mã OTP/khẩn cấp cho thu ngân');
assert.doesNotMatch(approvalRoute, /OFFLINE_EMERGENCY/, 'Route không được nhắc tới OFFLINE_EMERGENCY nữa');
assert.doesNotMatch(approvalRoute, /emergencyCode/, 'Route không được nhận emergencyCode nữa');

const approvalServicePath = path.resolve(process.cwd(), 'src/services/discount-approval.service.ts');
const approvalService = fs.readFileSync(approvalServicePath, 'utf8');
// Guard thật sự nằm ở service: chỉ APPROVED mới qua, CONSUMED thì từ chối.
assert.match(approvalService, /appr\.status !== 'APPROVED'/, 'Chỉ phê duyệt APPROVED mới được dùng để tạo đơn');
assert.match(approvalService, /assertTransitionApplied/);
assert.match(approvalService, /const canonicalItems = items\.map/);
assert.match(approvalService, /editions\.coverPrice/);
assert.match(approvalService, /supersedeResult/);
assert.match(approvalService, /Yêu cầu duyệt đã được sử dụng cho đơn hàng/);
assert.match(approvalService, /db\.transaction\(\(tx\) => this\.createRequest/);
assert.match(approvalService, /originalAmount\?: number/);
assert.match(approvalService, /eq\(discountApprovalRequests\.version, request\.version\)[\s\S]*gt\(discountApprovalRequests\.expiresAt, nowIso\)/);
// OFFLINE_EMERGENCY đã gỡ khỏi service: allowlist chỉ còn 3 phương thức và
// không còn nhánh verify "EMG-". Đây là chốt chặn cuối — service là nơi quyết
// định, route chỉ là lớp vỏ.
assert.doesNotMatch(approvalService, /OFFLINE_EMERGENCY/, 'Service không được còn phương thức OFFLINE_EMERGENCY');
assert.doesNotMatch(approvalService, /startsWith\('EMG-'\)/, 'Không được còn kiểm mã khẩn cấp bằng tiền tố chuỗi');
assert.match(approvalService, /'ONE_TOUCH', 'QR_JWT', 'SHORTCODE_BOUND'/, 'Allowlist phương thức duyệt còn đúng 3 mục');

const orderServicePath = path.resolve(process.cwd(), 'src/services/order.service.ts');
const orderService = fs.readFileSync(orderServicePath, 'utf8');
assert.match(orderService, /discountApprovalId\?: string/);
assert.match(orderService, /hasUnexpectedLineDiscount/);
assert.match(orderService, /DiscountApprovalService\.consumeApproval/);
assert.match(orderService, /originalAmount: calculatedSubtotal/);
assert.match(orderService, /orderCode\?: string/);
assert.match(orderService, /Approval không khớp với order đã commit/);
assert.match(orderService, /ord\.orderCode !== want\.orderCode/);
assert.match(orderService, /ord-\$\{generateUUIDv7\(\)\}/);
assert.match(orderService, /Approval chiết khấu chỉ áp dụng cho đơn sách lẻ/);

console.log('Mobile role navigation and settings contract passed.');
