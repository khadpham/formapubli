# BRIEF TỔNG HỢP: Cốt lõi vận hành + Hóa đơn điện tử + R2 + Portal mới
Ngày: 2026-10-14. Người duyệt: anh Kha. Điều phối: Muse.

Đọc `AGENT_GUIDE.md` và `FORMAPUBLI_MASTER_BLUEPRINT.md` trên nhánh dev trước khi làm.
Quy tắc tuyệt đối: không dấu gạch ngang dài, giờ UTC+7, chỉ làm trên dev, không sửa prod DB,
tsc sạch trước commit, chỉ push `origin dev`, KHÔNG tự tạo PR vào main.

---

## PHẦN 1: HÓA ĐƠN ĐIỆN TỬ MS-INVOICE (ưu tiên cao nhất)

### 1.1. Logic nghiệp vụ (anh Kha đã chốt, không được làm sai)

MỌI sản phẩm bán ra đều phải có hóa đơn. Không có ngoại lệ.

- **Khách lấy hóa đơn VAT:** Đơn gắn `fiscal_scope = 'OFFICIAL_TAX'`. Xuất HĐĐT ngay
  cho đơn đó qua MS-Invoice. Thủ kho được xuất hóa đơn khi khách yêu cầu.
- **Khách KHÔNG lấy hóa đơn:** Vẫn phải ghi nhận. Đơn gắn `fiscal_scope = 'INTERNAL_MANAGEMENT'`,
  xuất kho bình thường. Cuối ngày, hệ thống GOM TẤT CẢ đơn bán lẻ không lấy hóa đơn
  trong ngày thành MỘT hóa đơn tổng hợp duy nhất (đúng Nghị định 123/2020/NĐ-CP cho
  bán lẻ). Kế toán chỉ ký MỘT lần cho hóa đơn tổng hợp này.
- **Bán đầu nậu chiết khấu sâu không hóa đơn:** Giữ luồng RIÊNG, không gộp vào hóa đơn
  tổng hợp cuối ngày. Khi lập phiếu xuất kho cho đơn đầu nậu, có một tickbox rõ ràng
  "Xuất hóa đơn": tick thì `fiscal_scope = 'OFFICIAL_TAX'` và sinh hóa đơn, không tick
  thì `fiscal_scope = 'INTERNAL_MANAGEMENT'` và chỉ ghi nhận nội bộ. Một tick duy nhất
  quyết định luồng, không được để mập mờ.
- **Nguyên tắc sổ cái:** Mọi cuốn sách rời kho (bán có VAT, bán lẻ gộp cuối ngày,
  biếu tặng, lưu chiểu, bán đầu nậu không hóa đơn) đều phải có một dòng trong
  `inventory_ledger`. Sách trên phần mềm = Sách trên kệ 100%.
- **Tích hợp kho - hóa đơn:** Mọi nghiệp vụ xuất kho (bán lẻ, bán sỉ, đơn online,
  hội chợ, đầu nậu) đều phải có khả năng sinh hóa đơn. Luồng xuất kho và luồng hóa đơn
  phối hợp qua Outbox Pattern bất đồng bộ: xuất kho KHÔNG bị chặn bởi hóa đơn,
  hóa đơn được đẩy vào hàng đợi và xử lý riêng.

### 1.1b. Mô hình làm việc với kế toán (bối cảnh anh Kha xác nhận 2026-10-14)

Kế toán là đơn vị dịch vụ BÊN NGOÀI, không phải nhân viên công ty. Họ đã quen làm
việc hoàn toàn trên phần mềm MS-Invoice và không thể bắt họ chuyển sang ERP.
Vì vậy module hóa đơn tuân thủ mô hình sau, KHÔNG được thiết kế theo hướng ép
kế toán dùng ERP:

1. ERP chuẩn bị dữ liệu hóa đơn (từ đơn hàng / phiếu xuất kho) và ĐẨY sang
   MS-Invoice qua API (dạng nháp hoặc chờ ký, tùy cấu hình).
2. Kế toán xem, kiểm tra, duyệt và KÝ ngay trên MS-Invoice - công cụ họ đã quen.
3. ERP ĐỒNG BỘ NGƯỢC trạng thái, số hóa đơn, mã CQT, link tra cứu về để đối soát
   và báo cáo nội bộ.

ERP không bao giờ là nơi duy nhất tạo hóa đơn mà kế toán không nhìn thấy.
Mọi hóa đơn ERP sinh ra đều phải xuất hiện được trên MS-Invoice để kế toán kiểm soát.

### 1.2. Thông số kỹ thuật MS-Invoice (đã có từ POC)

- Demo: `https://docker-myinvoice.iamsoftware.com.vn`, user `0312303803-999`.
- Luồng: login lấy LoginKey -> POST `/create-from-3rd` (kèm certSn + isSigned=Y)
  -> remote signing qua IntrustCA (requirePinCode=N, không cần PIN).
- Ký hiệu: `1C26TVN`. Số hóa đơn tăng dần, ERP theo dõi số cuối đã dùng.
  Lưu mã tra cứu + link tracuu.myinvoice.vn + mã CQT.
- Hóa đơn máy tính tiền KHÔNG cần thiết bị phần cứng (loại phần mềm).

### 1.3. Việc cần làm

1. Xây module hóa đơn điện tử đầy đủ trên dev (service + API + UI), dùng demo API.
   Bảng: `einvoices` (đã có migration 0056) + bảng `einvoice_items`.
2. Chức năng xuất mẫu hóa đơn: từ đơn hàng / từ phiếu xuất kho, sinh đúng format
   MS-Invoice yêu cầu, đẩy lên demo, nhận về PDF + mã CQT.
3. Chức năng hóa đơn tổng hợp cuối ngày: cron 21h30 gom đơn bán lẻ `INTERNAL_MANAGEMENT`
   trong ngày thành một hóa đơn, trình kế toán ký một lần.
4. Test end-to-end trên demo: tạo -> ký -> lấy PDF -> tra cứu. Báo cáo từng bước.

---

## PHẦN 2: CLOUDFLARE R2 (lưu trữ file)

### 2.1. Hiện trạng
Chưa có một dòng code R2 nào. Blueprint chốt nguyên tắc: file lưu R2,
metadata trong bảng `documents` (migration 0057 đã có).

### 2.2. Anh Kha cần làm (hướng dẫn chi tiết ở PHỤ LỤC A bên dưới)
1. Tạo bucket R2 trên Cloudflare dashboard.
2. Tạo API token S3-compatible (quyền đọc/ghi bucket đó).
3. Gửi token cho Muse qua kênh an toàn (không chat thường).

### 2.3. Việc của agent (sau khi có token)
1. Viết `r2.service.ts`: upload/download/xóa file, dùng S3-compatible API.
2. Nối vào module tài liệu: upload file -> lưu R2 -> ghi metadata vào `documents`.
3. Dùng cho: file DOCX mẫu hợp đồng, biên lai chuyển khoản, và ảnh sản phẩm
   portal mới.

---

## PHẦN 3: PORTAL MỚI (repo riêng `khadpham/customer-order-portal`)

### 3.1. Hiện trạng
Portal hiện tại: trang chủ là màn hình đăng nhập (email/SDT), sau đó vào `/dat-mua`
chốt đơn 1 trang, 6 sản phẩm hardcode. Deploy Vercel, production datsach.formapubli.vn.

### 3.2. Chiến lược dev/staging (anh Kha chốt 2026-10-14)
- Tạo nhánh `dev` trong repo `khadpham/customer-order-portal`. Vercel tự động
  deploy preview cho nhánh dev mỗi lần push - đây là môi trường dev của portal.
- Biến môi trường trên preview dev: `FORMAPUBLI_API_URL=https://dev.formapubli.vn`
  (trỏ sang ERP dev, TUYỆT ĐỐI không trỏ production).
- Production giữ nguyên: nhánh `main`, `FORMAPUBLI_API_URL=https://app.formapubli.vn`.
- Hosting: tiếp tục dùng Vercel cho cả dev và production (khuyến nghị sau nghiên cứu,
  xem chi tiết ở PHỤ LỤC B). Không dựng portal dev trên VPS.
- Mọi thay đổi khách hàng nhìn thấy: preview trên dev trước, anh Kha duyệt mới
  merge vào main để deploy production.

### 3.3. Thiết kế mới (anh Kha chốt)
1. **Trang chủ hiển thị TOÀN BỘ sản phẩm ngay khi vào link.** Không còn màn hình
   đăng nhập chặn đầu. Khách xem, chọn sách, bấm đặt.
2. **Bắt buộc có tài khoản mới được xác nhận đơn.** Khi bấm đặt hàng:
   - Đã có thông tin -> đăng nhập (email hoặc SDT, không mật khẩu như hiện tại).
   - Chưa có -> đăng ký, lưu đầy đủ thông tin khách hàng.
3. **Lưu trữ toàn bộ thông tin khách hàng** để dùng cho đơn sau, đối soát, và
   chăm sóc khách hàng.
4. **Một mã đơn:** Portal gọi `POST /api/orders/reserve-code` (ERP dev đã có,
   đã audit an toàn) lấy mã `ORD...` trước khi khách thanh toán. Không tự sinh
   `DH-...` nữa. Mã này dùng xuyên suốt: hiển thị khách, VietQR, sheet, đối soát.

### 3.4. Việc cần làm
1. Tạo nhánh `dev`, cấu hình biến môi trường preview trỏ ERP dev.
2. Viết lại trang chủ thành catalog sản phẩm (lấy từ ERP API, không hardcode).
3. Luồng đặt hàng: chọn sách -> bấm đặt -> kiểm tra đăng nhập -> đăng nhập/đăng ký
   -> xác nhận đơn (đã có mã ORD từ reserve-code).
4. Trang này khách hàng nhìn thấy: MỌI thay đổi phải preview trên dev, anh Kha duyệt
   mới merge main deploy production.

---

## PHẦN 4: AUDIT NGHIỆP VỤ CỐT LÕI (kho, bán, chuyển, hoàn)

Rà soát, phân tích, kiểm nghiệm kỹ từng nghiệp vụ trên dev. Không sai sót.

### 4.1. Xuất kho
- Phiếu xuất kho có trạng thái DRAFT: lập nháp, in được phiếu nháp,
  sửa/xóa chỉ khi còn DRAFT.
- Xác nhận + ký duyệt mới TRỪ KHO THẬT (ghi `inventory_ledger`).
- Sổ cái kho: xem được lúc nào nhập gì, xuất gì, ai làm, đầy đủ theo giờ giấc.

### 4.2. Bán hàng
- POS, đơn portal, Shopee: đơn tạo -> duyệt -> xuất kho -> giao -> hoàn thành.
- Mỗi bước ghi ledger, không trừ kho 2 lần, không mất tồn.

### 4.3. Chuyển kho
- Phiếu chuyển kho: trừ kho nguồn, cộng kho đích, cùng một transaction,
  có mã liên kết (correlationId) để đối chiếu 2 đầu.

### 4.4. Hàng hoàn (đặc biệt Shopee)
- Phiếu hoàn độc lập + bút toán `RETURN_INBOUND` trên ledger.
- Phân loại: lành -> bán lại, xước nhẹ -> kho thanh lý, nát -> biên bản hủy.
- Đối soát hoàn Shopee với báo cáo sàn.

### 4.5. Test suite
Hiện tại chỉ có script tsx rời rạc, chưa có framework test chuẩn.
Việc cần làm: dựng test suite đầy đủ cho 4 nghiệp vụ trên (ít nhất test
tự động cho luồng happy path + các case lỗi đã từng xảy ra). Báo cáo độ phủ.

---

## PHẦN 5: MIGRATION MODAL (UI/UX)

`src/components/ui/Modal.tsx` đã có sẵn đúng chuẩn anh Kha yêu cầu:
- Desktop: modal tràn chiều ngang, nội dung bên trái, cột nút bấm hẹp bên phải.
- Mobile: layout 1 cột dọc, nút tối thiểu 44px.

Còn 15 modal cũ chưa migrate (dùng `fixed inset-0` trực tiếp), trong đó quan trọng:
`WholesaleDispatchModal` (xuất kho sỉ), `PortalOrdersPanel` (đơn portal),
`PosCheckoutTerminal` (POS), `DailyFairSettlementModal` (quyết toán hội chợ).

Việc cần làm: migrate từng modal sang wrapper, KHÔNG dùng sed/python sửa JSX
phức tạp (bài học 2026-10-13). Đọc file, sửa từng đoạn nhỏ bằng edit, chạy tsc
sau mỗi bước. Test desktop + mobile trên dev.

---

## PHẦN 6: THỨ TỰ THỰC HIỆN (điều phối)

1. **Trước mắt (Muse làm):** Test demo MS-Invoice end-to-end, viết hướng dẫn R2
   chi tiết cho anh Kha.
2. **Song song (agent làm trên dev):** Audit 4 nghiệp vụ cốt lõi + test suite.
3. **Sau khi có R2 token:** Agent implement `r2.service.ts` + nối module tài liệu.
4. **Sau khi audit xong:** Migrate 15 modal cũ.
5. **Portal mới:** Repo riêng, làm sau khi ERP ổn định. Preview bắt buộc trước deploy.
6. Mỗi phần xong và test đạt mới tách PR nhỏ vào main. Không gộp.

---

## PHỤ LỤC A: HƯỚNG DẪN ANH KHA TẠO R2 (làm một lần, khoảng 10 phút)

**Bước 1: Tạo bucket**
1. Đăng nhập Cloudflare dashboard (dash.cloudflare.com).
2. Menu trái -> R2 Object Storage -> Create bucket.
3. Đặt tên bucket: `formapubli-files`. Giữ mặc định còn lại -> Create.

**Bước 2: Tạo API token**
1. Trong trang R2 -> Manage R2 API tokens (góc phải) -> Create API token.
2. Tên token: `formapubli-erp`. Quyền: Object Read & Write.
3. Chọn Apply to specific buckets -> chọn `formapubli-files`.
4. TTL: không đặt hết hạn (hoặc 1 năm). -> Create.
5. Cloudflare hiện 3 giá trị, COPY NGAY (chỉ hiện một lần):
   - Access Key ID
   - Secret Access Key
   - Endpoint (dạng `https://<account-id>.r2.cloudflarestorage.com`)

**Bước 3: Gửi cho Muse**
Gửi 3 giá trị trên cho Muse qua kênh an toàn. Muse sẽ cấu hình vào VPS
(không lưu vào chat, không commit lên git) rồi implement service.

**Lưu ý:** R2 có free tier 10GB/tháng, đủ cho giai đoạn hiện tại. Không phát sinh phí
nếu chỉ lưu tài liệu và ảnh sản phẩm.
