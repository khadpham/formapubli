# BRIEF TIẾN ĐỘ HỆ THỐNG FORMAPUBLI - TÍNH ĐẾN 2026-10-20

Đối tượng đọc: coding agent nhận task giai đoạn tiếp theo.
Mục đích: nắm toàn bộ trạng thái thật của hệ thống trước khi viết dòng code đầu tiên.
Quy ước ghi nguồn trong brief này:
- "(git)" = đã kiểm chứng trực tiếp bằng git/repo ngày 2026-10-20.
- "(hồ sơ)" = theo hồ sơ bàn giao/go-live đã ghi lại, không tự kiểm chứng lại được từ repo.
Nguồn sự thật duy nhất về nghiệp vụ: FORMAPUBLI_MASTER_BLUEPRINT.md ở gốc repo.
Tài liệu kèm theo trong docs/: masterplan-golive-va-shopee-2026-10-20.md (đọc PHẦN PHỤ LỤC
tiến độ ở cuối file, phần thân là kế hoạch buổi sáng đã bị thực tế thay thế),
runbook-shopee-live-cutover.md, nghien-cuu-shopee-api-v2-2026-10-20.md,
phan-tich-shopee-hoa-don-escrow-tab-hub-2026-10-20.md, thư mục docs/shopee/ (12 tài liệu kỹ thuật).

---

## 1. TRẠNG THÁI NHÁNH MAIN / DEV / PRODUCTION

| Hạng mục | Trạng thái |
| --- | --- |
| Nhánh main (git) | Tip `8ab8e58` "Merge pull request #35 from khadpham/dev" (2026-10-20 14:17 +07) |
| Nhánh dev (git) | Tip `df845be`; hơn main đúng 4 commit, trong đó chỉ 1 commit chứa code |
| Production | app.formapubli.vn chạy đúng main `8ab8e58` (hồ sơ go-live + đã kiểm chứng sống 2026-10-20) |
| Dev | dev.formapubli.vn, /opt/formapubli-dev trên VPS, PM2 `formapubli-dev`, port 3002, DB SQLite local dev.db |
| Production hạ tầng | VPS 160.187.228.139, /opt/formapubli, PM2 `formapubli` cluster 2 instance port 3000, DB Turso cloud |
| Migration production | Áp tới 0073; DB từ 67 lên 86 bảng (hồ sơ). Backup trước go-live: /opt/backups/turso-pre-golive-20261020.sql (hồ sơ) |
| Migration trong repo (git) | File 0000-0074, KHÔNG có 0066. 0074 mới chỉ áp trên dev |

Bằng chứng git (chạy tại clone, 2026-10-20):
- `git log origin/main -3`: 8ab8e58 (merge PR #35) <- 2c131d9 (fix ms-list) <- 46ff81a (merge PR #34, 2026-10-20 14:09 +07).
- `git log origin/main..origin/dev`: đúng 4 commit: `3dd8834` (code D1), `4d9d928`, `38e86ed`, `df845be` (cả 3 là tài liệu).
- `git diff --stat origin/main...origin/dev`: 12 file, +482/-3, toàn bộ thuộc D1 (xem mục 2.1).
- PR #33 (đối trả theo giá thực trả, merge `56641bf` ngày 2026-10-19 13:24 +07) là ancestor của main (git).
- PR #34 gộp toàn bộ dev vào main: khoảng từ `56641bf` đến `46ff81a` có 153 commit (git), gồm cả commit `f6b3d74` gộp main vào dev trước đó. Chủ dự án đã điều kiện: chỉ lên main khi toàn bộ dev hoàn thiện, kiểm chứng hết, không lỗi (quyết định D2).

Kết luận ngắn: main và dev hiện gần như trùng nhau. Lệch code duy nhất là D1. Production = main.

---

## 2. NHỮNG GÌ ĐÃ XÂY THEO MODULE

### 2.1. Hóa đơn điện tử + MS-Invoice (ĐÃ LIVE production)

Luồng chuẩn (blueprint mục 23.8): ERP chỉ chuẩn bị và đẩy hóa đơn lên MS-Invoice qua API.
Kế toán là dịch vụ bên ngoài, làm việc hoàn toàn trên MS-Invoice, ký bằng USB token trên đó.
ERP KHÔNG đụng ký số/remote signing (chốt 2026-10-19). ERP đồng bộ ngược trạng thái về.

- Nhà cung cấp: MS-Invoice production https://hoadon.msinvoice.vn. Tài khoản API = tài khoản web,
  username là MST công ty 0110626953. Ký hiệu hóa đơn: 1C26TVN (blueprint mục 39.1).
- Tạo hóa đơn: POST {base}/erp/rest/s1/iam-invoice/invoices/create-from-3rd, header api_key,
  đăng nhập qua login-key có cache theo process. thirdPartyCode = id hóa đơn ERP.
- BẮT BUỘC khi gửi: invoiceForm = 1 và invoiceSerial = "C26TVN" (tách ký hiệu). Gửi nguyên
  "1C26TVN" sẽ lỗi "Không tìm thấy mẫu hóa đơn 11C26TVN".
- BẮT BUỘC khi đọc kết quả: MS-Invoice trả HTTP 200 ngay cả khi lỗi logic. Phải throw khi
  data.success === 'N' hoặc data.error === true.
- Tiền và thuế: giá bìa đã gồm VAT nên amount gửi đi là giá tách ngược chưa thuế;
  productItems dùng taxRate dạng chuỗi. Thuế: sách 5% (VatTax5), in ấn 8% (VatTax8).
  Dùng 8% cho sách là SAI.
- Chuẩn bị hóa đơn: POST /api/invoices {action:'prepare'} từ đơn OFFICIAL_TAX; đẩy:
  POST /api/invoices/[id]/push {action:'push'} qua MSInvoiceService.pushInvoice (điểm đẩy duy nhất).
- Hóa đơn tổng hợp cuối ngày: consolidateDay gom đơn INTERNAL_MANAGEMENT COMPLETED thành 1 hóa đơn.
  Đã sửa lỗi giờ UTC (commit d120db6, có trong main): chuẩn hoá created_at bằng datetime() của SQLite
  (dữ liệu có 2 định dạng: ISO-Z và "YYYY-MM-DD HH:MM:SS", đều là mốc UTC) rồi so với cửa sổ ngày VN
  quy ra UTC. Cron production chạy 23:30 giờ VN (file cron-consolidate.sh trên VPS, hồ sơ).
  LƯU Ý MÂU THUẪN TÀI LIỆU: blueprint mục 23.8 còn ghi cron 21h30 - đó là số cũ, thực tế đã đặt 23:30.
- Tab mirror "Trên MS-Invoice": GET /api/invoices/ms-list qua POST search của vendor; kết quả nằm ở
  trường listData; mapping: serial <- invoiceFormSerial, number <- invoiceNo, total <- invoiceTotal,
  status <- statusId, buyerName <- toPartyName || toName, buyerTaxCode <- toPartyTaxId.
  Đã hiển thị đúng 82 hóa đơn thật (hồ sơ). PR #35 (2c131d9) sửa route này: lỗi xác thực trả 401,
  chỉ lỗi upstream MS-Invoice mới trả 502.
- Endpoint vendor đã biết thêm: pdf-base64 (lấy PDF), PUT gửi email hóa đơn, DELETE xóa nháp.
  CHƯA có tài liệu API hóa đơn điều chỉnh/thay thế (vendor chưa trả lời từ 2026-10-13).
- Rủi ro còn mở (hồ sơ): consolidate chưa có unique constraint/transaction chống gom trùng ở mức DB,
  tính idempotent hiện dựa vào kiểm tra consolidatedDate.
- D1 (MỚI, CHỈ TRÊN DEV - xem chi tiết ở mục 4): hóa đơn đơn online chỉ phát hành sau khi xác nhận
  khách đã nhận hàng. Code: migration 0074 (orders.delivery_confirmed_at, delivery_confirmed_by),
  src/lib/order-channels.ts (ONLINE_CHANNELS = ONLINE, SHOPEE), POST /api/orders/[id]/confirm-delivery,
  chốt chặn trong MSInvoiceService.pushInvoice, cổng ngày xác nhận trong consolidateDay,
  GET /api/invoices/online-queue, UI trong EinvoiceView và ShopeeTab. Đã test vận hành thật trên dev đạt.

### 2.2. Shopee (code đã live, kết nối live CHƯA - đang chờ duyệt Go-Live)

Code tích hợp đã nằm trong main qua PR #34. Production chưa có khóa live nên
GET /api/shopee/status trên production trả connected=false, shopId=null (cố ý, hồ sơ).

- Mã nguồn (git): src/services/shopee/ gồm sign.ts (ký HMAC-SHA256), token-store.ts
  (bảng shopee_shop_tokens), shop-config.ts (bảng shopee_settings), auth.ts, order-sync.ts,
  shipment.ts (chuỗi SPX), escrow-sync.ts, webhook.ts, stock-push.ts (buffer an toàn 2),
  revenue-guard.ts. Routes src/app/api/shopee/: auth-url, callback, push, status, config,
  queue, ship, awb, sync (đồng bộ chủ động POST {hours?}, mặc định 24h, tối đa 15 ngày).
- Biến môi trường chuẩn: SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY, SHOPEE_BASE_URL,
  SHOPEE_SHOP_ID, SHOPEE_UI_ENABLED. Tuyệt đối không ghi giá trị key vào file/log/commit.
- Thông số kỹ thuật bắt buộc (blueprint mục 39.2 + tài liệu nghiên cứu):
  access_token sống 4 giờ; refresh token sống 30 ngày và XOAY VÒNG mỗi lần refresh (phải lưu
  refresh token mới ngay khi refresh). Chuỗi ký: partner_id + path + timestamp + access_token +
  shop_id (API public bỏ 2 phần cuối). Host live: https://partner.shopeemobile.com.
  get_order_list cửa sổ tối đa 15 ngày; get_order_detail tối đa 50 đơn/lần.
  update_stock là GIÁ TRỊ TUYỆT ĐỐI, không phải delta. Webhook: phải trả lời trong 3 giây,
  Shopee retry sau 300s/1800s/10800s, không đảm bảo thứ tự - bắt buộc idempotent + có
  get_lost_push_message và poll dự phòng.
- Bẫy đã trả giá trên sandbox (đừng lặp lại):
  (1) get_order_list/get_order_detail chỉ trả đúng trường được xin qua response_optional_fields -
  thiếu order_status là đơn bị bỏ qua toàn bộ; phải xin đủ item_list, payment_method,
  recipient_address, shipping_carrier, total_amount, actual_shipping_fee (commit 8c91339).
  (2) payment_method Shopee trả là NHÃN "Cash on Delivery", không phải mã "COD" - nhận diện phải
  chuẩn hoá (commit a4829e9). (3) create_shipping_document bắt buộc kèm tracking_number trong
  order_list, lỗi từng đơn nằm trong result_list (commit 80bf1fb). (4) Mã vận đơn SPX có thể sinh
  trễ sau khi xếp lịch - luồng ship phải chịu trạng thái chờ mã, lỗi "already shipped" phải được
  giữ lại để lấy mã vận đơn quyết định (commits 4651f79, ce2250a, 31ae38f). (5) Endpoint token trả
  token ở GỐC JSON, không nằm dưới trường response (commit b0061e4). (6) Gói kiểm tra webhook
  code 0 của Shopee dùng chữ ký mẫu cố định không khớp HMAC thật - xử lý chuẩn: code 0 trả 200
  ngay, mọi sự kiện khác bắt buộc chữ ký hợp lệ.
- Sandbox đã kiểm chứng trọn vòng đời (hồ sơ; blueprint mục 39.2 ghi ở thời điểm sớm hơn nên
  còn nói "còn lại tạo đơn test" - phần đó đã làm xong sau đó): app "Vita Nova shopee" id 246728,
  Test Partner_id 1249102, test shop 227989704 đã ủy quyền vào ERP dev (token trong
  shopee_shop_tokens của dev.db), sản phẩm test item 803946511, đơn test chạy đủ vòng:
  đồng bộ về ERP, trừ kho đúng 1, COD nhận diện đúng, gửi SPX, lấy mã vận đơn, tải PDF vận đơn
  qua /api/shopee/awb, đọc được get_escrow_detail có order_income đầy đủ.
- Giới hạn VN về hóa đơn người mua (blueprint mục 39.2): get_buyer_invoice_info dùng được ở VN;
  get_pending_buyer_invoice_order_list, upload_invoice_doc, download_invoice_doc CHỈ mở cho
  PH/BR. Hệ quả thiết kế: hàng đợi hóa đơn Shopee do ERP tự xây; trả hóa đơn cho khách bằng EMAIL
  kèm link tra cứu MS-Invoice, dự phòng qua chat.
- Escrow (thiết kế P3, CHƯA code phần phân tích): đối soát 3 tầng get_escrow_detail (theo đơn)
  -> income report (theo kỳ) -> payout (khớp sao kê ngân hàng). Lãi thật tính trên
  escrow_amount_after_adjustment trừ COGS và marketing. Đơn VN có các khoản khấu trừ thuế
  withholding_vat_tax/pit_tax/cit_tax phải tách riêng. KHÔNG hardcode tỷ lệ phí sàn.
- Hồ sơ Go-Live: ĐÃ NỘP 2026-10-20 trên console (hồ sơ). Shopee báo kết quả qua email trong 24h.
  IP whitelist đã khai báo: 160.187.228.139 (IP VPS). Đổi IP máy chủ là phải cập nhật whitelist trước.
  Tài khoản cho đội duyệt: REVIEW-01 trên production, vai trò ROLE_SHOPEE_OPS (chỉ thấy tab Shopee
  và cài đặt cá nhân). Duyệt xong phải vô hiệu hóa ngay.
- Sau khi duyệt: làm đúng runbook-shopee-live-cutover.md (7 bước): cấu hình khóa live vào
  /opt/formapubli/.env, ủy quyền shop formapubli (Shopee Mall), gắn kho xuất qua PUT
  /api/shopee/config, cấu hình Push Mechanism trên console trỏ về
  https://app.formapubli.vn/api/shopee/push và bật nhóm sự kiện (việc này KHÔNG làm qua API được),
  gộp D1 lên production, kiểm chứng vận hành thật, đóng vòng bảo mật.

### 2.3. Portal đặt sách (ERP đã sẵn, mặt tiền mới CHƯA lên production)

- Hai repo: ERP khadpham/formapubli và portal khadpham/customer-order-portal (repo portal được
  push thẳng main theo lệnh riêng của chủ dự án; repo ERP thì không - xem mục 5).
- Production hiện tại: datsach.formapubli.vn chạy catalog TĨNH data/products.ts trong repo portal,
  KHÔNG đọc bảng portal_products. Bảng portal_products trên production đang TRỐNG là có chủ ý,
  không phải lỗi. Endpoint ERP phục vụ portal vẫn còn nguyên trong main (git): src/app/api/portal/,
  portal-orders/, portal-products/, portal-settings/ (gồm các luồng portal-orders, portal/orders,
  portal/customers, reserve-code).
- Migration liên quan: 0053 portal_settings, 0055 orders_portal_ref (bảng orders lưu cả order_code
  và portal_ref), 0063 portal_products.
- Nhánh dev của portal (Vercel preview) là bản mới: Server Components đọc trực tiếp ERP,
  91 sản phẩm SINGLE đã tái tạo kèm mô tả và ảnh bìa, quản lý sản phẩm portal nằm trong tab
  Portal/CRM của ERP, có checkbox VAT (hồ sơ). Chưa lên production; còn chờ duyệt nội dung
  và xử lý lỗi Google OAuth invalid_client khi upload biên lai (hồ sơ).
- Logic quà theo bộ combo trên main là BẢN DEV 16/10 (đủ thành phần từ bảng combo_components),
  thay cho bản production cũ của PR #32 (lấy min số lượng). Đây là thay đổi hành vi đã được
  báo cáo khi gộp (commit f6b3d74).

### 2.4. Hợp đồng + Dự án xuất bản (đã live, ĐANG RÀ SOÁT VẬN HÀNH)

- Nền dữ liệu (git): migrations 0050 contract_ai_flags, 0051 contract_review, 0052
  contract_projects, 0058 pub_templates, 0060 contract_templates_tkho, 0071 milestone_dates.
  Thư viện mẫu: 11 mẫu trên production (từ 3 mẫu cũ, hồ sơ). Có lớp AI hỗ trợ soạn/thẩm định
  (draftTemplateFromDescription, smartDraft) dùng Gemini.
- Quy trình đã chốt (blueprint mục 23, quyết định 2026-10-13): mỗi giai đoạn = 1 hợp đồng +
  1 biên bản nghiệm thu riêng. Chuỗi thứ tự bắt buộc: Thiết kế bìa -> Biên dịch -> Biên tập ->
  Dàn trang -> Morat. Xin bản quyền/giấy phép là luồng song song, không chặn chuỗi sản xuất.
  Rule engine kiểm tra logic thời gian của chuỗi ngày.
- Tính năng tạo ngược hợp đồng (sinh chuỗi hợp đồng lùi từ ngày quyết định xuất bản, tham số
  thuế cấu hình được, vượt rule phải cấp Quản lý trở lên + lý do + audit log) đã có bản thiết kế
  ngày 2026-10-19; còn chờ chốt cách chuẩn hoá 5 mẫu từ file hợp đồng thật (hồ sơ).
- Trạng thái thật: module đạt khoảng 60% mục tiêu lãi/lỗ theo đầu sách; file DOCX còn lưu base64
  trong DB, chưa đấu nối R2; 5 mẫu chuẩn v2 có template_data rỗng chờ upload mẫu (hồ sơ).
  Ngày 2026-10-20 chủ dự án test lại và phản hồi hệ thống nút bấm rắc rối, khó hiểu, có lỗi vận
  hành thực tế - module này đang trong diện rà soát lại toàn bộ theo vận hành thật. Agent nhận
  task hợp đồng phải chờ kết quả rà soát, không tự mở rộng tính năng.

### 2.5. Kho (đã live)

- Lõi: sổ cái kho append-only inventory_ledger + bảng tồn stock_balances (cột tồn
  physical_quantity). Cấm sửa/xóa bút toán; sai thì ghi bút toán đảo. Ghi ledger và cập nhật
  balance phải cùng transaction. Không âm kho.
- Thực thể 2 tầng: Tác phẩm (Work) và Ấn bản (Edition, gắn ISBN-13, giá bìa, đợt in).
- Luồng: nhập hàng từng phần, chuyển kho 2 bước qua IN_TRANSIT (không tăng kho đích khi mới xuất),
  kiểm kê theo phạm vi tùy ý (điền sẵn số đếm = tồn hiện tại, chỉ sửa dòng chênh lệch - chốt
  2026-10-16), migration 0067 inventory_counts, 0068 warehouse_documents (chứng từ kho đã sửa
  format A4, hồ sơ).
- Kho ký gửi CONSIGNMENT KHÔNG phải kho thật: chỉ là shortcut theo dõi trong tab Đối tác.
  Ma trận kho và mọi màn hình vận hành chỉ hiện kho vật lý (PHYSICAL_MAIN, FAIR_EVENT).
- Combo/Box set (blueprint mục 38): phát hiện combo bằng dòng trong combo_components (migration
  0064), không thêm cột vào products, không dùng bundle.service. 9 combo COMBO01-09. Thành phần
  bắt buộc là productKind BOOK. Dòng combo trong đơn giữ nguyên giá combo, edition_id NULL;
  tồn và bút toán nổ xuống component. UI: ComboManagerPanel + tab Combo trong StockOverviewMatrix.
- Cảnh báo tồn thấp: migration 0065 low_stock_threshold.

### 2.6. Bán hàng, POS, Đối trả (đã live)

- Kênh đơn (orders.channel): RETAIL_OFFICE và FAIR_EVENT là bán trực tiếp tại POS; ONLINE là
  portal; SHOPEE là sàn. Đơn online dồn về tab Shopee thành hub đơn online (quyết định
  2026-10-09, thay thế phương án để ở tab Bán hàng): thủ kho bấm "Xác nhận đã giao" là trừ kho
  luôn, không còn bước duyệt riêng.
- POS: đăng nhập theo ca (staffId + passcode qua POST /api/auth/login), két tiền theo ca
  (cashbox_sessions), chốt ngày theo kho. Endpoint chốt ngày POST /api/pos/daily-settlement
  (Owner/Manager) đã có sẵn tham số autoCloseOpenShifts ở tầng service (tự đóng ca quá giờ khi
  chốt ngày, ghi người + lý do) nhưng ĐÃ có nút trên DEV từ 2026-10-20 (commit 3d1d919): nút nằm ngay trong khối cảnh báo ca chưa đóng của Báo cáo chốt ngày, bắt buộc ghi lý do, đã kiểm thử vận hành thật trên dev; chưa lên production.
- Đối trả: phương án A, tính cả hai đầu theo GIÁ THỰC TRẢ (không theo giá bìa), PR #33 merge
  56641bf ngày 2026-10-19, đã live. Mọi action của /api/returns bắt buộc idempotencyKey.
- Đơn Shopee vào ERP có khóa idempotency dạng "shopee-<order_sn>"; đồng bộ lại phải idempotent
  (không trừ kho hai lần).

### 2.7. Chiến dịch (đã live)

- Migrations 0054 campaigns, 0073 campaign_reports. Tự động kết thúc chiến dịch:
  POST /api/cron/campaign-auto-end, bảo vệ bằng CRON_SECRET, ghi báo cáo kỳ vào campaign_reports.
  Trên production đã nối vào cron-auto-close.sh chạy mỗi 30 phút; đã test thật trả endedCount 0
  vì production chưa có campaign nào (hồ sơ).

### 2.8. Hệ thống / nền tảng

- Phân quyền theo vai trò (roles.ts): OWNER, MANAGER, CASHIER, WAREHOUSE, TAX, SHOPEE_OPS.
  allowedNavItems quyết định tab được thấy; vai trò lạ không mở được tab nào (fail-closed).
  SHOPEE_OPS chỉ có ['shopee', 'settings'] và bị giới hạn theo danh sách kho được cấp
  (shopee_settings key ops_warehouse_ids, mặc định là kho xuất đã cấu hình).
- Đã loại bỏ toàn bộ confirm()/alert() của trình duyệt khỏi ERP (batch fix, đã live qua PR #34).
  Lỗi hiển thị bằng setError hoặc popup hệ thống.
- Tab Tài liệu riêng đã gộp bỏ (2026-10-19): mỗi nghiệp vụ tự quản file đính kèm
  (migration 0057 documents).
- Thông báo đơn mới: OrderService bắn webhook fire-and-forget sang n8n
  (N8N_ORDER_WEBHOOK_URL) -> Telegram. Báo cáo tối 21h giờ VN (evening digest) và cảnh báo
  hạ tầng Beszel -> n8n -> Telegram (hồ sơ). Báo trước cho chủ dự án mỗi lần restart n8n.
- Kiểm thử: CHƯA có bộ test tự động chạy cổng merge/CI. Có script kiểm thử rải rác trong
  scripts/ (ví dụ test-combo-*) và chuẩn nghiệm thu hiện hành là: kịch bản vận hành thật trên
  dev (gọi API thật, bấm giao diện thật) + đối chiếu DB + cổng npx tsc --noEmit và npm run build.
  Không được báo xong chỉ dựa trên tsc/build.

---

## 3. QUYẾT ĐỊNH NGHIỆP VỤ ĐÃ CHỐT (không tự ý thay đổi)

| Ngày | Quyết định | Nguồn |
| --- | --- | --- |
| (đang áp dụng) | Thuế GTGT: sách 5%, in ấn 8%. Giá bìa đã gồm VAT, khi đẩy hóa đơn phải tách ngược | Blueprint 23.8, 39.1 |
| 2026-10-09 | Kho ký gửi CONSIGNMENT không phải kho thật, chỉ là shortcut trong tab Đối tác; ma trận kho chỉ hiện kho vật lý | Hồ sơ |
| 2026-10-09 | Toàn bộ đơn online (portal + Shopee) dồn về tab Shopee thành hub đơn online; bỏ duyệt chờ ở tab Bán hàng; thủ kho "Xác nhận đã giao" là trừ kho luôn | Hồ sơ |
| 2026-10-12 | SPX là đơn vị vận chuyển chính cho kênh online. Tích hợp API vận chuyển để PENDING (chủ dự án đang làm việc trực tiếp với bên vận chuyển) | Hồ sơ |
| 2026-10-13 | Hợp đồng: mỗi giai đoạn = 1 hợp đồng + 1 biên bản nghiệm thu riêng; chuỗi Thiết kế bìa -> Biên dịch -> Biên tập -> Dàn trang -> Morat; quyền/giấy phép là luồng song song không chặn sản xuất | Blueprint mục 23 |
| 2026-10-14 | MỌI sản phẩm bán ra đều phải có hóa đơn. Khách lấy VAT: fiscal_scope OFFICIAL_TAX, xuất ngay. Không lấy: INTERNAL_MANAGEMENT, cuối ngày gom thành MỘT hóa đơn tổng hợp, kế toán ký một lần. Đơn đầu nậu/bán buôn giữ luồng riêng, không gom; phiếu xuất kho đầu nậu có tickbox "Xuất hóa đơn" (tick = OFFICIAL_TAX) | Blueprint 23.8 |
| 2026-10-14 | Khuyến mãi chỉ áp kênh chủ động được (hội chợ, portal, offline). KHÔNG gồm Shopee và các sàn khác | Hồ sơ |
| 2026-10-16 | Kiểm kê: phạm vi là tập con tùy ý (không giới hạn số mặt hàng); tạo/mở đợt kiểm kê luôn điền sẵn số đếm = tồn hiện tại, chỉ sửa mặt hàng chênh lệch | Hồ sơ |
| 2026-10-19 | Phạm vi MS-Invoice: ERP CHỈ đẩy hóa đơn lên qua API, KHÔNG đụng ký số/remote signing. Kế toán (dịch vụ bên ngoài) duyệt/ký hoàn toàn trên MS-Invoice; ERP đồng bộ ngược trạng thái | Hồ sơ, blueprint 23.8 |
| 2026-10-19 | Đối trả đơn theo phương án A: tính cả hai đầu theo giá thực trả. Đã live qua PR #33 | Git + hồ sơ |
| 2026-10-19 | Bỏ tab Tài liệu riêng; mỗi nghiệp vụ tự quản file đính kèm | Hồ sơ |
| 2026-10-20 (D0) | App Shopee tên "Vita Nova shopee", logo docs/shopee-app/vitanova-logo.png, category Seller In House System (console không có mục "ERP System") | Masterplan mục 5 |
| 2026-10-20 (D1) | Hóa đơn đơn online CHỈ phát hành khi khách ĐÃ NHẬN HÀNG (thay thế cách hiểu "xuất ngay" trước đây). Trước mắt xác nhận thủ công (ghi người + thời gian); khi có API vận chuyển sẽ lấy mốc tự động, không làm lại quy trình | Masterplan mục 5 |
| 2026-10-20 (D2) | Lên main theo từng gói PR nhỏ nối tiếp; điều kiện: toàn bộ dev hoàn thiện, kiểm chứng hết, không lỗi mới được lên | Masterplan mục 5 |
| 2026-10-20 (D4) | Shop chính thức để ủy quyền live là formapubli (Shopee Mall). Hệ quả: escrow đảm bảo 15 ngày, phí cố định Mall cao hơn Non-Mall | Masterplan mục 5 |
| 2026-10-20 (D6, cập nhật cuối ngày) | ĐÃ dọn credential MS-Invoice production khỏi dev (dev chạy mock). Chủ dự án quyết định KHÔNG đổi mật khẩu MS-Invoice production vì mật khẩu liên quan cả kế toán bên ngoài, khó thực hiện - đóng mục này, không nhắc lại như việc chờ | Hồ sơ |
| Chưa chốt | D3 khung giờ deploy cố định (đề xuất tối sau 21h giờ VN; đợt go-live giai đoạn 1 thực tế đã deploy buổi chiều 2026-10-20 theo lệnh trực tiếp của chủ dự án). D5 xin scope Chat Shopee (hướng đề xuất: có xin, làm ở giai đoạn 3; khi nộp Go-Live chỉ xin các scope lõi, không xin chat) | Masterplan mục 5 + hồ sơ |

---

## 4. ĐANG CHỜ VÀ BƯỚC TIẾP THEO

Theo thứ tự ưu tiên của masterplan (giai đoạn 2 -> 4):

1. **Chờ duyệt Go-Live Shopee** (nộp 2026-10-20, Shopee hứa trả email trong 24h).
   Duyệt xong thì chạy runbook-shopee-live-cutover.md: khóa live -> ủy quyền shop formapubli Mall
   -> gắn kho xuất -> cấu hình push events trên console -> kiểm chứng đơn thật -> vô hiệu hóa
   REVIEW-01. Nếu Shopee yêu cầu thêm báo cáo kiểm thử xâm nhập (pentest) cho quyền PII không che
   thì dừng và báo chủ dự án.
2. **D1 lên production, gộp CÙNG đợt Shopee live** (quyết định của chủ dự án 2026-10-20, không đi
   riêng): PR dev -> main (hiện chỉ có 1 commit code D1 + 3 commit tài liệu), áp migration 0074
   lên Turso production, deploy theo quy trình mục 5, kiểm chứng: push bị chặn trước xác nhận,
   phát hành được sau xác nhận, đơn online chưa xác nhận không bị gom vào hóa đơn tổng hợp.
3. **Shopee P2** (sau khi P1 live ổn định): hàng đợi hóa đơn người mua nối pipeline MS-Invoice +
   gửi email hóa đơn; hoàn trả qua API; đồng bộ sản phẩm lên sàn có duyệt tay trước khi đẩy
   giá/tồn tự động; job báo lệch tồn ERP - Shopee hằng ngày (P1 chỉ đồng bộ về + cảnh báo,
   CHƯA đẩy tồn tự động).
4. **Shopee P3**: escrow/đối soát 3 tầng + phân tích đa chiều (đầu sách, chương trình, kho xuất,
   phương thức thanh toán, khu vực); tái cấu trúc tab thành hub "Đơn online" sau khi dữ liệu thật
   chạy ổn 1-2 tuần; cảnh báo AccountHealth.
5. **Portal mới lên production**: nạp dữ liệu portal_products cho production, duyệt nội dung
   (mô tả AI phải được người review; còn lỗi ISBN trong sheet nguồn cần chủ dự án sửa: Châu trai
   Wittgenstein, Tristram Shandy, Đợt khổ - hồ sơ), xử lý Google OAuth invalid_client (publish
   OAuth app sang Production + làm lại token Drive + cập nhật Vercel), rồi mới chuyển mặt tiền.
6. **Hóa đơn điều chỉnh/thay thế**: chờ tài liệu từ vendor MS-Invoice (đã hỏi từ 2026-10-13 chưa
   trả lời). Chưa có tài liệu thì không tự đoán payload.
7. **Hợp đồng**: chờ kết quả rà soát vận hành của chủ dự án (đang test lại 2026-10-20) rồi mới
   nhận task sửa; kèm các tồn tại đã biết ở mục 2.4 và thiết kế tạo ngược hợp đồng chờ chốt
   chuẩn hoá 5 mẫu.
8. **Nút cưỡng chế chốt ca trên giao diện**: ĐÃ XONG trên dev 2026-10-20 (commit 3d1d919).
   Nút đặt trong khối cảnh báo "Ca chưa đóng" của Báo cáo chốt ngày - đúng luồng chốt ngày,
   không đặt bừa; bắt buộc ghi lý do; ca bị đóng ở trạng thái chưa đếm tiền và ghi rõ người
   đóng thay (bản ghi chốt ngày đánh dấu UNVERIFIED). Đã kiểm thử thật trên dev. Chờ lên
   production ở đợt deploy tiếp theo.
9. **Việc vận hành treo khác (hồ sơ)**: day-close kho Âu Cơ từng kẹt từ 2026-10-11 do ca chưa
   chốt (đã gửi cảnh báo); redirect 301 book.formaform.vn -> app.formapubli.vn và xóa nhánh
   debug diag/worker-hang-1101 là việc của chủ dự án trên Cloudflare/GitHub.
10. **Nợ kỹ thuật ghi nhận**: chưa có test suite tự động (đề xuất xây bộ smoke test đã nêu,
    chưa được chốt); DOCX hợp đồng lưu base64 trong DB chưa chuyển R2; comment cũ trong
    return.service.ts ("FIX 2026-10-13 so giá bìa", biến returnCoverValue không còn dùng trong
    điều kiện) chưa dọn, không ảnh hưởng hành vi.

---

## 5. QUY TẮC LÀM VIỆC CHO AGENT NHẬN TASK

### 5.1. Nhánh và phát hành
- Repo ERP khadpham/formapubli: làm trên nhánh `dev`, môi trường dev. KHÔNG push thẳng `main`,
  mọi thay đổi lên main qua PR. (Repo customer-order-portal là ngoại lệ theo lệnh riêng: push
  thẳng main được.)
- Blueprint FORMAPUBLI_MASTER_BLUEPRINT.md là nguồn sự thật duy nhất. Quyết định mới phải ghi
  ngày + người chốt + ghi rõ thay thế quyết định cũ nào, cập nhật vào blueprint/masterplan.
- Deploy production chỉ sau merge, bằng SSH vào VPS: backup ecosystem.config.js của production
  trước (file này KHÁC bản trong repo: production là cluster 2 instance port 3000, bản repo là
  dev port 3002 - không bao giờ pm2 start bằng bản repo trong thư mục production), git pull
  origin main, nếu package.json thay đổi thì npm install trước, npx tsc --noEmit, npm run build,
  kiểm tra exit code TRỰC TIẾP (không qua pipe - pipe nuốt mã lỗi), chỉ pm2 reload khi build
  exit 0 và .next/BUILD_ID tồn tại.
- Migration áp tay lên DB production (Turso), có backup trước. Deploy code không tự chạy migration.
- Trên VPS dev, trước khi merge/đồng bộ PHẢI git fetch origin dev (từng có sự cố deploy giả vì
  merge từ cache cũ). Sau build phải kiểm exit code + BUILD_ID + PM2 ổn định, không tin HTTP 200
  tức thời (từng có build lỗi làm PM2 sập vòng lặp, 502 chập chờn).
- Trước mọi lệnh SSH/SCP phải chạy ~/workspace/bin/ensure-ssh.sh.

### 5.2. Điều cấm và chuẩn code/UI
- KHÔNG dùng confirm()/alert() của trình duyệt. Lỗi hiển thị bằng setError hoặc popup hệ thống.
- Nhãn giao diện: tiếng Việt CÓ DẤU, ngắn, là động từ rõ ràng (quy tắc trong AGENTS.md của repo).
  Mọi nút phải có dấu hiệu bấm rõ (icon/viền/aria) và trạng thái sau khi bấm.
- KHÔNG dùng gạch ngang dài (em dash, en dash) trong mọi sản phẩm: trả lời, code, commit message,
  tài liệu. Chỉ dùng dấu gạch ngang ngắn "-".
- Mọi thời gian theo Asia/Ho_Chi_Minh (UTC+7): hiển thị, cron, log, báo cáo. Cẩn thận dữ liệu
  thời gian trong DB có cả định dạng ISO-Z lẫn "YYYY-MM-DD HH:MM:SS" đều là mốc UTC - khi so
  theo ngày VN phải chuẩn hoá bằng datetime(), không so chuỗi thô.
- KHÔNG ghi secret/token/API key/mật khẩu vào file, commit, log hay báo cáo. Credential chỉ nằm
  trong .env trên máy chủ đích. Tài khoản cấp cho bên ngoài dùng đặc quyền tối thiểu (mẫu:
  ROLE_SHOPEE_OPS cho đội duyệt Shopee) và vô hiệu hóa ngay khi xong việc.
- Nút Làm mới dùng router.refresh(), giữ nguyên tab/state, không window.location.reload().
- Modal desktop: vừa đủ rộng, không cuộn dọc; quá dài thì chia 2 cột đồng nhất toàn hệ thống.
  Ô tìm trong modal: gõ đến đâu gợi ý đến đấy, render inline ngay dưới ô tìm.
- Không sửa JSX phức tạp bằng sed/python diện rộng; sửa từng đoạn nhỏ bằng edit chính xác và
  chạy tsc sau mỗi bước. Tên công ty trên mọi mẫu in là "FORMApubli".
- Test không được dùng chung hằng/giá trị với code (bài học trong AGENTS.md của repo: test từng
  xanh giả vì dùng cùng giá trị sai với code). Giá trị hằng phải lấy từ nguồn thật
  (src/db/schema.ts, file migration), không ghi nhớ, không đoán.

### 5.3. Chuẩn kiểm chứng trước khi báo xong
- Không báo hoàn thành chỉ dựa trên tsc/build/curl. Phải: chạy kịch bản vận hành thật trên dev
  (đăng nhập ca thật, gọi API thật hoặc bấm giao diện thật), đối chiếu DB sau thao tác, kiểm tra
  cả đường lỗi (thiếu quyền trả 403, chưa đăng nhập trả 401, idempotent khi gọi lại).
- Việc đụng tiền/kho/hóa đơn phải test cả chiều chặn (hành động bị cấm có bị chặn thật không)
  lẫn chiều thông (sau khi đủ điều kiện có chạy thật không), và dọn sạch dữ liệu test sau khi xong.
- Phân công hiện tại: điều phối viên (Muse) giữ việc khó/chiến lược và kiểm chứng; agent local
  nhận task theo brief có đầu mục, chỉ dẫn cụ thể và tiêu chí đạt rõ ràng. API contract là cầu
  nối giữa các agent - đổi contract phải ghi vào tài liệu kèm theo task.

---

## PHỤ LỤC: MÂU THUẪN VÀ ĐIỂM CẦN BIẾT KHI ĐỌC TÀI LIỆU GỐC

1. Blueprint mục 39.1 (dòng cuối) và mục 39.2 (đoạn tiến độ cuối) được viết TRƯỚC khi go-live
   xong nên còn ghi "MS-Invoice chưa lên production" và "Shopee còn lại tạo đơn test, nộp
   Go-Live". Thực tế đến cuối 2026-10-20: MS-Invoice đã live (PR #34/#35), vòng đời đơn sandbox
   đã kiểm chứng xong, hồ sơ Go-Live đã nộp. Đọc masterplan phần phụ lục tiến độ để lấy trạng
   thái mới nhất; blueprint chưa được cập nhật hai đoạn này.
2. Blueprint mục 23.8 ghi cron gom hóa đơn tổng hợp lúc 21h30; cron production thực tế đã đặt
   23:30 giờ VN. Dùng 23:30.
3. Masterplan phần thân (mục 1-7) mô tả kế hoạch buổi sáng 2026-10-20: tách go-live thành các
   PR-A/B/C/D và "5 migration 0069-0073 chưa áp". Thực tế đã làm khác: gộp một PR #34 (toàn bộ
   dev, sau khi merge main vào dev và regression đạt) + PR #35 vá lỗi, áp migrations 0056-0073.
   Phần phụ lục cuối masterplan là bản ghi đúng.
4. Số liệu chỉ có ở hồ sơ bàn giao, không kiểm chứng lại được từ repo: production có 86 bảng,
   mirror đọc 82 hóa đơn thật, nội dung các cron trên VPS, trạng thái connected=false của
   Shopee production, các con số của portal dev (91 sản phẩm). Khi dùng lại các số này trong
   báo cáo khác, ghi rõ là theo hồ sơ go-live 2026-10-20.
5. Số thứ tự migration thiếu 0066 là có chủ ý lịch sử (xem blueprint mục 38.1), không phải mất file.
