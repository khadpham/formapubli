# BRIEF: Cập nhật thư viện mẫu hợp đồng theo bộ hồ sơ chuẩn T_KHO

## 1. Bối cảnh

Công ty TNHH Vita Nova (xuất bản/phát hành sách) đang xây ERP formapubli để quản lý toàn bộ quy trình xuất bản. Anh Kha đã chốt quy trình dự án xuất bản gồm 5 giai đoạn theo đúng thứ tự: Thiết kế bìa → Biên dịch → Biên tập → Dàn trang → Đọc morat.

Ngày 2026-10-13, anh Kha cung cấp bộ hồ sơ thực tế đầy đủ của đầu sách "Đốt kho" (file T_KHO.zip) làm chuẩn format. Nhiệm vụ của bạn là cập nhật thư viện mẫu hợp đồng trong ERP theo đúng format bộ hồ sơ này.

## 2. Tài liệu chiến lược: masterplan và blueprint

Chúng ta đang xây dựng ERP formapubli theo một bộ tài liệu chiến lược thống nhất. Bạn PHẢI đọc các tài liệu này trước khi code để hiểu đúng bối cảnh và không làm lệch hướng.

### 2.1. Các tài liệu đang xây dựng

| Tài liệu | Vị trí | Agent đọc bằng cách nào |
|---|---|---|
| Master Blueprint | `FORMAPUBLI_MASTER_BLUEPRINT.md` (thư mục gốc repo, nhánh dev) | `git checkout dev` rồi đọc file local |
| Blueprint v1 (tiếng Việt) | `~/workspace/your_files/blueprint-erp-formapubli-v1.md` (máy của Muse) | Bản tóm tắt tiếng Việt, Muse sẽ trích dẫn khi cần. Không bắt buộc đọc. |
| Brief này | File anh Kha gửi trực tiếp cho bạn | Đọc từ nội dung được giao |

### 2.2. Những mục blueprint liên quan trực tiếp đến nhiệm vụ này

- **Mục 23 (Quy trình dự án xuất bản):** Thứ tự 5 giai đoạn đã chốt, rule engine kiểm tra logic thời gian (R1-R5), thư viện 8 mẫu tài liệu chuẩn từ bộ hồ sơ T_KHO. Đọc kỹ mục 23.3 về 8 loại tài liệu và 6 quy tắc định dạng.
- **Mục 30 (Hệ sinh thái AI):** Nguyên tắc dùng Gemini để đọc và phân loại tài liệu - phân loại đọc từ nội dung, không đọc từ tên file.
- **Mục 06 (Sổ cái bất biến):** Mọi thay đổi dữ liệu nghiệp vụ phải qua ledger/bút toán, không sửa trực tiếp. Áp dụng khi sau này làm chức năng sinh phiếu chi/ủy nhiệm chi.

### 2.3. Tầm nhìn tổng thể bạn cần hiểu

formapubli không chỉ là phần mềm quản lý kho. Mục tiêu là thay thế toàn bộ cách team đang làm việc trên Google Sheets (6 tab: đơn hàng, phân loại đơn hàng, SPX, tổng hợp, khách hàng, Email_queue) bằng một hệ thống thông minh, linh hoạt, thân thiện với bộ máy hiện tại dưới 10 người.

Module hợp đồng/dự án xuất bản bạn đang làm là một mảnh ghép trong bức tranh lớn: từ lúc ký hợp đồng bản quyền, qua 5 giai đoạn sản xuất, đến in ấn, nhập kho, bán hàng đa kênh (portal, Shopee, đại lý), xuất hóa đơn điện tử, và báo cáo tài chính. Mọi mảnh ghép đều phải tuân thủ cùng một bộ nguyên tắc trong blueprint.

## 3. Môi trường làm việc (dev độc lập)

### 3.1. Nhánh dev trên GitHub

- Repo: `khadpham/formapubli`
- Nhánh `dev` ĐÃ TỒN TẠI trên GitHub (vừa được push ngày 2026-10-13). KHÔNG tạo nhánh dev mới từ main.
- Trả lời câu hỏi của bạn: KHÔNG cần pull main rồi tạo dev mới. Checkout nhánh dev có sẵn là đủ, vì nó đã chứa mọi commit mới nhất (migrations 0056-0058, module dự án xuất bản, blueprint cập nhật).
- Để lấy về máy local (Windows):
  ```
  cd "D:\Data Project\formapubli"
  git fetch origin
  git checkout dev
  git pull origin dev
  ```
- Sau này khi pull code mới từ team: `git pull origin dev`
- Khi xong việc: chỉ push lên `origin dev`. KHÔNG push trực tiếp main. TUYỆT ĐỐI KHÔNG tự tạo PR từ `dev` vào `main` khi dev còn tồn đọng việc chưa test (bài học PR #31 ngày 2026-10-13). Việc tách PR nhỏ vào main do điều phối viên (Muse) quyết định sau khi từng phần đã test xong trên dev.

### 3.2. Môi trường dev độc lập trên VPS
- Đường dẫn local trên máy bạn: `D:\Data Project\formapubli` (checkout nhánh dev theo hướng dẫn ở 3.1)
  - Code: `/opt/formapubli-dev` (git worktree của nhánh dev, tách biệt hoàn toàn với production)
  - URL test: `https://dev.formapubli.vn`
  - Database: SQLite file local `dev.db` (copy từ production, mọi thay đổi chỉ ảnh hưởng dev)
  - PM2 process riêng: `formapubli-dev`, port 3002 (không đụng production port 3000)
- Production (`https://app.formapubli.vn`) hoàn toàn tách biệt. Mọi thứ bạn làm trên dev KHÔNG ảnh hưởng production cho đến khi tạo PR, merge vào main, và deploy có chủ đích.
- Sau khi code xong: chạy `npx tsc --noEmit` phải pass, rồi mới commit lên nhánh dev

## 4. Hiện trạng trong database

Bảng `contract_templates` đã có 8 record (3 seed cũ + 5 mẫu mới):

| Code | Title | Category |
|---|---|---|
| HD_XUAT_BAN_SEED | Mẫu HĐ Xuất Bản (seed) | TAC_QUYEN |
| HD_DAI_LY_SEED | Mẫu HĐ Đại Lý Phát Hành (seed) | DAI_LY |
| HD_DICH_THUAT_SEED | Mẫu HĐ Dịch Thuật (seed) | DICH_THUAT |
| HD_THIET_KE_BIA | Hop dong thiet ke bia sach | THIET_KE_BIA |
| HD_BIEN_DICH_CHUAN | Hop dong bien dich (chuan) | BIEN_DICH |
| HD_BIEN_TAP | Hop dong bien tap | BIEN_TAP |
| HD_DAN_TRANG | Hop dong dan trang | DAN_TRANG |
| HD_DOC_MORAT | Hop dong doc morat | DOC_MORAT |

Tất cả đều có `legal_reviewed = 0` (chưa được pháp lý duyệt), `template_data` rỗng, chưa có file DOCX mẫu thật.

Migration liên quan: `src/db/migrations/0058_pub_templates.sql`

## 5. Yêu cầu: bổ sung 3 mẫu mới

Từ bộ hồ sơ T_KHO, ngoài 5 hợp đồng đã có, cần thêm 3 loại tài liệu:

| Code | Tên | Mô tả |
|---|---|---|
| BB_NGHIEM_THU | Biên bản nghiệm thu và thanh lý | Mỗi giai đoạn 1 biên bản riêng, viện dẫn đúng số hợp đồng |
| PHIEU_CHI | Phiếu chi | CHỈ dùng cho chi tiền mặt. Mẫu 02-TT theo Thông tư 133/2016/TT-BTC |
| UY_NHIEM_CHI | Ủy nhiệm chi | CHỈ dùng cho chuyển khoản ngân hàng |

Tạo migration mới (0059 hoặc số tiếp theo chưa dùng) để insert 3 record này vào `contract_templates`.

## 6. Định nghĩa trường (schema_fields) cho từng mẫu

Dựa trên phân tích nội dung thực tế các file trong T_KHO.zip, định nghĩa `schema_fields` (JSON) cho 8 mẫu. Mỗi field gồm: key, label tiếng Việt, kiểu dữ liệu, bắt buộc hay không.

### 5.1. HD_THIET_KE_BIA (HĐ thiết kế bìa)

Từ file `HĐTK_Công trịnh-Đốt kho-2026.docx`:
- so_hop_dong (text, bắt buộc) - VD: "10.2.2026/HĐTK"
- ngay_ky (date, bắt buộc)
- ten_tac_pham (text, bắt buộc)
- ten_tac_gia (text, bắt buộc)
- the_loai (text)
- hinh_thuc_bia (text) - VD: "Bìa mềm"
- kich_thuoc (text) - VD: "120 x 190 mm"
- so_trang_du_kien (number)
- ngay_bat_dau (date, bắt buộc)
- ngay_hoan_thanh (date, bắt buộc)
- so_lan_chinh_sua_toi_da (number) - VD: 3
- gia_tri_hop_dong (number, bắt buộc) - giá gross đã gồm thuế
- thuc_nhan (number) - tự tính = gross * 0.9
- thong tin ben B: ho_ten, ngay_sinh, so_giay_to (CCCD/CMND/Hộ chiếu/MST), email, dien_thoai

### 5.2. HD_BIEN_DICH_CHUAN (HĐ biên dịch)

Từ file `HDDG 2025-bùi gia bin-Đốt kho.docx`:
- so_hop_dong (text, bắt buộc) - VD: "1.10.2025/HĐBD"
- ngay_ky (date, bắt buộc)
- ten_tac_pham, ten_tac_gia (text, bắt buộc)
- gia_tri_hop_dong (number, bắt buộc)
- thuc_nhan (number, tự tính)
- thong tin ben B: ho_ten, so_cccd, ngay_cap_cccd, noi_cap_cccd, dia_chi, dien_thoai, email, so_tai_khoan, ngan_hang

### 5.3. HD_BIEN_TAP (HĐ biên tập)

Từ file `Hopdongbientap_AH-Đốt kho-2026.docx`:
- so_hop_dong (text, bắt buộc) - VD: "1.12.2025/HĐBT"
- ngay_ky, ngay_bat_dau, ngay_hoan_thanh (date, bắt buộc)
- ten_ban_thao (text, bắt buộc)
- gia_tri_hop_dong, thuc_nhan (number)
- thong tin ben B: ho_ten, but_danh, ngay_sinh, so_ho_chieu (hoặc CCCD), ngay_cap, noi_cap, email
- LƯU Ý: mẫu thực tế dùng HỘ CHIẾU + BÚT DANH, nên trường giấy tờ tùy thân phải hỗ trợ nhiều loại: CCCD/CMND/Hộ chiếu/MST

### 5.4. HD_DAN_TRANG (HĐ dàn trang)

Từ file `HDDT_Công trịnh-Đốt kho-2026.docx`:
- so_hop_dong (text, bắt buộc) - VD: "01.03.2026/HĐDT"
- ngay_ky, ngay_bat_dau, ngay_hoan_thanh (date, bắt buộc)
- ten_tac_pham (text, bắt buộc) - PHẢI validate trùng với tên sách của dự án
- gia_tri_hop_dong, thuc_nhan (number)
- thong tin ben B như mẫu thiết kế bìa

### 5.5. HD_DOC_MORAT (HĐ đọc morat)

Từ file `Hop-dong-CTV-Morat 2026-tháng 2 (1)-Ngô Diệu Châu.doc`:
- so_hop_dong (text, bắt buộc) - VD: "072/HĐMR"
- ngay_ky (date, bắt buộc)
- gia_tri_hop_dong, thuc_nhan (number)
- thong tin ben B: ho_ten, dia_chi, so_cmnd, ngay_cap, noi_cap, so_tai_khoan, ngan_hang, ma_so_thue_ca_nhan

### 5.6. BB_NGHIEM_THU (Biên bản nghiệm thu)

Từ file `NGHIỆM THU HĐ DỊCH_Đốt kho.docx`:
- so_bien_ban (text, bắt buộc) - VD: "31.10.2025/NTTLHĐBD"
- ngay_nghiem_thu (date, bắt buộc)
- hop_dong_vien_dan (reference đến contract_templates, CHỌN TỪ DB không gõ tay)
- noi_dung_cong_viec (text)
- khoi_luong_theo_hd, khoi_luong_thuc_te (text/number)
- tong_gia_tri, thue_tncn_khau_tru, so_con_phai_thanh_toan (number)
- danh_gia_chat_luong (text)

### 5.7. PHIEU_CHI (Phiếu chi tiền mặt)

Từ file `Phiếu chi năm 2025.docx`:
- so_phieu (text, bắt buộc) - VD: "PC00072"
- ngay_chi (date, bắt buộc)
- nguoi_nhan (text, bắt buộc)
- dia_chi_nguoi_nhan (text)
- ly_do_chi (text, bắt buộc)
- so_tien (number, bắt buộc)
- so_tien_bang_chu (text, TỰ SINH từ số tiền)
- tai_khoan_no (text) - VD: "334"
- tai_khoan_co (text) - VD: "1111"

### 5.8. UY_NHIEM_CHI (Ủy nhiệm chi ngân hàng)

Từ file `UNC Vietcombank MỚI.xls`:
- ngan_hang (text, bắt buộc)
- ngay_uy_nhiem (date, bắt buộc)
- nguoi_thu_huong (text, bắt buộc)
- so_tai_khoan_thu_huong (text, bắt buộc)
- so_tien (number, bắt buộc)
- noi_dung (text, bắt buộc)

## 7. Bốn quy tắc kỹ thuật BẮT BUỘC

Khi implement chức năng sinh tài liệu từ mẫu, phải tuân thủ:

1. **Số tiền bằng chữ tự sinh từ số.** Không cho người dùng gõ tay phần chữ. (Lý do: mẫu thực tế có lỗi số 4.161.111đ nhưng chữ ghi 1.891.111đ.)

2. **Biên bản nghiệm thu viện dẫn hợp đồng bằng cách chọn từ DB, không gõ tay.** (Lý do: mẫu thực tế viện dẫn sai số hợp đồng - ghi 15.9.2025/HĐBD trong khi HĐ thật là 1.10.2025/HĐBD.)

3. **Tên tác phẩm trong HĐ dàn trang phải validate trùng với tên sách của dự án.** (Lý do: mẫu thực tế bị copy-paste nhầm tên sách khác "Tên mọi trên tàu Narcissus" vào hồ sơ sách "Đốt kho".)

4. **Phân loại tài liệu đọc từ nội dung, không đọc từ tên file.** (Lý do: tên file do người dùng đặt tùy ý, không đáng tin. Phải đọc tiêu đề và nội dung thực tế để xác định loại giấy tờ.)

## 8. Quy tắc tuyệt đối

- KHÔNG dùng dấu gạch ngang dài (em dash — hoặc en dash –). Chỉ dùng dấu "-" ngắn trong mọi code, comment, commit message, tài liệu.
- Mọi thời gian dùng múi giờ Asia/Ho_Chi_Minh (UTC+7).
- Không sửa production DB. Chỉ làm trên nhánh dev và database dev.
- Không push trực tiếp main. Chỉ push lên `origin dev`. Không tự tạo PR từ `dev` vào `main`.

## 9. Deliverable

1. Migration mới tạo 3 record BB_NGHIEM_THU, PHIEU_CHI, UY_NHIEM_CHI với schema_fields đầy đủ như mục 6.
2. Cập nhật schema_fields cho 5 mẫu đã có (hiện đang rỗng hoặc sơ sài).
3. `npx tsc --noEmit` pass.
4. Commit lên nhánh dev (push `origin dev`). Không tự tạo PR vào main.

File DOCX mẫu thật sẽ upload sau, hiện tại chỉ cần metadata và schema_fields chuẩn.

**Lưu ý cuối:** Mọi thay đổi bạn làm đều phải nhất quán với tinh thần của blueprint (mục 2). Nếu phát hiện yêu cầu trong brief này mâu thuẫn với blueprint, hãy nêu ra trong PR description để thảo luận, không tự ý quyết định.
