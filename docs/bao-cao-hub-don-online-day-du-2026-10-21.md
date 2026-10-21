# BÁO CÁO TỔNG HỢP - Hub Đơn Online đầy đủ (đợt 2, 2026-10-21)

Ngày: 2026-10-21 (buổi tối)
Người thực hiện: Muse (điều phối) + trợ thủ
Trạng thái: HOÀN THÀNH TRIỂN KHAI - ĐÃ LÊN PRODUCTION

---

## PHẦN 1: ĐÃ LÀM (đợt 2 - theo yêu cầu chi tiết của anh Kha)

### 1.1. Sửa đồng bộ đơn - lấy TẤT CẢ trạng thái (quan trọng nhất)
**Vấn đề cũ:** code chỉ lấy đơn ở trạng thái "Chờ lấy hàng", các trạng thái khác bị bỏ qua → database trống, không có lịch sử.

**Đã sửa:**
- Bỏ filter READY_TO_SHIP, lấy tất cả: UNPAID, READY_TO_SHIP, PROCESSED, SHIPPED, COMPLETED, CANCELLED, IN_CANCEL
- Mapping đầy đủ vào vòng đời ERP
- Đơn đã có trong DB: cập nhật trạng thái thay vì bỏ qua
- Xử lý kho thông minh: đơn UNPAID→đã thanh toán thì trừ bù; đã trừ→CANCELLED thì hoàn kho

**Kết quả trên production:** đã kéo được **66 đơn thật** (44 đã giao, 7 đang giao, 15 hủy/thất bại). 4 đơn bị giữ lại xem (2 COD theo quyết định không bán COD, 2 đơn SKU H90 chưa khớp).

### 1.2. Sửa giá/tồn sản phẩm
**Vấn đề cũ:** giá và tồn kho hiện 0.
**Nguyên nhân:** `price_info` trong API Shopee là MẢNG (không phải object), tồn kho nằm ở `stock_info_v2.summary_info.total_available_stock`.
**Đã sửa:** đọc đúng cấu trúc. Hiện tại 58 sản phẩm đã hiện đúng giá và tồn thật.

### 1.3. Mapping combo/quà tặng (14 items)
**Hiện trạng:** 14 combo/quà tặng trên Shopee (COMBO01-10, H89-H92) chưa khớp với ERP.
**Đã xây:**
- Bảng `shopee_sku_components`: 1 SKU Shopee → nhiều thành phần ERP (VD: COMBO03 = sách A + sách B)
- UI "Đối chiếu": cho từng SP chưa map, tìm sách trong ERP, chọn nhiều thành phần + số lượng
- Đơn có combo tự tách thành nhiều dòng khi nhập vào ERP

**Cần anh làm:** vào mục Sản phẩm kênh, bấm "Đối chiếu" cho 14 items để ghép với sách trong kho.

### 1.4. Luồng xử lý đơn 4 bước (theo đúng Seller Center)
**Vấn đề cũ:** nút "Chuẩn bị hàng" thực ra gọi API xếp lịch giao (nhãn sai); nút "In vận đơn" hiện khi chưa có mã (bấm lỗi); mã vận đơn hiện chữ nhỏ.

**Luồng mới (thanh tiến trình trực quan):**
1. **Đã đóng gói** - nút "Xác nhận đã đóng gói" (nội bộ, thủ kho bấm sau khi gói xong)
2. **Đã xếp lịch** - nút "Xếp lịch giao" → dialog chọn "Tự mang ra bưu cục" hoặc "ĐVVC đến lấy" (giống ảnh Seller Center anh gửi) → hiện **mã vận đơn TO + nút Copy**
3. **Đã in phiếu** - nút "In vận đơn" **chỉ hiện khi đã có mã** → tải PDF dán lên gói hàng
4. **Đã bàn giao** - shipper lấy hàng hoặc mang ra bưu cục

### 1.5. Tab Trả hàng/Hủy (mới)
- Danh sách yêu cầu trả hàng/hoàn tiền từ Shopee API
- Hiện: trạng thái, lý do trả, số tiền hoàn, hạn xử lý
- Nút: Chấp nhận / Từ chối (theo đúng deadline Shopee)

### 1.6. Đồng bộ tài chính (escrow)
- Đã chạy cho 44 đơn đã giao: **44/44 thành công**
- Mỗi đơn có: giá bán, phí sàn, phí dịch vụ, thuế khấu trừ, tiền thực nhận
- Xem tại: Đơn online → Tài chính

### 1.7. Migrations đã áp production
- 0079: bảng shopee_sku_components (combo mapping)
- 0080: thêm packed_at, packed_by, awb_printed_at vào orders
- 0081: bảng shopee_returns

---

## PHẦN 2: HƯỚNG DẪN SỬ DỤNG CHI TIẾT

### 2.1. Xử lý đơn Shopee mới (luồng chuẩn)
1. Vào **Đơn online** → **Đơn Shopee** → tab "Chờ lấy hàng"
2. Bấm vào đơn → kiểm tra sản phẩm, địa chỉ khách
3. Đóng gói hàng → bấm **"Xác nhận đã đóng gói"**
4. Bấm **"Xếp lịch giao"** → chọn:
   - "ĐVVC đến lấy hàng" (shipper SPX đến kho lấy), hoặc
   - "Tự mang ra bưu cục" (mang ra điểm SPX gần nhất)
5. Hệ hiện **mã vận đơn** (VD: SPXVN06668320056A) → bấm Copy nếu cần
6. Bấm **"In vận đơn"** → tải PDF → in ra → dán lên gói hàng
7. Bàn giao cho shipper → đơn tự chuyển "Đang giao"
8. Khi khách nhận hàng → bấm **"Đã nhận hàng"** (mở khóa hóa đơn D1)

### 2.2. Xem lịch sử đơn
- Tab "Đã giao": 44 đơn đã hoàn thành
- Tab "Trả hàng/Hủy": 15 đơn hủy + yêu cầu trả hàng
- Bấm vào từng đơn xem chi tiết: sản phẩm, tiền, mã vận đơn, timeline

### 2.3. Đối chiếu combo/quà tặng (làm 1 lần)
1. Vào **Đơn online** → **Sản phẩm kênh**
2. Tìm các dòng có badge "Chưa đối chiếu" (COMBO01-10, H89-H92)
3. Bấm **"Đối chiếu"** → tìm sách trong ERP → chọn các thành phần + số lượng
4. Lưu → từ nay đơn có combo tự tách đúng

### 2.4. Xem tài chính
- **Đơn online** → **Tài chính**: tiền thực nhận theo đơn, phí, thuế
- **Tab Chủ** → "Lãi/lỗ theo đầu sách": lãi gộp sau khi trừ giá vốn (chỉ Owner)

### 2.5. Xử lý trả hàng
1. Vào **Đơn online** → **Trả hàng**
2. Xem lý do, số tiền khách yêu cầu hoàn, hạn xử lý
3. Bấm **Chấp nhận** (đồng ý hoàn tiền) hoặc **Từ chối** (nếu không hợp lý)
4. Hàng trả về → nhập lại kho theo hướng dẫn

---

## PHẦN 3: CHƯA LÀM / CẦN ANH QUYẾT

1. **Đối chiếu 14 combo/quà tặng** - cần anh (hoặc người phụ trách) ghép tay qua UI 1 lần
2. **2 đơn SKU H90** đang bị giữ (chưa khớp mã) - kiểm tra H90 là sản phẩm gì trong ERP
3. **Chat với khách Shopee** - cần xin thêm quyền từ Shopee (anh chưa chốt)
4. **Kiểm chứng luồng 4 bước trên đơn thật** - khi có đơn mới không phải COD

---

## PHẦN 4: THÔNG TIN KỸ THUẬT

- PR #41 (6 bước) đã merge, main tip: b763f47
- Production đã deploy, smoke 10/10
- Cron: shopee-catchup (30p), msinvoice-sync (30p)
- Tài liệu: docs/ke-hoach-hub-don-online-day-du-2026-10-21.md (trong repo)
