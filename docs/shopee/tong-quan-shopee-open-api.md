# HƯỚNG DẪN KỸ THUẬT & TÀI LIỆU TÍCH HỢP SHOPEE OPEN API (V2)
**Dành cho hệ thống quản lý xuất bản và kho vận FORMApubli**

---

## 1. TỔNG QUAN HỆ THỐNG SHOPEE OPEN PLATFORM

Shopee Open Platform cung cấp hệ thống REST API v2 toàn cầu (áp dụng cho Việt Nam và Đông Nam Á). Hệ thống cho phép các nhà bán hàng tự phát triển phần mềm nội bộ (**Seller In-house System**) kết nối trực tiếp với gian hàng để tự động hóa:
1. Nhận đơn hàng mới từ Shopee về hệ thống nội bộ.
2. Đồng bộ tồn kho thời gian thực giữa Kho sách vật lý và sàn Shopee.
3. Xác nhận chuẩn bị hàng và in phiếu gửi hàng (mã vận đơn SPX, GHTK, Viettel Post) trực tiếp.
4. Đối soát doanh thu thực nhận (sau khi Shopee trừ các loại phí sàn).

### Môi trường máy chủ (Endpoints)
* **Môi trường Test (Sandbox/UAT):** `https://partner.test-stable.shopeemobile.com`
* **Môi trường Chạy Thật (Live/Production):** `https://partner.shopeemobile.com`

---

## 2. CƠ CHẾ BẢO MẬT & XÁC THỰC (AUTHENTICATION & OAUTH 2.0)

Mọi API của Shopee đều yêu cầu chữ ký số HMAC-SHA256 để chống giả mạo, và cơ chế xác thực Token OAuth 2.0.

### 2.1. Tham số bắt buộc trên URL của mọi Request
Mọi yêu cầu gửi lên Shopee đều phải có các Query Parameters sau:
* `partner_id`: Mã định danh đối tác do Shopee cấp khi tạo App.
* `timestamp`: Thời gian gửi request tính bằng Unix timestamp (giây). Request bị từ chối nếu timestamp lệch quá 5 phút.
* `access_token`: Token ủy quyền của Shop (dành cho các API nghiệp vụ).
* `shop_id`: ID của gian hàng Shopee FORMApubli.
* `sign`: Chữ ký số băm HMAC-SHA256.

### 2.2. Cách tính chữ ký số `sign`
```text
base_string = partner_id + api_path + timestamp + access_token + shop_id
sign = HMAC_SHA256(base_string, partner_key).toHex()
```
*(Trong đó `partner_key` là chuỗi bí mật do Shopee cấp).*

### 2.3. Vòng đời Token (Token Lifecycle)
* **Ủy quyền lần đầu:** Chủ Shop bấm vào link ủy quyền trên Shopee $\rightarrow$ Shopee chuyển hướng về URL của FORMApubli kèm theo mã `code`.
* **Lấy Token:** Gọi API `v2/auth/token/get` truyền mã `code` để nhận về:
  * `access_token`: Có hiệu lực trong **4 giờ** (dùng để gọi API hàng ngày).
  * `refresh_token`: Có hiệu lực trong **30 ngày** (dùng để cấp mới `access_token`).
* **Cơ chế tự động làm mới (Auto Refresh):** Trước khi `access_token` hết hạn 4 giờ, hệ thống FORMApubli (qua Cron Job hoặc Background Task) gọi `v2/auth/access_token/get` với `refresh_token` để lấy cặp token mới. Quá trình này chạy ngầm 100%, không cần con người can thiệp.

---

## 3. NĂM NHÓM API TRỌNG TÂM DÀNH CHO FORMAPUBLI

Hệ thống tài liệu của Shopee có hàng trăm API (bao gồm cả livestream, quảng cáo, tiếp thị liên kết AMS...). Tuy nhiên, đối với hệ thống OMS & WMS của FORMApubli, chúng ta **chỉ cần tập trung vào 5 nhóm API cốt lõi**:

### NHÓM 1: QUẢN LÝ ĐƠN HÀNG (OMS)
* **`v2.order.get_order_list`**: 
  * Lấy danh sách các đơn hàng phát sinh trong khoảng thời gian (lọc theo trạng thái `READY_TO_SHIP` - Chờ giao hàng).
* **`v2.order.get_order_detail`**:
  * Lấy thông tin chi tiết một đơn: Danh sách sách khách mua, số lượng, tên người nhận, địa chỉ, phương thức thanh toán, tiền trợ giá, ghi chú đơn hàng.

### NHÓM 2: ĐỒNG BỘ TỒN KHO & SẢN PHẨM (WMS & INVENTORY SYNC)
* **Quy tắc ánh xạ (Mapping):**
  * Mã `item_sku` hoặc `model_sku` trên Shopee bắt buộc đặt trùng với **Mã ISBN-13** hoặc **Mã ấn bản** trong CSDL FORMApubli (`editions.code` hoặc `editions.isbn`).
* **`v2.product.update_stock`**:
  * Cập nhật số lượng tồn khả dụng lên Shopee.
  * **Ứng dụng thực tế:** Khi quầy POS bán được 5 cuốn hoặc kho chính xuất sách đi hội chợ $\rightarrow$ FORMApubli tự động gọi API này để hạ tồn kho trên Shopee, ngăn ngừa tình trạng hết hàng mà khách vẫn mua (bị Shopee phạt Sao Quả Tạ).

### NHÓM 3: VẬN CHUYỂN & IN PHIẾU GỬI HÀNG (LOGISTICS & AWB)
* **`v2.logistics.get_shipping_parameter`**:
  * Lấy thông tin kênh giao hàng (Ví dụ: SPX Express đến kho lấy hay nhân viên tự mang ra bưu cục).
* **`v2.logistics.ship_order`**:
  * Xác nhận đơn hàng "Đã sẵn sàng giao" $\rightarrow$ Shopee cấp Mã vận đơn (Tracking Number).
* **`v2.logistics.get_shipping_document_result` & `download_shipping_document`**:
  * Lấy file PDF phiếu gửi hàng tiêu chuẩn của Shopee (kích thước A6: 100x150mm hoặc 75x100mm nhiệt).
  * Nhân viên kho FORMApubli bấm in trực tiếp ra máy in nhiệt, dán lên gói sách là xong.

### NHÓM 4: CƠ CHẾ BẮN TIN TỰ ĐỘNG (WEBHOOK / PUSH MECHANISM)
Thay vì phần mềm phải liên tục gọi Shopee mỗi 5 phút để hỏi xem có đơn mới không (gây tốn tài nguyên và trễ đơn), Shopee cung cấp cơ chế Webhook:
* Cài đặt Webhook URL trên Shopee Developer Console trỏ về: `https://formapubli.vn/api/shopee/push`.
* Khi có khách đặt hàng hoặc khách hủy đơn, máy chủ Shopee tự động "bắn" gói tin JSON sang FORMApubli trong vòng 1-2 giây.
* Các sự kiện quan trọng cần đăng ký:
  * `1`: Cập nhật trạng thái đơn hàng (`ORDER_STATUS_UPDATE`).
  * `2`: Cập nhật mã vận đơn (`TRACKING_NO_UPDATE`).

### NHÓM 5: ĐỐI SOÁT DOANH THU & PHÍ SÀN (FINANCIAL ESCROW)
* **`v2.payment.get_escrow_detail`**:
  * Khi đơn hàng giao thành công, API này trả về bảng kê tài chính chi tiết:
    * Doanh thu giá bìa bán ra.
    * Phí thanh toán Shopee trừ (thường 3-4%).
    * Phí cố định sàn (thường 4-8%).
    * Tiền thực tế Shopee chuyển khoản về tài khoản ngân hàng của FORMApubli.
  * Giúp đưa chính xác con số doanh thu ròng vào mục **"Chủ"** để tính lãi/lỗ thực tế.

---

## 4. BẢN THIẾT KẾ CƠ SỞ DỮ LIỆU ĐỀ XUẤT CHO FORMAPUBLI

Để đón đầu kết nối này vào hệ thống Turso / LibSQL của chúng ta, cấu trúc bảng dữ liệu sẽ rất tinh gọn (tuân thủ nguyên tắc Ponytail: tối giản, không dư thừa):

```sql
-- 1. Lưu thông tin ủy quyền Shop & Token
CREATE TABLE shopee_shop_tokens (
    shop_id INTEGER PRIMARY KEY,
    shop_name TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expires_at INTEGER NOT NULL,      -- Thời điểm hết hạn (timestamp)
    refresh_expires_at INTEGER NOT NULL,
    is_active INTEGER DEFAULT 1 NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 2. Đơn hàng Shopee đồng bộ về
CREATE TABLE shopee_orders (
    shopee_order_sn TEXT PRIMARY KEY,       -- Mã đơn Shopee (VD: 241004ABCD123)
    order_id TEXT REFERENCES orders(id),    -- Khóa ngoại nối vào bảng orders nội bộ
    order_status TEXT NOT NULL,             -- READY_TO_SHIP, SHIPPED, COMPLETED, CANCELLED
    tracking_number TEXT,                   -- Mã vận đơn
    shipping_carrier TEXT,                  -- SPX, GHTK, Viettel Post
    total_amount REAL NOT NULL,             -- Khách thanh toán
    actual_escrow_amount REAL,              -- Tiền thực nhận sau trừ phí sàn
    synced_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

---

## 5. LỘ TRÌNH TRIỂN KHAI THỰC TẾ

1. **Bước 1 (Thủ tục):** Đăng ký tài khoản Lập trình viên tại [open.shopee.com](https://open.shopee.com) diện `Seller In-house System`. Điền thông tin Shop FORMApubli để chờ phê duyệt.
2. **Bước 2 (Chế độ bán ban đầu):** Khi mới khai trương gian hàng, nhân viên xử lý đơn trên trang `banhang.shopee.vn`. Trên FORMApubli, thủ kho dùng thao tác xuất kho đơn lẻ.
3. **Bước 3 (Kích hoạt Tự động hóa):** Khi lượng đơn đạt trên 20-30 đơn/ngày, kích hoạt module API trên FORMApubli để tự động kéo đơn, tự động trừ kho chính và in vận đơn một chạm.
