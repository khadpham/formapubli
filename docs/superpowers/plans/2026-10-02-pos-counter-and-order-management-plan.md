# Kế Hoạch Triển Khai: Cải Tiến POS Thực Chiến, Quản Trị Kho Vận & Cơ Chế Hủy Đơn An Toàn

> ## ✅ ĐÃ TRIỂN KHAI XONG (cập nhật 03/10/2026)
>
> **Checkbox dưới đây chưa được tick là vì plan viết trước khi code — không phải việc còn
> treo.** Toàn bộ đã lên `main`. Khi đọc, đừng tick lại; hãy kiểm bằng `git log`.
>
> | Việc | Bằng chứng trên `main` |
> |---|---|
> | `voidCompletedOrder` (hủy đơn đã hoàn tất) | `src/services/order.service.ts` + `POST /api/orders/[id]/void` |
> | Hoàn thẻ kho `RETURN_INBOUND` | có trong `order.service.ts`, test `test-void-completed-order` |
> | Các suite `scripts/test-*.ts` nêu trong plan | đều **đã đăng ký** trong `scripts/run-isolated.ts` |
>
> Spec đi kèm vẫn đúng và còn giá trị tham khảo: `docs/superpowers/specs/2026-10-02-pos-counter-and-order-management-design.md`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Giải quyết triệt để 8 vấn đề vận hành quầy thực tế: thanh toán VietQR mặc định, bộ tính tiền mặt/thối tiền, sửa & sắp xếp kho, lề in tồn sách A4, responsive chip mobile, xem hóa đơn và cơ chế Hủy đơn đã hoàn tất an toàn 100% về Thẻ kho (Ledger) và Sổ dòng tiền.

**Architecture:** Tiếp cận 2 làn song song: Làn UI (POS Calculator, Print A4 CSS, Mobile Chips, Warehouse Manager UI) và Làn Core Accounting (Transaction nguyên tử hủy đơn `voidCompletedOrder`, hoàn thẻ kho `RETURN_INBOUND` hàng loạt cho cả sách và quà, chốt chặn ca két, phân quyền Owner/Manager).

**Tech Stack:** Next.js 14 App Router, TypeScript, Drizzle ORM, LibSQL/Turso, TailwindCSS, Lucide Icons, Vitest / Node test scripts.

**Spec:** `docs/superpowers/specs/2026-10-02-pos-counter-and-order-management-design.md`

## Global Constraints

- **Bất biến Thẻ kho:** Tuyệt đối không `DELETE` dòng `inventory_ledger`. Luôn tạo bút toán bù trừ `RETURN_INBOUND` với `+quantityDelta`.
- **Bất biến Cloudflare OpenNext:** Giữ nguyên `NEXT_PRIVATE_MINIMAL_MODE="1"` và twin backslash `@libsql\\client`.
- **Bất biến tiếng Việt:** Toàn bộ UI dùng tiếng Việt CÓ DẤU, nút là động từ ngắn, aria-label rõ ràng.
- **Bất biến Kiểm thử:** Chạy test trên DB cách ly (`formapubli_test.db` qua `scripts/run-isolated.ts`), không đụng vào DB thật.
- **Bất biến Dọn dẹp:** Sau khi hoàn tất và deploy xong, thực hiện pruning toàn diện: gỡ worktree, xóa branch phụ, dọn dẹp artifacts tạm trên máy tính.

## Review Focus

1. **Hủy đơn có quà tặng kèm (`isGiftLine`):** Thẻ kho phải hoàn trả cả sách bán lẫn quà tặng kèm, không được bỏ sót quà.
2. **Hủy đơn thuộc ca két đã đóng (`CLOSED`):** Chỉ `ROLE_OWNER` mới có quyền thực hiện và bắt buộc có cảnh báo lệch biên bản A4.
3. **Transaction rollback:** Bất kỳ lỗi nào trong quá trình hủy đơn phải rollback 100%, không để lại trạng thái dở dang.
4. **Bộ tính tiền thối:** Format tiền tệ rõ ràng, không nhận số âm, nút bấm nhạy và reset sau mỗi đơn.
5. **Bản in A4 Mục IV:** Lề trang 12mm 10mm lặp lại đồng đều trên mọi trang, lặp lại tiêu đề bảng ở trang 2 (`thead { display: table-header-group }`).

---

### Task 0: Khởi tạo Git Branch & Worktree Cách Ly

**Files:** (Hạ tầng git)

- [ ] **Step 1: Tạo nhánh và worktree mới**
```powershell
git worktree add "D:\Data Project\formapubli-counter" -b feat/pos-counter-and-order-management main
```
- [ ] **Step 2: Cài đặt node_modules riêng (không dùng junction)**
```powershell
cd "D:\Data Project\formapubli-counter"
npm install --include=dev
Test-Path node_modules\typescript\package.json
```
- [ ] **Step 3: Xác nhận trạng thái git sạch**
```powershell
git branch --show-current
git status --porcelain
```

---

### Task 1: POS - VietQR Mặc Định & Bộ Tính Tiền Mặt (Tiền Nhận & Tiền Thối)

**Files:**
- Modify: `src/components/pos/PosCheckoutTerminal.tsx`
- Test: `scripts/test-pos-cash-calculator.ts` (mới)

- [ ] **Step 1: Viết test kiểm tra logic bộ tính tiền mặt**
  - File: `scripts/test-pos-cash-calculator.ts`
  - Kiểm tra các hàm tính toán `tiền thối = tiền nhận - giá bán`, các mốc gợi ý `200.000`, `500.000`, `1.000.000`, `Đủ tiền`, trạng thái thiếu tiền.
- [ ] **Step 2: Đổi phương thức thanh toán mặc định sang `'BANK_TRANSFER'`**
  - Trong `src/components/pos/PosCheckoutTerminal.tsx`: đổi `useState<'CASH' | ...>('BANK_TRANSFER')`.
- [ ] **Step 3: Bổ sung giao diện Bộ tính tiền mặt trên Wide Terminal (Desktop)**
  - State: `cashReceived: number | ''`.
  - Khi `paymentMethod === 'CASH'`, render ô nhập tiền nhận, các nút bấm nhanh 200k, 500k, 1M, Đủ tiền.
  - Hiển thị dòng "Tiền trả khách" màu xanh lá to rõ khi đủ tiền, cảnh báo màu cam nếu thiếu.
- [ ] **Step 4: Bổ sung giao diện Bộ tính tiền mặt trên Mobile Checkout Sheet**
  - Áp dụng đầy đủ ô nhập tiền nhận, nút nhanh và tiền thối vào khung checkout dưới đáy của điện thoại.
- [ ] **Step 5: Tự động reset `cashReceived` khi hoàn tất đơn hoặc chuyển giỏ**
- [ ] **Step 6: Chạy test và xác nhận**
```powershell
npx tsx scripts/test-pos-cash-calculator.ts
```
- [ ] **Step 7: Commit Task 1**
```powershell
git add src/components/pos/PosCheckoutTerminal.tsx scripts/test-pos-cash-calculator.ts
git commit -m "feat(pos): default to VietQR and add cash change calculator"
```

---

### Task 2: In Ấn - Khắc Phục Lề & Ngắt Trang Bảng Tồn Sách A4 (Mục IV)

**Files:**
- Modify: `src/components/pos/DailyFairSettlementModal.tsx`
- Test: `scripts/test-settlement-print-css.ts` (mới)

- [ ] **Step 1: Viết test kiểm tra cấu trúc CSS in ấn A4**
  - File: `scripts/test-settlement-print-css.ts`
  - Đảm bảo có `@page { size: A4 portrait; margin: 12mm 10mm !important; }`, `thead { display: table-header-group; }`, và `tr { break-inside: avoid; }`.
- [ ] **Step 2: Tinh chỉnh CSS in ấn trong `DailyFairSettlementModal.tsx`**
  - Cập nhật selector in: `@page { size: A4 portrait !important; margin: 12mm 10mm !important; }`.
  - Đặt padding `#printable-settlement-report` về `0 !important` khi in để `@page margin` kiểm soát toàn bộ lề trang 1, 2, 3...
  - Cho phép Section IV `break-inside: auto`, bảng `thead { display: table-header-group }`, các dòng `tr { break-inside: avoid; page-break-inside: avoid; }`.
- [ ] **Step 3: Chạy test và xác nhận**
```powershell
npx tsx scripts/test-settlement-print-css.ts
```
- [ ] **Step 4: Commit Task 2**
```powershell
git add src/components/pos/DailyFairSettlementModal.tsx scripts/test-settlement-print-css.ts
git commit -m "fix(print): correct page margins and page breaks for A4 stocktake table"
```

---

### Task 3: Kho Vận - Sửa Tên Kho & Thay Đổi Thứ Tự Vị Trí Kho

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/services/warehouse.service.ts`
- Modify: `src/app/api/warehouses/[id]/route.ts`
- Modify: `src/components/inventory/WarehouseManagerPanel.tsx`
- Test: `scripts/test-warehouse-reorder.ts` (mới)

- [ ] **Step 1: Thêm cột `sortOrder` vào schema và service**
  - `src/db/schema.ts`: Thêm `sortOrder: integer('sort_order').default(0)` vào `warehouses`.
  - `src/services/warehouse.service.ts`: Cập nhật `listAll()` và `listSellable()` order by `sort_order ASC, name ASC`. Hỗ trợ cập nhật `sortOrder`.
- [ ] **Step 2: Viết test kiểm chứng sửa tên và sắp xếp kho**
  - File: `scripts/test-warehouse-reorder.ts`.
- [ ] **Step 3: Cập nhật `WarehouseManagerPanel.tsx`**
  - Thêm nút "Sửa" inline cho phép Quản lý đổi tên kho trực tiếp.
  - Thêm nút mũi tên Lên (▲) / Xuống (▼) để hoán đổi thứ tự vị trí giữa các kho.
  - Chuẩn hóa toàn bộ nhãn sang tiếng Việt CÓ DẤU ("Sửa", "Xóa", "Ngưng hoạt động", "Mở lại", "Tải lại").
- [ ] **Step 4: Chạy test và xác nhận**
```powershell
npx tsx scripts/test-warehouse-reorder.ts
```
- [ ] **Step 5: Commit Task 3**
```powershell
git add src/db/schema.ts src/services/warehouse.service.ts src/app/api/warehouses/ src/components/inventory/WarehouseManagerPanel.tsx scripts/test-warehouse-reorder.ts
git commit -m "feat(warehouse): allow renaming and reordering warehouses with diacritics in UI"
```

---

### Task 4: Responsive Mobile - Sửa Tràn Chip Bộ Lọc Doanh Số & Sổ Kép

**Files:**
- Modify: `src/components/sales/SalesLedgerView.tsx`
- Modify: `src/components/sales/PendingOrdersView.tsx`
- Test: `scripts/test-mobile-chips-responsive.ts` (mới)

- [ ] **Step 1: Viết test kiểm tra class responsive trên mobile**
  - Kiểm tra sự hiện diện của `flex-wrap` hoặc `overflow-x-auto`, `min-w-0` trên các container chip lọc.
- [ ] **Step 2: Sửa layout chip/select trong `PendingOrdersView.tsx`**
  - Sửa cụm `Tất cả kho xuất` và `Tất cả kênh` sang `flex-wrap sm:flex-nowrap min-w-0 w-full`.
- [ ] **Step 3: Sửa layout chip/select trong `SalesLedgerView.tsx`**
  - Thêm cuộn ngang mượt mà cho thanh chọn Sổ (ALL / OFFICIAL_TAX / INTERNAL_MANAGEMENT).
  - Tinh chỉnh dải nút Thời gian và Kênh sang `flex-wrap gap-1.5 min-w-0`.
- [ ] **Step 4: Chạy test và xác nhận**
```powershell
npx tsx scripts/test-mobile-chips-responsive.ts
```
- [ ] **Step 5: Commit Task 4**
```powershell
git add src/components/sales/SalesLedgerView.tsx src/components/sales/PendingOrdersView.tsx scripts/test-mobile-chips-responsive.ts
git commit -m "fix(ui): prevent mobile chip overflow on SalesLedger and PendingOrders"
```

---

### Task 5: Core Backend - Nghiệp Vụ Hủy Đơn Hoàn Tất An Toàn Sổ Sách & Tồn Kho

**Files:**
- Modify: `src/services/order.service.ts`
- Create: `src/app/api/orders/[id]/void/route.ts`
- Create: `scripts/test-void-completed-order.ts`

- [ ] **Step 1: Viết test suite cách ly `scripts/test-void-completed-order.ts`**
  - Test case 1: Hủy đơn COMPLETED trong ca OPEN -> status CANCELLED, tạo bút toán `RETURN_INBOUND` cho toàn bộ sách, tồn kho tăng lại.
  - Test case 2: Hủy đơn có quà tặng (`isGiftLine`) -> quà tặng cũng được hoàn trả kho.
  - Test case 3: Thu ngân (`ROLE_CASHIER`) gọi hủy -> bị từ chối 403 Forbidden.
  - Test case 4: Quản lý (`ROLE_MANAGER`) hủy đơn ca đã đóng -> bị chặn 409 Conflict; Chủ (`ROLE_OWNER`) duyệt cưỡng chế -> thành công kèm audit log.
- [ ] **Step 2: Xây dựng hàm `voidCompletedOrder` trong `src/services/order.service.ts`**
  - Kiểm tra trạng thái đơn: phải là `COMPLETED`.
  - Transaction nguyên tử:
    * Kiểm tra ca két: ca `CLOSED` chỉ cho phép `ROLE_OWNER` với cờ `forceCloseBypass: true`.
    * Hoàn trả Thẻ kho hàng loạt: gọi `InventoryService.recordMovementsBatch` với `eventType = 'RETURN_INBOUND'`, `quantityDelta = +quantity` cho từng dòng hàng (kể cả quà tặng).
    * Cập nhật đơn: `status = 'CANCELLED'`, ghi chú `[HỦY ĐƠN: lý do]`.
    * Ghi `audit_logs`: `action = 'ORDER_VOIDED'`, ghi nhận actorId, vai trò, thời gian và lý do.
- [ ] **Step 3: Xây dựng route API `POST /api/orders/[id]/void`**
  - Yêu cầu xác thực phiên đăng nhập với vai trò `ROLE_OWNER` hoặc `ROLE_MANAGER`.
  - Body: `{ reason: string, force?: boolean }`.
  - Validate: lý do hủy bắt buộc (ít nhất 5 ký tự).
- [ ] **Step 4: Chạy test cách ly**
```powershell
npx tsx scripts/run-isolated.ts --only=test-void-completed-order
```
- [ ] **Step 5: Commit Task 5**
```powershell
git add src/services/order.service.ts src/app/api/orders/ scripts/test-void-completed-order.ts
git commit -m "feat(order): implement atomic voidCompletedOrder with full inventory rollback and audit log"
```

---

### Task 6: UI - Nút "Xem" Chi Tiết Đơn Hàng & Modal Hủy Đơn An Toàn Trong Sổ Doanh Số

**Files:**
- Modify: `src/components/sales/SalesLedgerView.tsx`
- Test: `scripts/test-sales-ledger-view-modal.ts` (mới)

- [ ] **Step 1: Viết test kiểm tra sự hiện diện của cột Thao tác và Nút "Xem"**
- [ ] **Step 2: Thêm cột Thao tác với Nút "Xem" (Eye icon) trong bảng `SalesLedgerView.tsx`**
- [ ] **Step 3: Tích hợp Modal/Drawer Chi Tiết Đơn Hàng**
  - Gọi `GET /api/orders/[id]` lấy thông tin đầy đủ.
  - Hiển thị danh sách từng đầu sách, số lượng, giá bìa, giá bán, thành tiền, quà tặng kèm, ghi chú, thông tin thu ngân, kho xuất.
- [ ] **Step 4: Tích hợp nút "Hủy đơn nhầm" trong Modal chi tiết đơn (Dành cho Quản lý / Chủ)**
  - Nút bấm màu đỏ "Hủy đơn nhầm".
  - Hộp thoại cảnh báo rủi ro (đặc biệt nếu đơn thuộc ca đã đóng hoặc ngày đã chốt).
  - Ô nhập lý do hủy bắt buộc.
  - Gọi `POST /api/orders/[id]/void`. Khi thành công: hiển thị thông báo, cập nhật lại danh sách đơn hàng và số liệu doanh số.
- [ ] **Step 5: Chạy test và xác nhận**
```powershell
npx tsx scripts/test-sales-ledger-view-modal.ts
```
- [ ] **Step 6: Commit Task 6**
```powershell
git add src/components/sales/SalesLedgerView.tsx scripts/test-sales-ledger-view-modal.ts
git commit -m "feat(sales): add view order detail modal and manager void order action"
```

---

### Task 7: Nghiệm Thu Toàn Diện & Dọn Dẹp (Pruning)

**Files:** (Toàn bộ dự án)

- [ ] **Step 1: Chạy toàn bộ test suites liên quan trên DB cách ly**
```powershell
npx tsx scripts/run-isolated.ts --only=test-void-completed-order
npx tsx scripts/run-isolated.ts --only=test-pos-cash-calculator
```
- [ ] **Step 2: Chạy kiểm tra tĩnh TypeScript**
```powershell
npx tsc --noEmit
```
- [ ] **Step 3: Chạy build ứng dụng**
```powershell
npm run build
```
- [ ] **Step 4: Chạy script nghiệm thu POS live**
```powershell
npx tsx scripts/verify-pos-live.ts
```
- [ ] **Step 5: Báo cáo kết quả và trình người dùng duyệt trước khi deploy**
- [ ] **Step 6: Dọn dẹp sạch sẽ (Pruning) sau khi hoàn tất:**
  * Hợp nhất nhánh vào `main`.
  * Xóa worktree tạm `D:\Data Project\formapubli-counter`.
  * Xóa các file test DB tạm thời (`.bak`, `.tmp`).
  * Kiểm tra `git status` sạch 100%.
