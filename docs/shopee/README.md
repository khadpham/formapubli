# KHO TRI THỨC LẬP TRÌNH TÍCH HỢP SHOPEE OPEN PLATFORM (V2)
**Dành cho hệ thống quản lý xuất bản và kho vận FORMApubli**

**Trạng thái tài liệu:** 🟢 **ĐÃ TRIỂN KHAI TRÊN `main` (06/10/2026) — CHỜ SANDBOX NGHIỆM THU**
*(Docs chỉ chính thức đóng khi có một đơn hàng test trên Sandbox chạy thông luồng từ đầu đến cuối và số liệu đối soát khớp 100%).*

> **Agent mới đọc trước (06/10):**
> 1. [`11-quyet-dinh-tab-shopee-va-role.md`](./11-quyet-dinh-tab-shopee-va-role.md) — 5 quyết định đã chốt với Chủ.
> 2. [`10-ke-hoach-trien-khai-shopee.md`](./10-ke-hoach-trien-khai-shopee.md) — master plan + trạng thái mới nhất (đầu file) + 3 suite đỏ tồn đọng.
> 3. `docs/superpowers/specs/2026-10-06-tab-shopee-design.md` + `docs/superpowers/plans/2026-10-06-tab-shopee.md` — spec + plan tab Shopee đã thực thi xong.

---

## 🌟 TÀI LIỆU CỐT LÕI (BẮT BUỘC ĐỌC TRƯỚC KHI CODE)

1. 👉 **[BẢN THIẾT KẾ KIẾN TRÚC TINH TÚY: 5 MẢNH GHÉP TỪ SHOPEE-SDK VÀO FORMAPUBLI](./00-kien-truc-tich-hop-tinh-tuy.md)**
   *Bản thiết kế chắt lọc 5 tinh túy lớn nhất từ repo `@congminh1254/shopee-sdk` nối thẳng vào mạch máu của FORMApubli (`orders.channel = 'SHOPEE'`, `recordMovementsBatch`, bảng CSDL Turso, tab "Chủ" và Webhook Cloudflare Worker).*

2. ⚠️ **[CÁC CẠM BẪY KỸ THUẬT & HƯỚNG DẪN TƯƠNG THÍCH CLOUDFLARE WORKERS](./09-cam-bay-va-tuong-thich-cloudflare.md)**
   *Phân tích chuyên sâu 8 cạm bẫy thực chiến: Mất token do InMemory trên Serverless, xung đột `node-fetch`/`Agent`, phình to kích thước Bundle, bão Webhook timeout 3s làm trừ kho 2 lần, tranh chấp tồn kho giữa quầy POS và Shopee (Race Condition), và giải thuật Buffer Stock.*

---

## MỤC LỤC TRA CỨU CHI TIẾT TỪNG CHUYÊN ĐỀ

1. **[Tài liệu 01: Kiến trúc Nền tảng & Xác thực OAuth 2.0](./01-kien-truc-va-xac-thuc-oauth2.md)**
   * Các loại App trên Shopee (In-house App vs Third-party App).
   * Môi trường Sandbox (UAT) vs Production (Live).
   * Thuật toán ký số HMAC-SHA256 (`sign`).
   * Vòng đời Token: `code` -> `access_token` (4h) -> `refresh_token` (30 ngày).

2. **[Tài liệu 02: Quản lý Đơn hàng (OMS)](./02-quan-ly-don-hang-oms.md)**
   * Vòng đời trạng thái đơn hàng Shopee (`READY_TO_SHIP`, `SHIPPED`, `COMPLETED`, `CANCELLED`...).
   * Đặc tả API `v2.order.get_order_list` (Phân trang con trỏ Cursor, giới hạn 15 ngày).
   * Đặc tả API `v2.order.get_order_detail` (Bóc tách sách, số lượng, combo quà tặng, địa chỉ nhận).

3. **[Tài liệu 03: Quản lý Sản phẩm & Đồng bộ Tồn kho (WMS)](./03-quan-ly-san-pham-va-dong-bo-kho.md)**
   * Quy chuẩn ánh xạ mã: Shopee SKU <-> Mã ấn bản ISBN-13 (`editions.isbn`).
   * Đặc tả API `v2.product.update_stock`.
   * Cơ chế khóa tồn kho ảo và giải thuật chống phạt "Sao Quả Tạ" do hết hàng.

4. **[Tài liệu 04: Vận chuyển & In Vận Đơn (Logistics & AWB)](./04-van-chuyen-va-in-van-don.md)**
   * Quy trình 3 bước xử lý giao hàng: `get_shipping_parameter` -> `ship_order` -> `get_tracking_number`.
   * Tải và in phiếu gửi hàng nhiệt A6 (100x150mm) trực tiếp bằng API `download_shipping_document`.

5. **[Tài liệu 05: Webhook & Cơ chế Bắn Tin Sự Kiện (Push Mechanism)](./05-webhook-va-co-che-ban-tin.md)**
   * Cấu hình Webhook URL trên Cloudflare Worker: `/api/shopee/push`.
   * Xác thực chữ ký webhook từ Shopee gửi sang (`HMAC-SHA256(webhook_url + "|" + rawBody, partner_key)`).
   * Xử lý tức thời sự kiện: Đơn hàng mới, Khách hủy đơn, Giao thành công, Khách trả hàng.

6. **[Tài liệu 06: Đối soát Tài chính & Báo cáo Lợi nhuận (Escrow Payment)](./06-doi-soat-tai-chinh-escrow.md)**
   * Đặc tả API `v2.payment.get_escrow_detail`.
   * Bóc tách các loại phí sàn: Phí thanh toán, phí cố định, voucher sàn trợ giá.
   * Liên kết số liệu doanh thu thực nhận vào tab **"Chủ"** của FORMApubli (Câu 8 & Câu 11).

7. **[Tài liệu 07: Bảng Mã Lỗi & Giới hạn Tần suất (Error Codes & Rate Limits)](./07-ma-loi-va-xu-ly-su-co.md)**
   * Bảng mã lỗi API thường gặp và cách xử lý (Token hết hạn, sai chữ ký, sản phẩm bị khóa...).
   * Giới hạn tần suất gọi API (Rate limits: 100 QPS) và cơ chế thử lại (Retry with exponential backoff).

8. **[Tài liệu 08: Đăng Tải Sản Phẩm Ngành Sách (Add Item)](./08-dang-san-pham-add-item.md)**
   * Chi tiết Module 89 (`v2.product.add_item`).
   * Các thuộc tính bắt buộc của ngành Sách: Tác giả, NXB, Năm XB, Số trang, Loại bìa, Trọng lượng kg.

9. 🚀 **[MASTER PLAN TRIỂN KHAI: 9 Task từ Sandbox đến Tab Chủ](./10-ke-hoach-trien-khai-shopee.md)**
   *Kế hoạch thực thi duy nhất: ràng buộc đã chốt với Anh (kho Âu Cơ, giá trần bìa, COD tắt bằng cờ, thủ kho thao tác), sơ đồ luồng, 9 task có test, và đầu việc chặn tầng báo cáo.*
