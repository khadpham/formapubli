# Kế Hoạch Triển Khai: Loại Bỏ Quà Tặng Kèm Khỏi Tất Cả Các Bảng Top Bán Chạy

> **Mục tiêu:** Phân biệt rạch ròi giữa Quà tặng kèm (Bookmark, quà khuyến mại, quà 0đ) và Sản phẩm bán hàng thực tế. Loại bỏ 100% quà tặng kèm khỏi tất cả các bảng Top bán chạy trên toàn hệ thống, đồng thời đảm bảo số lượng tồn kho trong kiểm kê đóng thùng vẫn được trừ chính xác.
>
> **Nhánh Git:** `fix/exclude-gifts-from-top-sellers`  
> **Ngày lập:** 02/10/2026

---

## Danh Sách Các Bảng Đã Rà Soát & Khắc Phục

1. [x] **Báo cáo Chốt Ngày & Bản In (`daily-settlement.service.ts` & `DailyFairSettlementModal.tsx`)**:
   - Hiện trạng: Bookmark đứng Top 1 vì chưa lọc `isGiftLine = 1` và `totalAmount = 0`.
   - Khắc phục: Lọc bỏ dòng quà tặng khỏi `topSellers`, bổ sung trả về `giftSummary` (thống kê quà tặng đã phát).
2. [x] **Tab Doanh Số - Sách Bán Chạy (`TopEditionsPanel.tsx`)**:
   - Hiện trạng: Chưa truyền `excludeGifts: '1'` khi gọi API.
   - Khắc phục: Bổ sung `excludeGifts: '1'`.
3. [x] **API Phân Tích Bán Chạy (`analytics.service.ts` & `/api/analytics`)**:
   - Hiện trạng: `excludeGifts` mặc định là `false`.
   - Khắc phục: Đổi mặc định sang `true` (luôn loại trừ quà tặng, trừ khi client cố tình truyền `0`).
4. [x] **Giám Sát Hội Chợ Lúc Này (`LiveFairMonitorModal.tsx` & `/api/pos/live-monitor`)**:
   - Hiện trạng: Query Top 5 chưa lọc `orderItems.isGiftLine = 0`.
   - Khắc phục: Bổ sung `eq(orderItems.isGiftLine, false)` và `gt(orderItems.totalAmount, 0)`.
5. [x] **AI Copilot Tra Cứu Top Sách Bán Chạy (`executive-query.service.ts`)**:
   - Hiện trạng: Chưa lọc `orderItems.isGiftLine = 0`.
   - Khắc phục: Bổ sung điều kiện lọc dòng quà tặng.

---

## Chi Tiết Các Bước Triển Khai (Tasks)

### Task 1: Viết Test Giả Lập & Chứng Minh Lỗi (TDD Red -> Green)
- [x] Tạo `scripts/test-exclude-gifts-from-top.ts`
- [x] Chạy Red phase: Xác nhận Bookmark quà tặng bị lọt vào top 1 (Fail).
- [x] Chạy Green phase sau khi sửa: 11/11 checks PASS.

### Task 2: Nâng Cấp `daily-settlement.service.ts`
- [x] `isGiftLine` và `unitSellingPrice` được thêm vào select `lineItems`.
- [x] `soldQtyAll`: Giữ nguyên tính đủ số lượng xuất/tặng để kiểm kê đóng thùng trừ đúng tồn kho thực tế.
- [x] `topSellers`: Chỉ gom các sản phẩm bán có thu tiền (`!item.isGiftLine && item.totalAmount > 0 && item.unitSellingPrice > 0`).
- [x] `giftSummary`: Gom riêng quà tặng đã phát `{ totalGiftCopies, items }`.

### Task 3: Nâng Cấp `DailyFairSettlementModal.tsx`
- [x] Bảng Top 10 bán chạy sạch sẽ 100%, không dính quà tặng.
- [x] Hiển thị dòng ghi chú quà tặng kèm đã phát (kèm số lượng từng món quà).
- [x] Bản in biên bản chốt ngày có thêm ghi chú số lượng quà tặng kèm đã phát.

### Task 4: Rà Soát & Chuẩn Hóa Tất Cả Các Endpoint & Component Khác
- [x] `src/services/analytics.service.ts`: `excludeGifts = true` làm mặc định; thêm điều kiện `totalAmount > 0`.
- [x] `src/app/api/analytics/route.ts`: Mặc định `excludeGifts = true`.
- [x] `src/components/sales/TopEditionsPanel.tsx`: Truyền `excludeGifts: '1'`.
- [x] `src/app/api/pos/live-monitor/route.ts`: Thêm `eq(orderItems.isGiftLine, false)` và `gt(orderItems.totalAmount, 0)`.
- [x] `src/services/executive-query.service.ts`: Thêm `eq(orderItems.isGiftLine, false)` và `gt(orderItems.totalAmount, 0)`.

### Task 5: Chạy Toàn Bộ Test Suite & Nghiệm Thu
- [x] `scripts/test-exclude-gifts-from-top.ts`: PASS (11/11).
- [x] `scripts/test-settlement-goods-display.ts`: PASS (11/11).
- [x] `scripts/test-settlement-ui.ts`: PASS (29/29).
- [x] `scripts/test-stock-sorting-ui.ts`: PASS (5/5).
- [x] `npx tsc --noEmit`: 0 lỗi.
