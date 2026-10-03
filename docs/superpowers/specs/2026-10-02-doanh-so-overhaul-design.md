# Spec: Overhaul tab Doanh Số & Sổ Kép (nguồn số liệu chung)

- Ngày: 2026-10-02 · Phạm vi B mở rộng (tab Doanh Số + ExecutiveDashboard/digest, chung tầng dữ liệu)
- Cách B (gom tầng dữ liệu chung trước) · Trạng thái: đã duyệt thiết kế, chờ plan
- Không đụng: đơn W (giữ PENDING), so chuỗi thô ở digest/query (latent, 0/117 dòng ảnh hưởng)

## 1. Vấn đề (bằng chứng)

Ba họ lỗi gốc, đo được từ 3 luồng rà soát độc lập (~70 mục):

1. Mỗi panel tự fetch + tự tính theo luật riêng ⇒ số không khớp nhau. Nặng nhất:
   `RevenueAnalyticsPanel.tsx:43-45` không gửi ngày/kho (số toàn lịch sử đặt cạnh bảng lọc);
   `analytics.service.ts:31-35` trộn 2 sổ (tiền thật);
   summary server bị bỏ qua, client cộng lại thiếu luật loại trừ (`SalesLedgerView.tsx:167-171`).
2. Summary và danh sách không cùng tập đơn: summary ép `COMPLETED` + loại `SPONSORSHIP`
   (`order.service.ts:1969,1972`), danh sách lấy theo query `status` (`api/orders/route.ts:113`
   không truyền status cho summary).
3. Nhãn cứng trong khi kho hội chợ sinh động: kho lạ in "Kho Quỳnh Mai"
   (`SalesLedgerView.tsx:565-570`), kênh in mã thô, giờ hiện UTC nhưng lọc ngày VN (`:624`).

Đính chính: nghi "2 họ timestamp" đã kiểm production — 0/117 đơn non-Z, 0 NULL.
Các chỗ so chuỗi thô ở digest/query là rủi ro tiềm ẩn, KHÔNG phải lỗi sống, không sửa đợt này.

## 2. Mục tiêu nghiệm thu

1. Một nguồn số liệu cho cả tab: cùng tập đơn, cùng ngày VN, cùng luật loại trừ.
2. Mọi con số trên màn hình cộng tay lại được; CSV khớp màn hình (đủ cột, actor thật, ngày VN).
3. Tên kho/kênh/giờ đúng; quyền đúng vai (thu ngân/kế toán/thủ kho không thấy hộp lỗi).
4. Mỗi họ lỗi có 1 test khóa; `tsc` + build sạch; không hạ assertion.

## 3. Kiến trúc: tầng dữ liệu chung

### 3.1 Client — một filter, fetch đúng nguồn

- Filter duy nhất ở cấp tab: ngày VN (từ/đến), kho, kênh, sổ (fiscalScope).
- Mỗi nguồn số liệu fetch đúng một lần với cùng filter: danh sách + tổng từ
  `GET /api/orders` (dùng `data.summary` server, không cộng client);
  breakdown kênh/dòng tiền từ `GET /api/analytics`; quà từ `/api/reports/gifts`.
- 4 panel nhận filter + data qua props, KHÔNG tự đặt filter riêng, KHÔNG tự cộng tổng.
- `PendingOrdersView` giữ nguyên (nguồn riêng đã đúng sau deploy `ebb0f91c`).

### 3.2 Server — sửa tối thiểu để luật khớp

- `GET /api/analytics`: nhận `startDate/endDate/warehouseId/fiscalScope`, đẩy vào
  `analytics.service` (channels, cashflow theo đủ filter; consignment range-only vì tồn ký gửi là vật lý, không chia sổ).
- `gift-report.service`: thêm `o.status = 'COMPLETED'` + nhận `from/to`
  (service đã lọc ngày VN đúng, client chưa gửi).
- Top bán chạy: mặc định `excludeGifts=1` (API đã hỗ trợ, `analytics/route.ts:49`);
  trả `totalGiftQty` để UI hiện số quà riêng.
- Không đụng: `createdAtBetween` (đúng), `getSalesSummary` (đúng sau khi caller
  truyền đủ filter), digest/query (latent).

### 3.3 Luật số liệu chung (một chỗ, mọi panel theo)

- Tập đơn: `COMPLETED` (loại PENDING/CANCELLED).
- `SPONSORSHIP`: ra khỏi doanh thu, hiện dòng riêng, không vào chiết khấu bình quân.
- Dòng quà `is_gift_line`: 0đ, không vào doanh thu/top bán chạy; quà hết tồn
  (`is_gift_shortfall`) tách khỏi quà đã phát.
- Ngày lọc + giờ hiển thị: ngày nghiệp vụ VN (`datetime(col,'+7 hours')`), không UTC.
- Đơn hoàn (`return_orders`): `getSalesSummary` báo gộp như hiện tại — ghi chú rõ
  "doanh thu gộp chưa trừ hoàn" trên UI thay vì đổi công thức (đổi công thức = đổi
  nghiệp vụ, cần chủ quyết riêng).

## 4. Thay đổi từng panel

### 4.1 SalesLedgerView (Sổ Kép)

- Dùng `data.summary` server; bỏ cộng client.
- Preset "Tháng này" = tháng lịch; "7 ngày" = đúng 7 ngày; custom không giữ sót ngày cũ.
- Cột giờ + tên file CSV theo giờ VN; tên kho từ `/api/warehouses`, không fallback bịa.
- Kênh tiếng Việt (dùng chung `channelLabel`, xóa map riêng lẻ từng file).
- CSV: thêm cột Kênh, actor = người xuất thật, tên báo cáo khớp nội dung.
- Nút "In Phiếu": nối phiếu nhiệt thật hoặc gỡ (hiện in trang trắng).
- Fetch có AbortController; thẻ tổng có skeleton khi loading; tìm kiếm chuẩn hoá dấu.

### 4.2 RevenueAnalyticsPanel

- Nhận filter từ tab (ngày/kho/sổ), không fetch toàn lịch sử.
- Tách dòng SPONSORSHIP; thêm dòng TỔNG cuối bảng; loading/empty riêng (không hiện 0 giả).
- CSV có dấu, actor thật; bỏ map cứng kênh (dùng chung label, fallback tiếng Việt).

### 4.3 TopEditionsPanel

- Mặc định loại quà + hiện "đã tặng N cuốn" riêng; ngày VN (dùng `businessDateOf`).
- Nhãn Top10/20/50 nhìn thấy được; nút refresh có nhãn; CSV có dấu + cột kỳ lọc.

### 4.4 GiftReportPanel

- Nhận `from/to` + `currentRole` từ tab; ẩn hẳn với thu ngân (hiện tại hộp đỏ 403).
- Chỉ đơn COMPLETED; tách quà hết tồn; nút "Thử lại" khi lỗi; render `lineCount`
  và fallback tên khi `productName` null.

### 4.5 ExecutiveDashboard + digest (phạm vi B mở rộng)

- Dashboard dùng chung đường ống filter/summary của §3 (cùng tập đơn, cùng ngày VN),
  không fetch toàn bộ lịch sử không lọc (`ExecutiveDashboard.tsx:195` hiện nạp
  `GET /api/orders?fiscalScope=ALL` không khoảng ngày — vừa sai số vừa nguy cơ treo).
- Số "Tổng tiền/đơn" trên dashboard phải bằng số tab Doanh Số cùng filter
  (hiện lệch đúng bằng số đơn tài trợ, mục E.21 báo cáo rà soát).
- Không đụng so chuỗi thô trong `executive-digest.service` / `executive-query.service`
  (latent); chỉ thêm test canh: báo đỏ khi xuất hiện dòng `created_at` non-Z đầu tiên.

## 5. Phân quyền (giữ nguyên server, sửa UI cho khớp)

- Server đã đúng: TAX ép `OFFICIAL_TAX`, warehouse trả rỗng, cashier lọc theo mình.
- UI phải khớp: cashier không thấy nút chọn "Sổ Thuế"; warehouse thấy thông báo
  "không có quyền xem doanh số" thay vì "không tìm thấy đơn"; TAX không thấy panel Quà.

## 6. Kiểm chứng (TDD, reproduce-first)

Mỗi họ lỗi 1 test khóa qua `run-isolated.ts` (route thật, DB test), gồm ít nhất:

1. Filter tab đổi ⇒ cả 4 panel cùng đổi số (không panel nào còn toàn lịch sử).
2. Summary server = tổng client = tổng CSV (cùng filter).
3. Quà 0đ không leo top; SPONSORSHIP ngoài doanh thu; PENDING/CANCELLED ngoài mọi số.
4. Giờ VN hiển thị khớp ngày VN lọc (đơn 01:30 VN thuộc "hôm nay").
5. 403 đúng vai không hiện hộp đỏ (ẩn panel / thông báo đúng).

`npx tsc --noEmit` 0 lỗi + `npm run build` sạch trước deploy. Verify production chỉ đọc.
Không hạ assertion để xanh. Không log PIN/secret.

## 7. Không làm đợt này (ghi rõ để khỏi mở rộng)

- So chuỗi thô ở `executive-digest.service` / `executive-query.service` (latent, 0 dòng ảnh hưởng;
  chỉ có test canh).
- Phân trang/limit `getOrders` riêng lẻ — Dashboard hết nạp toàn bộ sau §4.5 nên chỉ làm
  tiếp nếu đo thấy timeout thật ở chỗ khác.
- Đổi công thức doanh thu gộp→ròng (cần chủ quyết nghiệp vụ riêng).
