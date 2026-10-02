# Kế Hoạch Triển Khai: Loại Bỏ Quà Tặng Kèm Khỏi Tất Cả Các Bảng Top Bán Chạy

> **Mục tiêu:** Phân biệt rạch ròi giữa Quà tặng kèm (Bookmark, quà khuyến mại, quà 0đ) và Sản phẩm bán hàng thực tế. Loại bỏ 100% quà tặng kèm khỏi tất cả các bảng Top bán chạy trên toàn hệ thống, đồng thời đảm bảo số lượng tồn kho trong kiểm kê đóng thùng vẫn được trừ chính xác.
>
> **Nhánh Git:** `fix/exclude-gifts-from-top-sellers`  
> **Ngày lập:** 02/10/2026

---

## Danh Sách Các Bảng Cần Rà Soát & Khắc Phục

1. **Báo cáo Chốt Ngày & Bản In (`daily-settlement.service.ts` & `DailyFairSettlementModal.tsx`)**:
   - Hiện trạng: Bookmark đứng Top 1 vì chưa lọc `isGiftLine = 1` và `totalAmount = 0`.
   - Khắc phục: Lọc bỏ dòng quà tặng khỏi `topSellers`, bổ sung trả về `giftsGiven` (thống kê quà tặng đã phát).
2. **Tab Doanh Số - Sách Bán Chạy (`TopEditionsPanel.tsx`)**:
   - Hiện trạng: Chưa truyền `excludeGifts: '1'` khi gọi API.
   - Khắc phục: Bổ sung `excludeGifts: '1'`.
3. **API Phân Tích Bán Chạy (`analytics.service.ts` & `/api/analytics`)**:
   - Hiện trạng: `excludeGifts` mặc định là `false`.
   - Khắc phục: Đổi mặc định sang `true` (luôn loại trừ quà tặng, trừ khi client cố tình truyền `0`).
4. **Giám Sát Hội Chợ Lúc Này (`LiveFairMonitorModal.tsx` & `/api/pos/live-monitor`)**:
   - Hiện trạng: Query Top 5 chưa lọc `orderItems.isGiftLine = 0`.
   - Khắc phục: Bổ sung `eq(orderItems.isGiftLine, false)` và `gt(orderItems.totalAmount, 0)`.
5. **AI Copilot Tra Cứu Top Sách Bán Chạy (`executive-query.service.ts`)**:
   - Hiện trạng: Chưa lọc `orderItems.isGiftLine = 0`.
   - Khắc phục: Bổ sung điều kiện lọc dòng quà tặng.

---

## Chi Tiết Các Bước Triển Khai (Tasks)

### Task 1: Viết Test Giả Lập & Chứng Minh Lỗi (TDD Red)
- **Tạo:** `scripts/test-exclude-gifts-from-top.ts`
- **Nội dung test:**
  1. Tạo 1 đơn hàng gồm: 1 cuốn Sách A (mua 1 cuốn, 100.000đ), 1 cuốn Sách B (mua 2 cuốn, 200.000đ), và 1 Bookmark (tặng kèm 10 chiếc, `isGiftLine = true`, giá 0đ).
  2. Gọi `DailySettlementService.getDailyFairSettlement`:
     - Kiểm tra `topSellers`: Bookmark **KHÔNG ĐƯỢC** có mặt trong `topSellers`. Vị trí số 1 phải là Sách B (2 cuốn), vị trí số 2 là Sách A (1 cuốn).
     - Kiểm tra `inventoryReconciliation`: Bookmark vẫn phải được trừ đúng 10 chiếc trong tồn kho (`soldToday = 10`).
     - Kiểm tra `giftsGiven`: Ghi nhận đúng 10 Bookmark đã tặng.
  3. Kiểm tra `AnalyticsService.topEditions`:
     - Mặc định Bookmark không xuất hiện trong danh sách bán chạy.

---

### Task 2: Nâng Cấp `daily-settlement.service.ts`
- **Modify:** `src/services/daily-settlement.service.ts`
- **Nội dung:**
  - Trong `lineItems` select: Bổ sung `isGiftLine: orderItems.isGiftLine`, `unitSellingPrice: orderItems.unitSellingPrice`.
  - Phân tách 2 luồng:
    * `soldQtyAll`: Tiếp tục cộng dồn tất cả để kiểm kê đóng thùng trừ đúng tồn kho thực tế.
    * `topSellers`: Chỉ cộng dồn các món thỏa mãn `!item.isGiftLine && Number(item.totalAmount) > 0 && Number(item.unitSellingPrice) > 0`.
    * `giftsGiven`: Gom riêng các món quà tặng để trả về cấu trúc `{ totalGiftCopies, items: Array<{ code, title, copies }> }`.

---

### Task 3: Nâng Cấp `DailyFairSettlementModal.tsx`
- **Modify:** `src/components/pos/DailyFairSettlementModal.tsx`
- **Nội dung:**
  - Bảng "Top 10 Ấn Phẩm Bán Chạy Nhất Tại Gian Hàng": Hiển thị sạch sẽ, không có sản phẩm quà tặng 0đ nào.
  - Thêm một badge/dòng tóm tắt nhỏ: "Đã tặng kèm {totalGiftCopies} phần quà khuyến mại" để quản lý nắm được số lượng quà đã phát.
  - Trong bản in (printable view): Hiển thị danh sách Top 10 chuẩn xác, nếu có quà tặng thì có thêm dòng ghi chú số lượng quà tặng đã phát.

---

### Task 4: Rà Soát & Chuẩn Hóa Tất Cả Các Endpoint & Component Khác
- **Modify:**
  - `src/services/analytics.service.ts`: `excludeGifts = true` làm mặc định; thêm điều kiện `totalAmount > 0`.
  - `src/app/api/analytics/route.ts`: Mặc định `excludeGifts = true` nếu không truyền `excludeGifts=0`.
  - `src/components/sales/TopEditionsPanel.tsx`: Truyền `excludeGifts: '1'`.
  - `src/app/api/pos/live-monitor/route.ts`: Thêm `eq(orderItems.isGiftLine, false)` và `gt(orderItems.totalAmount, 0)`.
  - `src/services/executive-query.service.ts`: Thêm `eq(orderItems.isGiftLine, false)` và `gt(orderItems.totalAmount, 0)`.

---

### Task 5: Chạy Toàn Bộ Test Suite & Nghiệm Thu
- Chạy:
  * `npx tsx scripts/test-exclude-gifts-from-top.ts`
  * `npx tsx scripts/test-settlement-goods-display.ts`
  * `npx tsx scripts/test-settlement-ui.ts`
  * `npx tsx scripts/test-stock-sorting-ui.ts`
  * `npx tsc --noEmit`
- Yêu cầu: Tất cả bài test đều XANH, không có bất kỳ regression nào.
- Code Review & Báo cáo trước khi deploy.
