# formapubli OS - Nhật Ký Tiến Trình Dự Án & Bảng Theo Dõi Thi Công
> **Dự án:** Hệ Điều Hành Xuất Bản & Kho Vận Bán Lẻ Chuyên Dụng (formapubli OS)  
> **Repository:** `https://github.com/khadpham/formapubli.git`  
> **Kiến trúc:** Next.js 14 + TypeScript + Tailwind + Drizzle ORM + LibSQL SQLite (Dual Cloudflare D1 Engine)  
> **Chi phí hạ tầng:** 0 VNĐ trọn đời (100% Free Forever Tier)

---

## 1. Bảng Tổng Quan Tiến Độ Các Phase (Milestone Tracker)

| Phase | Trọng tâm Nghiệp vụ | Trạng thái | Mức độ Hoàn thành | Nhánh Git Phụ trách |
| :---: | :--- | :---: | :---: | :--- |
| **Phase 1** | **Lõi Kho Vận & Thẻ Kho Bất Biến**<br/>(Catalog 81 sách, 3 kho vật lý, Thẻ kho Append-Only, Tìm kiếm tiếng Việt, Micro giọng nói, Phím tắt) | 🟢 **HOÀN THÀNH** | **100%** | `feat/seed-catalog-and-cloudflare-setup`<br/>`feat/inventory-ledger-and-operations`<br/>`feat/vietnamese-unaccented-and-voice-search` |
| **Phase 2** | **Quầy POS Bán Sách & Sổ Kép Tài Chính**<br/>(Orders, Order Items, Khấu trừ kho tự động, Bán lẻ hội chợ, Bán sỉ đầu nậu, Phân tách Sổ Thuế vs Sổ Thực) | 🟡 **ĐANG THI CÔNG** | **40%** (Baby-Step 1 Done) | `feat/sales-order-engine-and-dual-ledger` |
| **Phase 3** | **CRM Độc Giả & Đăng Ký Gói Mùa**<br/>(Hồ sơ độc giả 360 độ, Gói mùa Xuân/Hạ/Thu/Đông, Subscription, Tủ sách sở hữu, Chống trùng quà tặng) | ⚪ **CHỜ TRIỂN KHAI** | **0%** | `feat/customer-crm-and-bundles` |

---

## 2. Nhật Ký Thi Công Chi Tiết Theo Ngày (Chronological Engineering Log)

### 📅 Ngày 11/09/2026

#### 🔹 [Mã: ENG-20260911-01] Khởi tạo Khung Dự án & CSDL Kép
- **Nhánh:** `feat/init-dual-db-framework` | **Commit:** `8045a7f`
- **Nội dung:** 
  - Thiết lập Next.js 14.2.5, TypeScript 5.5, Tailwind CSS.
  - Cấu hình Drizzle ORM hỗ trợ kiến trúc kép: Local SQLite file (`formapubli.db`) và Cloudflare D1 trên môi trường Edge.
  - Khai báo 11 bảng cơ sở dữ liệu ban đầu theo đặc tả Master Blueprint.

#### 🔹 [Mã: ENG-20260911-02] Nạp Danh mục 81 Đầu Sách & Cấu hình Kho Âu Cơ
- **Nhánh:** `feat/seed-catalog-and-cloudflare-setup` (Đã merge vào `main`) | **Commit:** `22b91c8`
- **Nội dung:**
  - Chuẩn hóa tên kho: Đổi "Kho Tây Hồ" thành **"Kho 1 - Âu Cơ"** theo đúng địa bàn thực tế.
  - Xử lý bài toán trùng ISBN tái bản: H21 (Bìa tím) và H36 (Tái bản bìa trắng) dùng chung ISBN `9786044737690` liên kết cùng tác phẩm Baudelaire.
  - Nạp thành công 80 tác phẩm (`works`), 81 ấn bản (`editions`), 3 kho vật lý (`warehouses`), 5 đối tác (`partners`).
  - Cấu hình tương thích Cloudflare Pages: `wrangler.toml` và `@cloudflare/next-on-pages`.

#### 🔹 [Mã: ENG-20260911-03] Lõi Thẻ Kho Bất Biến (Append-Only Inventory Ledger)
- **Nhánh:** `feat/inventory-ledger-and-operations` | **Commit:** `7058a2b`
- **Nội dung:**
  - Xây dựng `src/services/inventory.service.ts`: Tuân thủ nguyên tắc kế toán kho bất biến (nghiêm cấm UPDATE/DELETE thẻ kho).
  - Tự động đồng bộ số dư bảng `stock_balances`.
  - Cơ chế chặn xuất âm kho tuyệt đối (Negative Stock Prevention).
  - Nghiệp vụ chuyển kho kép (Dual-entry transfer: 1 bút toán TRANSFER_OUT và 1 bút toán TRANSFER_IN trong 1 giao dịch).
  - Kiểm thử tự động `scripts/test-inventory.ts` vượt qua **6/6 test cases (100%)**.
  - Giao diện Ma trận Tồn kho 3 kho (`StockOverviewMatrix.tsx`) và Modal Nhập/Xuất/Chuyển kho (`StockMovementModal.tsx`).

#### 🔹 [Mã: ENG-20260911-04] Tìm Kiếm Tiếng Việt Không Dấu, Giọng Nói Free & Thanh Nam Châm
- **Nhánh:** `feat/vietnamese-unaccented-and-voice-search` | **Commit:** `ee04789`, `ffd81db`, `7e6fcfd`
- **Nội dung:**
  - Xây dựng thuật toán bỏ dấu tiếng Việt chuẩn Unicode kết hợp chuẩn hóa ngữ âm (`phoneticSimplify` khử lệch phương ngữ `ch/tr`, `gi/d/r`, `s/x`).
  - Tích hợp nhận diện giọng nói tiếng Việt miễn phí 100% qua Web Speech API (`useVoiceSearch.ts`).
  - Thanh tìm kiếm nam châm có điều kiện (Conditional Magnet Search): Chỉ nổi lên mép trên khi đang có từ khóa và cuộn xuống dưới, không che màn hình khi đọc bình thường.
  - Chuẩn hóa hệ thống phím tắt không xung đột với Chrome/Edge: `/` (tìm kiếm), `Esc` (xóa/đóng), `Alt+Shift+V` (bật mic), `Alt+Shift+T/R/X` (mở phiếu kho).
  - Kiểm thử tự động `scripts/test-vietnamese-search.ts` vượt qua **10/10 test cases (100%)**.
  - Cập nhật Master Blueprint Chương 24 (Sổ kép thuế/nội bộ), Chương 25 (POS Offline-first đa nhân viên), Chương 26 (Định vị sản phẩm).

#### 🔹 [Mã: ENG-20260911-05] Baby-Step 1: Động cơ Bán Hàng Sổ Kép & Khấu Trừ Kho Tự Động
- **Nhánh:** `feat/sales-order-engine-and-dual-ledger` | **Commit:** `95785e4`
- **Nội dung:**
  - Khai báo 2 bảng thương mại mới: `orders` (đơn hàng) và `order_items` (chi tiết sách).
  - Tạo và thực thi migration sạch `0002_chubby_saracen.sql` trên `formapubli.db`.
  - Xây dựng `src/services/order.service.ts`:
    - Tạo đơn hàng tự động tính chiết khấu (lẻ hoặc sỉ đầu nậu 35-50%).
    - Kiểm tra tồn kho trước, từ chối nếu không đủ sách.
    - Tự động liên kết Thẻ kho bất biến khấu trừ sách vật lý tức thì (kho máy = kho kệ 100%).
    - Hàm phân tách Sổ Kép `getSalesSummary`: Tách riêng Báo cáo Thuế (VAT) và Báo cáo Quản trị Thực tế cho Chủ doanh nghiệp.
  - Kiểm thử tự động `scripts/test-order-sales.ts` vượt qua **6/6 test cases (100%)**.
  - Biên dịch Next.js production build (`npm run build`) thành công với **0 lỗi**.

---

## 3. Các Hạng Mục Tiếp Theo & Kế Hoạch Triển Khai (Roadmap)

### 📌 Baby-Step 2 (Kế hoạch trước mắt): Giao diện Quầy Thu Ngân Bán Sách (POS UI)
- [ ] Thiết kế Component `PosCheckoutModal.tsx` / `PosTerminal.tsx`.
- [ ] Chọn sách vào giỏ siêu tốc qua bàn phím (`/`, gõ tắt, barcode) hoặc giọng nói.
- [ ] Chọn kho xuất bán (Kho 1 Âu Cơ hoặc Kho 3 Hội Chợ).
- [ ] Chọn nhóm khách hàng: Khách lẻ (giảm 0-10%) hoặc Đầu nậu Đinh Lễ (chiết khấu 35-45%).
- [ ] Chọn cờ tài chính: Xuất VAT (Thuế) hoặc Không hóa đơn (Nội bộ).
- [ ] Phím tắt thanh toán `Ctrl + Enter`: Khấu trừ kho tức thì và hiển thị biên nhận tóm tắt.

### 📌 Baby-Step 3: Bảng Báo Cáo Doanh Số & Dòng Tiền (Sales Analytics Dashboard)
- [ ] Báo cáo tổng số cuốn bán và doanh thu theo Ngày / Tháng / Năm.
- [ ] Nút chuyển đổi 1-click: **Góc nhìn Kế toán Thuế** vs **Góc nhìn Thực tế Toàn cảnh (Chủ Doanh Nghiệp)**.

---

## 4. Điểm Cần Cải Thiện & Hạng Mục Tối Ưu (Improvement Backlog)

| Hạng mục | Vấn đề hiện tại / Mục tiêu | Giải pháp kỹ thuật đề xuất | Độ ưu tiên |
| :--- | :--- | :--- | :---: |
| **Responsive & Cảm ứng** | Nhân viên hội chợ dùng điện thoại, quầy văn phòng dùng máy tính màn hình ngang | - **Màn hình ngang (Desktop):** Split-view 2 cột (Danh mục sách bên trái, Giỏ hàng bên phải).<br/>- **Màn hình dọc (Mobile):** Stacked Drawer, nút bấm cảm ứng lớn $\ge 44\text{px}$, thanh toán 1 ngón tay cái. | 🔴 Cao (Áp dụng ngay Baby-Step 2) |
| **Offline-First POS** | Hội chợ sách nghẽn mạng 4G/Wifi từ 4-8 tiếng | Tích hợp IndexedDB Queue + UUID v7 + Idempotency Key tự động sync khi có mạng. | 🟡 Trung bình (Phase 2 hoàn thiện) |
| **In Biên Nhận Cầm Tay** | Khách lẻ hoặc đầu nậu cần phiếu giao hàng/biên nhận | Tích hợp Web Bluetooth / Web Serial kết nối máy in hóa đơn nhiệt mini K57/K80. | 🟡 Trung bình |
| **Cài Đặt Dạng App (PWA)** | Nhân viên muốn mở app từ màn hình chính điện thoại không cần gõ URL | Khai báo `manifest.json` và Service Worker để cài đặt PWA (Progressive Web App). | 🟢 Thấp |
