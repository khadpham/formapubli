# BRIEF: Hệ thống đối soát ngân hàng và SPX

## 1. Bối cảnh

Nhân viên kế toán hiện đang đối chiếu thủ công từng dòng sao kê ngân hàng và báo cáo tài chính SPX để xác minh tiền về. Công việc máy móc, dễ sai, không scale được. Nhiệm vụ của bạn là xây dựng hệ thống đối soát tự động trong ERP.

Đọc `AGENT_GUIDE.md` và `FORMAPUBLI_MASTER_BLUEPRINT.md` (mục 23.6, mục 24 về đối soát) trên nhánh dev trước khi bắt đầu.

## 2. Môi trường làm việc

Xem `AGENT_GUIDE.md`. Tóm tắt: nhánh `dev`, đường dẫn local `D:\Data Project\formapubli`, `npx tsc --noEmit` phải pass, không PR lên main khi chưa test.

## 3. Việc 1 (làm trước): Chuẩn hóa mã thanh toán - gộp 2 mã đơn thành 1

### 3.1. Vấn đề

Hiện tại một đơn online có 2 mã (chi tiết trong blueprint mục 23.6):
- Portal tự sinh: `DH-20261011-J3OT`
- ERP sinh khi nhận từ portal: `ORD261011000M`
- Bảng `orders` lưu cả 2 cột: `order_code` và `portal_ref`

### 3.2. Giải pháp

Chỉ dùng MỘT mã duy nhất (`order_code` format `ORD...`) xuyên suốt:
- Portal KHÔNG tự sinh mã nữa. Khi khách bấm đặt hàng, portal gọi API ERP để lấy mã đơn trước, dùng mã đó cho toàn bộ luồng.
- Mã này hiển thị cho khách, ghi vào Google Sheet (thay cột mã portal), và nhúng sẵn trong VietQR (khách chỉ quét, không phải tự ghi mã).
- Cột `portal_ref` giữ lại để tra cứu đơn cũ, nhưng mọi logic mới chỉ dùng `order_code`.

### 3.3. Việc cần làm

1. Tạo API endpoint trên ERP: `POST /api/orders/reserve-code` - trả về mã `ORD...` mới, chưa tạo đơn (để portal lấy mã trước khi khách thanh toán).
2. Sửa API nhận đơn từ portal (`/api/portal-orders`): nhận `order_code` từ portal gửi lên thay vì tự sinh. Nếu portal chưa gửi mã (đơn cũ), fallback sinh mới như hiện tại.
3. Cập nhật portal (repo riêng `customer-order-portal` - chỉ đọc để hiểu, không sửa trong nhiệm vụ này): ghi chú rõ trong brief portal sau này sẽ đổi sang gọi API lấy mã.

## 4. Việc 2: Đối soát ngân hàng tự động

### 4.1. Dữ liệu đầu vào

File sao kê MB Bank (xlsx), sheet "Thông tin giao dịch", các cột quan trọng:
- C4: NGÀY GIAO DỊCH
- C8: PHÁT SINH NỢ (tiền ra)
- C9: PHÁT SINH CÓ (tiền vào)
- C12: ĐƠN VỊ THỤ HƯỞNG/ĐƠN VỊ CHUYỂN
- C13: NỘI DUNG (chứa mã đơn trong VietQR, VD: "MBVCB.15601306902.096033.[mã đơn]")
- C18: BÚT TOÁN (mã giao dịch ngân hàng)

### 4.2. Bảng mới

Tạo migration mới:
- `bank_statements`: id, ngay_giao_dich, ngay_hach_toan, phat_sinh_no, phat_sinh_co, so_du, don_vi, noi_dung, but_toan, created_at. Thêm unique constraint trên `but_toan` để import không bị trùng.
- `bank_statement_matches`: id, statement_id, order_id, match_type (AUTO/MANUAL), confidence (HIGH/MEDIUM/LOW), matched_at, matched_by, note.

### 4.3. Logic auto-match

Khi import sao kê:
1. Parse cột NỘI DUNG tìm mã đơn (regex pattern `ORD\d+`).
2. Nếu tìm thấy mã: tìm đơn trong `orders` theo `order_code`. So sánh số tiền (phat_sinh_co vs final_amount).
   - Mã khớp + tiền khớp (sai số < 1000đ): tự động match, confidence HIGH, cập nhật trạng thái thanh toán đơn thành ĐÃ THU.
   - Mã khớp + tiền lệch: match confidence MEDIUM, đưa vào hàng đợi review, đánh dấu đơn THEU DÕI.
   - Mã không tìm thấy đơn: confidence LOW, đưa vào hàng đợi review.
3. Nếu không tìm thấy mã trong nội dung: thử match theo tên + SĐT (từ thông tin khách hàng), confidence LOW, đưa vào review.
4. Dòng không match được gì: để trạng thái CHƯA XỬ LÝ cho kế toán phân loại tay (VD: chi lương, chi nhà cung cấp).

### 4.4. UI

Trang "Đối soát ngân hàng" trong module Tài chính:
- Nút import file xlsx sao kê
- Bảng các dòng sao kê với trạng thái: ĐÃ KHỚP (xanh) / CHỜ REVIEW (vàng) / CHƯA XỬ LÝ (xám)
- Với dòng chờ review: hiển thị gợi ý match (mã tìm được, đơn gần khớp), nút Xác nhận / Bỏ qua / Gán tay
- Desktop: bảng full chiều ngang. Mobile: cards xếp dọc, nút tối thiểu 44px.

## 5. Việc 3: Đối soát SPX

### 5.1. Dữ liệu đầu vào

File báo cáo tài chính SPX (xlsx), các cột quan trọng:
- Mã vận đơn (tracking number)
- Trạng thái vận đơn
- Tiền thu hộ (VND) - cột A: số COD SPX thu được
- Tổng phí phải trả (VND) - cột C: phí vận chuyển
- Số tiền điều chỉnh (VND) - cột D
- Tổng tiền vào Số dư tài khoản

### 5.2. Bảng mới

- `spx_settlements`: id, ma_van_don (unique), trang_thai, tien_thu_ho, tong_phi, phi_giao_hang, phi_bao_hiem, phi_hoan_hang, so_tien_dieu_chinh, ly_do_dieu_chinh, tong_tien_ve, ngay_import, created_at.
- `spx_settlement_matches`: id, settlement_id, order_id, cod_khop (boolean), phi_bat_thuong (boolean), note.

### 5.3. Logic auto-match

Khi import báo cáo SPX:
1. Match `ma_van_don` với `tracking_code` trong bảng `orders` (đơn gửi qua SPX).
2. Kiểm tra 3 điểm:
   - COD thu hộ vs cod_amount của đơn: khớp hay lệch?
   - Phí vận chuyển vs phí dự kiến: có bất thường không (vượt ngưỡng cấu hình được)?
   - Có số tiền điều chỉnh không: nếu có, đánh dấu cần kế toán xem lý do.
3. Đơn không tìm thấy mã vận đơn tương ứng: đưa vào review.

### 5.4. UI

Trang "Đối soát SPX" trong module Tài chính, tương tự UI đối soát ngân hàng.

## 6. Thứ tự thực hiện

Làm theo đúng thứ tự (anh Kha đã duyệt):
1. Việc 1 (chuẩn hóa mã đơn) - làm trước vì việc 2 và 3 phụ thuộc vào mã thống nhất
2. Việc 2 (đối soát ngân hàng)
3. Việc 3 (đối soát SPX)

Mỗi việc xong: migration + tsc pass + commit lên dev. Không gộp chung một commit lớn.

## 7. Quy tắc tuyệt đối

Xem `AGENT_GUIDE.md`. Nhắc lại: không dấu gạch ngang dài, giờ UTC+7, không chạm production, không PR lên main khi chưa test.
