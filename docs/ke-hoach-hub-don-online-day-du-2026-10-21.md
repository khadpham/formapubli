# KẾ HOẠCH TỔNG THỂ - Hub Đơn Online đầy đủ (2026-10-21)

## 1. Phân tích hiện trạng (từ ảnh Seller Center + code)

### Luồng Seller Center (từ ảnh chụp của anh Kha):
1. Đơn về → tab "Chờ lấy hàng" → bấm "Chuẩn bị hàng"
2. Dialog "Giao Đơn Hàng": chọn "Tự mang ra bưu cục" (dropoff) hoặc "ĐVVC đến lấy" (pickup)
3. Shopee cấp mã vận đơn (VD: SPXVN06668320056A)
4. In phiếu vận đơn (PDF) → dán lên gói hàng
5. Bàn giao cho shipper → đơn chuyển "Đang giao" (23 đơn) → "Đã giao"
6. Tab "Trả hàng/Hoàn tiền/Hủy" (3 đơn) - xử lý riêng

### Lỗi hiện tại trong ERP:
1. **Sync chỉ lấy READY_TO_SHIP** → DB trống, không có lịch sử
2. **UI sai luồng**: nút "Chuẩn bị hàng" thực ra gọi API xếp lịch giao (nhãn sai)
3. **Nút "In vận đơn" hiện khi chưa có mã** → bấm lỗi
4. **Giá/tồn sản phẩm hiện 0** (sai tên trường API)
5. **14 combo/quà tặng chưa map** với ERP
6. **Chưa có xử lý trả hàng/hoàn tiền**
7. **Tài chính trống** (chưa sync escrow)

## 2. Kiến trúc triển khai

### 2.1. Tầng dữ liệu
- `orders`: lưu TẤT CẢ đơn Shopee (mọi trạng thái), thêm trường `packedAt` (đã đóng gói)
- `shopee_returns` (mới): return_sn, order_sn, status, reason, refund_amount, deadlines
- `shopee_order_finance`: populate qua get_escrow_detail cho đơn COMPLETED

### 2.2. Tầng đồng bộ
- `pullShopeeOrders`: bỏ filter READY_TO_SHIP, lấy tất cả status, mapping vào vòng đời ERP
- `pullShopeeReturns` (mới): get_return_list → lưu DB
- `syncShopeeFinance` (mới): get_escrow_detail cho đơn COMPLETED chưa có finance

### 2.3. Tầng UI - Luồng 4 bước
Mỗi đơn Shopee hiện thanh tiến trình:
```
[1. Đã đóng gói] → [2. Đã xếp lịch + mã vận đơn] → [3. Đã in phiếu] → [4. Đã bàn giao]
```
- Bước 1: nút "Xác nhận đã đóng gói" (nội bộ ERP)
- Bước 2: nút "Xếp lịch giao" → dialog chọn pickup/dropoff → hiện mã vận đơn TO + nút copy
- Bước 3: nút "In vận đơn" (chỉ hiện khi có mã) → tải PDF
- Bước 4: tự động khi shipper lấy (webhook) hoặc nút "Đã bàn giao"

### 2.4. Tab Trả hàng/Hủy (mới)
- Danh sách return từ API, trạng thái, lý do, số tiền hoàn
- Nút: Chấp nhận / Từ chối / Tranh chấp (theo deadline)
- Liên kết với đơn gốc và tác động kho

### 2.5. Tài chính chi tiết
- Mỗi đơn COMPLETED: hiện breakdown (giá bán, phí sàn, phí dịch vụ, thuế, thực nhận)
- Tổng hợp theo kỳ

## 3. Thứ tự triển khai
1. Fix sync all-status (quan trọng nhất - có dữ liệu mới làm được các bước sau)
2. Fix giá/tồn sản phẩm
3. Mapping combo/quà tặng
4. Luồng 4 bước UI
5. Tab Trả hàng/Hủy
6. Sync escrow + UI tài chính

## 4. Tiêu chí hoàn thành
- DB có đơn ở mọi trạng thái (đối chiếu với Seller Center)
- Luồng 4 bước chạy được trên đơn thật
- In được vận đơn PDF thật
- Trả hàng hiện đúng và xử lý được
- Tài chính hiện số thật từ escrow
