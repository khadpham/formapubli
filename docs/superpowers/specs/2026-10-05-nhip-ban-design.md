# Nhịp Bán — timeline bán ra của 1 sản phẩm trong kỳ

Ngày: 2026-10-05. Nguồn: yêu cầu chủ (theo dõi thời điểm bán từng món trong
campaign + insight cho Chủ).

## 1. Tên + vị trí (đã duyệt)

- Tên: **"Nhịp Bán"**, phụ đề "từng thời điểm bán ra của 1 sản phẩm trong kỳ".
- Không tab mới, không nhét dashboard. Drawer 2 tầng mở từ: dòng Sách Bán Chạy
  (tab Doanh Số) + nút "Nhịp Bán" trong Báo Cáo Kỳ (khoảng kỳ của modal).
- Tầng 1: danh sách TOÀN BỘ món có bán trong kỳ (top-editions top=100 — campaign
  thực tế không quá 100 SKU; vượt thì hiện đúng 100 + nhãn) + ô tìm mã/tên/ISBN.
  Bấm dòng top thì vào thẳng tầng 2. Món 0 đơn: mở được từ tìm kiếm, hiện "chưa
  bán trong kỳ" + tồn hiện tại.

## 2. API (đọc, OWNER/MANAGER như analytics cũ)

- `GET /api/analytics?view=product-timeline&productId=&startDate&endDate&warehouseId`
  → `{ product: {id, code, title}, buckets: [{date, qty, revenue, orders}],
  events: [{createdAt, qty, orderId, orderCode, channel}], totals: {qty, revenue, orders, activeDays} }`.
  Events mới nhất trước, tối đa 200. Chỉ đơn COMPLETED (PENDING chưa phải bán).
- SSOT ngày VN: `createdAtBetween` + khóa ngày như settlement (không cắt chuỗi).

## 3. UI drawer (1 file `ProductFlowDrawer.tsx`)

1. Đầu: mã + tên + 4 số (tổng cuốn, doanh thu, số đơn, số ngày có bán).
2. Cột theo ngày (kỳ 1 ngày thì theo giờ), gạt cuốn/tiền — div thuần, không lib.
3. Dòng sự kiện: giờ, cuốn, kho, kênh; bấm mã đơn mở OrderDetailModal (có sẵn).
4. Insight tự tính client (`buildFlowInsights` pure trong `src/lib/product-flow.ts`):
   ngày/giờ đỉnh, % hội chợ vs văn phòng (theo warehouseId so với kho mở),
   kênh mạnh nhất, tốc độ cuốn/ngày, ngày im ắng đầu-cuối.

## 4. Kiểm thử

- Suite `test-product-flow.ts`: pure insights runtime + timeline service trên DB
  cách ly (seed 2 đơn như test-settlement-range) + regex drawer/điểm vào.
- tsc + suite analytics cũ (`test-analytics-doanhso`).
