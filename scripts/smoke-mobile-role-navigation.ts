import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  USER_ROLES,
  getDefaultTabForRole,
  getSettingsAccess,
} from '../src/lib/roles';

const cashierNav = USER_ROLES.ROLE_CASHIER.allowedNavItems;
assert.deepEqual(cashierNav, ['pos', 'settings']);

assert.equal(getDefaultTabForRole('ROLE_OWNER'), 'dashboard');
assert.equal(getDefaultTabForRole('ROLE_MANAGER'), 'dashboard');
assert.equal(getDefaultTabForRole('ROLE_CASHIER'), 'pos');
assert.equal(getDefaultTabForRole('ROLE_WAREHOUSE'), 'inventory');
assert.equal(getDefaultTabForRole('ROLE_TAX'), 'sales');

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
assert.match(shell, /currentTab === 'pos'/);
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
assert.match(shell, /aria-label="Mở thông báo POS"/);

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
assert.match(reset, /setApprovedPin\(null\)/);
assert.match(reset, /setIsManagerOverride\(false\)/);
assert.match(reset, /setActiveOrderCode\(createOrderCode\(\)\)/);
assert.match(reset, /setCustomerName\('Khách lẻ vãng lai'\)/);
assert.match(reset, /setFiscalScope\('INTERNAL_MANAGEMENT'\)/);
assert.match(reset, /setPaymentMethod\('CASH'\)/);
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
assert.match(pos, /setIsMoneyReceived\(false\);[\s\S]*\[cart, discountRate, selectedWarehouseId, isGift, paymentMethod\]/);
assert.match(pos, /\[cart, discountRate, selectedWarehouseId, isGift, paymentMethod\]/);
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
assert.match(modal, /if \(generation === requestGenerationRef\.current\) setOtpError/);
assert.match(modal, /if \(generation === requestGenerationRef\.current\) setEmergencyError/);
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
assert.match(pos, /moneyReceived: isMoneyReceived/);
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
assert.match(pos, /requestId !== cashboxRequestRef\.current/);
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
assert.match(ordersRoute, /appr\.status === 'APPROVED' \|\| appr\.status === 'CONSUMED'/);
assert.match(ordersRoute, /approvalApproverId/);
assert.match(ordersRoute, /approvalApproverRole/);
assert.match(ordersRoute, /SYSTEM_MANAGER_PIN/);
assert.match(ordersRoute, /approvalAuditActorId/);
assert.match(ordersRoute, /approvalAuditRole/);
assert.match(ordersRoute, /actorId: approvalAuditActorId/);
assert.match(ordersRoute, /aud-order-\$\{result\.orderId\}-mutate/);
assert.match(ordersRoute, /id: 'discount-approval'/);
assert.match(ordersRoute, /id: 'gift-approval'/);
assert.match(ordersRoute, /approvalSource = appr\.approvedBy/);
assert.match(ordersRoute, /phê duyệt bởi: \$\{approvalSource\}/);
assert.doesNotMatch(ordersRoute, /actorId: cashierId/);
assert.doesNotMatch(ordersRoute, /cashier: \$\{cashierId/);
assert.doesNotMatch(ordersRoute, /Không thể tiêu thụ discount approval/);

const approvalRoutePath = path.resolve(process.cwd(), 'src/app/api/pos/discount-approvals/[id]/route.ts');
const approvalRoute = fs.readFileSync(approvalRoutePath, 'utf8');
assert.match(approvalRoute, /session\.role === 'ROLE_CASHIER' && action === 'APPROVE'/);
assert.match(approvalRoute, /session\.role === 'ROLE_CASHIER' && data\.cashierId !== session\.actorId/);
assert.match(approvalRoute, /action === 'CANCEL'/);
assert.match(approvalRoute, /session\.role === 'ROLE_CASHIER' && action !== 'CANCEL'/);

const approvalServicePath = path.resolve(process.cwd(), 'src/services/discount-approval.service.ts');
const approvalService = fs.readFileSync(approvalServicePath, 'utf8');
assert.match(approvalService, /assertTransitionApplied/);
assert.match(approvalService, /const trustedItems = items\.map/);
assert.match(approvalService, /editions\.coverPrice/);
assert.match(approvalService, /supersedeResult/);
assert.match(approvalService, /Yêu cầu duyệt đã được sử dụng cho đơn hàng/);
assert.match(approvalService, /db\.transaction\(\(tx\) => this\.createRequest/);
assert.match(approvalService, /originalAmount\?: number/);
assert.match(approvalService, /eq\(discountApprovalRequests\.version, request\.version\)[\s\S]*gt\(discountApprovalRequests\.expiresAt, nowIso\)/);

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
