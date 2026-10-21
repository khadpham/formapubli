# BÁO CÁO TỔNG HỢP - Cutover Shopee Live + Hub Đơn Online + Giá vốn/P&L

Ngày: 2026-10-21
Người thực hiện: Muse (điều phối) + trợ thủ
Trạng thái: HOÀN THÀNH PHẦN KỸ THUẬT - CHỜ KIỂM CHỨNG ĐƠN THẬT

---

## PHẦN 1: ĐÃ LÀM (đã lên production, đang chạy)

### 1.1. Shopee Go-Live - ĐƯỢC DUYỆT
- App "Vita Nova shopee" trên Shopee Open Platform đã chuyển trạng thái Online (hết Developing).
- Đã cấp Live Partner ID và Live Partner Key (lưu trong production.env, không ghi vào tài liệu).
- Không bị yêu cầu bổ sung hồ sơ, không bị hỏi Penetration Test Report.
- IP whitelist: 160.187.228.139 (IP egress của VPS, đã kiểm tra vẫn đúng).
- Tài khoản duyệt REVIEW-01 đã vô hiệu hóa ngay sau khi xong việc.

### 1.2. Kết nối shop thật
- Shop formapubli - Shopee Mall đã ủy quyền thành công (shopId 1467915150, token còn hiệu lực).
- Kho xuất đã gán: Kho 1 - Âu Cơ (wh-au-co).
- Push Mechanism đã bật trên console: callback https://app.formapubli.vn/api/shopee/push, mã sự kiện 1 (ủy quyền shop), 2 (hủy ủy quyền), 3 (trạng thái đơn), 4 (mã vận đơn).
- Đồng bộ live đầu tiên thành công: kéo được đơn thật từ shop.

### 1.3. Các bản vá quan trọng trong đợt cutover
1. **Redirect ủy quyền** (commit 5b0b370): link ủy quyền trước đây sinh redirect là localhost:3000 (do lấy origin từ request sau proxy), Shopee live sẽ từ chối. Đã sửa dùng biến môi trường APP_PUBLIC_URL tường minh. Đã kiểm chứng trên cả dev và production.
2. **Mã push webhook** (PR #38): handler cũ check nhầm mã 1/2 cho sự kiện đơn hàng (thực ra 1/2 là sự kiện shop, đơn hàng là mã 3/4). Đã sửa + nhận cả trường ordersn (push) lẫn order_sn (API). Nếu không sửa, push đơn về sẽ bị bỏ qua hết.
3. **Tham số API config**: PUT /api/shopee/config dùng warehouseId (camelCase), không phải warehouse_id.

### 1.4. Hub "Đơn online" (PR #39, mới nhất)
Tab Shopee cũ đã tái cấu trúc thành Hub "Đơn online" với 6 mục con:
1. **Tổng quan**: đơn hôm nay theo từng kênh, doanh thu, hàng đợi xử lý, cảnh báo (token sắp hết hạn, đơn quá hạn chuẩn bị).
2. **Đơn Shopee** (tách riêng theo quyết định 2026-10-21): tab vòng đời (Chờ xác nhận / Chờ lấy hàng / Đang giao / Đã giao / Trả hàng-Hủy), mỗi đơn có nút Chuẩn bị hàng → In vận đơn → Xác nhận đã giao, badge trạng thái hóa đơn D1, tìm kiếm mã đơn, nút Đồng bộ ngay.
3. **Đơn Portal** (khu riêng): luồng portal hiện có (xác nhận chuyển khoản VietQR, chuẩn bị, giao).
4. **Sản phẩm kênh**: danh sách hàng đang bán trên shop (từ API Shopee) + cột đối chiếu với sách ERP (SKU nào đã khớp, chưa khớp), nút đẩy tồn kho.
5. **Tài chính**: tiền thực nhận sau phí (escrow), phí Shopee, thuế khấu trừ tại nguồn (với riêng cho VN), theo từng đơn và theo kỳ.
6. **Hóa đơn**: liên kết sang tab Hóa đơn điện tử + hàng đợi D1.

### 1.5. Lớp giá vốn theo đầu sách + P&L 4 chiều (migration 0078)
- Bảng work_costs: tổng hợp chi phí từ hợp đồng (5 loại HĐ giai đoạn, tính GROSS trước khấu trừ TNCN 10%) + tiền in ấn.
- Giá vốn/bản = tổng chi phí / tổng số bản nhập kho (bình quân gia quyền khi tái bản nhiều đợt).
- P&L 2 sổ song song (thuế / nội bộ), 2 tầng (lãi gộp theo đầu sách → trừ chi phí chung → lãi ròng), chỉ ROLE_OWNER xem, tính từ 01/01/2026.
- Đã kiểm chứng bằng tính tay 100% khớp: 35tr chi phí / 2000 bản = 17.500đ/bản; bán 10 bản giá 129.000đ → lãi gộp 1.115.000đ.

### 1.6. Ô dán thông minh (BatchTransferModal + WholesaleDispatchModal)
- Dán text thuần → tự tách theo dấu phẩy/xuống dòng → tìm sách bằng khớp mờ (không dấu, 1-2 từ cũng ra).
- Bỏ qua mọi con số số lượng trong text dán; số lượng mặc định, chỉnh tay từng dòng sau.
- Mơ hồ (2+ ứng viên) → hiện hộp xác nhận cho người dùng chọn.
- Đã kiểm chứng với 4 test case của anh Kha trên dữ liệu thật, khớp 100%.

### 1.7. Hạ tầng tự động
- Cron shopee-catchup: mỗi 30 phút, bù tin push bị mất (idempotent).
- Cron msinvoice-sync: mỗi 30 phút (lệch 5 phút so với catchup), đồng bộ trạng thái ký hóa đơn từ MS-Invoice về ERP. Đã chạy thật trên production: quét 84 hóa đơn, không lỗi.
- Cron consolidate hóa đơn tổng hợp 23:30 + campaign-auto-end (từ trước, vẫn chạy).

### 1.8. Database production
- Backup trước cutover: /opt/backups/turso-pre-shopee-live-20261021.sql
- Đã áp migrations 0074 (xác nhận giao hàng D1), 0075 (thuế VN escrow), 0076 (cộng tác viên), 0077 (liên kết HĐ-cộng tác viên), 0078 (giá vốn). Tổng 88 bảng.

---

## PHẦN 2: CHƯA LÀM (kế hoạch tiếp theo)

### 2.1. Kiểm chứng đơn thật đầu-cuối (ưu tiên cao nhất, chờ đơn mới về)
Khi có đơn Shopee mới, cần kiểm chứng cùng anh:
- Đơn tự về ERP qua push (hoặc nút Đồng bộ) → hiển thị đúng trong hub
- Chuẩn bị hàng → gửi SPX → in vận đơn (PDF) → mã vận đơn về đúng
- D1: trước khi xác nhận khách nhận hàng → đẩy hóa đơn bị chặn; sau xác nhận → phát hành được
- Escrow đọc được tiền thực nhận của đơn đã giao

### 2.2. Nhóm 2 - Mở rộng Shopee (chưa chốt thời gian)
- Chat với khách Shopee (cần xin thêm scope ủy quyền từ Shopee - anh chưa chốt D5)
- Đánh giá: xem và trả lời đánh giá trong ERP
- Sức khỏe shop: cảnh báo điểm phạt, đơn sắp trễ, sản phẩm vi phạm

### 2.3. Các tính năng khác trong lộ trình
- Gửi hóa đơn cho khách Shopee qua email kèm link tra cứu (P2)
- Xử lý hoàn trả qua API (P2)
- Đăng sản phẩm mới lên Shopee từ dữ liệu ERP (P3)
- Đối soát 3 tầng escrow đầy đủ (P3)
- Trung tâm báo cáo quản trị 5 khối (sau khi COGS có số liệu)

### 2.4. Đơn COD đang bị giữ
- 2 đơn COD (2610217XFAWYUQ, 2610217VBTVUEE) đang nằm trong hàng đợi quarantine vì shop không bán COD nữa (quyết định 2026-10-21). Cứ để theo dõi, không xử lý.

---

## PHẦN 3: KHÔNG LÀM (quyết định để ở Seller Center)

### 3.1. Marketing Shopee
Voucher, flash sale, quảng cáo đấu thầu, chương trình khuyến mãi của sàn → làm trực tiếp trên Seller Center (banhang.shopee.vn).
Lý do (anh đã đồng ý): đặc thù sàn, Shopee thay đổi liên tục, không liên quan đến kho/tiền/hóa đơn của ERP. Đưa vào chỉ tốn công bảo trì mà ít giá trị.

---

## PHẦN 4: HƯỚNG DẪN SỬ DỤNG CÁC CHỨC NĂNG ĐÃ TÍCH HỢP

### 4.1. Xem và xử lý đơn Shopee
1. Vào tab **Đơn online** → mục **Đơn Shopee**.
2. Chọn tab trạng thái (Chờ lấy hàng là nơi đơn mới về chờ xử lý).
3. Bấm vào đơn để xem chi tiết: sản phẩm, tiền, khách, ĐVVC.
4. Luồng xử lý: **Chuẩn bị hàng** (đóng gói xong) → **In vận đơn** (tải PDF, dán lên kiện) → bàn giao cho SPX → khi khách nhận hàng, bấm **Xác nhận đã giao**.
5. Nút **Đồng bộ ngay**: kéo đơn mới từ Shopee về khi không muốn chờ push tự động.

### 4.2. Hóa đơn cho đơn online (D1)
- Đơn Shopee/portal CHỈ được phát hành hóa đơn sau khi bấm **Xác nhận đã giao** (khách đã nhận hàng).
- Trước đó, nút phát hành sẽ báo chặn - đây là đúng thiết kế, không phải lỗi.
- Xem hàng đợi: tab Hóa đơn điện tử → khối "Hóa đơn đơn online" (2 nhóm: chờ khách nhận hàng / sẵn sàng phát hành).

### 4.3. Sản phẩm kênh
- Tab Đơn online → mục **Sản phẩm kênh**: xem hàng đang bán trên shop, giá, tồn.
- Cột **Đối chiếu ERP**: xanh là SKU đã khớp với sách trong kho, vàng là chưa khớp (cần map tay để trừ kho đúng).
- Nút **Đẩy tồn kho**: đồng bộ tồn từ ERP lên Shopee (có buffer an toàn).

### 4.4. Tài chính Shopee
- Tab Đơn online → mục **Tài chính**: xem tiền thực nhận sau khi trừ phí Shopee, các loại thuế khấu trừ, theo từng đơn.
- Số liệu chi tiết hơn (lãi/lỗ theo đầu sách): tab **Chủ** → panel "Lãi/lỗ theo đầu sách" (chỉ Owner xem được).

### 4.5. Xử lý sự cố thường gặp
| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Đơn mới không tự về ERP | Push bị gián đoạn | Bấm "Đồng bộ ngay" trong mục Đơn Shopee; cron bù tin chạy mỗi 30 phút sẽ tự bắt |
| Không phát hành được hóa đơn đơn online | Chưa bấm "Xác nhận đã giao" | Kiểm tra trạng thái giao hàng của đơn trước |
| Tồn kho Shopee lệch với ERP | Đơn phát sinh ngoài ERP hoặc chưa đồng bộ | Bấm "Đẩy tồn kho" trong mục Sản phẩm kênh |
| Tab Shopee báo chưa kết nối | Token hết hạn | Vào mục kết nối, bấm "Kết nối gian hàng" để ủy quyền lại |

### 4.6. Ô dán thông minh (chuyển kho / xuất bán buôn)
1. Mở modal chuyển kho hàng loạt hoặc xuất bán buôn.
2. Ô dán hiển thị sẵn - dán danh sách tên sách (không cần format, có thể lẫn số lượng, ghi chú).
3. Bấm **Kiểm tra** → hệ tự tìm sách, bỏ qua số lượng.
4. Dòng nào khớp chắc chắn → tự nhận; dòng mơ hồ → hiện hộp cho anh chọn đúng sách.
5. Bấm **Vào bảng** để đưa vào danh sách, chỉnh số lượng từng dòng rồi xác nhận.

---

## PHẦN 5: THÔNG TIN KỸ THUẬT (để tra cứu)

- Production: https://app.formapubli.vn (VPS 160.187.228.139, PM2 2 instance)
- Dev: https://dev.formapubli.vn (test trước khi lên production)
- Main branch tip: b57dd06 (PR #39). Các PR trong đợt: #37 (cutover), #38 (hotfix push), #39 (hub).
- Cron: shopee-catchup (30p), msinvoice-sync (30p), consolidate (23:30), campaign-auto-end, backup (2h).
- Tài liệu phân tích gốc: docs/phan-tich-shopee-hoa-don-escrow-tab-hub-2026-10-20.md, docs/nghien-cuu-shopee-api-v2-2026-10-20.md, docs/runbook-shopee-live-cutover.md
