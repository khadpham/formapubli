# BÁO CÁO THIẾT KẾ PORTAL BÁN SÁCH MỚI (datsach.formapubli.vn)
Ngày: 2026-10-14. Người duyệt: anh Kha. Điều phối: Muse.
Trạng thái: Báo cáo phân tích để thảo luận và giao agent thực hiện trên nhánh dev.

Repo: khadpham/customer-order-portal. Local: D:\Data Project\customer-order-portal.
Hosting: Vercel (cả dev preview và production, gói Hobby).
Quy tắc: không dấu gạch ngang dài, giờ UTC+7, preview bắt buộc trước khi merge main.

---

## 1. TẦM NHÌN

Portal là bộ mặt của FORMApubli ra thế giới. Không phải form đặt hàng đơn giản,
mà là một trang thương mại điện tử đầy đủ, đẹp, thông minh, thể hiện đẳng cấp
của một nhà xuất bản. Khách vào là thấy sách, mua hàng trong vài bước chạm,
quay lại thì được nhận ra ngay.

Nguyên tắc:
- Khách hàng là trung tâm. Mọi thứ phục vụ trải nghiệm mua sách.
- ERP là nguồn sự thật duy nhất. Portal không tự lưu nghiệp vụ riêng.
- Làm chắc, làm đẹp, không làm vội. Có môi trường dev để thử nghiệm.

---

## 2. KIẾN TRÚC DỮ LIỆU SẢN PHẨM (trả lời câu hỏi của anh Kha)

### 2.1. ERP lấy thông tin sản phẩm từ đâu?

Câu hỏi của anh rất đúng: ERP hiện biết sách dưới góc độ xuất bản (tên, tác giả,
ISBN, nhà in, giá vốn, tồn kho), nhưng không biết sách dưới góc độ bán hàng
(mô tả marketing, ảnh bìa đẹp, thứ tự trưng bày, giá bán lẻ).

Giải pháp: xây dựng lớp **Quản trị Nội dung Sản phẩm** (Product Content Management)
ngay trong ERP. Đây không phải là "ERP tự có sẵn", mà là module chúng ta xây thêm.
Cụ thể:

**Nguồn dữ liệu theo từng loại thông tin:**

| Loại thông tin | Nguồn | Ghi chú |
|---|---|---|
| Tên sách, tác giả, ISBN, năm XB | Bảng sách của ERP (đã có từ module xuất bản) | Dữ liệu gốc, không nhập lại |
| Giá bìa | Bảng sách của ERP | Giá chuẩn |
| Tồn kho thực tế | inventory_ledger của ERP | Để tự động ẩn nút mua khi hết hàng |
| Mô tả marketing, giới thiệu tác phẩm | Nhập mới trong trang Quản trị Portal | Copy từ sheet hiện tại lần đầu, sau đó sửa trên UI |
| Ảnh bìa, ảnh sản phẩm | Upload lên Cloudflare R2, lưu URL trong DB | R2 chính là để phục vụ việc này |
| Thứ tự sắp xếp, ẩn/hiện, giá khuyến mại | Cài đặt trong trang Quản trị Portal | Anh tùy biến hoàn toàn |
| Đánh giá, review của khách | Khách viết trên portal, lưu vào ERP | Hiển thị sau khi duyệt |

**Luồng khởi tạo:** Import một lần từ Google Sheet hiện tại (26 đầu sách, có sẵn
tên, mô tả, giá, link ảnh, ISBN) vào các bảng mới. Từ đó về sau, mọi chỉnh sửa
thực hiện trên trang Quản trị Portal trong ERP. Sheet cũ nghỉ hưu, không dùng nữa.

### 2.2. Ảnh sản phẩm lưu ở đâu?

Ảnh upload qua trang Quản trị Portal, lưu trên **Cloudflare R2** (bucket
`formapubli-files` đã lên kế hoạch), phục vụ qua CDN. Lý do:
- R2 rẻ, bền, không giới hạn băng thông nội bộ Cloudflare.
- ERP chỉ lưu URL ảnh trong DB, không lưu file nhị phân.
- Giai đoạn dev có thể dùng tạm link ảnh từ sheet cũ, nhưng bản production
  phải chuyển hết lên R2 để chủ động (link ngoài có thể chết bất cứ lúc nào).

### 2.3. Tùy biến giao diện portal đến mức nào?

Anh có toàn quyền. Bảng `portal_settings` trong ERP (đã có sẵn, hiện lưu
PORTAL_WAREHOUSE_ID) sẽ mở rộng thêm các cài đặt:
- Sách nổi bật hiển thị đầu trang (chọn tay từng cuốn).
- Thứ tự sắp xếp mặc định (mới nhất, bán chạy, giá tăng/giảm, tùy chỉnh tay).
- Banner/quảng cáo chương trình khuyến mại.
- Bật/tắt từng cuốn sách (thay cho checkbox cột A trên sheet).
- Giá bán riêng cho portal nếu khác giá bìa (mặc định = giá bìa).

Tất cả chỉnh trên UI trong ERP, không cần đụng code, không cần nhờ developer.

### 2.4. Bảng dữ liệu mới trong ERP

- `portal_products`: product_id (nối với bảng sách ERP), slug, mô tả marketing,
  thứ tự sắp xếp, hiển thị/ẩn, giá portal (null = dùng giá bìa), cờ nổi bật.
- `portal_product_images`: product_id, url ảnh (R2), thứ tự, ảnh chính/phụ.
- `portal_settings`: key-value (mở rộng từ bảng đã có).
- `portal_reviews`: product_id, customer_id, số sao, nội dung, trạng thái duyệt.
- `portal_promotions`: quy tắc khuyến mại (xem mục 7).

---

## 3. TÍNH NĂNG PORTAL (góc nhìn khách hàng)

### 3.1. Trang chủ - Catalog sản phẩm

- Vào link là thấy toàn bộ sản phẩm ngay. Không có màn hình đăng nhập chặn đầu.
- Lưới ô sản phẩm: mobile 2 cột, desktop 4-5 cột.
- Mỗi ô: ảnh bìa, tên sách, tác giả, giá bìa (gạch giá cũ nếu đang khuyến mại),
  nút "Mua".
- Bấm nút "Mua": thêm vào giỏ hàng, ở lại trang, hiện thông báo nhẹ
  ("Đã thêm [Tên sách] vào giỏ") + số lượng trên icon giỏ hàng tăng lên.
- Bấm vào ô sản phẩm (không phải nút Mua): mở modal chi tiết đầy đủ -
  ảnh lớn (vuốt xem nhiều ảnh), tên, tác giả, mô tả giới thiệu tác phẩm,
  thông tin chi tiết (ISBN, số trang, khổ sách, năm XB, nhà XB),
  đánh giá của khách khác, nút "Thêm vào giỏ".
- Thanh tìm kiếm theo tên sách/tác giả.
- Lọc theo thể loại (văn học dịch, văn học Việt, thiếu nhi...).
- Sắp xếp: mới nhất, bán chạy, giá tăng dần, giá giảm dần.
- Sách hết hàng: tự động hiện nhãn "Hết hàng", nút Mua bị vô hiệu hóa.
  KHÔNG hiển thị số lượng tồn kho cụ thể.

### 3.2. Giỏ hàng

- Icon giỏ hàng trên header, hiện số lượng sản phẩm.
- Bấm vào: mở drawer (mobile) hoặc dropdown/page (desktop) liệt kê sản phẩm,
  tăng/giảm số lượng, xóa từng món, tổng tiền tạm tính.
- Giỏ hàng của khách vãng lai: lưu trên trình duyệt (localStorage).
- Giỏ hàng của khách đã xác định tài khoản: đồng bộ vào tài khoản,
  đổi thiết bị vẫn còn.

### 3.3. Thanh toán

- Nút "Tiến hành thanh toán" từ giỏ hàng.
- Form thông tin: họ tên, số điện thoại, email, địa chỉ (tỉnh/quận/phường
  chọn từ danh sách có sẵn như hiện tại).
- **Tra cứu khách hàng tự động:** khi nhập đủ 10 số điện thoại hoặc email hợp lệ,
  hệ thống tự động tìm trong DB. Nếu tìm thấy, hiện "Chào [Tên], phải bạn không?"
  kèm nút xác nhận. Khách bấm xác nhận là tự động điền toàn bộ thông tin còn lại
  (địa chỉ đã lưu). Không cần mật khẩu, không cần nhớ tài khoản.
- Nếu không tìm thấy: coi như khách mới, điền form đầy đủ, hệ thống tạo tài khoản.
- Phương thức thanh toán: COD hoặc Chuyển khoản (giữ nguyên như hiện tại).
- Chuyển khoản: hiện VietQR với số tiền và nội dung = mã đơn ORD
  (lấy từ API reserve-code TRƯỚC khi hiện QR), upload ảnh biên lai.
- Áp dụng khuyến mại tự động (xem mục 7): ví dụ đơn trên 500.000đ tự động
  thêm quà tặng vào đơn.
- Xác nhận đơn: hiện tóm tắt đơn hàng, tổng tiền, quà tặng (nếu có).
  Bấm "Đặt hàng" là xong, chuyển sang trang thành công.

### 3.4. Tài khoản khách hàng

Sau khi đã xác định được tài khoản (qua tra cứu tự động), khách có trang
"Tài khoản của tôi" gồm:
- **Thông tin cá nhân:** xem và sửa họ tên, SĐT, email, địa chỉ
  (hỗ trợ nhiều địa chỉ giao hàng, chọn địa chỉ mặc định).
- **Đơn hàng của tôi:** danh sách đơn đã đặt, trạng thái từng đơn
  (chờ xác nhận, đang giao, đã giao, đã hủy), xem chi tiết đơn.
- **Đã mua:** danh sách sản phẩm đã mua, nút "Đánh giá" cho từng sản phẩm.
- **Đánh giá của tôi:** các review đã viết.

### 3.5. Đánh giá sản phẩm

- Khách đã mua hàng mới được đánh giá (chống review ảo).
- Chấm sao 1-5, viết nhận xét.
- Review mới ở trạng thái chờ duyệt, admin duyệt trên ERP mới hiển thị.
- Hiện điểm trung bình và số lượng đánh giá trên ô sản phẩm và modal chi tiết.

---

## 4. YÊU CẦU UI/UX (anh Kha nhấn mạnh)

- Đây là trang khách hàng nhìn thấy. Phải ĐẸP. Không chấp nhận UI tạm bợ.
- Phong cách: tinh gọn, thông minh, tử tế. Đúng tinh thần thương hiệu FORMApubli.
- Desktop: tận dụng chiều ngang, lưới sản phẩm rộng, modal chi tiết lớn.
- Mobile: layout riêng, một cột, nút chạm tối thiểu 44px, thao tác bằng ngón tay cái.
- Ảnh bìa sách phải hiển thị đẹp, đúng tỉ lệ, không méo, không vỡ.
- Mọi thay đổi giao diện: preview trên dev, anh Kha duyệt mới merge main.

---

## 5. API GIỮA PORTAL VÀ ERP

Portal gọi sang ERP qua các API riêng (prefix `/api/portal/`), xác thực bằng
`PORTAL_API_KEY`. ERP dev: `https://dev.formapubli.vn`. ERP prod:
`https://app.formapubli.vn`.

| API | Phương thức | Mục đích |
|---|---|---|
| `/api/portal/products` | GET | Danh sách sản phẩm (hỗ trợ tìm kiếm, lọc, sắp xếp, phân trang). Chỉ trả sản phẩm đang hiển thị. |
| `/api/portal/products/[slug]` | GET | Chi tiết một sản phẩm (mô tả, ảnh, tồn kho ẩn/hiện, đánh giá). |
| `/api/portal/reviews` | GET | Lấy review đã duyệt của một sản phẩm. |
| `/api/portal/reviews` | POST | Khách gửi review mới (trạng thái chờ duyệt). |
| `/api/orders/reserve-code` | POST | Lấy mã đơn ORD duy nhất TRƯỚC khi khách thanh toán (đã có trên dev). |
| `/api/portal/orders` | POST | Tạo đơn hàng (kèm mã ORD, thông tin khách, giỏ hàng, phương thức thanh toán). |
| `/api/portal/customers/lookup` | GET | Tra cứu khách theo SĐT hoặc email (?phone= / ?email=). |
| `/api/portal/customers` | POST | Tạo hoặc cập nhật thông tin khách hàng. |
| `/api/portal/customers/[id]/orders` | GET | Lịch sử đơn hàng của khách (cần session). |
| `/api/portal/promotions/active` | GET | Danh sách khuyến mại đang chạy để portal tự áp dụng. |

**Luồng tạo đơn chuẩn:**
1. Portal gọi `reserve-code` lấy mã ORD.
2. Nếu chuyển khoản: hiện VietQR với nội dung = mã ORD.
3. Khách xác nhận: portal gọi `/api/portal/orders` với mã ORD + toàn bộ thông tin.
4. ERP tạo đơn, trừ kho (hoặc giữ chỗ), bắn webhook n8n như hiện tại.

---

## 6. TRANG QUẢN TRỊ PORTAL (trong ERP, dành cho nhân viên)

- **Danh sách sản phẩm:** bảng gồm ảnh thumbnail, tên, giá, tồn kho, trạng thái
  hiển thị/ẩn, thứ tự. Nút bật/tắt hiển thị nhanh (thay checkbox sheet).
- **Sửa sản phẩm:** form sửa mô tả marketing, upload ảnh (lên R2), đặt thứ tự,
  đặt giá portal (để trống = giá bìa), đánh dấu nổi bật.
- **Import từ sheet:** nút import một lần từ Google Sheet cũ để khởi tạo dữ liệu.
- **Cài đặt portal:** banner, sắp xếp mặc định, các tùy chọn hiển thị.
- **Duyệt review:** danh sách review chờ duyệt, nút duyệt/từ chối.
- **Khuyến mại:** tạo/sửa quy tắc khuyến mại (xem mục 7).

---

## 7. KHUYẾN MẠI ĐA KÊNH (tích hợp khăng khít)

Hiện tại đã có chương trình tặng quà cho đơn trên 500.000đ / 1.000.000đ.
Yêu cầu của anh Kha: nghiêm túc hóa, tích hợp các kênh CHỦ ĐỘNG ĐƯỢC.

**Phạm vi áp dụng (anh Kha chốt 2026-10-14):** Chỉ các kênh chúng ta chủ động được:
- Bán tại hội chợ (fair).
- Bán trên portal online.
- Bán vật lý tại cửa hàng offline.

KHÔNG áp dụng cho Shopee và các sàn thương mại điện tử khác, vì không thể
cài đặt khuyến mại trên hệ thống của họ. Các sàn có cơ chế khuyến mại riêng,
không liên quan đến engine này.

**Nguyên tắc:**
- Quy tắc khuyến mại định nghĩa MỘT lần trong ERP (`portal_promotions`).
- Các kênh chủ động được (portal, POS, bán offline) gọi cùng một API kiểm tra
  khuyến mại.
- Logic áp dụng nhất quán: cùng một đơn, cùng điều kiện, cùng quà tặng,
  không phụ thuộc kênh.

**Loại khuyến mại giai đoạn 1:**
- Quà tặng theo ngưỡng giá trị đơn (ví dụ: trên 500k tặng bookmark,
  trên 1 triệu tặng túi vải).
- Giảm giá % hoặc số tiền cho sản phẩm/chương trình đặc biệt.
- Mỗi quy tắc có ngày bắt đầu, ngày kết thúc, điều kiện áp dụng.

**API:** `GET /api/portal/promotions/active` trả về quy tắc đang chạy.
Portal tự tính và hiện "Thêm Xđ nữa để nhận quà" (rất hiệu quả tăng giá trị đơn).
Khi tạo đơn, ERP kiểm tra lại và chốt quà tặng vào đơn (không tin hoàn toàn client).

---

## 8. QUYẾT ĐỊNH ĐÃ CHỐT (2026-10-14)

- Giá trên portal = giá bìa, trừ khi có chương trình khuyến mại đặc biệt.
- KHÔNG hiển thị số lượng tồn kho. Hết hàng thì tự động hiện nhãn "Hết hàng"
  và vô hiệu hóa nút Mua (dựa vào inventory_ledger của ERP, kho chính).
- Tra cứu khách hàng TỰ ĐỘNG khi nhập đủ SĐT/email (không cần bấm nút).
- Khách có trang tài khoản: sửa thông tin, xem đơn hàng, đánh giá sản phẩm.
- Ảnh sản phẩm lưu trên Cloudflare R2, không dùng link ngoài lâu dài.
- Dữ liệu sản phẩm quản trị trong ERP (trang Quản trị Portal), import một lần
  từ sheet cũ rồi bỏ sheet.
- Làm chắc, làm đẹp, không vội. Thử nghiệm kỹ trên dev.

---

## 9. LỘ TRÌNH THỰC HIỆN TRÊN DEV (đề xuất)

**Giai đoạn 1 - Nền tảng dữ liệu (ERP):**
1. Tạo các bảng `portal_products`, `portal_product_images`, `portal_reviews`,
   `portal_promotions`, mở rộng `portal_settings`.
2. API `/api/portal/products` và `/api/portal/products/[slug]`.
3. Chức năng import từ Google Sheet cũ.
4. Trang Quản trị Portal cơ bản trong ERP (danh sách + bật/tắt + sửa).

**Giai đoạn 2 - Portal mới (repo customer-order-portal, nhánh dev):**
1. Trang chủ catalog: lưới sản phẩm, tìm kiếm, lọc, sắp xếp.
2. Modal chi tiết sản phẩm.
3. Giỏ hàng (localStorage + đồng bộ tài khoản).
4. Thanh toán: form + tra cứu tự động + COD/chuyển khoản + reserve-code.
5. Trang tài khoản khách hàng + đánh giá.

**Giai đoạn 3 - Khuyến mại và hoàn thiện:**
1. Engine khuyến mại trong ERP + API.
2. Tích hợp quà tặng vào luồng đặt hàng portal.
3. Duyệt review, cài đặt portal, banner.
4. Test toàn diện desktop + mobile trên dev.

**Giai đoạn 4 - Lên production:**
1. Import dữ liệu thật, upload ảnh lên R2.
2. Anh Kha duyệt preview từng phần.
3. Merge dev vào main theo từng phần nhỏ, deploy Vercel production.

---

## 10. GHI CHÚ CHO AGENT THỰC HIỆN

- Đọc `AGENT_GUIDE.md` của repo portal trước khi code.
- Mọi API mới viết trên ERP phải nằm trên nhánh `dev` của repo formapubli,
  tuân thủ quy tắc: tsc sạch, chỉ push origin dev, không tạo PR vào main.
- Portal làm trên nhánh `dev` của repo customer-order-portal, Vercel tự deploy
  preview. Biến môi trường preview: `FORMAPUBLI_API_URL=https://dev.formapubli.vn`.
- UI là ưu tiên hàng đầu. Tham khảo các trang bán sách đẹp (Tiki, Fahasa)
  về cách trình bày, nhưng giữ bản sắc riêng của FORMApubli.
- Mobile-first trong tư duy, nhưng desktop phải tận dụng chiều ngang.
