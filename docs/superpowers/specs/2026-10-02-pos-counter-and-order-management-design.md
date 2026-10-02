# Spec Thiết Kế: Cải Tiến POS Thực Chiến, Quản Trị Kho Vận & Cơ Chế Hủy Đơn An Toàn

- **Ngày tạo:** 2026-10-02
- **Tác giả:** Coordinator & Senior Architecture Team (Ponytail & Superpowers)
- **Mục tiêu:** Giải quyết triệt để 8 vấn đề phát sinh từ trải nghiệm đứng quầy thực tế của chủ doanh nghiệp: mặc định VietQR, bộ tính tiền mặt & tiền thối, ngắt trang in biên bản tồn sách A4, sửa & đổi thứ tự kho, responsive chip mobile, xem chi tiết hóa đơn và cơ chế Hủy đơn đã hoàn tất an toàn sổ sách / tồn kho.

---

## 1. Bối cảnh & Vấn đề thực chiến

Khi vận hành bán lẻ trực tiếp tại hội chợ sách và quầy giao dịch:
1. **Thanh toán VietQR phổ biến hơn tiền mặt:** Thu ngân phải tốn thêm thao tác chọn lại hình thức thanh toán cho mỗi đơn hàng.
2. **Thiếu bộ tính tiền thối (Cash Change Calculator):** Thu ngân nhận tiền mặt (mệnh giá 200k, 500k, 1M) phải nhẩm tay tiền thối, dễ gây nhầm lẫn và chậm nhịp phục vụ lúc đông khách.
3. **In ấn Biên bản chốt ngày A4 (Mục IV - Tồn sách cuối ngày):** Bảng tồn sách khi có nhiều đầu sách bị ngắt trang không chuẩn, mép bảng dính sát mép dưới trang 1 và dính sát đỉnh trang 2 do `@page margin: 0` và `.print-block` ép `break-inside: avoid`.
4. **Quản lý kho:** Chỉ có nút Ngưng hoạt động / Xóa, thiếu nút Sửa tên kho và điều chỉnh thứ tự hiển thị các kho theo độ ưu tiên (kho hội chợ lên trước).
5. **Tràn giao diện Mobile:** Dải chip bộ lọc kênh, kho xuất trên tab Doanh Số & Sổ Kép bị tràn ngang khỏi khung nhìn điện thoại.
6. **Thu ngân quét nhầm đơn:** Đơn đã bấm Hoàn tất (`COMPLETED`) bị khóa cứng, không có cách nào sửa/hủy; dẫn đến sai lệch doanh thu và tồn kho nếu nhân viên quét nhầm tiền mặt thay vì chuyển khoản.
7. **Xem hóa đơn:** Bảng danh sách đơn hàng thiếu nút xem cụ thể danh mục sách, giá bìa, chiết khấu và quà tặng của đơn đã bán.

---

## 2. Kiến trúc & Giải pháp kỹ thuật

### 2.1 POS Terminal: Chuyển khoản mặc định & Bộ tính tiền mặt
- **File:** `src/components/pos/PosCheckoutTerminal.tsx`
- **Mặc định:** `paymentMethod` khởi tạo `'BANK_TRANSFER'`.
- **Bộ tính tiền mặt:**
  * State: `cashReceived: number | ''`.
  * Gợi ý nhanh: 4 nút `200.000`, `500.000`, `1.000.000` và `Đủ tiền` (`finalAmount`).
  * Dòng hiển thị: `Tiền trả khách = cashReceived - finalAmount`.
    - Khi `cashReceived >= finalAmount`: Số tiền trả lại font mono xanh lá to rõ (`+50.000 đ`).
    - Khi `cashReceived < finalAmount` (và khác 0): Cảnh báo màu hổ phách/đỏ (`Còn thiếu: -30.000 đ`).
  * Áp dụng đồng bộ cho cả giao diện Wide (Desktop) và Mobile Checkout Sheet.
  * Tự động reset `cashReceived` khi đổi đơn hoặc hoàn tất đơn.

### 2.2 In ấn Biên bản chốt ngày A4 (Mục IV - Tồn sách cuối ngày)
- **File:** `src/components/pos/DailyFairSettlementModal.tsx`
- **Sửa đổi CSS `@media print`:**
  * Cấu hình `@page { size: A4 portrait; margin: 12mm 10mm !important; }`.
  * Đặt padding của `#printable-settlement-report` về `0` khi in để lề trang do `@page` quản lý đồng nhất trên mọi trang in.
  * Tách riêng bảng Mục IV: cho phép `break-inside: auto;`, bảng `thead { display: table-header-group; }` để lặp lại tiêu đề khi sang trang mới, và các dòng `tr { break-inside: avoid; page-break-inside: avoid; }`.

### 2.3 Quản lý Kho Vận: Sửa tên kho & Thay đổi vị trí (Thứ tự)
- **Database Schema:** Bổ sung cột `sortOrder: integer('sort_order').default(0)` vào bảng `warehouses` (`src/db/schema.ts`).
- **Backend Service:**
  * `WarehouseService.updateWarehouse` hỗ trợ cập nhật `sortOrder` và `name`.
  * `WarehouseService.listAll` và `listSellable` sắp xếp `ORDER BY sort_order ASC, name ASC`.
- **UI:** Trong `src/components/inventory/WarehouseManagerPanel.tsx`:
  * Bổ sung nút "Sửa" inline mở form sửa tên kho (gọi `PATCH /api/warehouses/[id]`).
  * Bổ sung nút mũi tên Lên (▲) / Xuống (▼) để Quản lý hoán đổi vị trí hiển thị giữa các kho.
  * Chuẩn hóa 100% nhãn nút sang tiếng Việt có dấu ("Sửa", "Xóa", "Ngưng hoạt động", "Mở lại", "Lưu", "Hủy").

### 2.4 Responsive Mobile: Chip bộ lọc
- **Files:** `src/components/sales/SalesLedgerView.tsx`, `src/components/sales/PendingOrdersView.tsx`
- Bổ sung `flex-wrap`, container cuộn ngang mượt mà (`overflow-x-auto no-scrollbar`), co giãn `min-w-0 flex-1` cho các select và dải chip: `Tất cả kho xuất`, `Tất cả kênh`, `Tất cả các kho`.

### 2.5 Nút "Xem" chi tiết đơn hàng
- **File:** `src/components/sales/SalesLedgerView.tsx`
- Bổ sung cột "Thao tác" với nút "Xem" (icon Eye) trên từng dòng đơn hàng.
- Bấm "Xem" mở Modal/Drawer hiển thị chi tiết hóa đơn (mã đơn, thu ngân, khách hàng, thời gian, kênh, hình thức thanh toán, chiết khấu, danh sách từng đầu sách kèm số lượng/giá bán, quà tặng kèm, ghi chú) - tái sử dụng `GET /api/orders/[id]`.

### 2.6 Hủy đơn hàng đã hoàn tất (Void Completed Order) — Trọng tâm Kế toán & Tồn kho
- **Nguyên tắc cốt lõi:**
  1. **Không DELETE vật lý dòng `orders`**: Cập nhật `orders.status = 'CANCELLED'`.
  2. **Bảo toàn Thẻ kho bất biến (Append-Only):** Gọi `InventoryService.recordMovementsBatch` với `eventType = 'RETURN_INBOUND'`, `quantityDelta = +quantity` cho **CẢ sách bán VÀ các quà tặng kèm (`isGiftLine`)**.
  3. **Atomic Transaction (`db.transaction`):** Đổi status + hoàn kho + trừ tiền két + ghi audit log nằm trong cùng 1 transaction. Nếu bất kỳ bước nào lỗi, rollback toàn bộ.
  4. **Quy tắc bảo vệ Ca Két & Chốt Sổ:**
     - `ROLE_CASHIER`: Cấm tuyệt đối.
     - `ROLE_MANAGER`: Chỉ được hủy đơn thuộc ca két đang `OPEN`.
     - `ROLE_OWNER`: Được phép duyệt hủy cả đơn thuộc ca đã `CLOSED` hoặc ngày đã chốt, nhưng hệ thống bắt buộc hiển thị hộp thoại xác nhận cảnh báo đỏ nguy cơ lệch Biên bản chốt ngày đã ký.
  5. **Audit Trail:** Bắt buộc nhập lý do hủy (tối thiểu 5 ký tự) và ghi nhận vào `audit_logs` (`action = 'ORDER_VOIDED'`).

---

## 3. Kế hoạch kiểm thử & Tiêu chí nghiệm thu

1. **Unit & Integration Test:**
   - Tạo file test độc lập `scripts/test-void-completed-order.ts` chạy trên DB cách ly (`formapubli_test.db` qua `scripts/run-isolated.ts`):
     * Test 1: Hủy đơn tiền mặt ca OPEN -> status CANCELLED, thẻ kho tăng đúng số lượng, tồn kho `stock_balances` tăng lại.
     * Test 2: Hủy đơn có quà tặng kèm -> quà tặng cũng được hoàn trả kho.
     * Test 3: Cashier thường gọi API hủy -> bị từ chối 403 Forbidden.
     * Test 4: Hủy đơn ca CLOSED bởi Manager -> bị từ chối 409 Conflict; bởi Owner -> thành công kèm audit log.
   - Tạo file test `scripts/test-warehouse-reorder.ts`: kiểm tra API sửa tên và đổi thứ tự kho.
2. **Quality Gates:**
   - `npx tsc --noEmit` đạt 0 lỗi.
   - `npm run build` thành công không cảnh báo lỗi OpenNext / Cloudflare.
   - `npx tsx scripts/verify-pos-live.ts` xác nhận luồng quầy bán hàng hoạt động bình thường.
