# formapubli OS - Nhật Ký Tiến Trình Dự Án & Bảng Theo Dõi Thi Công
> **Dự án:** Hệ Điều Hành Xuất Bản & Kho Vận Bán Lẻ Chuyên Dụng (formapubli OS)  
> **Repository:** `https://github.com/khadpham/formapubli.git`  
> **Kiến trúc:** Next.js 14 + TypeScript + Tailwind + Drizzle ORM + LibSQL SQLite (Dual Cloudflare D1 Engine)  
> **Chi phí hạ tầng:** 0 VNĐ trọn đời (100% Free Forever Tier)

---

## 1. Bảng Tổng Quan Tiến Độ Các Phase (Master 6-Phase Tracker)

| Phase | Trọng tâm Nghiệp vụ | Trạng thái | Mức độ Hoàn thành | Nhánh Git Phụ trách |
| :---: | :--- | :---: | :---: | :--- |
| **Phase 1** | **Lõi Kho Vận Bất Biến & Ma Trận 3 Kho**<br/>(Catalog 81 sách, 3 kho, Thẻ kho Append-Only, Tìm kiếm ngữ âm tiếng Việt, Micro giọng nói, Phím tắt) | 🟢 **HOÀN THÀNH** | **100%** | `feat/seed-catalog-and-cloudflare-setup`<br/>`feat/inventory-ledger-and-operations`<br/>`feat/vietnamese-unaccented-and-voice-search` |
| **Phase 2** | **Quầy POS Bán Sách & Sổ Kép Tài Chính 5 Roles**<br/>(Orders, Khấu trừ kho tức thì, POS Terminal, Bán sỉ đầu nậu/khách lẻ, Phân tách Sổ Thuế vs Sổ Thực, Executive Dashboard, Sidebar dọc, Suite cài đặt) | 🟢 **HOÀN THÀNH** | **100%** | `feat/sales-order-engine-and-dual-ledger` |
| **Phase 3** | **Di Động Hóa Quầy, "Súng" Quét Barcode Camera & Offline Sync**<br/>(PWA Standalone, Quét mã vạch ISBN bằng Camera điện thoại 0 đồng, IndexedDB Queue rớt mạng, Báo cáo doanh số đa chiều) | 🟡 **KẾ HOẠCH TIẾP THEO** | **0%** (Chuẩn bị thi công) | `feat/pwa-mobile-and-offline-pos` |
| **Phase 4** | **Nghiệp Vụ Xuất Bản Mở Rộng & Bán Combo Đóng Hộp**<br/>(Động cơ Combo/Boxset trừ linh kiện, Sổ cái Ký gửi Đinh Lễ, Quản trị Bản quyền & Nhuận bút tác giả) | ⚪ **CHỜ TRIỂN KHAI** | **0%** | `feat/boxset-bundles-and-consignment` |
| **Phase 5** | **Hệ Sinh Thái AI Tinh Gọn & Trợ Lý Bán Hàng 0 Đồng**<br/>(Smart Voice POS Dispatcher qua Groq Whisper, Executive AI Copilot qua Gemini Flash, Dự báo tái bản $V_{\text{sale}}$, CRM Độc giả) | ⚪ **CHỜ TRIỂN KHAI** | **0%** | `feat/lean-ai-copilot-and-crm` |
| **Phase 6** | **Tích Hợp Đa Kênh & Bàn Giao Vận Hành Toàn Diện**<br/>(Đồng bộ sàn Shopee/TikTok, Hóa đơn điện tử VAT chính thức, Bàn giao trọn đời) | ⚪ **TẦM NHÌN DÀI HẠN** | **0%** | `feat/omnichannel-and-einvoice` |

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


#### 🔹 [Mã: ENG-20260911-06] Kiến Trúc Sidebar Dọc, Dashboard Quản Trị & Ma Trận Phân Quyền RBAC 5 Roles
- **Nhánh:** `feat/sales-order-engine-and-dual-ledger`
- **Nội dung:**
  - Bổ sung Chương 27 vào Master Blueprint: Ma trận phân quyền 5 nhóm người dùng (`ROLE_OWNER`, `ROLE_MANAGER`, `ROLE_CASHIER`, `ROLE_WAREHOUSE`, `ROLE_TAX_ACCOUNTANT`).
  - Cơ chế bảo vệ chống rò rỉ dữ liệu (Query-level Scope Guard): Kế toán thuế chỉ xem số liệu hóa đơn điện tử VAT (`OFFICIAL_TAX`), chủ doanh nghiệp xem toàn cảnh thực tế (`INTERNAL_MANAGEMENT` + `OFFICIAL_TAX`), thu ngân không thấy doanh thu tổng.
  - Bổ sung Chương 28 vào Master Blueprint: Kiến trúc Menu Sidebar dọc bên trái (7 module điều hướng), thiết kế Bảng Quản trị Toàn cảnh (KPI Doanh thu, Cảnh báo sắp hết sách, Cơ cấu tiền mặt/chuyển khoản).
  - Tối ưu tương thích đa thiết bị: Cố định 260px trên Desktop màn hình ngang, tự động thu gọn dạng Drawer cảm ứng trên điện thoại/máy tính bảng.


#### 🔹 [Mã: ENG-20260911-07] Baby-Step 2: Quầy POS Bán Hàng Siêu Tốc, Dashboard Quản Trị & Sidebar Dọc 5 Roles
- **Nhánh:** `feat/sales-order-engine-and-dual-ledger` | **Commit:** `fffa627`
- **Nội dung:**
  - Xây dựng Component điều hướng `AppSidebar.tsx` (Menu dọc bên trái, 7 phân hệ, thu gọn 80px/260px, drawer cảm ứng trên mobile).
  - Xây dựng Component tổng quan `ExecutiveDashboard.tsx` (4 thẻ chỉ số KPI, phân tách dòng tiền Sổ Kép, cảnh báo tồn kho, bảng đơn hàng gần đây).
  - Xây dựng Component bán hàng quầy `PosCheckoutTerminal.tsx` (Tìm sách gõ tắt/giọng nói, chọn kho xuất Âu Cơ/Hội Chợ, chiết khấu 0-40%, chọn cờ VAT/Nội bộ, phím tắt thanh toán `Ctrl + Enter` trừ kho tức thì, in phiếu giao hàng).
  - Xây dựng Component sổ sách doanh số `SalesLedgerView.tsx` (Bộ lọc 1-click Sổ Thuế VAT vs Sổ Thực Tế Nội Bộ, lọc tìm kiếm theo mã đơn/khách hàng).
  - Tích hợp Ma trận Phân quyền 5 vai trò (`ROLE_OWNER`, `ROLE_MANAGER`, `ROLE_CASHIER`, `ROLE_WAREHOUSE`, `ROLE_TAX`).
  - Xây dựng API Endpoint `/api/orders` (GET danh sách & tổng hợp, POST tạo đơn bán).
  - Kiểm thử tự động đạt 100% test cases và biên dịch Next.js production với **0 lỗi**.

#### 🔹 [Mã: ENG-20260911-08] Sửa Phím Tắt POS, Đồng Bộ Micro Giọng Nói & Hoàn Thiện Suite Cài Đặt Hệ Thống
- **Nhánh:** `feat/sales-order-engine-and-dual-ledger`
- **Nội dung:**
  - Sửa lỗi phím tắt tại Quầy POS: Bổ sung lắng nghe sự kiện bàn phím cho `/` (focus thanh tìm kiếm), `Escape` (xóa/hủy), `Alt+Shift+V` (bật/tắt micro), `Ctrl+Enter` (thanh toán). Thêm badge trực quan `[/]` khi nhàn rỗi.
  - Đồng bộ thiết kế nút Micro giọng nói giữa Màn hình Tồn kho (`StockOverviewMatrix.tsx`) và Quầy Bán hàng (`PosCheckoutTerminal.tsx`): Nút biểu tượng bo tròn mềm mại, chuyển đổi trạng thái nhấp nháy đỏ (`bg-rose-600 animate-pulse`) khi đang thu âm, kết nối phím tắt `Alt+Shift+V`.
  - Hoàn thiện Trung tâm Cài đặt & Tùy biến Hệ thống (`SettingsRbacView.tsx`) với 6 phân hệ chuyên sâu:
    1. **Phân quyền người dùng (RBAC Simulator):** Chuyển đổi linh hoạt giữa 5 vai trò và xem trước ma trận thẩm quyền.
    2. **Phím tắt điều khiển (Shortcuts Manager):** Bảng tra cứu 7 phím tắt, công tắc bật/tắt toàn hệ thống, và Hộp Test Phím Tắt tương tác trực tiếp (Interactive Keypress Tester).
    3. **Giao diện hiển thị (Appearance):** Tùy biến Chủ đề (Sáng / Tối / Tự động theo hệ thống), Mật độ bảng (Thoải mái cho màn cảm ứng / Thu gọn cho máy tính để bàn).
    4. **Âm thanh & Cảnh báo (Audio & Alerts):** Bật/tắt âm thanh phản hồi quầy thu ngân với nút Nghe Thử Tone (Web Audio API Synthesizer tích hợp), tùy biến ngưỡng cảnh báo sắp hết sách.
    5. **Máy in nhiệt POS (Thermal Printer):** Chọn khổ giấy hóa đơn (K80 80mm hoặc K57 57mm), bật/tắt tự động in khi hoàn tất đơn hàng, tùy chỉnh dòng chữ chân trang phiếu thu.
    6. **Ngôn ngữ hệ thống (Language):** Tiếng Việt (mặc định) & English.
    - Toàn bộ tùy chọn cài đặt được lưu trữ bền vững trong `localStorage` (`formapubli_settings`).
  - Biên dịch kiểm thử thành công `npm run build` (0 lỗi), 100% test cases đạt chuẩn.

#### 🔹 [Mã: ENG-20260911-09] Kiểm Toán Toàn Diện Hệ Thống (Master Audit Test Suite) Cho Phase 1 & 2
- **Nhánh:** `feat/sales-order-engine-and-dual-ledger` | **Commit:** `5eba86a`
- **Nội dung:**
  - Xây dựng bộ kiểm toán tự động tổng thể `scripts/test-master-audit.ts` gồm 13 bài kiểm tra khắt khe:
    1. Kiểm toán Master Data: 81 ấn bản (H01-H81), 80 tác phẩm gốc, 3 kho vật lý.
    2. Định luật Bảo toàn Số dư Sổ Cái: $\sum \Delta Q_{\text{ledger}} = Q_{\text{balance}}$ khớp 100% qua ma trận 5 ấn bản x 3 kho, 0 dòng âm kho.
    3. Kiểm toán Chặn lỗi Xuất kho: Từ chối xuất vượt quá tồn kho hiện tại.
    4. Kiểm toán Động cơ Bán hàng POS: Chặn đơn rỗng, chặn số lượng $\le 0$, tự động khấu trừ kho vật lý, tính chiết khấu lẻ/sỉ chính xác.
    5. Kiểm toán Cách ly Sổ Kép Tài chính: Góc nhìn Kế toán thuế (`OFFICIAL_TAX`) lọc sạch 100% đơn nội bộ/đầu nậu (`INTERNAL_MANAGEMENT`), không rò rỉ 1 đồng doanh thu ngầm; Góc nhìn Chủ quản lý hiển thị toàn cảnh thực tế hợp nhất.
  - Kết quả kiểm toán: **13/13 bài test đạt 100%**.
  - Kiểm thử tìm kiếm tiếng Việt không dấu: **10/10 bài test đạt 100%**.
  - Đóng gói Next.js Production (`npm run build`): Thành công với **0 lỗi**.

## 3. Kế Hoạch Triển Khai Chi Tiết Từng Phase (Actionable Master Roadmap)

### 🟢 Phase 1: Lõi Kho Vận Bất Biến & Ma Trận 3 Kho Vật Lý - [ĐÃ HOÀN THÀNH 100%]
- [x] Khởi tạo CSDL kép: Local SQLite (`formapubli.db`) + Cloudflare D1.
- [x] Nạp danh mục chuẩn 81 ấn bản sách (SKU H01-H81, ISBN-13).
- [x] Sổ cái kho bất biến (`inventory_ledger`) Append-only, cấm sửa/xóa.
- [x] Cơ chế chặn xuất âm kho tuyệt đối (Negative Stock Prevention).
- [x] Ma trận tồn kho 3 kho vật lý: Kho 1 Âu Cơ, Kho 2 Quỳnh Mai, Kho 3 Hội Chợ.
- [x] Thuật toán tìm kiếm tiếng Việt không dấu & khử lệch ngữ âm (`ch/tr`, `s/x`, `gi/d/r`).
- [x] Nhận diện giọng nói Web Speech API & Phím tắt hệ thống (`/`, `Esc`, `Alt+Shift+V`).
- [x] Đạt 100% test cases kiểm thử tự động (`scripts/test-inventory.ts`).

---

### 🟢 Phase 2: Động Cơ Bán Hàng Sổ Kép, Quầy POS & Trung Tâm 5 Roles - [ĐÃ HOÀN THÀNH 100%]
- [x] Khai báo 2 bảng thương mại: `orders` và `order_items` với cờ tài chính `fiscal_type`.
- [x] Dịch vụ bán hàng (`order.service.ts`): Bán lẻ giảm 0-10%, Bán sỉ đầu nậu chiết khấu 35-50%.
- [x] Tự động liên kết Thẻ kho khấu trừ sách vật lý tức thì (kho máy = kho kệ 100%).
- [x] Phân tách Sổ Kép (`getSalesSummary`): Sổ Thuế VAT sạch sẽ vs Sổ Quản trị Thực tế Toàn cảnh.
- [x] Quầy POS Bán sách Siêu tốc (`PosCheckoutTerminal.tsx`): Lọc sách, chọn kho, phím tắt `Ctrl+Enter` chốt đơn.
- [x] Sửa lỗi phím tắt và đồng bộ giao diện Micro thu âm (chớp đỏ `animate-pulse`).
- [x] Sidebar điều hướng dọc 7 phân hệ (`AppSidebar.tsx`) tối ưu đa thiết bị (260px desktop, Drawer cảm ứng mobile).
- [x] Bảng Quản trị Vận hành Toàn cảnh (`ExecutiveDashboard.tsx`) với 4 thẻ KPI và phân bổ dòng tiền.
- [x] Ma trận phân quyền 5 nhóm người dùng (RBAC Simulator: Owner, Manager, Cashier, Warehouse, Tax).
- [x] Trung tâm Cài đặt & Tùy biến Hệ thống 6 phân hệ (`SettingsRbacView.tsx`) lưu bền vững vào `localStorage`.
- [x] Đạt 100% test cases bán hàng (`scripts/test-order-sales.ts`), đóng gói Next.js build với **0 lỗi**.

---

### 🟡 Phase 3: Di Động Hóa Quầy, "Súng" Quét Barcode Camera & Offline Sync - [KẾ HOẠCH TRƯỚC MẮT]
*Mục tiêu: Đưa ứng dụng lên điện thoại/tablet của nhân viên bán hội chợ với chi phí thiết bị 0 đồng, bán hàng trơn tru kể cả khi rớt mạng 4-8 tiếng.*

#### 📌 3.1. Đóng gói PWA Cài Đặt 1-Chạm (Progressive Web App Standalone)
- [ ] Khai báo `manifest.json` chuẩn PWA (tên formapubli OS, theme color `#4f46e5`, start_url, display: standalone).
- [ ] Thiết kế bộ icon ứng dụng đầy đủ kích thước (192px, 512px, maskable icon cho Android/iOS).
- [ ] Cấu hình Service Worker cache tài nguyên tĩnh để app khởi động tức thì dưới 0.5s kể cả khi không có mạng.
- [ ] Hỗ trợ nút "Thêm vào màn hình chính" (Add to Home Screen) trên Safari iOS và Chrome Android.

#### 📌 3.2. "Súng" Quét Mã Vạch 0 Đồng Bằng Camera PWA (In-App Barcode Scanner)
- [ ] Tích hợp Barcode Detection API / Camera stream (`getUserMedia`) trên thiết bị di động.
- [ ] Nút biểu tượng quét mã vạch `[ 📷 ]` tại Quầy POS và Màn hình Nhập kho.
- [ ] Bật khung ngắm camera (Viewfinder) nhận diện mã vạch ISBN-13 / EAN-13 sau bìa sách trong 100ms.
- [ ] Tự động phát âm thanh "Bíp" xác nhận (Web Audio API) và thêm sách vào giỏ hàng hoặc tăng số lượng +1.
- [ ] Quét liên tục nhiều cuốn sách mà không cần bấm lại nút (Continuous scanning mode).

#### 📌 3.3. Động Cơ Bán Hàng Ngoại Tuyến Đa Nhân Viên (Offline-First POS Engine)
- [ ] Xây dựng bộ đệm `IndexedDB` lưu danh mục sách và giỏ hàng cục bộ trên trình duyệt thiết bị.
- [ ] Sinh khóa duy nhất bằng UUID v7 (sắp xếp tự nhiên theo thời gian) kết hợp `idempotency_key` cho từng đơn bán offline.
- [ ] Hàng đợi đồng bộ nền (Sync Queue): Tự động phát hiện khi có mạng trở lại (Online Event) và gửi đơn hàng lên máy chủ Cloudflare D1 theo thứ tự.
- [ ] Cơ chế giải quyết xung đột (Conflict Resolution) và chặn trùng lặp đơn hàng tuyệt đối.

#### 📌 3.4. Báo Cáo Doanh Số & Sổ Sách Đa Chiều (Advanced Sales Analytics)
- [ ] Hoàn thiện bộ lọc báo cáo theo Ngày / Tuần / Tháng / Năm trên `SalesLedgerView.tsx`.
- [ ] Công tắc 1-click chuyển đổi nhanh giữa Góc nhìn Thuế VAT vs Góc nhìn Thực tế Nội bộ.
- [ ] Xuất biên bản kê khai doanh số ra file Excel/CSV phục vụ đối soát.

---

### ⚪ Phase 4: Nghiệp Vụ Xuất Bản Mở Rộng & Bán Combo Đóng Hộp - [CHỜ TRIỂN KHAI]
*Mục tiêu: Xử lý các nghiệp vụ đặc thù chiều sâu của ngành sách Việt Nam.*

#### 📌 4.1. Động Cơ Đóng Combo / Hộp Tuyển Tập (Boxset & Bundle Engine)
- [ ] Khai báo cấu trúc sản phẩm phức hợp (Composite Item): 1 mã Combo bao gồm danh sách $N$ mã ấn bản lẻ + 1 vỏ hộp.
- [ ] Khi bán 1 Combo tại Quầy POS, hệ thống tự động sinh bút toán Thẻ kho trừ đồng thời toàn bộ các cuốn sách lẻ thành phần và vỏ hộp.
- [ ] Cơ chế cảnh báo tồn kho Combo dựa trên thành phần có số lượng tồn ít nhất (Bottleneck Component).

#### 📌 4.2. Phân Hệ Quản Trị Ký Gửi Phố Sách (Consignment Ledger)
- [ ] Quản lý dòng sách ký gửi tại Đinh Lễ, Nguyễn Xí, Đường sách TP.HCM.
- [ ] Phân định rõ ràng: Đại lý giữ sách (*Custodian*) nhưng quyền sở hữu (*Owner*) vẫn thuộc công ty cho đến khi bán được.
- [ ] Màn hình lập biên bản đối soát định kỳ: So sánh số sách gửi ban đầu với số đếm thực tế để bóc tách: Sách đã bán cần đòi tiền, sách rách hỏng cần thu hồi và sách thất thoát.

#### 📌 4.3. Quản Lý Hạn Ngạch Bản Quyền & Nhuận Bút Tác Giả (Rights & Royalties Ledger)
- [ ] Quản lý hợp đồng bản quyền sách dịch/tác quyền (thời hạn 5 năm, hạn ngạch số cuốn được in tối đa).
- [ ] Tự động đếm lũy kế số cuốn đã in thực tế qua Thẻ kho để cảnh báo trước khi vượt hạn ngạch cấp phép.
- [ ] Bảng tính tiền nhuận bút tự động theo tỷ lệ % giá bìa nhân với số cuốn bán thực tế.

---

### ⚪ Phase 5: Hệ Sinh Thái AI Tinh Gọn & Trợ Lý Bán Hàng 0 Đồng - [CHỜ TRIỂN KHAI]
*Mục tiêu: Đưa trí tuệ nhân tạo vào hỗ trợ trực tiếp nhân viên và giám đốc với chi phí 0 VNĐ/tháng (Free Tier First).*

#### 📌 5.1. Smart Voice POS Dispatcher (Trợ Lý Lên Đơn Thần Tốc Bằng Giọng Nói)
- [ ] Tích hợp Groq Whisper Large v3 (chuyển âm thanh tiếng Việt thành text chuẩn xác trong 0.3s).
- [ ] LLM Function Calling (LLaMA 3.3 / Gemini Flash) bóc tách thực thể: Mã SKU, số lượng, kho xuất, tỷ lệ chiết khấu, cờ sổ kép.
- [ ] Tự động điền dữ liệu vào Giỏ hàng POS theo nguyên tắc "Human-in-the-loop" (thu ngân kiểm tra và bấm xác nhận).

#### 📌 5.2. Executive AI Copilot (Trợ Lý Điều Hành Giám Đốc)
- [ ] Trợ lý đối thoại hỏi đáp bằng tiếng Việt tự nhiên qua Gemini 1.5 Flash.
- [ ] Chế độ an toàn Read-only: Chỉ gọi các API đọc số liệu doanh thu, tồn kho; cấm tuyệt đối can thiệp sửa đổi CSDL.
- [ ] Cơ chế RBAC Scope Guard: Không rò rỉ dữ liệu Sổ Quản trị nội bộ cho tài khoản vai trò Kế toán thuế.

#### 📌 5.3. Dự Báo Tái Bản Thông Minh & Điểm Cạn Kho (Reprint Runout Forecasting)
- [ ] Tự động tính toán Vận tốc bán trung bình ($V_{\text{sale}} = \text{Số cuốn bán} / \text{Ngày}$) của từng tựa sách theo thời gian thực.
- [ ] Cảnh báo điểm cạn kho trước 30-45 ngày để Giám đốc kịp làm việc với NXB và Nhà in.

#### 📌 5.4. Hồ Sơ Độc Giả Thân Thiết & Đọc Sách Theo Mùa (Reader Persona CRM)
- [ ] Quản lý lịch sử mua sắm và sở thích đọc của từng bạn đọc.
- [ ] Phân loại nhóm độc giả sưu tầm (sách bản đặc biệt, bìa cứng) vs độc giả mua combo theo mùa.
- [ ] AI gợi ý danh sách bạn đọc phù hợp nhất khi ra mắt tác phẩm mới cùng dịch giả hoặc cùng chủ đề.

---

### ⚪ Phase 6: Tích Hợp Đa Kênh & Bàn Giao Vận Hành Toàn Diện - [TẦM NHÌN DÀI HẠN]
- [ ] Đồng bộ tồn kho 2 chiều với Shopee Open Platform & TikTok Shop theo hạn ngạch an toàn.
- [ ] Kết nối API phần mềm Hóa đơn điện tử chính thức (VNPT / Viettel / MISA) cho các đơn `OFFICIAL_TAX`.
- [ ] Đóng gói tài liệu bàn giao kỹ thuật, thiết lập cơ chế sao lưu CSDL tự động lên Google Drive hàng ngày.

---

## 4. Điểm Cần Cải Thiện & Hạng Mục Tối Ưu (Improvement Backlog)

| Hạng mục | Vấn đề hiện tại / Mục tiêu | Giải pháp kỹ thuật triển khai | Độ ưu tiên | Phase thực hiện |
| :--- | :--- | :--- | :---: | :---: |
| **"Súng" quét mã vạch 0 đồng** | Máy quét mã vạch đắt tiền (1-2 triệu), cồng kềnh tại hội chợ | Tích hợp Camera Barcode Detection API quét ISBN sau bìa sách tít tít trừ kho | 🔴 Khẩn cấp | **Phase 3** (Mục 3.2) |
| **Cài đặt dạng App (PWA)** | Cần mở app toàn màn hình trên điện thoại/tablet không qua App Store | File `manifest.json`, icon app, Service Worker cache cho iOS & Android | 🔴 Khẩn cấp | **Phase 3** (Mục 3.1) |
| **Bán hàng khi rớt mạng** | Hội chợ sách nghẽn sóng 4G/Wifi từ 4 - 8 tiếng liên tục | `IndexedDB` Queue + UUID v7 + Idempotency Key tự động sync khi có mạng | 🔴 Khẩn cấp | **Phase 3** (Mục 3.3) |
| **Bán sách Combo / Tuyển tập** | Bán 1 hộp sách cần trừ đồng thời các cuốn lẻ và vỏ hộp | Động cơ Boxset / Bundle Engine tự động trừ Thẻ kho cho từng linh kiện | 🟡 Quan trọng | **Phase 4** (Mục 4.1) |
| **Đối soát ký gửi Đinh Lễ** | Số lượng sách gửi ký gửi thường xuyên lệch sau 3-6 tháng | Sổ cái ký gửi riêng biệt + Thuật toán so lệch kiểm đếm thực tế | 🟡 Quan trọng | **Phase 4** (Mục 4.2) |
| **Lên đơn giọng nói bằng AI** | Hội chợ ồn ào hoặc đơn sỉ nhiều đầu sách cần lên nhanh | Groq Whisper + LLaMA 3.3 tự động bóc tách thực thể nạp vào Giỏ POS | 🟢 Trung hạn | **Phase 5** (Mục 5.1) |
| **Cảnh báo tái bản sách** | In sách mất 30-40 ngày, để hết sách mới in sẽ mất mùa bán | Thuật toán đo vận tốc bán $V_{\text{sale}}$ cảnh báo trước điểm cạn kho | 🟢 Trung hạn | **Phase 5** (Mục 5.3) |

