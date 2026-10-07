# Spec: Quản Lý & Soạn Thảo Hợp Đồng Tự Động (FORMApubli)

**Ngày lập:** 07/10/2026  
**Dự án:** `formapubli` (Hệ điều hành Quản trị Kho vận & Xuất bản FORMApubli)  
**Phạm vi:** Module Soạn thảo & Quản lý Hợp đồng/Văn bản tích hợp trực tiếp trên `book.formaform.vn`  
**Mục tiêu:** Cắt giảm 90% thời gian soạn thảo hợp đồng, triệt tiêu lỗi sao chép dữ liệu thủ công, xuất file Word/PDF chuẩn thể thức văn bản hành chính Việt Nam.

---

## 1. Nhu cầu thực tế & Bối cảnh bài toán

### 1.1. Hiện trạng tại FORMApubli
Là một đơn vị hoạt động trong lĩnh vực xuất bản và phát hành sách, FORMApubli thường xuyên phải phát sinh và xử lý khối lượng lớn các loại hợp đồng, thỏa thuận pháp lý và văn bản thỏa thuận giao dịch:
1. **Hợp đồng Chuyển nhượng/Cấp quyền Sử dụng Tác phẩm (Tác quyền):** Ký kết với tác giả hoặc dịch giả, quy định thời hạn bản quyền, phí nhượng quyền cố định hoặc % nhuận bút theo giá bìa, số lượng in ấn tối thiểu, tiến độ thanh toán.
2. **Hợp đồng Dịch thuật & Hiệu đính:** Ký với dịch giả, biên tập viên, quy định số lượng từ/trang, tiến độ nộp bản dịch, trách nhiệm bảo mật và đơn giá trang.
3. **Hợp đồng Gia công In ấn & Thành phẩm:** Ký với nhà in (đối tác `PRINTER`), quy định quy cách sách (kích thước, loại giấy ruột, giấy bìa, ép nhũ, số trang), số lượng ấn bản, đơn giá in/cuốn, lịch giao hàng về kho.
4. **Hợp đồng Đại lý Phát hành & Ký gửi sách:** Ký với các chuỗi nhà sách, đại lý sỉ, đơn vị phân phối (đối tác `WHOLESALE`, `CONSIGNMENT`), quy định mức chiết khấu (ví dụ 35% - 45%), hạn mức công nợ (`credit_limit`), chu kỳ đối soát & thanh toán gối đầu (`payment_due_days`).
5. **Hợp đồng Tài trợ / Đồng xuất bản / Hợp tác truyền thông:** Hợp tác với các tổ chức văn hóa, viện nghiên cứu, đại sứ quán...

### 1.2. Nỗi đau & Lãng phí trong quy trình cũ
* **Tỷ lệ lặp lại áp đảo (90/10):** Khoảng **90% nội dung của mỗi hợp đồng là cố định** — bao gồm:
  - Quốc hiệu, tiêu ngữ, căn cứ pháp luật (Bộ luật Dân sự, Luật Xuất bản, Luật Sở hữu trí tuệ).
  - Tên pháp nhân đại diện bên FORMApubli, địa chỉ trụ sở, mã số thuế, tài khoản ngân hàng.
  - Các điều khoản pháp lý chuẩn: quyền và nghĩa vụ các bên, chế tài phạt vi phạm hợp đồng, điều khoản bất khả kháng, cam kết bảo mật, giải quyết tranh chấp tại Tòa án/Trọng tài, hiệu lực thi hành.
  - Cấu trúc trình bày, thể thức căn lề, bảng chữ ký đại diện hai bên.
* **Chỉ 10% thông tin là biến động:**
  - Thông tin bên B (Họ tên đối tác, CMND/CCCD/Mã số thuế, địa chỉ, người đại diện, số điện thoại, email, số tài khoản nhận tiền).
  - Đối tượng hợp đồng (Tên tác phẩm, ấn bản ISBN, quy cách sách).
  - Số liệu thương mại (Số lượng bản in, đơn giá, tỷ lệ chiết khấu, giá trị hợp đồng, tiền nhuận bút bằng số và bằng chữ).
  - Ngày tháng ký kết và thời hạn hiệu lực.
* **Hậu quả của việc soạn thủ công trên file Word cũ:**
  - **Mất thời gian vô ích:** Nhân viên phải mở file mẫu cũ, sao chép (Copy - Paste), tìm từng con số/cái tên để thay thế. Mỗi hợp đồng mất từ 20 đến 45 phút.
  - **Lỗi sót dữ liệu cũ (Cực kỳ nguy hiểm và thiếu chuyên nghiệp):** Rất dễ quên sửa tên tác giả cũ, số CCCD cũ, hoặc để sót tên cuốn sách trước ở Điều 1.
  - **Lệch số tiền bằng chữ và bằng số:** Gõ số tiền bằng số nhưng quên tính lại phần "Bằng chữ", hoặc đọc sai đơn vị tiền tệ.
  - **Không có nơi lưu trữ tập trung:** Các file Word nằm rải rác trên máy tính cá nhân của nhân viên; khi ban giám đốc cần tra cứu lịch sử hợp đồng với một tác giả/đối tác thì phải hỏi lòng vòng.

---

## 2. Phân tích & So sánh các phương án kỹ thuật

Để giải quyết bài toán trên, chúng ta phân tích 3 phương án kiến trúc khả thi:

| Tiêu chí so sánh | Phương án 1: Hybrid Template Engine (`docxtemplater` + CSS Print) | Phương án 2: Backend Microservice Converter (Docker + Gotenberg/LibreOffice) | Phương án 3: Web WYSIWYG Editor (TipTap / Quill) |
| :--- | :--- | :--- | :--- |
| **Cơ chế hoạt động** | Merge biến `{key}` trực tiếp vào file Word `.docx` gốc bằng engine JS siêu nhẹ; Xem trước & In PDF qua CSS A4 của trình duyệt. | Gửi dữ liệu lên máy chủ Node/Python riêng chạy LibreOffice headless để convert `.docx` $\rightarrow$ PDF. | Hiển thị toàn bộ hợp đồng trên khung soạn thảo web (rich-text) cho phép gõ trực tiếp như Google Docs. |
| **Bảo toàn định dạng văn bản** | **Tuyệt đối 100%:** Giữ nguyên từng bảng biểu, thụt lề tab, font Times New Roman, header/footer của file Word mẫu. | **Tốt:** Giữ nguyên định dạng Word, nhưng phụ thuộc bộ font cài đặt trên máy chủ Linux. | **Kém:** Rất khó căn lề chuẩn thể thức hành chính VN; convert ngược từ HTML sang `.docx` thường bị vỡ layout. |
| **Tốc độ phản hồi** | **Tức thì (< 0.5s):** Xử lý nhanh, download ngay lập tức. | **Chậm (2s - 5s):** Phải upload file lên container, chạy LibreOffice nặng nề rồi tải về. | **Tức thì** trên web. |
| **Độ phức tạp hạ tầng** | **Tối giản (Zero Infra):** Chạy mượt mà trên Cloudflare Pages / Workers / Vercel hiện tại của dự án. Tuân thủ triệt để YAGNI. | **Phức tạp:** Phải thuê thêm VPS/Docker, quản lý uptime, bảo mật, vá lỗi LibreOffice. | **Trung bình:** Phải cấu hình parser HTML/Word phức tạp. |
| **Bảo vệ nội dung pháp lý (90%)** | **An toàn cao:** Nhân viên chỉ điền 10% trường biến vào form; không thể vô tình sửa xóa nhầm 90% câu chữ pháp lý. | **An toàn cao:** Chỉ điền biến vào form. | **Rủi ro cao:** Nhân viên có thể vô tình xóa mất một câu trong điều khoản bảo mật hay bồi thường. |
| **Quản lý & Cập nhật mẫu** | **Rất dễ dàng:** Phòng Pháp chế sửa file Word mẫu trên máy tính rồi upload lên web là xong. | **Dễ dàng:** Upload file Word mẫu. | **Khó:** Phải copy-paste HTML mẫu vào database, căn chỉnh lại CSS. |
| **Chi phí vận hành** | **0 đồng** (không phát sinh tài nguyên hạ tầng mới). | **Tốn kém** chi phí duy trì VPS/Docker riêng hàng tháng. | **0 đồng**. |

### 🎯 Kết luận lựa chọn: Phương án 1 (Hybrid Template Engine)
* Phương án 1 đáp ứng hoàn hảo yêu cầu:
  1. Giữ nguyên 100% mẫu Word quy chuẩn của công ty.
  2. Xuất file Word (.docx) chuẩn chỉnh để gửi đối tác hoặc lưu trữ.
  3. Xuất file PDF sắc nét thông qua tính năng In ấn vector (Print Preview A4) chuẩn Nghị định 30/2020/NĐ-CP.
  4. Nhẹ, bền bỉ, tích hợp tự nhiên vào hệ thống `formapubli` hiện tại mà không làm phình to kiến trúc.

---

## 3. Kiến trúc hệ thống chi tiết (Design Details)

### 3.1. Mô hình Dữ liệu (Database Schema)

Dự án sẽ bổ sung 2 bảng mới trong `src/db/schema.ts` (Migration `0046_contract_management.sql`):

```sql
-- 1. Bảng quản lý Mẫu Hợp Đồng (Templates)
CREATE TABLE contract_templates (
  id TEXT PRIMARY KEY,                       -- e.g. 'ctpl-xuat-ban', 'ctpl-dai-ly'
  code TEXT NOT NULL UNIQUE,                 -- e.g. 'HD_XUAT_BAN', 'HD_DAI_LY_SI'
  title TEXT NOT NULL,                       -- e.g. 'Hợp đồng xuất bản và phát hành tác phẩm'
  category TEXT NOT NULL DEFAULT 'TAC_QUYEN',-- 'TAC_QUYEN' | 'DAI_LY' | 'IN_AN' | 'DICH_THUAT' | 'KHAC'
  description TEXT,                          -- Mô tả mục đích sử dụng
  template_filename TEXT NOT NULL,           -- Tên file .docx gốc (e.g. 'Mau_HD_Xuat_Ban_2026.docx')
  template_data TEXT NOT NULL,               -- Chuỗi Base64 của file .docx mẫu
  schema_fields TEXT NOT NULL,               -- JSON cấu hình các biến { key, label, type, required, autoFillSource }
  version INTEGER NOT NULL DEFAULT 1,        -- Phiên bản của mẫu
  is_active INTEGER NOT NULL DEFAULT 1,      -- 1: Đang dùng, 0: Ngưng dùng
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 2. Bảng quản lý Các Bản Hợp Đồng Đã Soạn (Documents)
CREATE TABLE contract_documents (
  id TEXT PRIMARY KEY,                       -- e.g. 'cdoc-202610-001'
  contract_number TEXT NOT NULL UNIQUE,      -- Số HĐ: e.g. '01/2026/HĐXB-FORMA'
  template_id TEXT NOT NULL REFERENCES contract_templates(id),
  title TEXT NOT NULL,                       -- Tiêu đề ngắn gọn: 'HĐXB - Đồi Gió Hú - Tác giả Emily Bronte'
  partner_id TEXT REFERENCES partners(id),   -- Liên kết đối tác nếu có (Đại lý, Tác giả, Nhà in)
  work_id TEXT REFERENCES works(id),         -- Liên kết tác phẩm nếu có
  status TEXT NOT NULL DEFAULT 'DRAFT',      -- 'DRAFT' (Bản nháp) | 'FINALIZED' (Đã chốt) | 'SIGNED' (Đã ký) | 'CANCELLED' (Đã hủy)
  payload_data TEXT NOT NULL,                -- JSON lưu toàn bộ giá trị các trường biến (10%) đã nhập
  created_by TEXT NOT NULL,                  -- Mã nhân viên / tài khoản tạo
  signed_date TEXT,                          -- Ngày ký kết (YYYY-MM-DD)
  effective_date TEXT,                       -- Ngày có hiệu lực
  expiry_date TEXT,                          -- Ngày hết hạn hợp đồng
  total_amount REAL DEFAULT 0,               -- Giá trị hợp đồng (nếu có số tiền)
  notes TEXT,                                -- Ghi chú nội bộ
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### 3.2. Cấu trúc Placeholder & Thư viện thẻ biến (Variable Registry)

File Word mẫu (.docx) sử dụng cú pháp dấu ngoặc nhọn `{ten_bien}` để định vị vị trí dữ liệu cần thay thế.

#### Danh mục biến chuẩn hóa theo nghiệp vụ FORMApubli:
1. **Thông tin Bên A (FORMApubli - Cố định hoặc tự điền):**
   - `{ben_a_ten}`: `CÔNG TY TNHH XUẤT BẢN FORMA` (thương hiệu `FORMApubli`)
   - `{ben_a_dai_dien}`: Họ tên người đại diện pháp luật
   - `{ben_a_chuc_vu}`: Chức vụ (Giám đốc)
   - `{ben_a_dia_chi}`: Địa chỉ trụ sở
   - `{ben_a_mst}`: Mã số thuế
   - `{ben_a_sdt}`: Số điện thoại
   - `{ben_a_tk_ngan_hang}`: Số tài khoản ngân hàng (tự động lấy từ bảng `bank_accounts`)
   - `{ben_a_ngan_hang}`: Tên ngân hàng

2. **Thông tin Bên B (Đối tác / Tác giả / Đại lý - Tự điền từ `partners`):**
   - `{ben_b_ten}`: Tên đối tác / tác giả
   - `{ben_b_dai_dien}`: Người đại diện (nếu là pháp nhân)
   - `{ben_b_chuc_vu}`: Chức vụ
   - `{ben_b_cccd_mst}`: Số CCCD hoặc Mã số thuế
   - `{ben_b_ngay_cap}`: Ngày cấp CCCD
   - `{ben_b_noi_cap}`: Nơi cấp CCCD
   - `{ben_b_dia_chi}`: Địa chỉ liên hệ
   - `{ben_b_sdt}`: Số điện thoại
   - `{ben_b_email}`: Email
   - `{ben_b_stk}`: Số tài khoản ngân hàng Bên B
   - `{ben_b_ngan_hang}`: Ngân hàng Bên B

3. **Thông tin Tác phẩm / Hàng hóa (Tự điền từ `works` & `editions`):**
   - `{ten_tac_pham}`: Tên tác phẩm (`works.title`)
   - `{tac_gia}`: Tên tác giả (`works.author`)
   - `{dich_gia}`: Tên người dịch (`works.translator`)
   - `{ma_isbn}`: Mã chuẩn 13 số (`editions.isbn`)
   - `{gia_bia_so}`: Giá bìa niêm yết (e.g. `120.000 VNĐ`)
   - `{gia_bia_chu}`: Giá bìa bằng chữ (e.g. `Một trăm hai mươi nghìn đồng`)
   - `{so_luong_in}`: Số lượng bản in (cuốn)

4. **Thông tin Thương mại & Tài chính:**
   - `{gia_tri_hd_so}`: Tổng giá trị hợp đồng bằng số (e.g. `50.000.000 VNĐ`)
   - `{gia_tri_hd_chu}`: Tổng giá trị hợp đồng bằng chữ (e.g. `Năm mươi triệu đồng chẵn`)
   - `{ty_le_nhuan_but}`: Tỷ lệ % nhuận bút (e.g. `10%`)
   - `{ty_le_chiet_khau}`: Tỷ lệ % chiết khấu đại lý (e.g. `40%`)
   - `{han_muc_cong_no}`: Hạn mức nợ gối đầu (từ `partners.credit_limit`)
   - `{thoi_han_thanh_toan}`: Số ngày thanh toán (từ `partners.payment_due_days`)

5. **Thời gian & Thể thức:**
   - `{ngay_ky}`: e.g. `ngày 07 tháng 10 năm 2026`
   - `{so_hop_dong}`: e.g. `15/2026/HĐXB-FORMA`
   - `{thoi_han_hop_dong}`: e.g. `05 (năm) năm kể từ ngày ký`

### 3.3. Bộ công cụ tự động hóa thông minh (Smart Helpers)
1. **Helper đọc số thành chữ tiếng Việt chuẩn (`vietnamese-number-reader.ts`):**
   - Chuyển `15000000` $\rightarrow$ `"Mười lăm triệu đồng chẵn"`.
   - Xử lý mượt mà các trường hợp: *lăm/năm*, *mười/mươi*, *mốt/một*, *linh/lẻ*.
   - Có kiểm thử đơn vị độc lập.
2. **Helper định dạng ngày tháng văn bản hành chính Việt Nam (`vietnamese-date-formatter.ts`):**
   - Định dạng: `"Hà Nội, ngày 07 tháng 10 năm 2026"`.
   - Thêm số `0` đệm cho ngày < 10 và tháng < 3 theo đúng quy chuẩn Nghị định 30/2020/NĐ-CP.
3. **Auto-Fill Data Adapter:**
   - Khi chọn `Đối tác`: tự động map thông tin tên, địa chỉ, sđt, tax code, chiết khấu, công nợ.
   - Khi chọn `Tác phẩm`: tự động map tên sách, tác giả, dịch giả, giá bìa, ISBN.

### 3.4. Chuẩn thể thức in ấn & PDF (Nghị định 30/2020/NĐ-CP)
* Khổ giấy: A4 (210 mm x 297 mm).
* Căn lề chuẩn (Page Margins):
  - Lề trên: 20 mm.
  - Lề dưới: 20 mm.
  - Lề trái: 30 mm (khoảng chừa bấm ghim / đóng bìa hồ sơ).
  - Lề phải: 15 mm.
* Font chữ: Times New Roman, cỡ 13 - 14 pt, căn đều hai bên (Justified), dòng đầu đoạn thụt vào 1.27 cm (1 tab chuẩn).
* CSS `@media print` được tối ưu hóa riêng biệt:
  - Tự động ẩn toàn bộ sidebar, navbar, action buttons.
  - Phân trang chuẩn xác với `page-break-inside: avoid` tại các khối điều khoản quan trọng và bảng chữ ký đại diện hai bên.

---

## 4. Trải nghiệm người dùng (UI/UX Flows)

Module hợp đồng xuất hiện dưới dạng một Tab mới trong hệ thống: **`Hợp Đồng`** (nằm tại Sidebar dành cho `ROLE_OWNER` và `ROLE_MANAGER`).

### Luồng 1: Soạn hợp đồng mới (Dưới 60 giây)
1. Nhân viên bấm **"Soạn Hợp Đồng Mới"**.
2. Chọn loại mẫu: ví dụ *"Hợp đồng xuất bản tác phẩm"*.
3. Chọn đối tác sẵn có trong hệ thống (gõ tìm kiếm nhanh theo tên đối tác).
4. Chọn tác phẩm/ấn bản (nếu là hợp đồng bản quyền hoặc hợp đồng in).
5. Hệ thống tự động điền 80% form. Nhân viên chỉ cần điền nốt 20% còn lại (ngày ký, tỷ lệ nhuận bút hoặc điều khoản thanh toán cụ thể).
6. Màn hình bên phải hiển thị ngay **Bản xem trước A4 (Live Preview)**.
7. Bấm **"Tải File Word (.docx)"** hoặc **"In / Xuất PDF"**. Hợp đồng tự động được lưu vào lịch sử với mã số HĐ tự sinh.

### Luồng 2: Quản lý & Cập nhật file mẫu (.docx)
1. Người dùng vào mục **"Quản Lý Mẫu Hợp Đồng"**.
2. Bấm **"Thêm Mẫu Mới"** hoặc **"Cập nhật file Word"** cho mẫu hiện tại.
3. Tải file Word đã có các biến `{...}` lên.
4. Hệ thống phân tích file Word, hiển thị danh sách các biến tìm thấy để người dùng kiểm tra lại.
5. Lưu lại. Mẫu mới lập tức có hiệu lực cho toàn bộ nhân viên sử dụng.

---

## 5. Rủi ro & Chiến lược phòng ngừa

1. **Rủi ro lỗi font khi mở trên máy tính đối tác:**
   - File `.docx` sinh ra sử dụng 100% font chuẩn hệ điều hành: `Times New Roman`. Bảng mã Unicode dựng sẵn tiếng Việt tiêu chuẩn (TCVN 6909:2001). Không dùng font lạ.
2. **Rủi ro người dùng gõ sai cú pháp placeholder trong file Word mẫu:**
   - Trong giao diện quản lý mẫu, có nút **"Kiểm tra tính hợp lệ của mẫu"** (Validate Template): tự động quét toàn bộ placeholder trong file `.docx`, báo đỏ ngay nếu có thẻ mở `{` mà không có thẻ đóng `}` hoặc tên biến chứa ký tự đặc biệt.
3. **Rủi ro mất dữ liệu khi sửa mẫu:**
   - Mẫu hợp đồng có cơ chế `version` tăng dần. Khi sửa mẫu, các bản hợp đồng đã tạo trong quá khứ vẫn giữ nguyên toàn bộ dữ liệu đã nhập (`payload_data`).
