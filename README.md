# formapubli — Hệ Điều Hành Quản Trị Xuất Bản & Kho Vận Chuyên Dụng

> **Đơn vị phát triển:** formapubli Core Engineering  
> **Phiên bản kiến trúc:** 3.0 (Master Comprehensive Edition - 2026)  
> **Repository:** [https://github.com/khadpham/formapubli.git](https://github.com/khadpham/formapubli.git)

---

## 1. Giới thiệu Dự án
**formapubli** là giải pháp ERP tinh gọn, chuyên sâu cho ngành xuất bản và phát hành sách tại Việt Nam. Dự án được thiết kế nhằm thay thế hoàn toàn hệ thống 7 Google Spreadsheets (55 sub-sheets) thủ công trước đây bằng một hệ thống đám mây chuẩn mực, bảo mật tuyệt đối, phản hồi dưới 100ms và **hoàn toàn miễn phí 100% chi phí hạ tầng (0 VNĐ vĩnh viễn)**.

---

## 2. Cấu trúc Tài liệu & Kho Tri thức
Toàn bộ tài liệu thiết kế và hồ sơ kiểm toán được tổ chức bài bản tại:
- **FORMAPUBLI_MASTER_BLUEPRINT.md**: Bản kiến trúc tổng thể 19 chương, bao gồm quy chuẩn nghiệp vụ, cơ sở dữ liệu DDL, chính sách kho vận, chiến lược bảo mật Cloudflare và lộ trình 4 Phase.
- **docs/REPORT_55_SHEETS_AUDIT.md**: Biên bản kiểm toán toàn diện 55 sub-sheets lịch sử: phân tích chi tiết dữ liệu, công thức tính và nhận diện các rủi ro vận hành.
- **docs/FORMAPUBLI_KNOWLEDGE_BASE.md**: Kho tri thức toàn thư của dự án phục vụ tra cứu nhanh cho toàn bộ đội ngũ.
- **data_tabs/**: Bản sao lưu 55 file CSV dữ liệu thô kết xuất từ 7 Google Spreadsheets ban đầu.

---

## 3. Các Trụ cột Kiến trúc Đột phá
1. **Kiến trúc Thực thể 2 Tầng:** Tác phẩm (*Work / Master Title*) cho báo cáo tổng quan điều hành và Ấn bản (*Edition / Lot*) quản lý SKU mã vạch ISBN, giá vốn, giá bìa tái bản (hỗ trợ các trường hợp dùng chung ISBN như H21 và H36 tái bản).
2. **Cấu trúc 3 Kho Vật lý:**
   - **Kho 1 - Âu Cơ:** Văn phòng chính, bán lẻ, soạn đơn hàng ngày (sách rời).
   - **Kho 2 - Quỳnh Mai:** Kho tổng, tiếp nhận lưu kho kiện lớn từ nhà in, bán buôn sỉ.
   - **Kho 3 - Dự phòng:** Gian hàng lưu động hội chợ, lưu chuyển kiểm định tạm thời.
3. **Thao tác Bàn phím Siêu tốc (Keyboard-First):** Tra cứu tức thì bằng **4 số cuối ISBN** (`isbn_last4`) hoặc **tên viết tắt** (`short_code`, vd: `bt` -> Bệnh tưởng, `nbl` -> Người biển lận, `dddhc` -> Dưỡng đường đồng hồ cát) trong **2-3 giây**.
4. **Sổ cái Kho Bất biến (Append-Only Inventory Ledger):** Nghiêm cấm sửa (UPDATE) hoặc xóa (DELETE) lịch sử kho.
5. **Đám mây Không Chi phí (0 VNĐ vĩnh viễn):**
   - **Cloudflare D1:** SQLite serverless tại Edge, 5GB dung lượng miễn phí, 5 triệu lượt đọc/ngày, không bao giờ rơi vào trạng thái ngủ đông (No Pause Trap).
   - **SQLite cục bộ (`formapubli.db`):** Nhúng trực tiếp tại máy trạm, chạy offline siêu tốc khi đứt cáp hoặc mất mạng.
   - **Tự động sao lưu Google Drive:** Snapshot sao lưu CSDL hàng ngày hoàn toàn tự động 0 chi phí.
6. **Mô hình Khách hàng CRM 360 & Gói Phát Hành Theo Mùa:**
   - Quản lý hội viên (Standard, Silver, Gold, Platinum).
   - Quản lý gói mùa (Xuân, Hạ, Thu, Đông) với cơ chế chọn linh hoạt, mua kèm sách cũ và xuất hóa đơn bù thu/dồn kỳ.

---

## 4. Hướng dẫn Phát triển Cục bộ (Local Development)

### Cài đặt và Khởi tạo CSDL
```bash
# Cài đặt thư viện phụ thuộc
npm install

# Đồng bộ lược đồ bảng CSDL (11 bảng)
npm run db:push

# Nạp toàn bộ 81 đầu sách và 3 kho vật lý vào CSDL
npm run db:seed

# Chạy kiểm thử tự động Sổ Cái Bất Biến & Luân chuyển 3 Kho (6 kịch bản kiểm thử)
npx tsx scripts/test-inventory.ts

# Khởi chạy giao diện thử nghiệm
npm run dev
```

Truy cập: `http://localhost:3000`

---

### Kiểm tra quét mã vạch bằng camera

Scanner ưu tiên `BarcodeDetector` nếu hỗ trợ EAN-13, tự tải ZXing JavaScript khi API thiếu/lỗi hoặc để kiểm tra khi native liên tục không nhận diện. ZXing được phục vụ cùng ứng dụng, không cần CDN hay bật cờ thử nghiệm trên iPhone. Camera vẫn cần HTTPS khi truy cập từ điện thoại qua LAN.

Chạy `npx tsx scripts/test-camera-scanner.ts` để kiểm tra ảnh EAN-13 thật, fallback, ảnh xoay, trạng thái lỗi và hủy quét. Suite này cũng nằm trong `npm run test:isolated`. Sau thay đổi scanner phải thử camera thật trên Safari/Chrome iPhone và Chrome Android; xem checklist trong [hướng dẫn test](docs/TEAM_TEST_MANUAL.md#311-quét-camera-trên-iphone-và-android).

## 5. Hướng dẫn Triển khai Cloudflare Pages / Workers (0 VNĐ)

> ⚠️ **Trạng thái thật (22/09/2026): CHƯA deploy được.** Khung `wrangler.toml` + `pages:build`
> có sẵn nhưng còn thiếu: nối D1 vào code (`src/db` đang đọc file local),
> `database_id` thật, secrets Workers env, rate-limit ra khỏi RAM.
> Xem báo cáo review để biết danh sách chặn. Khi sẵn sàng mới làm theo dưới đây:

- File cấu hình: `wrangler.toml` (tương thích `nodejs_compat`, binding `DB` D1)
- Lệnh biên dịch trên Cloudflare Pages Build Settings:
  - **Framework Preset:** Next.js
  - **Build Command:** `npx @cloudflare/next-on-pages`
  - **Build Output Directory:** `.vercel/output/static`
  - **Environment Variables:** `NODE_VERSION = 20`
  - **D1 Database Binding:** Variable Name: `DB`, Database: `formapubli-db`

---

## 6. Bản quyền & Phân phối
Dự án được bảo hộ và phát triển nội bộ cho **formapubli**.
