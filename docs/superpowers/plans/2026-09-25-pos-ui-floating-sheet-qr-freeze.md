# Kế hoạch triển khai POS UI: Nút Thanh toán nổi Sheet (#7), Gộp Chuyển khoản/QR (#8) và Freeze giỏ hàng A1-F (#1 UI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện 3 hạng mục POS UI còn lại của Agent C: mở Mobile Checkout Sheet khi nhấn nút nổi (#7), gộp lựa chọn Chuyển khoản / QR (#8), và khóa (freeze) giỏ hàng kèm hành động hủy duyệt để chỉnh sửa giỏ khi đang chờ duyệt chiết khấu (A1-F / #1 UI).

**Architecture:** Giữ toàn bộ logic thanh toán và hợp đồng server hiện có (`order.service.ts`, `BANK_TRANSFER`, `DiscountApprovalModal`, `ManagerApprovalDrawer`). Chỉ sửa đổi tầng UI và state quản lý giỏ hàng trong `src/components/pos/PosCheckoutTerminal.tsx`. Đảm bảo không render hai bộ handler thanh toán riêng biệt, không tự chốt đơn khi mở sheet, và vô hiệu hóa mọi thao tác sửa giỏ khi giỏ đang bị khóa.

**Tech Stack:** Next.js 14, React 18, Tailwind CSS, Lucide React, TypeScript, Chrome Headless test runner.

**Spec:** `docs/superpowers/plans/2026-09-24-pos-hardening-abc-master-plan.md` (Mục #7, #8, A1-F / #1 UI, và Contract A4).

## Global Constraints

- Không sửa đổi các file backend/service: `src/services/order.service.ts`, `src/db/index.ts`, `src/app/api/orders/route.ts`.
- Không đụng chạm logic `fallbackToOffline` (S-01 session lease freshness) của Agent B.
- Không thêm bất kỳ thư viện hoặc dependency bên ngoài nào.
- Giữ nguyên khả năng tương thích ngược của server: đơn hàng mới từ lựa chọn gộp lưu `paymentMethod: 'BANK_TRANSFER'`.
- Nút nổi mobile khi nhấn chỉ mở Sheet xác nhận, tuyệt đối không tự động kích hoạt tạo đơn hàng.
- Khi giỏ hàng bị freeze (`isCartFrozen`), mọi thao tác thêm sách từ catalog/quét mã, tăng/giảm số lượng, xóa từng cuốn, xóa sạch giỏ, và thay đổi chiết khấu đều bị chặn.

## Review Focus

1. **Khóa giỏ hàng toàn diện (Cart freeze boundary):** Khi có yêu cầu duyệt chiết khấu đang chờ, thu ngân bấm nút `+`, `-`, nút thùng rác xóa dòng, nút "Xóa giỏ", nút chọn chiết khấu khác, hoặc click thẻ sách bên catalog đều không làm thay đổi giỏ hàng.
2. **Hủy duyệt để mở khóa (Cancel approval unlock):** Thu ngân có thể bấm "Hủy duyệt để sửa giỏ", giỏ hàng lập tức mở khóa, tỷ lệ chiết khấu reset an toàn về 0% (hoặc mức hợp lệ trước đó).
3. **Mở sheet không kích hoạt checkout sớm:** Bấm nút thanh toán nổi `#cart-checkout-bar` chỉ mở Sheet; không có request `POST /api/orders` nào được gửi cho đến khi người dùng bấm nút xác nhận cuối cùng trong Sheet.
4. **Gộp Chuyển khoản/QR:** Dropdown thanh toán chỉ còn `Tiền mặt` (`CASH`) và `Chuyển khoản / Quét QR` (`BANK_TRANSFER`). Khi chọn Chuyển khoản / QR, component `VietQrPay` được hiển thị đầy đủ thông tin số tài khoản và QR.
5. **Headless Chrome viewports:** Test tự động trên Chrome thật chạy qua 320px, 375px, 390px xác nhận Sheet hiển thị không tràn màn hình (`scrollWidth <= clientWidth`), đóng/mở mượt mà.

---

### Task 1: Triển khai Ticket #8 — Gộp lựa chọn Chuyển khoản và QR thành "Chuyển khoản / Quét QR"

**Files:**
- Modify: `src/components/pos/PosCheckoutTerminal.tsx` (phần render dropdown thanh toán và điều kiện hiển thị `VietQrPay`)
- Test: `scripts/browser-pos-terminal-test.tsx` (bổ sung assertion kiểm tra options của select thanh toán)

**Interfaces:**
- `paymentMethod`: Giữ kiểu `'CASH' | 'BANK_TRANSFER' | 'QR_CODE'`.
- Đơn mới khi chọn hình thức điện tử: lưu `BANK_TRANSFER`.
- Điều kiện render `VietQrPay`: `(paymentMethod === 'BANK_TRANSFER' || paymentMethod === 'QR_CODE')`.

- [ ] **Step 1: Viết test kiểm tra dropdown thanh toán chỉ có 2 option chuẩn**
Cập nhật file `scripts/browser-pos-terminal-test.tsx` thêm assertion kiểm tra dropdown thanh toán không còn tách rời 3 option mà gộp thành `CASH` ("Tiền mặt") và `BANK_TRANSFER` ("Chuyển khoản / Quét QR").

- [ ] **Step 2: Cập nhật `PosCheckoutTerminal.tsx` cho Ticket #8**
Thay thế options trong dropdown thanh toán tại dòng ~1860 và điều kiện hiển thị `VietQrPay` tại dòng ~1871 để hỗ trợ `BANK_TRANSFER`.

- [ ] **Step 3: Chạy typecheck và test**
Chạy `npx tsc --noEmit` để đảm bảo không có lỗi type.

---

### Task 2: Triển khai Ticket A1-F / #1 UI — Freeze giỏ hàng và Banner điều khiển duyệt chiết khấu

**Files:**
- Modify: `src/components/pos/PosCheckoutTerminal.tsx` (state `isCartFrozen`, guard trong handlers, cart item buttons, discount buttons, catalog card click)
- Test: `scripts/browser-pos-terminal-test.tsx` (bổ sung test case giả lập pending approval và assert các nút sửa giỏ bị disabled)

**Interfaces:**
- State: `pendingApprovalRate`: `number | null`, `isApprovalPending`: `boolean`.
- Handler: `handleCancelApproval()`: hủy yêu cầu duyệt, reset `isApprovalPending = false`, `pendingDiscountRate = null`, `discountRate = 0`, mở khóa giỏ hàng.
- Guards:
  - `updateQuantity`: `if (isCartFrozen) return;`
  - `removeFromCart`: `if (isCartFrozen) return;`
  - `setCart([])`: `if (isCartFrozen) return;`
  - Catalog `addToCart`: `if (isCartFrozen) { setErrorMessage('Giỏ hàng đang tạm khóa do chờ Quản lý duyệt chiết khấu.'); return; }`
  - Discount buttons: `disabled={isCartFrozen}`.

- [ ] **Step 1: Viết test kiểm tra trạng thái freeze giỏ hàng**
Thêm ca kiểm thử vào `scripts/browser-pos-terminal-test.tsx`: khi `isDiscountApprovalModalOpen` hoặc `isApprovalPending`, các nút `+`, `-`, nút xóa dòng và nút chọn chiết khấu bị disabled và hiển thị banner cảnh báo.

- [ ] **Step 2: Cập nhật `PosCheckoutTerminal.tsx` với logic Cart Freeze**
Bổ sung state `isCartFrozen`, gắn guard vào `addToCart`, `updateQuantity`, `removeFromCart`, `setCart([])`, và render banner "Giỏ hàng tạm khóa" kèm nút "Hủy duyệt để sửa giỏ".

- [ ] **Step 3: Chạy typecheck và test**
Chạy `npx tsc --noEmit` để xác nhận an toàn kiểu dữ liệu.

---

### Task 3: Triển khai Ticket #7 — Mobile Checkout Bottom Sheet

**Files:**
- Modify: `src/components/pos/PosCheckoutTerminal.tsx` (thay thế `scrollIntoView` bằng state `isMobileCheckoutSheetOpen`, render Bottom Sheet trên mobile)
- Test: `scripts/browser-pos-terminal-test.tsx` (thêm tương tác click nút nổi `#cart-checkout-bar` và kiểm tra Sheet xuất hiện trong DOM)

**Interfaces:**
- State: `isMobileCheckoutSheetOpen: boolean`.
- Nút nổi `#cart-checkout-bar`: `onClick={() => setIsMobileCheckoutSheetOpen(true)}`.
- Mobile Checkout Sheet:
  - Container cố định fixed ở đáy màn hình với z-index cao (z-50) và nền overlay bán trong suốt.
  - Hiển thị danh sách tóm tắt các cuốn sách trong giỏ.
  - Hiển thị tổng tiền, chiết khấu, số tiền phải thanh toán (`finalAmount`).
  - Chọn phương thức thanh toán (`paymentMethod`) và hiển thị `VietQrPay` nếu chọn Chuyển khoản / Quét QR.
  - Nút xác nhận thanh toán cuối cùng: `Xác nhận Thanh toán ({finalAmount.toLocaleString('vi-VN')} đ)` gọi `handleCheckout()`.
  - Nút đóng (`X` hoặc bấm ra ngoài overlay): đóng sheet mà không mất dữ liệu giỏ.

- [ ] **Step 1: Viết test kiểm tra nút nổi mobile mở Mobile Checkout Sheet**
Thêm ca kiểm thử vào `scripts/browser-pos-terminal-test.tsx`: viewport 375px, click nút nổi `#cart-checkout-bar`, assert Mobile Checkout Sheet xuất hiện, hiển thị đúng thông tin giỏ và nút chốt đơn.

- [ ] **Step 2: Cập nhật `PosCheckoutTerminal.tsx` render Mobile Checkout Sheet**
Thêm state `isMobileCheckoutSheetOpen` và render component Bottom Sheet dành riêng cho mobile.

- [ ] **Step 3: Chạy typecheck**
Chạy `npx tsc --noEmit`.

---

### Task 4: Chạy kiểm thử tự động Headless Chrome, chụp ảnh giao diện và cập nhật Báo cáo

**Files:**
- Modify: `scripts/run-real-pos-terminal-test.ts` (bổ sung chụp ảnh Mobile Checkout Sheet, Payment combined, Cart Freeze banner)
- Artifact / Report: `reports/wave3-pos-ui/pos-hardening-ui-report.md` và các ảnh chụp màn hình trong `reports/wave3-pos-ui/`

- [ ] **Step 1: Chạy runner kiểm thử Headless Chrome thật**
Thực thi `npx tsx scripts/run-real-pos-terminal-test.ts` và kiểm tra 100% assertions PASS.

- [ ] **Step 2: Cập nhật ảnh chụp màn hình thực tế**
Kiểm tra các file PNG sinh ra chứng minh:
  1. Nút nổi mobile mở Sheet thanh toán (`pos-mobile-checkout-sheet.png`).
  2. Dropdown gộp "Chuyển khoản / Quét QR" hiển thị mã QR (`pos-combined-payment.png`).
  3. Giỏ hàng bị khóa (Freeze) khi có yêu cầu phê duyệt chiết khấu (`pos-cart-frozen.png`).

- [ ] **Step 3: Viết tài liệu báo cáo nghiệm thu UI bàn giao cho Agent A & B**
Lập bản báo cáo chi tiết kèm SHA commit và bằng chứng kiểm thử sẵn sàng bàn giao.
