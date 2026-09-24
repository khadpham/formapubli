import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { PosCheckoutTerminal } from '../src/components/pos/PosCheckoutTerminal';
import { UserRole } from '../src/lib/roles';

// Mock fetch — GHI LẠI mọi lời gọi để test contract (CANCEL API, chặn chốt đơn sớm)
type FetchCall = { url: string; method: string; body?: string };
const fetchCalls: FetchCall[] = [];
(window as any).__fetchCalls = fetchCalls;
let cancelApprovalFails = false;
(window as any).__setCancelApprovalFails = (v: boolean) => {
  cancelApprovalFails = v;
};
let drawerItems: any[] = [];
(window as any).__setDrawerItems = (v: any[]) => {
  drawerItems = v;
};
const CREATED_REQUEST = {
  id: 'req-test-1',
  shortCode: '4821',
  qrToken: 'tok-1',
  requestedDiscountRate: 1,
  expiresAt: '2099-01-01T00:00:00.000Z',
};

window.fetch = (async (url: string, init?: any) => {
  const method = `${init?.method || 'GET'}`.toUpperCase();
  fetchCalls.push({
    url: `${url}`,
    method,
    body: typeof init?.body === 'string' ? init.body : undefined,
  });
  const okData = (data: any) => ({ ok: true, json: async () => ({ success: true, data }) });

  if (url.includes('/api/warehouses')) {
    return okData([
      { id: 'wh-au-co', code: 'KHO_AU_CO', name: 'Kho Âu Cơ', warehouseType: 'RETAIL_OFFICE' }
    ]);
  }
  if (url.includes('/api/atp')) {
    return {
      ok: true,
      json: async () => ({ ok: true, atp: {} })
    };
  }
  if (/\/api\/pos\/discount-approvals\/[^/?]+$/.test(url)) {
    // POST .../[id]: APPROVE (modal OTP) hoặc CANCEL (nút "Hủy duyệt để sửa giỏ").
    if (method === 'POST' && cancelApprovalFails) {
      return {
        ok: false,
        json: async () => ({ success: false, message: 'Yêu cầu vừa được duyệt/tiêu thụ, vui lòng tải lại.' })
      };
    }
    return method === 'POST'
      ? okData({ id: 'req-test-1', status: 'APPROVED' })
      : okData({ id: 'req-test-1', status: 'PENDING' });
  }
  if (url.includes('/api/pos/discount-approvals')) {
    return method === 'POST' ? okData(CREATED_REQUEST) : okData(drawerItems);
  }
  if (url.includes('/api/orders')) {
    // Trả payload đơn hàng đúng shape như API thật (màn hình biên nhận cần finalAmount...).
    return okData({
      orderId: 'ord-test-1',
      orderCode: 'ORD-TEST-0001',
      warehouseId: 'wh-au-co',
      customerName: 'Khách Test',
      subtotal: 168000,
      discountAmount: 0,
      finalAmount: 168000,
      fiscalScope: 'INTERNAL_MANAGEMENT',
      itemsCount: 1,
      totalQuantity: 1,
      status: 'COMPLETED',
      idempotencyKey: 'idem-test-1',
    });
  }
  return okData({});
}) as any;

const sampleBooks = [
  { id: '1', code: 'BOOK-01', title: 'Muôn Kiếp Nhân Sinh - Tập 1 (Tái Bản Đặc Biệt)', isbn: '9781111', isbnLast4: '1111', author: 'Nguyên Phong', coverPrice: 168000, stockAvailable: 12, stockAuCo: 12, stockDuPhong: 10, stockQuynhMai: 5, totalStock: 27 },
  { id: '2', code: 'BOOK-02', title: 'Cây Cam Ngọt Của Tôi', isbn: '9782222', isbnLast4: '2222', author: 'José Mauro de Vasconcelos', coverPrice: 108000, stockAvailable: 5, stockAuCo: 5, stockDuPhong: 10, stockQuynhMai: 5, totalStock: 20 },
  { id: '3', code: 'BOOK-03', title: 'Hiểu Về Trái Tim', isbn: '9783333', isbnLast4: '3333', author: 'Thích Minh Niệm', coverPrice: 145000, stockAvailable: 8, stockAuCo: 8, stockDuPhong: 10, stockQuynhMai: 5, totalStock: 23 },
  { id: '4', code: 'BOOK-04', title: 'Đắc Nhân Tâm (Khổ Lớn)', isbn: '9784444', isbnLast4: '4444', author: 'Dale Carnegie', coverPrice: 98000, stockAvailable: 20, stockAuCo: 20, stockDuPhong: 10, stockQuynhMai: 5, totalStock: 35 },
  { id: '5', code: 'BOOK-05', title: 'Nhà Giả Kim', isbn: '9785555', isbnLast4: '5555', author: 'Paulo Coelho', coverPrice: 79000, stockAvailable: 15, stockAuCo: 15, stockDuPhong: 10, stockQuynhMai: 5, totalStock: 30 },
  { id: '6', code: 'BOOK-06', title: 'Hành Trình Về Phương Đông', isbn: '9786666', isbnLast4: '6666', author: 'Baird T. Spalding', coverPrice: 120000, stockAvailable: 10, stockAuCo: 10, stockDuPhong: 10, stockQuynhMai: 5, totalStock: 25 }
];

function log(msg: string) {
  console.log(msg);
  const logDiv = document.getElementById('test-logs');
  if (logDiv) {
    const el = document.createElement('div');
    el.className = 'test-log';
    el.textContent = msg;
    logDiv.appendChild(el);
  }
}

window.addEventListener('error', (e) => log('WINDOW ERROR: ' + (e.error?.stack || e.message)));
window.addEventListener('unhandledrejection', (e) => log('UNHANDLED REJECTION: ' + (e.reason?.stack || e.reason)));

function findButton(text: string): HTMLButtonElement | null {
  const buttons = Array.from(document.querySelectorAll('button'));
  return buttons.find((b) => b.textContent?.includes(text)) || null;
}

async function waitFor(check: () => boolean, timeoutMs = 2000, label = 'condition') {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timeout chờ: ${label}`);
}

function setInputValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function setSelectValue(el: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function callsTo(fragment: string, method?: string) {
  return fetchCalls.filter((c) => c.url.includes(fragment) && (!method || c.method === method));
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { error };
  }
  componentDidCatch(error: any, errorInfo: any) {
    log('REACT ERROR: ' + (error?.stack || error?.message || error));
  }
  render() {
    if (this.state.error) {
      return <div id="react-crash-error" className="p-4 bg-red-100 text-red-900 font-mono text-xs">{String(this.state.error?.stack || this.state.error)}</div>;
    }
    return this.props.children;
  }
}

function TestContainer() {
  const urlParams = new URLSearchParams(window.location.search);
  const initialRole = (urlParams.get('role') || 'ROLE_CASHIER') as UserRole;
  const [role, setRole] = useState<UserRole>(initialRole);

  useEffect(() => {
    (window as any).__setRole = setRole;
  }, []);

  return (
    <ErrorBoundary>
      <PosCheckoutTerminal books={sampleBooks} currentRole={role} />
    </ErrorBoundary>
  );
}

async function runTestSuite() {
  log('Starting Automated Real Component Tests for PosCheckoutTerminal...');
  await new Promise((r) => setTimeout(r, 200));

  // 1. Check catalog grid structure (grid-cols-2)
  const gridEl = document.querySelector('.grid.grid-cols-2');
  if (!gridEl) {
    throw new Error('Test 1 Failed: Catalog grid container does not have grid-cols-2 class!');
  }
  log('✓ [Test 1] PASS: Catalog grid uses responsive 2 columns (grid-cols-2)');

  // 2. Check initial collapsed card count on mobile (should be 4 cards)
  let count = gridEl.children.length;
  for (let i = 0; i < 10 && count !== 4; i++) {
    await new Promise((r) => setTimeout(r, 100));
    count = gridEl.children.length;
  }
  if (count !== 4) {
    throw new Error(`Test 2 Failed: Expected 4 book cards in 2x2 collapsed view, got ${count}`);
  }
  log('✓ [Test 2] PASS: Mobile view renders exactly 4 books in compact 2x2 grid');

  // 3. Test expand toggle: Click "Xem tất cả"
  const expandBtn = findButton('Xem tất cả');
  if (!expandBtn) {
    throw new Error('Test 3 Failed: Cannot find "Xem tất cả" button');
  }
  expandBtn.click();
  await new Promise((r) => setTimeout(r, 100));

  if ((gridEl.children.length as number) !== 6) {
    throw new Error(`Test 3 Failed: Expected 6 book cards after expanding, got ${gridEl.children.length}`);
  }
  log('✓ [Test 3] PASS: Clicking "Xem tất cả" expands catalog grid to all 6 books');

  // 4. Test collapse toggle: Click "Thu gọn"
  const collapseBtn = findButton('Thu gọn');
  if (!collapseBtn) {
    throw new Error('Test 4 Failed: Cannot find "Thu gọn" button');
  }
  collapseBtn.click();
  await new Promise((r) => setTimeout(r, 100));

  if ((gridEl.children.length as number) !== 4) {
    throw new Error(`Test 4 Failed: Expected 4 book cards after collapsing back, got ${gridEl.children.length}`);
  }
  log('✓ [Test 4] PASS: Clicking "Thu gọn" restores compact 2x2 grid (4 books)');

  // 5. Test Settlement button role check for Cashier
  const cashierSettlementBtn = findButton('Chốt Ngày');
  if (cashierSettlementBtn) {
    throw new Error('Test 5 Failed: "Chốt Ngày" button must NOT be rendered for ROLE_CASHIER');
  }
  log('✓ [Test 5] PASS: "Chốt Ngày" button is strictly hidden for ROLE_CASHIER');

  // 6. Switch role to ROLE_MANAGER and verify Settlement button renders
  (window as any).__setRole('ROLE_MANAGER');
  await new Promise((r) => setTimeout(r, 150));

  const managerSettlementBtn = findButton('Chốt Ngày');
  if (!managerSettlementBtn) {
    throw new Error('Test 6 Failed: "Chốt Ngày" button MUST be rendered for ROLE_MANAGER');
  }
  log('✓ [Test 6] PASS: "Chốt Ngày" button correctly renders for ROLE_MANAGER');

  // 7. Measure horizontal overflow and right-edge bounds at 320px, 375px, 390px
  const rootEl = document.getElementById('root')!;
  const testWidths = [320, 375, 390];
  for (const w of testWidths) {
    rootEl.style.width = `${w}px`;
    rootEl.style.maxWidth = `${w}px`;
    rootEl.style.margin = '0 auto';
    await new Promise((r) => setTimeout(r, 50));

    const scrollW = rootEl.scrollWidth;
    const clientW = rootEl.clientWidth;
    if (scrollW > clientW) {
      throw new Error(`Test 7 Failed: Horizontal overflow detected at ${w}px! scrollWidth (${scrollW}) > clientWidth (${clientW})`);
    }

    const cards = rootEl.querySelectorAll('.grid.grid-cols-2 > div');
    const rootRect = rootEl.getBoundingClientRect();
    for (const card of Array.from(cards)) {
      const cardRect = card.getBoundingClientRect();
      if (cardRect.right > rootRect.right + 1) {
        throw new Error(`Test 7 Failed: Book card right edge (${cardRect.right}) overflows container right (${rootRect.right}) at ${w}px!`);
      }
    }
    log(`✓ [Test 7] PASS: No horizontal overflow at ${w}px (scrollWidth=${scrollW} <= clientWidth=${clientW}, all cards fit in viewport)`);
  }

  // 8. Test Payment method options (Bug #8): Only CASH and combined BANK_TRANSFER ("Chuyển khoản / Quét QR")
  const paymentSelect = (document.getElementById('pos-payment-method-select') as HTMLSelectElement | null) 
    || (Array.from(document.querySelectorAll('select')).find(s => s.querySelector('option[value="CASH"]')) as HTMLSelectElement | null);
  if (!paymentSelect) {
    throw new Error('Test 8 Failed: Cannot find payment method select element!');
  }
  const paymentOptions = Array.from(paymentSelect.options).map(o => ({ value: o.value, text: o.text }));
  if (paymentOptions.some(o => o.value === 'QR_CODE')) {
    throw new Error('Test 8 Failed: QR_CODE must NOT be a separate option in dropdown; must be combined with BANK_TRANSFER!');
  }
  const bankOption = paymentOptions.find(o => o.value === 'BANK_TRANSFER');
  if (!bankOption || !bankOption.text.includes('QR')) {
    throw new Error(`Test 8 Failed: BANK_TRANSFER option must include "QR" in label, got "${bankOption?.text}"`);
  }
  log('✓ [Test 8] PASS: Payment method dropdown combines Bank Transfer and QR into single "Chuyển khoản / Quét QR" option');

  // 9. Test Cart Freeze on Discount Approval Request (Bug A1-F / #1 UI)
  (window as any).__setRole('ROLE_CASHIER');
  await new Promise((r) => setTimeout(r, 100));

  const firstBookAddBtn = document.querySelector('.grid.grid-cols-2 button[aria-label^="Thêm"]') as HTMLButtonElement | null;
  if (!firstBookAddBtn) {
    throw new Error('Test 9 Failed: Cannot find "+ Thêm" button on first book card!');
  }
  firstBookAddBtn.click();
  await new Promise((r) => setTimeout(r, 100));

  const giftBtn = findButton('100%');
  if (!giftBtn) {
    throw new Error('Test 9 Failed: Cannot find gift 100% button!');
  }
  giftBtn.click();
  await new Promise((r) => setTimeout(r, 100));

  const frozenBanner = document.getElementById('pos-cart-frozen-banner');
  if (!frozenBanner) {
    throw new Error('Test 9 Failed: Cart frozen banner (#pos-cart-frozen-banner) must be rendered when approval is pending!');
  }

  const cartMinusBtn = document.querySelector('button[aria-label="Giảm số lượng"]') as HTMLButtonElement | null;
  if (!cartMinusBtn || !cartMinusBtn.disabled) {
    throw new Error('Test 9 Failed: Cart quantity minus button must be disabled when cart is frozen!');
  }

  const cancelApprovalBtn = document.getElementById('btn-cancel-approval') as HTMLButtonElement | null;
  if (!cancelApprovalBtn) {
    throw new Error('Test 9 Failed: Cannot find "#btn-cancel-approval" button to cancel approval!');
  }
  const cancelCallsBefore = callsTo('/api/pos/discount-approvals/', 'POST').length;
  cancelApprovalBtn.click();
  await waitFor(() => !document.getElementById('pos-cart-frozen-banner'), 3000, 'bỏ khóa giỏ sau khi hủy duyệt');

  const cancelCalls = callsTo('/api/pos/discount-approvals/', 'POST').slice(cancelCallsBefore);
  if (cancelCalls.length !== 1) {
    throw new Error(
      `Test 9 Failed: Hủy duyệt phải gọi đúng 1 lần POST /api/pos/discount-approvals/{id} (CANCEL), thực tế ${cancelCalls.length}!`
    );
  }
  if (!`${cancelCalls[0].body}`.includes('"CANCEL"')) {
    throw new Error(`Test 9 Failed: Body phải là {"action":"CANCEL"}, thực tế ${cancelCalls[0].body}`);
  }
  if (!cancelCalls[0].url.includes(CREATED_REQUEST.id)) {
    throw new Error(`Test 9 Failed: CANCEL phải gửi đúng requestId ${CREATED_REQUEST.id}, thực tế ${cancelCalls[0].url}`);
  }
  log('✓ [Test 9] PASS: Freeze khi chờ duyệt + hủy duyệt gọi API CANCEL mới mở khóa giỏ (A1-F / #1 UI)');

  // 10. Test Mobile Floating Checkout Button opens Sheet (Bug #7)
  const floatingCheckoutBtn = document.getElementById('btn-open-mobile-checkout-sheet') as HTMLButtonElement | null;
  if (!floatingCheckoutBtn) {
    throw new Error('Test 10 Failed: Cannot find mobile floating checkout button (#btn-open-mobile-checkout-sheet)!');
  }
  floatingCheckoutBtn.click();
  await new Promise((r) => setTimeout(r, 150));

  const mobileSheet = document.getElementById('mobile-checkout-sheet');
  if (!mobileSheet) {
    throw new Error('Test 10 Failed: Mobile checkout sheet (#mobile-checkout-sheet) must open on floating button click!');
  }

  const confirmBtn = document.getElementById('btn-confirm-mobile-checkout') as HTMLButtonElement | null;
  if (!confirmBtn) {
    throw new Error('Test 10 Failed: Confirm checkout button (#btn-confirm-mobile-checkout) must be inside mobile sheet!');
  }

  const closeSheetBtn = document.getElementById('close-mobile-checkout-sheet') as HTMLButtonElement | null;
  if (!closeSheetBtn) {
    throw new Error('Test 10 Failed: Close sheet button (#close-mobile-checkout-sheet) must exist!');
  }
  closeSheetBtn.click();
  await new Promise((r) => setTimeout(r, 100));

  if (document.getElementById('mobile-checkout-sheet')) {
    throw new Error('Test 10 Failed: Mobile sheet must be closed after clicking close button!');
  }
  log('✓ [Test 10] PASS: Mobile floating checkout button opens sheet modal without auto-checkout (#7)');

  // 11. CANCEL lỗi (409/timeout) -> giỏ VẪN khóa, không mở sớm (A1-F)
  log('\n--- Test 11: CANCEL API lỗi -> giỏ giữ khóa ---');
  (window as any).__setCancelApprovalFails(true);
  const addBtn11 = document.querySelector('.grid.grid-cols-2 button[aria-label^="Thêm"]') as HTMLButtonElement | null;
  if (!addBtn11) throw new Error('Test 11 Failed: Cannot find "+ Thêm" button!');
  addBtn11.click();
  await new Promise((r) => setTimeout(r, 120));
  const giftBtn11 = findButton('100%');
  if (!giftBtn11) throw new Error('Test 11 Failed: Cannot find gift 100% button!');
  giftBtn11.click();
  await waitFor(() => !!document.getElementById('btn-cancel-approval'), 2000, 'banner khóa giỏ');

  (document.getElementById('btn-cancel-approval') as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 300));
  if (!document.getElementById('pos-cart-frozen-banner')) {
    throw new Error('Test 11 Failed: CANCEL lỗi thì giỏ PHẢI còn khóa (không mở sớm)!');
  }
  if (!`${document.getElementById('pos-error-message')?.textContent || ''}`.includes('tải lại')) {
    throw new Error('Test 11 Failed: Phải hiển thị lỗi từ server khi hủy thất bại!');
  }

  (window as any).__setCancelApprovalFails(false);
  (document.getElementById('btn-cancel-approval') as HTMLButtonElement).click();
  await waitFor(() => !document.getElementById('pos-cart-frozen-banner'), 3000, 'mở khóa khi retry CANCEL thành công');
  log('✓ [Test 11] PASS: CANCEL lỗi -> giữ khóa + báo lỗi; retry thành công mới mở khóa giỏ');

  // 12. Đã được Quản lý duyệt -> giỏ VẪN khóa (giữ đúng phê duyệt) nhưng ĐƯỢC chốt đơn
  log('\n--- Test 12: đã duyệt -> giỏ vẫn khóa, được phép chốt đơn ---');
  const addBtn12 = document.querySelector('.grid.grid-cols-2 button[aria-label^="Thêm"]') as HTMLButtonElement | null;
  if (!addBtn12) throw new Error('Test 12 Failed: Cannot find "+ Thêm" button!');
  addBtn12.click();
  await new Promise((r) => setTimeout(r, 120));
  const giftBtn12 = findButton('100%');
  if (!giftBtn12) throw new Error('Test 12 Failed: Cannot find gift 100% button!');
  giftBtn12.click();
  await waitFor(() => !!document.getElementById('pos-approval-otp-input'), 2000, 'form OTP của modal duyệt');

  setInputValue(document.getElementById('pos-approval-otp-input') as HTMLInputElement, '4821');
  const unlockBtn = findButton('Mở Khóa Đơn');
  if (!unlockBtn) throw new Error('Test 12 Failed: Cannot find "Mở Khóa Đơn" button!');
  unlockBtn.click();
  await waitFor(
    () => `${document.getElementById('pos-cart-frozen-banner')?.textContent || ''}`.includes('đã duyệt'),
    3000,
    'banner chuyển sang trạng thái đã duyệt'
  );

  const minus12 = document.querySelector('button[aria-label="Giảm số lượng"]') as HTMLButtonElement | null;
  if (!minus12?.disabled) {
    throw new Error('Test 12 Failed: Sau khi duyệt, sửa giỏ PHẢI vẫn bị khóa để giữ đúng phê duyệt!');
  }
  const checkout12 = document.getElementById('btn-desktop-checkout') as HTMLButtonElement | null;
  if (!checkout12) throw new Error('Test 12 Failed: Cannot find desktop checkout button (#btn-desktop-checkout)!');
  if (checkout12.disabled) {
    throw new Error('Test 12 Failed: Sau khi duyệt, nút chốt đơn PHẢI bật lại (không chặn bán)!');
  }
  if (findButton('Mở lại mã')) {
    throw new Error('Test 12 Failed: Đã duyệt thì KHÔNG được mời tạo yêu cầu duyệt mới ("Mở lại mã")!');
  }
  log('✓ [Test 12] PASS: Sau khi duyệt, giỏ vẫn khóa để giữ phê duyệt và nút chốt đơn được bật');

  // 13. F5: Chuyển khoản/QR phải xác nhận TAY "Đã nhận tiền" trước khi gửi đơn
  log('\n--- Test 13: chuyển khoản/QR cần xác nhận tay "Đã nhận tiền" ---');
  (document.getElementById('btn-cancel-approval') as HTMLButtonElement | null)?.click();
  await waitFor(() => !document.getElementById('pos-cart-frozen-banner'), 3000, 'mở khóa giỏ trước Test 13');

  setSelectValue(document.getElementById('pos-payment-method-select') as HTMLSelectElement, 'BANK_TRANSFER');
  await new Promise((r) => setTimeout(r, 120));

  const ordersBefore = callsTo('/api/orders', 'POST').length;
  const checkout13 = document.getElementById('btn-desktop-checkout') as HTMLButtonElement;
  checkout13.click();
  await new Promise((r) => setTimeout(r, 250));
  if (callsTo('/api/orders', 'POST').length !== ordersBefore) {
    throw new Error('Test 13 Failed: Chưa xác nhận "Đã nhận tiền" thì KHÔNG được gửi POST /api/orders!');
  }
  if (!`${document.getElementById('pos-error-message')?.textContent || ''}`.includes('Đã nhận tiền')) {
    throw new Error('Test 13 Failed: Phải báo yêu cầu xác nhận "Đã nhận tiền"!');
  }

  const moneyReceivedBtn = document.getElementById('btn-money-received') as HTMLButtonElement | null;
  if (!moneyReceivedBtn) throw new Error('Test 13 Failed: Cannot find "#btn-money-received" toggle!');
  moneyReceivedBtn.click();
  await new Promise((r) => setTimeout(r, 100));

  checkout13.click();
  await waitFor(() => callsTo('/api/orders', 'POST').length > ordersBefore, 3000, 'gửi đơn sau khi xác nhận đã nhận tiền');
  log('✓ [Test 13] PASS: Chuyển khoản/QR bắt buộc xác nhận tay "Đã nhận tiền" trước khi chốt đơn');

  // 14. F4: Drawer Quản lý hiện cartSnapshot (giỏ đã khóa) của yêu cầu chờ duyệt
  log('\n--- Test 14: drawer Quản lý hiện cartSnapshot ---');
  (window as any).__setDrawerItems([
    {
      id: 'req-drawer-1',
      orderCode: 'ORD-TEST-0001',
      warehouseId: 'wh-au-co',
      cashierId: 'staff-tn',
      shortCode: '4821',
      requestedDiscountRate: 0.25,
      originalAmount: 168000,
      discountAmount: 42000,
      finalAmount: 126000,
      status: 'PENDING',
      expiresAt: '2099-01-01T00:00:00.000Z',
      createdAt: '2026-09-25T00:00:00.000Z',
      cartSnapshot: JSON.stringify([{ editionId: 'BOOK-01', quantity: 2, unitPrice: 168000 }]),
    },
  ]);
  (window as any).__setRole('ROLE_MANAGER');
  await new Promise((r) => setTimeout(r, 150));

  const drawerOpenBtn = document.querySelector('button[title^="Mở bảng duyệt chiết khấu"]') as HTMLButtonElement | null;
  if (!drawerOpenBtn) throw new Error('Test 14 Failed: Cannot find manager approval drawer button!');
  drawerOpenBtn.click();
  await waitFor(() => !!document.getElementById('btn-view-cart-req-drawer-1'), 4000, 'nút xem giỏ trong drawer');

  (document.getElementById('btn-view-cart-req-drawer-1') as HTMLButtonElement).click();
  await waitFor(
    () => `${document.getElementById('drawer-cart-snapshot-req-drawer-1')?.textContent || ''}`.includes('BOOK-01'),
    2000,
    'snapshot giỏ hiển thị trong drawer'
  );
  const snapshotText = `${document.getElementById('drawer-cart-snapshot-req-drawer-1')?.textContent || ''}`;
  if (!snapshotText.includes('× 2')) {
    throw new Error(`Test 14 Failed: Snapshot phải hiện đúng số lượng đã khóa, thực tế "${snapshotText}"`);
  }
  log('✓ [Test 14] PASS: Drawer Quản lý hiện cartSnapshot của yêu cầu chờ duyệt');

  // Summary
  const summaryEl = document.createElement('div');
  summaryEl.id = 'test-summary';
  summaryEl.textContent = 'ALL REAL POS COMPONENT TESTS PASSED (14/14)';
  document.body.appendChild(summaryEl);
  log('\n>>> SUCCESS: ALL REAL POS COMPONENT TESTS PASSED (14/14) <<<');
}

window.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('root')!;

  const urlParams = new URLSearchParams(window.location.search);
  const targetWidth = urlParams.get('width');
  if (targetWidth) {
    container.style.width = `${targetWidth}px`;
    container.style.maxWidth = `${targetWidth}px`;
    container.style.margin = '0';
  }

  const root = createRoot(container);
  root.render(<TestContainer />);

  const mode = urlParams.get('mode') || 'test';

  if (mode === 'test') {
    runTestSuite().catch((err) => {
      console.error('TEST ERROR:', err);
      const errEl = document.createElement('div');
      errEl.id = 'test-summary';
      errEl.textContent = 'FAILED: ' + err.message;
      document.body.appendChild(errEl);
    });
  } else if (mode === 'sheet') {
    setTimeout(() => {
      const addBtn = document.querySelector('.grid.grid-cols-2 button[aria-label^="Thêm"]') as HTMLButtonElement | null;
      if (addBtn) addBtn.click();
      setTimeout(() => {
        const floatBtn = document.getElementById('btn-open-mobile-checkout-sheet');
        if (floatBtn) floatBtn.click();
      }, 150);
    }, 250);
  } else if (mode === 'frozen') {
    setTimeout(() => {
      const addBtn = document.querySelector('.grid.grid-cols-2 button[aria-label^="Thêm"]') as HTMLButtonElement | null;
      if (addBtn) addBtn.click();
      setTimeout(() => {
        const giftBtn = findButton('100%');
        if (giftBtn) giftBtn.click();
      }, 150);
    }, 250);
  } else if (mode === 'payment-qr') {
    setTimeout(() => {
      const addBtn = document.querySelector('.grid.grid-cols-2 button[aria-label^="Thêm"]') as HTMLButtonElement | null;
      if (addBtn) addBtn.click();
      setTimeout(() => {
        const select = (document.getElementById('pos-payment-method-select') as HTMLSelectElement | null);
        if (select) {
          select.value = 'BANK_TRANSFER';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, 150);
    }, 250);
  }
});
