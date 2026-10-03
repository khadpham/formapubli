# TÀI LIỆU 09: CÁC CẠM BẪY KỸ THUẬT & HƯỚNG DẪN TƯƠNG THÍCH CLOUDFLARE WORKERS
**Phân tích chuyên sâu từ Senior Architect — Dành riêng cho hệ thống FORMApubli**

---

## 1. CẠM BẪY MÔI TRƯỜNG RUNTIME: CLOUDFLARE WORKERS VS NODE.JS

Hệ thống FORMApubli chạy trên nền tảng **Cloudflare Workers (Edge Serverless)** qua `@opennextjs/cloudflare`. Thư viện mẫu `shopee-sdk` được thiết kế chạy trên máy chủ Node.js truyền thống (VPS/Docker). Nếu bê nguyên xi SDK vào mà không chú ý, hệ thống sẽ gặp các "cái bẫy chết người" sau:

### 1.1. Cạm bẫy số 1: `InMemoryTokenStorage` làm mất Token liên tục
* **Bản chất lỗi:** 
  * SDK mẫu dùng một biến RAM `Map` trong file `in-memory-token-storage.ts` để cất token.
  * Trên Cloudflare Workers, kiến trúc là **Isolate Serverless**: Mỗi khi có request, một worker siêu nhẹ khởi động trong vài mili-giây, xử lý xong và có thể bị hủy ngay lập tức (Cold start / Spin down).
* **Hậu quả:** 
  * Vừa lấy được `access_token` ở request trước, sang request sau worker khác chạy $\rightarrow$ Biến RAM rỗng $\rightarrow$ Hệ thống báo lỗi `No access token found` hoặc phải liên tục gọi API lấy lại token $\rightarrow$ Bị Shopee khóa tài khoản vì spam API.
* **Giải pháp bắt buộc:**
  * **Tuyệt đối không dùng RAM.**
  * Phải dùng bảng CSDL `shopee_shop_tokens` trên Turso / LibSQL (như thiết kế ở Tài liệu 00). Mọi worker ở bất kỳ đâu trên thế giới đều đọc chung một nguồn sự thật duy nhất.

### 1.2. Cạm bẫy số 2: Phình to kích thước Bundle (Vượt trần nén Cloudflare)
* **Bản chất lỗi:**
  * Thư viện `@congminh1254/shopee-sdk` bao phủ 100% Shopee API (chứa hơn 30 Manager: LiveStream, Video, Ads, Games, TopPicks, SBS, FBS...).
  * Cloudflare Worker giới hạn kích thước script sau khi nén (thường là 3MB hoặc 10MB tùy gói).
* **Hậu quả:** Kéo cả SDK vào sẽ làm tăng thời gian build, làm chậm thời gian khởi động (Cold Start) của worker, và có nguy cơ khiến lệnh deploy lên Cloudflare bị từ chối vì vượt dung lượng.
* **Giải pháp bắt buộc (Quy tắc Ponytail):**
  * Không `npm install` nguyên gói SDK.
  * Chỉ trích xuất 3 module thiết yếu: Đơn hàng, Kho vận, Vận chuyển.

### 1.3. Cạm bẫy số 3: Xung đột `node-fetch` và `node:http Agent`
* Trong SDK: `src/fetch.ts` import `node-fetch`, còn `src/sdk.ts:36` import `{ Agent } from "node:http"` để truyền custom fetch agent.
* Trên Cloudflare Workers, đối tượng mạng chuẩn là **`globalThis.fetch`** có sẵn của trình duyệt/worker. Việc SDK phụ thuộc vào các module Node.js truyền thống và socket `Agent` không phải là cách làm tối ưu trên môi trường Edge.
* **Giải pháp:** Sử dụng trực tiếp `fetch()` nguyên bản của Cloudflare Workers, không cài thêm `node-fetch` hay `node:http Agent`.

---

## 2. CẠM BẪY XÁC THỰC & ĐỒNG BỘ THỜI GIAN (AUTH & CLOCK DRIFT)

### 2.1. Cạm bẫy số 4: Lệch giờ máy chủ (Clock Drift > 5 phút)
* **Quy định của Shopee:** Trường `timestamp` gửi lên không được lệch quá **300 giây (5 phút)** so với đồng hồ nguyên tử của máy chủ Shopee.
* **Hậu quả:** Nếu lệch quá 5 phút, Shopee sẽ trả về mã lỗi `error_sign` mặc dù thuật toán băm HMAC của bạn hoàn toàn đúng! Lỗi này cực kỳ khó debug vì lập trình viên tưởng mình băm sai mã.
* **Giải pháp:** Máy chủ Cloudflare Workers luôn được đồng bộ thời gian chuẩn xác theo giờ quốc tế. Tuy nhiên khi chạy máy dev cục bộ (Localhost trên Windows), lập trình viên phải bật tính năng *Auto Sync Time* trong Windows Settings.

### 2.2. Cạm bẫy số 5: Vòng lặp gia hạn Token vô tận (Refresh Token Loop)
* `refresh_token` có hạn 30 ngày. Nếu vì một lý do nào đó (Shop đổi mật khẩu, hoặc quá 30 ngày không có ai kích hoạt), `refresh_token` bị chết.
* Nếu code cứ tự động bắt lỗi `token_expired` rồi gọi tiếp `refreshToken()` trong vòng lặp `while/retry` $\rightarrow$ Sẽ tạo thành **vòng lặp vô tận (Infinite Loop)** làm treo máy chủ worker.
* **Giải pháp:** Thiết lập cờ đếm: Chỉ tự động refresh tối đa **1 lần**. Nếu refresh thất bại $\rightarrow$ Ném lỗi `CRITICAL_AUTH_EXPIRED` và bắn thông báo lên tab **Chủ** để Anh bấm "Ủy quyền lại".

---

## 3. CẠM BẪY KHO VẬN & TRANH CHẤP ĐỒNG THỜI (CONCURRENCY & RACE CONDITIONS)

### 3.1. Cạm bẫy số 6: Xung đột tồn kho giữa Quầy POS Hội Chợ và Khách Shopee
* **Tình huống thực tế:** Cuốn sách *Tristram Shandy* chỉ còn đúng **1 cuốn duy nhất** trong kho.
  * Lúc 14:00:01: Khách tại Hội chợ cầm sách ra quầy POS thanh toán. Thu ngân quẹt mã vạch.
  * Lúc 14:00:02: Khách trên mạng bấm mua trên Shopee.
  * Nếu không có rào chắn, hệ thống sẽ cho phép cả 2 người cùng mua $\rightarrow$ **Tồn kho bị âm -1** và Shopee phạt nặng vì không có sách giao!
* **Giải pháp thực chiến (Chiến lược 2 lớp):**
  1. **Lớp 1 - Tồn kho an toàn (Buffer Stock = 2 cuốn):** Số lượng đẩy lên Shopee luôn bằng `Tồn kho - 2`. Nếu kho chỉ còn 2 cuốn, Shopee tự động hiện "Hết hàng". 2 cuốn này giữ lại phục vụ bán lẻ trực tiếp.
  2. **Lớp 2 - Giao dịch nguyên tử (Atomic Transaction):** Tái sử dụng hàm `InventoryService.recordMovementsBatch`. Hàm này có sẵn mệnh đề `WHERE quantity >= requested_qty` trong SQL, nếu hết sách câu lệnh sẽ ném lỗi ngay lập tức, ngăn chặn việc tạo đơn ảo.

### 3.2. Cạm bẫy số 7: Đóng sự kiện hội chợ làm ảnh hưởng nhầm kho Shopee
* Khi kết thúc một hội chợ (VD: Đóng hội chợ Huế), phần mềm sẽ khóa kho và hoàn trả sách.
* Nếu code không rành mạch, sự kiện "Đóng hội chợ" có thể vô tình kích hoạt lệnh khóa hoặc thu hồi sách của cả Kho Chính (`PHYSICAL_MAIN`).
* **Giải pháp:** Kho bán Shopee **luôn luôn cố định là `PHYSICAL_MAIN`**. Các kho loại `FAIR_EVENT` độc lập hoàn toàn, việc mở hay đóng hội chợ không bao giờ được phép tác động đến liên kết Shopee.

---

## 4. CẠM BẪY WEBHOOK: BÃO YÊU CẦU & XỬ LÝ TRÙNG LẶP (IDEMPOTENCY)

### 4.1. Cạm bẫy số 8: Shopee bắn lại Webhook liên tục (Webhook Retry Storm)
* Shopee quy định: Khi Shopee gửi Webhook sang URL của bạn, máy chủ của bạn **phải trả về mã HTTP 200 trong vòng 3 giây**.
* Nếu máy chủ của bạn vừa nhận Webhook đã vội vã: Kéo chi tiết đơn $\rightarrow$ gọi DB $\rightarrow$ tính toán $\rightarrow$ in ấn... tổng cộng mất 4 giây $\rightarrow$ Shopee coi như request bị timeout $\rightarrow$ Shopee sẽ **tự động gửi lại (retry) gói tin đó 3 đến 5 lần nữa**!
* **Hậu quả:** Đơn hàng bị nhân đôi, nhân ba, sách trong kho bị trừ 3 lần!
* **Giải pháp bắt buộc:**
  1. Nhận Webhook $\rightarrow$ Kiểm tra chữ ký HMAC $\rightarrow$ **Trả về HTTP 200 ngay lập tức**!
  2. Việc kéo đơn và trừ kho được đưa vào hàng đợi xử lý ngầm (Background Task / Queue).
  3. Dùng mã khóa trùng lặp: `idempotencyKey = 'shopee-' + order_sn`. Nếu mã đơn này đã có trong bảng `orders`, hệ thống bỏ qua không bao giờ trừ kho lần 2.
