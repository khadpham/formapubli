# PROMPT CHO CODING AGENT - ERP FORMAPUBLI (nhánh dev)
# Ngày cập nhật: 2026-10-14. Người duyệt: anh Kha.
# Copy toàn bộ prompt này cho agent local. Agent chạy trên Windows.
# Đường dẫn repo local: D:\Data Project\formapubli

---

## BỐI CẢNH

Bạn làm việc trên repo ERP formapubli (Next.js, TypeScript, SQLite/Turso, Drizzle ORM).
Nhánh làm việc: `dev`. TUYỆT ĐỐI không đụng nhánh `main` hoặc production.
Không tạo PR từ `dev` vào `main`.

Quy tắc bắt buộc:
- Không dùng dấu gạch ngang dài (chỉ dùng "-").
- Mọi thời gian dùng giờ Việt Nam (Asia/Ho_Chi_Minh, UTC+7).
- Chạy `npx tsc --noEmit` sạch trước mỗi commit.
- Chỉ push lên `origin dev`.
- Đọc `AGENT_GUIDE.md` và `FORMAPUBLI_MASTER_BLUEPRINT.md` trên nhánh dev trước khi code.

---

## QUYẾT ĐỊNH NGHIỆP VỤ MỚI NHẤT (anh Kha chốt 2026-10-14, không được làm sai)

### 1. HÓA ĐƠN ĐIỆN TỬ - MÔ HÌNH ĐƠN GIẢN HÓA

**Nguyên tắc tối cao:** MỌI sản phẩm bán ra đều phải có hóa đơn. Không có ngoại lệ.

**Ba luồng hóa đơn:**

a) **Khách lấy hóa đơn VAT:** Đơn gắn `fiscal_scope = 'OFFICIAL_TAX'`.
   ERP chuẩn bị dữ liệu và đẩy sang MS-Invoice làm NHÁP. Kế toán duyệt và ký sau.

b) **Khách KHÔNG lấy hóa đơn (bán lẻ):** Đơn gắn `fiscal_scope = 'INTERNAL_MANAGEMENT'`.
   Xuất kho bình thường. Cuối ngày (cron 21h30), hệ thống GOM TẤT CẢ đơn bán lẻ
   không lấy hóa đơn trong ngày thành MỘT hóa đơn tổng hợp duy nhất
   (theo Nghị định 123/2020/NĐ-CP). Đẩy nháp tổng hợp này sang MS-Invoice,
   kế toán ký MỘT lần.

c) **Bán đầu nậu chiết khấu sâu không hóa đơn:** Luồng RIÊNG, KHÔNG gộp vào hóa đơn
   tổng hợp cuối ngày. Khi lập phiếu xuất kho cho đơn đầu nậu, UI có tickbox rõ ràng
   "Xuất hóa đơn": tick thì `fiscal_scope = 'OFFICIAL_TAX'` và đẩy nháp hóa đơn,
   không tick thì `fiscal_scope = 'INTERNAL_MANAGEMENT'` và chỉ ghi nhận nội bộ.

**Mô hình làm việc với kế toán (QUAN TRỌNG):**

Kế toán là đơn vị dịch vụ BÊN NGOÀI, không phải nhân viên công ty. Họ làm việc
HOÀN TOÀN trên phần mềm MS-Invoice và đã quen cắm USB token để ký. KHÔNG ép họ
dùng ERP. KHÔNG cần remote signing.

Luồng chuẩn:
1. ERP chuẩn bị dữ liệu hóa đơn (từ đơn hàng / phiếu xuất kho).
2. ERP gọi API MS-Invoice tạo HÓA ĐƠN NHÁP (chưa ký) trên hệ thống MS-Invoice.
3. Kế toán mở MS-Invoice, thấy nháp do ERP đẩy lên, kiểm tra, cắm USB token ký
   như họ vẫn làm từ trước đến nay.
4. ERP ĐỒNG BỘ NGƯỢC: định kỳ gọi API lấy trạng thái, số hóa đơn, mã CQT,
   link tra cứu về lưu vào DB ERP để đối soát và báo cáo.

ERP không bao giờ tự ký hóa đơn. ERP chỉ chuẩn bị nháp.

### 2. KỸ THUẬT MS-INVOICE (đã verify qua POC ngày 2026-10-14)

- Demo API: `https://docker-myinvoice.iamsoftware.com.vn`
- Endpoint tạo hóa đơn: `POST /erp/rest/s1/iam-invoice/invoices/create-from-3rd`
- Để tạo NHÁP (không ký): gửi payload với `isSigned = "N"` (thay vì "Y" như POC đã test).
- Payload chuẩn đã verify:
  - `invoiceForm = 1`
  - `invoiceSerial = "C26TVN"` (ký hiệu, ERP lưu sẵn)
  - `currencyUomId = "VND"`
  - `productItems`: mảng sản phẩm (KHÔNG dùng trường `items`)
  - Mỗi productItem có `taxRate` (ví dụ 5 cho VAT 5%)
- Endpoint lấy chi tiết: `GET /erp/rest/s1/iam-invoice/invoices/{id}/detail`
- Endpoint lấy PDF: `GET /erp/rest/s1/iam-invoice/invoices/{id}/pdf-base64`
- Lưu ý: URL đúng có tiền tố `/erp/rest/s1/`, KHÔNG phải `/api/rest/s1/`.
- Credential demo KHÔNG hardcode trong source. Dùng biến môi trường.

### 3. VIỆC CẦN LÀM (theo thứ tự ưu tiên)

**Ưu tiên 1 - Module hóa đơn nháp:**
1. Tạo service `einvoice.service.ts`: hàm tạo nháp hóa đơn từ đơn hàng/phiếu xuất kho,
   gọi API MS-Invoice với `isSigned = "N"`, lưu kết quả vào bảng `einvoices`.
2. Bảng `einvoices` (migration 0056 đã có) + tạo thêm bảng `einvoice_items` nếu chưa có.
3. API endpoint nội bộ: `POST /api/einvoices/create-draft` (từ orderId hoặc deliveryOrderId).
4. Job đồng bộ ngược: cron mỗi 30 phút gọi API detail lấy trạng thái hóa đơn đã ký,
   cập nhật số hóa đơn, mã CQT, link tra cứu vào DB.

**Ưu tiên 2 - Hóa đơn tổng hợp cuối ngày:**
1. Cron 21h30: query tất cả đơn `INTERNAL_MANAGEMENT` trong ngày chưa được gộp.
2. Gom thành một hóa đơn tổng hợp duy nhất, đẩy nháp lên MS-Invoice.
3. Đánh dấu các đơn đã được gộp (tránh gộp trùng).
4. UI cho kế toán xem danh sách đơn trong hóa đơn tổng hợp.

**Ưu tiên 3 - Tickbox đầu nậu:**
1. Trên form lập phiếu xuất kho cho đơn bán sỉ/đầu nậu, thêm tickbox "Xuất hóa đơn".
2. Tick -> `fiscal_scope = 'OFFICIAL_TAX'` + tự động tạo nháp hóa đơn.
3. Không tick -> `fiscal_scope = 'INTERNAL_MANAGEMENT'`, chỉ ghi ledger.

**Ưu tiên 4 - Outbox Pattern:**
Luồng xuất kho và luồng hóa đơn phối hợp bất đồng bộ. Xuất kho KHÔNG bị chặn
nếu API MS-Invoice lỗi. Hóa đơn được đẩy vào hàng đợi (outbox table) và retry riêng.

### 4. BẢO MẬT

- Endpoint POC cũ `src/app/api/einvoice-test/route.ts` chứa credential demo hardcode
  và đang public. XÓA endpoint này hoặc chuyển credential sang biến môi trường
  và thêm xác thực đăng nhập.
- Credential MS-Invoice production (khi có) CHỈ lưu trong biến môi trường,
  KHÔNG commit lên git, KHÔNG hardcode.

---

## KIỂM THỬ

- Test tạo nháp hóa đơn trên demo API: verify nháp xuất hiện trên MS-Invoice.
- Test hóa đơn tổng hợp: tạo 3-5 đơn bán lẻ test, chạy cron gộp, verify một nháp duy nhất.
- Test tickbox đầu nậu: verify fiscal_scope đúng theo tick.
- Test đồng bộ ngược: ký tay một nháp trên demo, verify ERP cập nhật trạng thái.
- Tất cả test trên dev.formapubli.vn, không đụng production.

---

## BÀN GIAO

Mỗi phần xong:
1. `npx tsc --noEmit` sạch.
2. Commit rõ ràng, push `origin dev`.
3. Báo cáo: đã làm gì, test thế nào, kết quả ra sao.
4. KHÔNG tự tạo PR vào main. Chờ anh Kha duyệt từng phần.
