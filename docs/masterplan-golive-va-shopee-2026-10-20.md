# MASTERPLAN: Đưa ERP lên production và Tích hợp Shopee API

Ngày lập: 2026-10-20. Người lập: Muse, trình anh Kha duyệt. Tài liệu nền: nghien-cuu-shopee-api-v2-2026-10-20.md (nghiên cứu API), phan-tich-shopee-hoa-don-escrow-tab-hub-2026-10-20.md (phân tích nghiệp vụ), FORMAPUBLI_MASTER_BLUEPRINT.md (nguồn sự thật).

---

## 1. Ta đang ở đâu (chỉ gồm việc đã kiểm chứng)

### Đã xong và đã kiểm chứng tận nơi
- **MS-Invoice production**: tích hợp create-from-3rd chạy thật trên tài khoản công ty (MST 0110626953, ký hiệu 1C26TVN). Đã bắt và sửa 3 lỗi tinh vi (tách ký hiệu form/serial, bắt lỗi logic trả về qua HTTP 200, đọc đúng trường listData). Hóa đơn test đầu-cuối qua ERP: SYNCED, ID hai chiều khớp, số liệu đúng thuế sách 5%. Màn hình mirror hiển thị đúng 82 hóa đơn thật của công ty. **Hai hóa đơn nháp test đã XÓA khỏi prod sau kiểm chứng - production sạch, sẵn sàng dùng thật.**
- **Dev ERP**: toàn bộ vòng đời hóa đơn (POS/bán buôn/portal, đơn lẻ + tổng hợp cuối ngày), tự động kết thúc chiến dịch + báo cáo kỳ, tab Hợp đồng F1-F5 - đều đã test trên trình duyệt thật và đối chiếu cơ sở dữ liệu.
- **Kiến thức Shopee API v2**: đủ để lập kế hoạch (xem mục 2 về mức độ tin cậy).

### Đang chờ và chưa lên production
- Nhánh dev tích lũy nhiều việc chưa qua PR: module hóa đơn đầy đủ, MS-Invoice service mới, tự kết thúc chiến dịch, sửa lỗi toàn hệ thống confirm/alert.
- 5 migration chưa áp lên DB production: 0069 (trường hóa đơn cho orders), 0070 (liên kết einvoice), 0071 (ngày ký/nghiệm thu milestone hợp đồng), 0072 (trường hóa đơn cho phiếu bán buôn), 0073 (bảng báo cáo chiến dịch).
- 3 file CRUD đối tác vẫn là file chưa commit đang chạy trên production (nợ kỹ thuật từ 19/10).
- Cron production chưa gọi endpoint tự kết thúc chiến dịch; biến môi trường MSINVOICE_* chưa đặt trên production.

---

## 2. Kho tri thức đã đầy đủ chưa? - Đánh giá thẳng thắn

| Mảng | Mức tin cậy | Căn cứ |
| --- | --- | --- |
| MS-Invoice: tạo hóa đơn, mirror, thuế | CAO - đã chạy thật | Test E2E trên prod, đối chiếu từng số |
| MS-Invoice: lấy file PDF | TRUNG BÌNH - biết có endpoint pdf-base64 trong tài liệu vendor, chưa gọi thử | Cần 1 lần gọi thử trên prod với hóa đơn thật đã ký của kế toán |
| MS-Invoice: gửi email qua API | TRUNG BÌNH - tài liệu có request "Gửi email hóa đơn" (PUT) nhưng nội dung chưa đọc kỹ | Cần đọc lại request mẫu |
| MS-Invoice: hóa đơn điều chỉnh/thay thế | THẤP - vendor chưa trả lời từ 13/10 | Không chặn go-live (nghiệp vụ hiếm, xử lý tay được), phải hỏi lại khi làm hoàn trả Shopee |
| Shopee API: danh mục + luồng | CAO ở mức tài liệu | Đọc trực tiếp tài liệu chính thức bằng tài khoản công ty |
| Shopee API: hành vi thực tế | THẤP - chưa có MỘT lời gọi API thật nào | Chưa có app nên chưa có Partner ID/Key; mọi con số (rate limit, che dấu thông tin, cây thuộc tính) đều là đọc, chưa chạm |
| Shopee: shop của công ty | CHƯA BIẾT: shop_id thật, khối lượng đơn/tháng, cấu hình kho lấy hàng SPX, shop có đang bị hạn chế gì không | Cần ủy quyền shop mới thấy |
| Chiến lược hub tab | TỐT ở mức thiết kế | Nhưng có một giả định cần phản biện - xem mục 3.2 |

**Kết luận mục 2**: Kiến thức đủ để (a) go-live ERP ngay, (b) tạo app Shopee và bắt đầu giai đoạn kiểm chứng thực tế. Kiến thức CHƯA đủ để code thẳng tính năng Shopee hoàn chỉnh - bắt buộc có một chặng kiểm chứng bằng API thật (sandbox + shop thật ở chế độ chỉ đọc) trước khi viết tính năng.

---

## 3. Phản biện (nói ngược lại chính mình trước khi làm)

### 3.1. "Làm Shopee ngay đi, đang có đà" - SAI THỨ TỰ
Shopee là dự án nhiều tuần. Go-live ERP là việc vài ngày và là NỀN của một nửa giá trị Shopee (luồng hóa đơn người mua nối vào pipeline MS-Invoice trên production; nếu pipeline chưa live thì Shopee làm xong cũng treo). Thêm nữa mỗi ngày dev chưa merge là một ngày rủi ro xung đột tăng (bài học PR #31). **Go-live trước, Shopee sau - nhưng tạo app Shopee ngay tuần này vì nó không tốn công và mở đường cho kiểm chứng song song.**

### 3.2. "Hợp nhất tầng dữ liệu hub trước" - giả định trong tài liệu phân tích cần đảo lại
Tài liệu hub đề xuất "Bước 0: hợp nhất dữ liệu trước khi có API". Phản biện: ta chưa từng thấy một đơn Shopee thật qua API trông như thế nào (trường package, trạng thái chi tiết, phí tách dòng). Hợp nhất dữ liệu theo tưởng tượng rồi mới thấy dữ liệu thật là cách tạo nợ kỹ thuật. **Đảo thứ tự: xây đồng bộ Shopee như một module độc lập đọc-ghi rõ ràng (P1), nhìn dữ liệu thật chạy 1-2 tuần, rồi mới hợp nhất và làm giao diện hub.**

### 3.3. "Xuất hóa đơn cho đơn Shopee ngay khi khách yêu cầu" - rủi ro điều chỉnh
Khách khai thông tin hóa đơn lúc đặt hàng, nhưng đơn Shopee hủy/hoàn với tỷ lệ không nhỏ. Xuất hóa đơn ngay = sinh hóa đơn điều chỉnh hàng loạt sau đó (mà phần điều chỉnh ta còn chưa có câu trả lời của vendor). Nguyên tắc thuế: thời điểm lập hóa đơn gắn với thời điểm chuyển giao hàng hóa. **Đề xuất: chỉ phát hành khi đơn đã bàn giao vận chuyển (SHIPPED trở đi); đơn bị hủy trước đó không phát sinh hóa đơn.** Cần anh chốt (quyết định D1).

### 3.4. "Escrow là vàng" - đúng nhưng đừng quên mặt còn lại
Escrow detail chỉ đúng SAU khi đơn hoàn tất; đơn đang đi đường chưa có số cuối. Báo cáo lãi tháng phải tách rõ "đã chốt" và "đang treo" - nếu không số lãi sẽ nhảy mỗi lần đối soát và mất niềm tin của người dùng nội bộ.

### 3.5. "Tự động hóa hết" - vùng xám vận hành
Hai điểm không nên tự động hoàn toàn ở giai đoạn đầu: (a) đẩy giá/tồn từ ERP lên Shopee (sai một lần là bán lỗ/bán vượt diện rộng) - giai đoạn đầu chỉ ĐỒNG BỘ MỘT CHIỀU từ Shopee về + cảnh báo lệch, đẩy lên sau khi đối soát ổn định; (b) trả lời chat tự động - Shopee không khuyến khích và rủi ro điểm vận hành.

### 3.6. Bảo mật bị xem nhẹ
Dev .env hiện chứa credential MS-Invoice PRODUCTION. Trước go-live phải: tách rõ - dev dùng tài khoản/môi trường riêng (hoặc ít nhất đổi lại sau kiểm chứng), production .env chỉ ở /opt/formapubli/.env; credential Shopee (Partner Key, token) lưu mã hóa ở tầng ứng dụng hoặc biến môi trường, không để trong DB dạng thô và không ghi log.

---

## 4. Chiến lược theo giai đoạn

### GIAI ĐOẠN 0 - Quyết định và mở đường (tuần này, song song với giai đoạn 1)
1. Anh chốt các quyết định ở mục 5 (tên app + logo là việc duy nhất chặn tạo app).
2. Muse tạo app Shopee trên console, lấy Partner ID/Key, cấu hình push cơ bản. Đăng ký sandbox test shop.
3. Kiểm chứng thực tế vòng 1 (chỉ đọc): ủy quyền shop sandbox -> gọi get_shop_info, get_order_list, get_buyer_invoice_info mẫu, get_attribute_tree của ngành Sách, get_brand_list -> ghi kết quả vào phụ lục nghiên cứu, đánh dấu lại mọi giả định sai. (Ủy quyền shop THẬT chỉ làm ở giai đoạn 2 sau khi hạ tầng token xong.)

### GIAI ĐOẠN 1 - GO-LIVE ERP LÊN PRODUCTION (ưu tiên cao nhất)
Phạm vi tách PR nhỏ theo đúng kỷ luật đã chốt, KHÔNG gộp cả dev vào main:
1. PR-A: Hạ tầng hóa đơn (migration 0069, 0070, 0072 + einvoice service + MS-Invoice service mới + tab Hóa đơn điện tử + mirror). Áp migration lên DB production. Đặt MSINVOICE_* vào /opt/formapubli/.env.
2. PR-B: Tự kết thúc chiến dịch (migration 0073, endpoint cron, báo cáo kỳ) + thêm lệnh gọi vào cron-auto-close.sh.
3. PR-C: CRUD đối tác (đưa 3 file đang chạy lậu trên production về qua PR chuẩn).
4. PR-D: Migration 0071 + phần hợp đồng F1-F5 liên quan (nếu anh xác nhận test xong trên dev).
5. Việc đi kèm: sửa lỗi consolidateDay lấy giờ UTC thay vì giờ VN; lên lịch chạy gom hóa đơn tổng hợp cuối ngày (cron 23h30 giờ VN, có báo cáo qua Telegram n8n); test khói trên production sau mỗi PR theo checklist (đăng nhập, tạo đơn POS test có/không VAT, chuẩn bị + đẩy 1 hóa đơn thật nhỏ, mirror đọc được).
6. Điểm dừng an toàn: mỗi PR độc lập revert được; backup DB production trước khi áp migration; deploy ngoài giờ cao điểm.

Tiêu chí xong giai đoạn 1: nhân viên dùng hóa đơn điện tử trên app thật; kế toán thấy hóa đơn ERP đẩy sang trên MS-Invoice của mình; không còn file chưa commit trên production.

### GIAI ĐOẠN 2 - SHOPEE P1: Hạ tầng + Đơn + Vận chuyển SPX
1. Hạ tầng dùng chung: module ký số HMAC, bảng token theo shop (access/refresh, hạn dùng), cron làm mới token trước hạn 30 phút, hàng đợi gọi API có retry/backoff, endpoint nhận webhook (verify chữ ký, trả 200 ngay, xử lý nền, idempotent), job lấy lại push bị mất + poll dự phòng.
2. Ủy quyền shop thật; đồng bộ đơn hai chiều trạng thái (webhook + poll cửa sổ 15 ngày).
3. Màn hình vận chuyển trong tab Shopee hiện tại (chưa đổi cấu trúc tab): get_shipping_parameter -> ship/mass ship -> tracking number -> in phiếu theo job. Thủ kho thao tác thử với đơn thật khối lượng nhỏ trước khi dùng diện rộng.
4. Đối chiếu tồn kho: job báo lệch ERP vs Shopee hằng ngày (chưa đẩy tồn tự động).

Tiêu chí xong: đơn Shopee về ERP trong vài phút không cần xlsx; thủ kho gửi và in phiếu ngay trong ERP; không lệch trạng thái đơn sau 2 tuần chạy.

### GIAI ĐOẠN 3 - SHOPEE P2: Hóa đơn người mua + Hoàn trả + Sản phẩm
1. Hàng đợi hóa đơn người mua (từ trạng thái INVOICE_PENDING + get_buyer_invoice_info) nối pipeline giai đoạn 1; gửi email hóa đơn tự động kèm link tra cứu sau khi ký.
2. Hoàn trả qua API: danh sách, confirm/dispute theo chính sách đối trả phương án A, hàng về nhập kho, tác động tiền rõ ràng. (Điều kiện: có câu trả lời vendor về hóa đơn điều chỉnh, hoặc quy trình tay tạm cho phần hóa đơn.)
3. Đồng bộ sản phẩm một chiều lên: đăng/cập nhật sản phẩm từ dữ liệu ERP (qua hàng đợi duyệt nội dung), đẩy giá/tồn theo cơ chế duyệt tay trước - tự động sau.
4. Xin scope Chat nếu anh đồng ý; tích hợp hộp thư Shopee vào hub (chỉ hỗ trợ người trả lời, không bot tự động).

### GIAI ĐOẠN 4 - TÀI CHÍNH SÂU + HUB "ĐƠN ONLINE"
1. Escrow 3 tầng về ERP (theo đơn, báo cáo kỳ, payout) + đối soát tự động + cảnh báo lệch phí và phải thu tồn đọng.
2. Phân tích nhiều chiều theo đầu sách và dự báo dòng tiền (như thiết kế đã viết).
3. Tái cấu trúc giao diện tab thành hub "Đơn online" (Portal + Shopee) theo vòng đời và hàng đợi công việc - làm SAU KHI dữ liệu thật đã chạy ổn, theo bản phân tích hub đã duyệt.
4. AccountHealth: cảnh báo vận hành (đơn sắp trễ gửi, sản phẩm vi phạm, điểm phạt).

---

## 5. Các quyết định cần anh chốt

| Mã | Quyết định | Đề xuất của Muse |
| --- | --- | --- |
| D0 | Tên app Shopee + file logo | ĐÃ CHỐT 2026-10-20 (anh Kha): tên app "Vita Nova shopee"; logo = docs/shopee-app/vitanova-logo.png |
| D1 | Thời điểm phát hành hóa đơn cho đơn online có yêu cầu VAT | ĐÃ CHỐT 2026-10-20 (anh Kha): chỉ phát hành khi KHÁCH ĐÃ NHẬN HÀNG. Tạm thời làm cơ chế xác nhận nhận hàng thủ công; chờ tích hợp API đơn vị vận chuyển (anh đang làm việc với bên vận chuyển) |
| D2 | Phạm vi go-live giai đoạn 1 | ĐÃ CHỐT 2026-10-20 (anh Kha): đợt lên main đi theo từng gói PR nhỏ nối tiếp nhau trong cùng đợt; điều kiện: TOÀN BỘ dev phải hoàn thiện, kiểm chứng hết, không lỗi mới được lên main |
| D3 | Khung giờ deploy production | Tối sau 21h giờ VN (sau digest), có mặt anh để test khói |
| D4 | Ủy quyền shop Shopee thật ở giai đoạn 2 | ĐÃ CHỐT 2026-10-20 (anh Kha): shop chính thức là 'formapubli' (Shopee Mall). Lưu ý: Mall áp thời gian đảm bảo escrow 15 ngày và phí cố định cao hơn Non-Mall 3-4% |
| D5 | Có xin scope Chat ở giai đoạn 3 không | Có - giá trị vận hành cao, chi phí xin thấp |
| D6 | Dev .env đang chứa credential prod | Sau go-live, Muse dọn dev về mock/demo và đổi mật khẩu MS-Invoice prod (anh thao tác đổi, Muse cập nhật .env production) |

---

## 6. Rủi ro lớn nhất và cách chặn

1. **Xung đột merge dev->main** (dev đã đi xa): chặn bằng tách PR nhỏ + CI + test từng PR trên dev trước.
2. **Migration lên production DB**: chặn bằng backup + áp thử trên bản sao DB + chỉ áp trong cửa sổ deploy.
3. **Token Shopee hết hạn giữa đêm**: chặn bằng cron refresh sớm + sự kiện cảnh báo authorization_expiry + cảnh báo Telegram khi refresh thất bại.
4. **Lệch tồn kho hai hệ thống**: chặn bằng đồng bộ một chiều có kiểm soát ở P1-P2 và job báo lệch hằng ngày qua n8n.
5. **Kế toán không theo kịp thay đổi**: go-live hóa đơn cần 1 buổi hướng dẫn ngắn + tuần đầu chạy song song kiểm tra tay (kế toán đối chiếu MS-Invoice như hiện tại, ERP chỉ thêm nguồn đẩy mới).
6. **Phí Shopee thay đổi chính sách**: hệ thống không hardcode tỷ lệ; cảnh báo lệch phí bắt thay đổi trong tuần đầu.

---

## 7. Việc làm ngay sau khi anh duyệt masterplan này

1. Tạo app Shopee (khi có D0) + kiểm chứng thực tế vòng 1.
2. Mở PR-A go-live hóa đơn.
3. Cập nhật blueprint mục 39 (đã làm bản ghi kèm masterplan này).

## Tien do thuc te (cap nhat 2026-10-20 14:30)
- Merge main vao dev (f6b3d745) + regression day du: XONG.
- GO-LIVE GIAI DOAN 1: XONG - PR #34 (toan bo dev) + PR #35 (va ms-list 401); migrations 0056-0073 da ap len production DB (67 -> 86 bang, backup logic tai /opt/backups/turso-pre-golive-20261020.sql); MSINVOICE_* da cau hinh production; cron gom hoa don 23:30 VN da dat (cron-consolidate.sh) + campaign-auto-end da noi vao cron-auto-close.sh; dev da don credential prod (ve mock).
- Luu y: portal production dung catalog tinh trong repo portal nen bang portal_products rong tren production KHONG anh huong trang ban hang hien tai; nap du lieu portal_products la viec cua dot dua portal moi len production.
- Con lai: Shopee khoa live + uy quyen shop that (Giai doan 2), hang doi hoa don D1, escrow P3.

- D1 HOAN THANH TREN DEV (2026-10-20): migration 0074 (orders.delivery_confirmed_at/by); chan day hoa don tai MSInvoiceService.pushInvoice cho don ONLINE/SHOPEE chua xac nhan; consolidateDay gom don online theo NGAY XAC NHAN nhan hang thay vi ngay tao don; API confirm-delivery (kiem tra theo kenh: Shopee can PICKED_UP, portal can COMPLETED, idempotent, ghi nguoi+gio); hang doi /api/invoices/online-queue + khoi UI trong tab Hoa don; muc "Cho xac nhan khach nhan hang" trong tab Shopee. Da test van hanh that tren dev: chan day truoc xac nhan, phat hanh sau xac nhan, gom dung ngay xac nhan, tu choi xac nhan som. CHO: PR len main o dot go-live tiep theo; khi co API van chuyen thi dien tu dong 2 cot nay.
