# POS, Warehouse Refactor & Delivery Orders (Sprint 1 UI, Sprint 3, Sprint 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện 100% các phân hệ còn lại của Formapubli OS theo đặc tả V4: Giao diện chuyển kho hàng loạt cho Thủ kho (Sprint 1 UI), Cơ chế phê duyệt chiết khấu bảo mật bằng Bound TOTP/QR kèm State Machine (Sprint 3), Phân hệ Bán buôn Đại lý và in Phiếu Xuất Kho A4 bất biến (Sprint 3), và Báo cáo chốt ngày hội chợ đối soát kiểm kê tồn kệ mang về (Sprint 4).

**Architecture:** Drizzle ORM quản lý bảng `discount_approval_requests`, `delivery_orders`, `delivery_order_items`. Cơ chế duyệt chiết khấu kết hợp State Machine với mã băm chuẩn hóa `generateCanonicalCartHash` và chữ ký HMAC-SHA256 native qua Web Crypto API. Phân hệ bán buôn cấp số `PXK-YYYY-XXXX` liên tục từ `document_sequences` trong cùng transaction với thẻ kho `DISPATCH_SALE`.

**Tech Stack:** Next.js 14 (App Router), TypeScript 5.5, Tailwind CSS, Lucide React, Drizzle ORM, SQLite / LibSQL / Cloudflare D1.

**Spec:** `docs/superpowers/specs/2026-09-22-pos-warehouse-refactor-design-V4.md`

## Global Constraints

- Không thêm bất kỳ thư viện npm nặng nề bên ngoài (giữ nguyên quy tắc zero-dependency / native platform).
- Toàn bộ thao tác ghi thẻ kho và cấp mã chứng từ bắt buộc chạy trong `db.transaction()` và bọc `withDbRetry`.
- Tuyệt đối cấm gõ mật khẩu tài khoản Quản lý lên màn hình máy thu ngân.
- Phiếu xuất kho sau khi ký chuyển sang `DISPATCHED_LOCKED` bất biến, mọi sửa đổi phải qua phiếu đảo `PXK_R`.
- Tất cả kiểm thử bắt buộc chạy trên DB cô lập (`formapubli_test.db` hoặc file test riêng), không đụng chạm prod.

## Review Focus

1. **TOCTOU khi chuyển kho hàng loạt:** Dữ liệu tồn kho biến động giữa lúc mở modal và lúc bấm xác nhận chuyển kho phải được bắt bằng HTTP 409 và trả về `staleItems` để UI cập nhật lại 1-chạm mà không làm mất form.
2. **Gian lận sửa giỏ sau khi duyệt chiết khấu:** Thu ngân thay đổi bất kỳ sản phẩm hoặc số lượng nào sau khi đã được duyệt 25% phải làm `cartHash` thay đổi và tự động vô hiệu hóa yêu cầu duyệt cũ (`SUPERSEDED`).
3. **Trùng số chứng từ khi nhiều người cùng xuất kho:** Cấp số `PXK-2026-XXXX` phải thực thi atomic trong cùng transaction ghi phiếu, không dùng `MAX(id)+1`.
4. **Mất mạng tại hội chợ (Offline Fallback):** Quầy POS khi rớt mạng vẫn cho phép dùng mã khẩn cấp trong ngày (`OFFLINE_EMERGENCY`) đã cấp đầu ca và lưu đơn vào IndexedDB.
5. **Chênh lệch kiểm kê sách cuối ngày:** Báo cáo chốt ngày phải đối chiếu Tồn lý thuyết trên máy tính với Tồn thực tế đếm được trên kệ trước khi đóng thùng mang về.

---

### Task 1: Giao diện Chuyển Kho Hàng Loạt Cho Thủ Kho (MultiItemTransferModal)

**Files:**
- Create: `src/components/inventory/BatchTransferModal.tsx`
- Modify: `src/components/StockOverviewMatrix.tsx` (tích hợp nút mở modal chuyển hàng loạt)
- Test: `scripts/test-batch-transfer-ui.ts`

**Interfaces:**
- Consumes: `/api/inventory/transfer-batch/validate`, `/api/inventory/transfer-batch`, `WarehouseService.listSellable()`
- Produces: `BatchTransferModal` component hỗ trợ chọn N ấn bản, kiểm tra tồn trước (pre-validation), cảnh báo dòng thiếu màu đỏ, nút "Hạ về tồn tối đa" 1-chạm và gửi lệnh chuyển kho.

- [ ] **Step 1: Viết test kịch bản API validate và commit từ giao diện**
  Tạo `scripts/test-batch-transfer-ui.ts` kiểm thử luồng validate và commit có đầy đủ `idempotencyKey`.

- [ ] **Step 2: Chạy test để xác nhận trạng thái**
  Chạy `npx tsx scripts/test-batch-transfer-ui.ts`.

- [ ] **Step 3: Xây dựng Component `BatchTransferModal.tsx`**
  Tạo component cho phép:
  - Chọn Kho nguồn và Kho đích (chỉ hiển thị kho hoạt động).
  - Chọn nhiều ấn bản từ danh mục kèm ô nhập số lượng.
  - Nút *"Kiểm tra tồn kho"*: Gọi API `/validate`, nếu có dòng thiếu thì tô đỏ dòng đó kèm số tồn thực tế và hiện nút *"Hạ về tồn tối đa"*.
  - Nút *"Xác nhận chuyển kho"*: Sinh `idempotencyKey` và gọi API `/transfer-batch`, hiển thị mã `PCK-YYYY-XXXX` khi thành công.

- [ ] **Step 4: Tích hợp vào `StockOverviewMatrix.tsx`**
  Thêm nút *"Chuyển kho hàng loạt"* trên thanh công cụ Quản lý Kho, mở `BatchTransferModal`.

- [ ] **Step 5: Kiểm thử và commit**
  Chạy `npm run build` và commit code.

---

### Task 2: Database Schema & Migration Sprint 3 (Discount Approvals & Delivery Orders)

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/db/migrations/0019_sprint3_approvals_and_pxk.sql`
- Modify: `scripts/setup-test-db.ts`
- Test: `scripts/test-s3-schema.ts`

**Interfaces:**
- Produces: 
  - Bảng `discount_approval_requests` (`id`, `order_code`, `warehouse_id`, `cashier_id`, `cart_hash`, `cart_snapshot`, `requested_discount_rate`, `status`, `approved_by`, `approval_method`, `nonce`, `expires_at`, `version`).
  - Bảng `delivery_orders` (`id`, `code`, `partner_id`, `from_warehouse_id`, `subtotal`, `discount_rate`, `final_amount`, `fiscal_scope`, `status`, `reversal_of`, `created_by`, `dispatched_by`, `dispatched_at`).
  - Bảng `delivery_order_items` (`id`, `delivery_order_id`, `edition_id`, `quantity`, `unit_cover_price`, `unit_selling_price`, `total_amount`).

- [ ] **Step 1: Khai báo bảng mới trong `src/db/schema.ts`**
  Thêm 3 bảng theo đúng đặc tả V4.

- [ ] **Step 2: Tạo migration SQL `0019_sprint3_approvals_and_pxk.sql` và cập nhật journal**
  Viết câu lệnh DDL an toàn cho SQLite/D1.

- [ ] **Step 3: Cập nhật `setup-test-db.ts`**
  Thêm các bảng mới vào danh sách dọn dẹp và khởi tạo.

- [ ] **Step 4: Viết và chạy test `scripts/test-s3-schema.ts`**
  Xác nhận bảng được tạo thành công và query không lỗi.

- [ ] **Step 5: Commit**

---

### Task 3: Backend Service & API Duyệt Chiết Khấu (Approval Engine)

**Files:**
- Create: `src/services/discount-approval.service.ts`
- Create: `src/app/api/pos/discount-approvals/route.ts`
- Create: `src/app/api/pos/discount-approvals/[id]/route.ts`
- Test: `scripts/test-s3-discount-approval.ts`

**Interfaces:**
- Produces:
  - `generateCanonicalCartHash(items, discountRate, warehouseId, orderCode)`: Băm SHA-256 giỏ hàng.
  - `createRequest(...)`: Tạo yêu cầu duyệt ở trạng thái `PENDING` kèm TTL 5 phút.
  - `approveRequest(...)`: Duyệt bằng Session Manager / QR JWT / ShortCode bound TOTP.
  - `consumeApproval(...)`: Đánh dấu `CONSUMED` khi thanh toán thành công.

- [ ] **Step 1: Viết test `scripts/test-s3-discount-approval.ts`**
  Kiểm thử:
  - Tạo request sinh đúng TTL 5 phút.
  - Duyệt thành công chuyển sang `APPROVED`.
  - Giỏ hàng đổi làm hash đổi → request cũ bị `SUPERSEDED`.
  - Quá hạn 5 phút query tự nhận `EXPIRED` (Lazy Expiration).

- [ ] **Step 2: Xây dựng `DiscountApprovalService`**
  Thực thi các hàm nghiệp vụ bám sát đặc tả V4.

- [ ] **Step 3: Xây dựng các API Routes**
  - `POST /api/pos/discount-approvals`: Thu ngân gửi yêu cầu duyệt.
  - `GET /api/pos/discount-approvals`: Quản lý lấy danh sách đơn cần duyệt / Thu ngân kiểm tra trạng thái đơn của mình.
  - `POST /api/pos/discount-approvals/[id]`: Quản lý duyệt/từ chối (chỉ cho phép `ROLE_MANAGER` hoặc `ROLE_OWNER`).

- [ ] **Step 4: Chạy test và commit**

---

### Task 4: Phân Hệ Bán Buôn Đại Lý & Phiếu Xuất Kho (PXK Service & API)

**Files:**
- Create: `src/services/delivery-order.service.ts`
- Create: `src/app/api/delivery-orders/route.ts`
- Create: `src/app/api/delivery-orders/[id]/route.ts`
- Test: `scripts/test-s3-delivery-orders.ts`

**Interfaces:**
- Produces:
  - `createDraft(...)`: Lập phiếu xuất bán sỉ đại lý ở trạng thái `DRAFT`.
  - `dispatchAndLock(...)`: Cấp số `PXK-YYYY-XXXX` từ `document_sequences`, trừ kho bằng `DISPATCH_SALE`, khóa cứng `DISPATCHED_LOCKED`.
  - `reverse(...)`: Lập phiếu đối ứng `PXK_R-YYYY-XXXX`, hoàn kho bằng `RECEIPT_RETURN`, đánh dấu `VOIDED_REVERSED`.

- [ ] **Step 1: Viết test `scripts/test-s3-delivery-orders.ts`**
  Kiểm thử cấp số liên tục, tính toán tiền hàng, xuất kho trừ đúng số lượng và quy trình đảo bút toán.

- [ ] **Step 2: Xây dựng `DeliveryOrderService`**
  Thực thi đầy đủ các quy tắc kế toán và kiểm toán bất biến.

- [ ] **Step 3: Xây dựng API Routes `/api/delivery-orders`**
  Hỗ trợ tạo phiếu, duyệt xuất kho và in ấn.

- [ ] **Step 4: Chạy test và commit**

---

### Task 5: Tích Hợp UI POS: Duyệt Chiết Khấu Thông Minh & Thay Thế PIN Cũ

**Files:**
- Create: `src/components/pos/DiscountApprovalModal.tsx`
- Create: `src/components/pos/ManagerApprovalDrawer.tsx`
- Modify: `src/components/pos/PosCheckoutTerminal.tsx`

**Interfaces:**
- Consumes: `/api/pos/discount-approvals`
- Replaces: Modal PIN quản lý tĩnh cũ bằng luồng duyệt hiện đại:
  - Thu ngân: Gửi duyệt, màn hình hiện mã QR và ShortCode 4 số, tự động poll trạng thái mỗi 3s (dừng sau 5 phút).
  - Quản lý: Có thanh thông báo / drawer duyệt nhanh 1-chạm hoặc quét QR từ điện thoại.
  - Quản lý tại quầy: Hỗ trợ nhập mã khẩn cấp `OFFLINE_EMERGENCY`.

- [ ] **Step 1: Xây dựng `DiscountApprovalModal.tsx` cho quầy POS**
  Hiển thị trạng thái đang chờ duyệt, mã QR cho quản lý quét, mã ShortCode 4 số, nút hủy yêu cầu.

- [ ] **Step 2: Xây dựng `ManagerApprovalDrawer.tsx` cho Quản lý**
  Dành cho vai trò `ROLE_MANAGER` / `ROLE_OWNER` hiển thị các yêu cầu đang chờ duyệt, bấm 1 chạm để duyệt hoặc từ chối kèm lý do.

- [ ] **Step 3: Cập nhật `PosCheckoutTerminal.tsx`**
  Gỡ bỏ modal nhập mã PIN cũ, tích hợp `DiscountApprovalModal`. Khi thanh toán thành công, gọi `consumeApproval`.

- [ ] **Step 4: Kiểm thử giao diện và commit**

---

### Task 6: Giao Diện Bán Buôn Kho & Mẫu In Phiếu Xuất Kho A4

**Files:**
- Create: `src/components/inventory/WholesaleDispatchModal.tsx`
- Create: `src/components/inventory/DeliveryReceiptPrint.tsx`
- Modify: `src/components/StockOverviewMatrix.tsx`

**Interfaces:**
- Consumes: `/api/delivery-orders`
- Produces: Giao diện lập lệnh xuất kho bán buôn cho đại lý, bảng tính chiết khấu sỉ 35-50%, mẫu in A4 chuẩn kế toán có 4 chữ ký và mã QR tra cứu.

- [ ] **Step 1: Xây dựng Component `WholesaleDispatchModal.tsx`**
  Chọn đối tác đại lý, chọn kho xuất, chọn sách và số lượng sỉ, chiết khấu đại lý.

- [ ] **Step 2: Xây dựng Mẫu in A4 `DeliveryReceiptPrint.tsx`**
  Sử dụng chuẩn CSS `@media print` A4 đẹp mắt, hiển thị bảng kê chi tiết, chữ ký Thủ kho, Người giao, Đại lý nhận.

- [ ] **Step 3: Tích hợp vào menu Quản lý Kho**
  Thêm nút *"Xuất Bán Buôn Đại Lý"* và tab *"Sổ Phiếu Xuất Kho (PXK)"*.

- [ ] **Step 4: Kiểm thử và commit**

---

### Task 7: Báo Cáo Chốt Ngày Hội Chợ & Đối Soát Kiểm Kê (Sprint 4)

**Files:**
- Create: `src/components/pos/DailyFairSettlementModal.tsx`
- Create: `src/app/api/pos/daily-settlement/route.ts`
- Modify: `src/components/pos/PosCheckoutTerminal.tsx`
- Test: `scripts/test-s4-settlement.ts`

**Interfaces:**
- Consumes: `/api/pos/catalog`, `/api/orders`, `/api/cashbox`
- Produces: Báo cáo chốt ngày hội chợ tích hợp:
  - Đối soát két tiền: Tiền mặt lý thuyết vs thực đếm.
  - Đối soát tồn sách: Tồn nhận ban đầu - Số bán POS = Tồn lý thuyết trên kệ. So sánh với Tồn thực tế đếm được trước khi đóng thùng mang về.
  - Phân tích cơ cấu tiền mặt vs QR chuyển khoản.
  - Cảnh báo tỷ lệ chiết khấu bình quân ca nếu > 12%.

- [ ] **Step 1: Viết test `scripts/test-s4-settlement.ts`**
  Kiểm thử tính toán chênh lệch két tiền và chênh lệch kiểm đếm tồn kho.

- [ ] **Step 2: Viết API `/api/pos/daily-settlement`**
  Tổng hợp số liệu ngày làm việc của kho hội chợ.

- [ ] **Step 3: Xây dựng UI `DailyFairSettlementModal.tsx`**
  Giao diện chốt ngày có form nhập kiểm kê kệ sách, xuất bản in K80 hoặc A4 chốt ngày.

- [ ] **Step 4: Chạy toàn bộ test suite và commit**
