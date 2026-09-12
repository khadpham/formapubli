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
| **Phase 3** | **Di Động Hóa Quầy, "Súng" Quét Barcode Camera & Offline Sync**<br/>(PWA Standalone, Quét mã vạch ISBN bằng Camera điện thoại 0 đồng, IndexedDB Queue rớt mạng, Báo cáo doanh số đa chiều) | 🟢 **HOÀN THÀNH** | **100%** | `feat/pwa-mobile-and-offline-pos` |
| **Phase 4** | **Nghiệp Vụ Xuất Bản Mở Rộng & Bán Combo Đóng Hộp**<br/>(Động cơ Combo/Boxset trừ linh kiện, Sổ cái Ký gửi Đinh Lễ, Quản trị Bản quyền & Nhuận bút tác giả) | 🟡 **ĐANG TRIỂN KHAI** | **65%** | `feat/pwa-mobile-and-offline-pos`<br/>`feat/boxset-engine`<br/>`feat/consignment-ledger` |
| **Phase 5** | **Hệ Sinh Thái AI Tinh Gọn & Trợ Lý Bán Hàng 0 Đồng**<br/>(Smart Voice POS Dispatcher qua Groq Whisper, Executive AI Copilot qua Gemini Flash, Dự báo tái bản $V_{\text{sale}}$, CRM Độc giả) | 🟡 **ĐANG TRIỂN KHAI** | **25%** | `feat/pwa-mobile-and-offline-pos`<br/>`feat/runout-forecasting-v-sale` |
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

#### 🔹 [Mã: ENG-20260911-10] Triển Khai Gói PWA First-Class & "Súng" Quét Mã Vạch Camera 0 Đồng
- **Nhánh:** `feat/pwa-mobile-and-offline-pos`
- **Nội dung:**
  - Đóng gói PWA Standalone: Khai báo `public/manifest.json` (tên formapubli OS, theme `#4f46e5`, icon 192px/512px, display standalone), Service Worker `public/sw.js` cache tài nguyên tĩnh, component `PwaRegister.tsx` lắng nghe sự kiện cài đặt app.
  - Xây dựng "Súng" Quét Mã Vạch Camera 0 Đồng (`src/components/scanner/InAppBarcodeScanner.tsx`):
    - Khung ngắm Viewfinder laser đỏ/xanh lá với góc bo tròn công nghệ cao, animation `animate-scan-beam`.
    - Tích hợp `BarcodeDetector` API native quét chuẩn EAN-13 / ISBN-13 trong 100ms.
    - Âm thanh "Bíp" siêu thị trong trẻo bằng Web Audio API Synthesizer (880Hz -> 1760Hz double chirp) + rung haptic `navigator.vibrate`.
    - Công tắc bật đèn Flash (Torch) và chuyển đổi Camera trước/sau.
    - Bảng mã vạch test mẫu 6 cuốn sách giúp kiểm thử 1-click ngay trên máy tính bàn.
  - Tích hợp vào Quầy POS (`PosCheckoutTerminal.tsx`):
    - Bổ sung nút Camera `[ 📷 ]` trong thanh tìm kiếm cạnh nút Micro.
    - Phím tắt bàn phím `Alt + Shift + C` để bật/tắt camera tức thì.
    - Tự động tra cứu ISBN-13, nạp sách vào giỏ hàng (+1 cuốn), hiển thị Toast thông báo xanh lá.
  - Kiểm thử tự động `scripts/test-barcode-engine.ts` vượt qua **7/7 test cases (100%)**.
  - Kiểm toán bảo toàn sổ cái `scripts/test-master-audit.ts`: **13/13 test cases (100%)**.
  - Biên dịch Next.js production build (`npm run build`): First Load JS chỉ 116 kB, **0 lỗi**.

#### 🔹 [Mã: ENG-20260911-11] Động Cơ POS Ngoại Tuyến (Offline-First), Khóa UUID v7, Đồng Bộ Tự Động & Báo Cáo Doanh Số Đa Chiều
- **Nhánh:** `feat/pwa-mobile-and-offline-pos`
- **Nội dung:**
  - Xây dựng `src/lib/uuidv7.ts`: Thuật toán sinh UUID v7 chuẩn RFC 9562 với 48-bit timestamp và tính tăng đơn điệu (monotonic ordering), cho phép trích xuất mili-giây chuẩn xác.
  - Xây dựng `src/lib/offline-db.ts`: Bộ đệm IndexedDB cục bộ (`formapubli_offline_db`) không phụ thuộc thư viện bên ngoài, zero-cost, lưu trữ an toàn đơn hàng ngoại tuyến.
  - Tích hợp Offline-First vào `PosCheckoutTerminal.tsx`:
    - Bán hàng bình thường khi mất mạng, tự động lưu IndexedDB với mã đơn `OFF-YYYYMMDD-XXXX`.
    - Tự động phát hiện mạng trở lại qua sự kiện `online` và đồng bộ hàng loạt lên máy chủ.
    - Huy hiệu mạng trực quan (`🟢 Trực tuyến` vs `🟡 Mất mạng (Chế độ Offline)`) kèm nút bấm `[ 🔄 Đồng bộ ngay ]`.
    - Phiếu giao hàng thông minh nhận biết đơn ngoại tuyến và thông báo rõ ràng cho thu ngân.
  - Bảo vệ Idempotency trong `OrderService.createOrder` và API `/api/orders`: Loại trừ hoàn toàn nguy cơ trùng đơn hoặc trừ thẻ kho hai lần khi sync lại.
  - Nâng cấp `SalesLedgerView.tsx`:
    - Bộ lọc thời gian đa chiều: Tất cả, Hôm nay, 7 ngày qua, Tháng này, Tùy chọn (Custom Range).
    - Bộ lọc theo Kho xuất hàng: Toàn hệ thống, Kho 1 - Âu Cơ, Kho 3 - Hội Chợ, Kho 2 - Quỳnh Mai.
    - Bộ kiểm thử tự động `scripts/test-offline-engine.ts` vượt qua **9/9 test cases (100%)**.
  - Kiểm thử quét mã vạch `scripts/test-barcode-engine.ts`: **7/7 test cases (100%)**.
  - Kiểm toán tổng thể `scripts/test-master-audit.ts`: **13/13 test cases (100%)**.
  - Đóng gói Next.js production build (`npm run build`): **0 lỗi biên dịch, First Load JS chỉ 120 kB**.

#### 🔹 [Mã: ENG-20260913-12] Vá Toàn Diện Lỗ Hổng Kỹ Thuật Cốt Lõi (Priority P0 Technical Audit Fixes)
- **Nhánh:** `feat/pwa-mobile-and-offline-pos`
- **Nội dung:**
  - **Vá ACID Transaction cho Thẻ Kho & Bán Hàng (Triệt tiêu B1):**
    - Viết lại `InventoryService.recordMovement` và `InventoryService.transfer` bọc 100% trong `db.transaction(async (tx) => { ... })`. Gom kiểm tra tồn, insert thẻ kho và upsert balance vào một giao dịch nguyên tử, tự động rollback sạch sẽ nếu lỗi.
    - Viết lại `OrderService.createOrder` thực thi nguyên tử trong một Transaction (All-or-Nothing): Tạo đơn hàng, lưu chi tiết đơn hàng và trừ thẻ kho từng cuốn sách đồng thời. Nếu 1 cuốn sách thiếu hàng, toàn bộ đơn tự động hủy bỏ, không sinh đơn rác.
  - **Nâng cấp Schema `inventory_ledger` & Ràng buộc CSDL (Triệt tiêu B2):**
    - Bổ sung 6 trường kiểm toán nền móng: `owner_id`, `lot_id`, `unit_cost_snapshot`, `correlation_id`, `reversal_of`, `effective_at`.
    - Mở rộng enum `condition` hỗ trợ `QUARANTINE`.
    - Thêm ràng buộc `nonNegativeCheck: check('check_stock_non_negative', sql`physical_quantity >= 0`)` trên bảng `stock_balances`.
    - Áp dụng thành công migration `0003_slim_caretaker.sql` trên `formapubli.db`.
  - **Xây Dựng Lá Chắn Bảo Mật Server-side Cho Sổ Kép & Audit Logs (Triệt tiêu B3 & B4):**
    - Xây dựng `src/lib/rbac-guard.ts` với hàm `enforceFiscalScope`: Server tự động ép chặt `ROLE_TAX` chỉ được xem `OFFICIAL_TAX`, chặn đứng 100% việc sửa tham số trên URL để đọc trộm Sổ Quản trị nội bộ.
    - Tạo bảng CSDL `audit_logs` tự động ghi vết mọi lượt truy cập dữ liệu quản trị nội bộ hoặc thao tác tạo đơn hàng.
  - **Gia Cố Concurrency & Xử Lý Lệch Tồn Hội Chợ (Theo Góp Ý Chuyên Gia):**
    - Tiện ích `src/lib/db-retry.ts` (`withDbRetry`): Bọc cơ chế thử lại tự động với Exponential Backoff và Random Jitter khi gặp `SQLITE_BUSY` hoặc `database is locked`.
    - **Pattern Offline Overdraft 2 bước:** Khi đơn sync ngoại tuyến bán vượt số tồn, hệ thống tự động sinh `ADJUSTMENT (+K)` với ghi chú `FAIR_VARIANCE` rồi mới trừ `SALE (-K)` $\rightarrow$ Ràng buộc `CHECK (physical_quantity >= 0)` luôn thỏa mãn 100%, số dư không bị âm, đơn hàng gắn cờ `SYNCED_WITH_OVERDRAFT_WARNING` để đối soát cuối ca.
    - **Khắc phục Race Condition của Idempotency Key:** Bắt lỗi `SQLITE_CONSTRAINT_UNIQUE` khi 2 luồng gửi cùng 1 key đồng thời, tự động truy vấn và trả về kết quả cũ 200 thay vì sập lỗi 500.
  - **Kiểm Thử & Đóng Gói:**
    - Xây dựng bộ test chuyên sâu `scripts/test-p0-verification.ts`: Vượt qua **7/7 test cases (100%)**.
    - Bộ kiểm thử `scripts/test-inventory.ts`: **6/6 test cases (100%)**.
    - Bộ kiểm thử `scripts/test-order-sales.ts`: **6/6 test cases (100%)**.
    - Bộ kiểm thử `scripts/test-offline-engine.ts`: **9/9 test cases (100%)**.
    - Bộ kiểm toán Master Audit `scripts/test-master-audit.ts`: **13/13 test cases (100%)**.
    - Đóng gói Next.js Production (`npm run build`): Thành công với **0 lỗi biên dịch**, First Load JS chỉ 125 kB.

#### 🔹 [Mã: ENG-20260913-13] Vá 5 Vết Nứt P0-Rework & Triển Khai Phân Hệ Két Tiền Quầy (Cashbox Session) & Trần Chiết Khấu Manager PIN
- **Nhánh:** `feat/pwa-mobile-and-offline-pos`
- **Nội dung:**
  - **Vá Vết Nứt a: Atomic UPDATE + rowsAffected Guard (Triệt tiêu Lost-Update 100%):**
    - Refactor `InventoryService.recordMovement`: Cập nhật trực tiếp qua câu lệnh `UPDATE stock_balances SET physical_quantity = physical_quantity + ? WHERE ... AND (physical_quantity + ? >= 0)`.
    - Kiểm tra `rowsAffected` ngay trong transaction. Nếu = 0, phát hiện ngay xung đột hoặc thiếu kho và ném lỗi rõ ràng, chấm dứt hoàn toàn nguy cơ 2 thu ngân ghi đè số dư của nhau.
  - **Vá Vết Nứt b: Mở Cờ Overdraft & Validate Phân Quyền Phía API:**
    - Cập nhật `/api/orders`: Tiếp nhận `isOfflineSync` và `allowOverdraft`.
    - Ràng buộc thẩm quyền: Chỉ `ROLE_OWNER` / `ROLE_MANAGER` hoặc đơn có `isOfflineSync = true` mới được kích hoạt `allowOverdraft`. Thu ngân bình thường gửi đơn online với `allowOverdraft=true` sẽ bị server tự động ép về `false`.
    - POS Terminal khi sync đơn từ IndexedDB tự động truyền đầy đủ `isOfflineSync: true` và `allowOverdraft: true`.
  - **Vá Vết Nứt c: Siết Chặt Phân Quyền Thu Ngân & Thủ Kho:**
    - Thu ngân (`ROLE_CASHIER`) khi gọi `/api/orders` bị ép lọc theo đúng `cashierId` của ca mình, tuyệt đối không xem được doanh thu gộp hoặc đơn của quầy khác.
    - Thủ kho (`ROLE_WAREHOUSE`) gọi `/api/orders` bị chặn truy cập doanh thu, chỉ được quản lý tồn kho vật lý.
  - **Triển Khai Phân Hệ D1: Két Tiền Ca Thu Ngân & Kiểm Kê Tiền Mặt (Cashbox Session):**
    - Khởi tạo bảng CSDL `cashbox_sessions`: Quản lý ID thu ngân, kho, tiền bàn giao đầu ca (`opening_cash`), tiền mặt thực đếm khi chốt ca (`closing_cash_actual`), tiền mặt hệ thống tính (`expected_cash`), chênh lệch két (`cash_discrepancy`), tổng doanh thu tiền mặt vs chuyển khoản/QR, trạng thái OPEN/CLOSED.
    - Liên kết mỗi đơn hàng với `cashbox_session_id`.
    - Xây dựng dịch vụ `CashboxService` và API route `/api/cashbox` (`OPEN`, `CLOSE`, truy vấn ca hiện tại, liệt kê lịch sử ca).
    - Giao diện POS tích hợp Huy hiệu Két tiền trên thanh tiêu đề, nút "Mở Két Ca Mới", Modal Mở Ca, Modal Chốt Ca & Kiểm Kê Két Tiền hiển thị chênh lệch thời gian thực (Khớp 100% / Thừa / Thiếu).
  - **Triển Khai Phân Hệ D2: Trần Chiết Khấu Quầy (Hard-cap 15%) & Modal Mã PIN Quản Lý:**
    - Thu ngân bị giới hạn chiết khấu tối đa 15%. Mức chiết khấu sỉ/đầu nậu (20%, 35%, 40%) tự động khóa với biểu tượng 🔒.
    - Khi áp dụng mức chiết khấu > 15%, hệ thống kích hoạt Modal Mã PIN Quản Lý (Mã: 9999 / 1234 / 8888). Sau khi Quản lý nhập đúng PIN, hạn mức được mở khóa cho giao dịch hiện tại.
  - **Cập Nhật Master Blueprint Chương 32:** Bổ sung Ba Chuẩn Mực Vận Hành Thực Địa (Atomic Guard, Counter Quota "Chia Mâm", Clean Slate Opening Stock).
  - **Kiểm Thử Tự Động Toàn Diện:**
    - Nâng cấp `scripts/test-p0-verification.ts` lên **10/10 test cases đạt chuẩn 100%** (bao gồm kiểm thử Atomic UPDATE rowsAffected, Vòng đời ca két tiền & đối soát chênh lệch, và Cô lập đơn hàng của thu ngân).
    - `scripts/test-inventory.ts`: **6/6 test cases (100%)**.
    - `scripts/test-master-audit.ts`: **13/13 test cases (100%)**.
    - Đóng gói Next.js Production (`npm run build`): Thành công mỹ mãn với **0 lỗi biên dịch**, First Load JS giữ vững mức **128 kB** ($\le$ 130 kB ngân sách).

#### 🔹 [Mã: ENG-20260913-14] Triển Khai Phase D3 & D4: Hạn Ngạch Chia Mâm Quầy, Soạn Sách Kệ Kho (Pick List), Cách Ly Sách Lỗi (RMA) & Đóng Dấu Băm SHA-256
- **Nhánh:** `feat/pwa-mobile-and-offline-pos`
- **Nội dung:**
  - **Kiến trúc Module Hóa Không Xung Đột (Non-Colliding Architecture):**
    - Migration Additive-only `0005_d3_d4_quota_rma.sql`: Tạo 2 bảng mới `counter_allocations` và `rma_tickets` với chỉ mục đầy đủ, bảo toàn 100% các bảng cũ.
  - **D3: Hạn Ngạch Bàn Quầy "Chia Mâm" (`allocation.service.ts`):**
    - Trưởng quầy phân bổ số lượng sách cho từng bàn (`counter_allocations`).
    - Kiểm tra hạn ngạch thời gian thực (`checkCounterQuota`): Cảnh báo thu ngân khi sách trên bàn quầy sắp hết để tiếp tế từ kho đệm hội chợ.
    - Cập nhật số lượng đã bán (`recordCounterSales`) khi hoàn tất giao dịch.
  - **D3: Danh Sách Soạn Sách Kệ Kho (Shelf Pick List):**
    - Hàm `generatePickList`: Tự động tra cứu vị trí kệ (`suggestedLocation`) từ danh mục ấn bản, gom nhóm theo vị trí kệ kho và sắp xếp tối ưu thứ tự nhặt sách.
    - Component `PickListModal.tsx`: Bảng soạn hàng trực quan có checkbox đánh dấu từng cuốn đã lấy, nút in phiếu soạn hàng (Print Pick List).
  - **D4: Quy Trình Tiếp Nhận & Cách Ly Sách Lỗi/Đổi Trả (RMA Quarantine Workflow):**
    - Dịch vụ `rma.service.ts`: Tiếp nhận sách lỗi in (`PRINT_DEFECT`), bung gáy (`BINDING_DEFECT`), dập góc (`TRANSIT_DAMAGE`), khách trả (`CUSTOMER_RETURN`), ẩm mốc (`WATER_DAMAGE`).
    - Tự động trừ tồn kho `NEW` và tăng kho `QUARANTINE` / `DEFECTIVE` trong Ledger bất biến $\rightarrow$ Tuyệt đối không để lẫn sách hỏng vào tồn bán cho độc giả.
    - Hàm `resolveTicket`: Xử lý sau kiểm định gồm tiêu hủy phế liệu (`WRITE_OFF_SCRAP`), xuất trả NXB (`RETURN_TO_SUPPLIER`), hoặc phục hồi về `NEW` (`REPAIRED_RESTOCK`).
    - Component `RmaTicketModal.tsx` trên giao diện Ma trận Kho cho phép nhân viên tạo phiếu RMA 1 chạm.
  - **D4: Đóng Dấu Watermark & Khóa Băm Toàn Vẹn SHA-256 Cho File Xuất Báo Cáo:**
    - Tiện ích `src/lib/export-hash.ts`: Thuật toán pure TypeScript SHA-256 (0-dependency, chạy mượt mà trên cả Node.js, Web Browser và PWA Worker).
    - Tính mã băm SHA-256 trên dữ liệu chuẩn hóa và thêm Watermark Footer ở cuối file CSV doanh số (`SalesLedgerView.tsx`): Ghi nhận vai trò, mã người xuất, ngày giờ UTC, và mã băm 64 ký tự.
    - Hàm `verifyExportIntegrity`: Phát hiện ngay lập tức nếu file bảng tính bị sửa đổi dù chỉ 1 ký tự số tiền.
  - **Kiểm Thử Toàn Diện & Đóng Gói:**
    - Viết mới `scripts/test-d3-d4.ts`: Đạt **20/20 test cases (100%)**.
    - Chạy lại toàn bộ: `test-p0-verification.ts` (10/10 PASS), `test-inventory.ts` (6/6 PASS), `test-master-audit.ts` (13/13 PASS) $\rightarrow$ **Tổng 49/49 test cases PASS 100%**.
    - Next.js Production Build (`npm run build`): Thành công với **0 lỗi, 0 cảnh báo type**, First Load JS chỉ 132 kB.

#### 🔹 [Mã: ENG-20260913-15] Hợp Nhất Phân Hệ Bảo Vệ Server-Enforce Discount/PIN & Cô Lập Toàn Bộ 9 Test Suites (Clean Slate Runner)
- **Nhánh:** `feat/pwa-mobile-and-offline-pos` (Merge từ `feat/server-discount-test-db` & `feat/isolate-all-test-suites`)
- **Nội dung:**
  - **Server-Side Discount Hard-Cap 15% & PIN Check (`src/app/api/orders/route.ts`):**
    - Đặt hằng số `MAX_CASHIER_DISCOUNT_RATE = 0.15` (15%), danh sách PIN quản lý `['9999', '1234', '8888']`.
    - Tính `effectiveItemDiscounts` bằng `Math.max` của cả `discountRate` tổng lẫn `unitDiscountRate` từng dòng (chặn đứng mọi thủ thuật lách chiết khấu từng cuốn).
    - Phân quyền kép: `ROLE_OWNER` / `ROLE_MANAGER` được miễn trừ tự nhiên; `ROLE_CASHIER` gửi đơn vượt 15% mà không có PIN hoặc sai PIN sẽ bị chặn cứng với HTTP 403 Forbidden.
    - Ghi nhận `MANAGER_DISCOUNT_APPROVED` và `MANAGER_DISCOUNT_DENIED` vào `audit_logs` — **tuyệt đối không lưu mã PIN vào log kiểm toán**.
  - **Cô Lập Toàn Bộ CSDL Kiểm Thử (Clean Slate Test DB Runner):**
    - `scripts/test-guard.ts`: Hàm `assertIsolatedTestDb()` tự động ném `exit 2` chặn ngay lập tức nếu bất kỳ file test nào trỏ vào `formapubli.db` production.
    - `scripts/setup-test-db.ts`: Xóa file `formapubli_test.db` cũ $\rightarrow$ Dựng schema qua `drizzle-kit push` $\rightarrow$ Seed chuẩn xác 81 ấn bản từ CSV + 3 kho + 5 đối tác + `OPENING_BALANCE` 50 cuốn/ấn bản tại Âu Cơ ghi đồng thời cả Ledger lẫn Stock Balance (đảm bảo luật bảo toàn số dư).
    - `scripts/run-isolated.ts` & `npm run test:isolated`: Chạy tuần tự 9 suites test hoàn toàn trong môi trường cách ly, đối chiếu mtime và file size của `formapubli.db` trước/sau để bảo vệ 100% tính trong sạch của DB thật.
  - **Kết Quả Nghiệm Thu:**
    - Toàn bộ **9/9 test suites** đạt **89/89 test cases PASS (100%)**:
      - `test-discount-guard`: 8/8 PASS
      - `test-p0-verification`: 10/10 PASS
      - `test-inventory`: 6/6 PASS
      - `test-order-sales`: 6/6 PASS
      - `test-offline-engine`: 9/9 PASS
      - `test-d3-d4`: 20/20 PASS
      - `test-master-audit`: 13/13 PASS
      - `test-vietnamese-search`: 10/10 PASS
      - `test-barcode-engine`: 7/7 PASS
    - `formapubli.db` production nguyên vẹn 100%, không bị ô nhiễm dù chỉ 1 byte.
    - Đóng gói Next.js Production Build (`npm run build`): Thành công với **0 lỗi biên dịch, 0 type error**, First Load JS giữ ở mức **132 kB**.

#### 🔹 [Mã: ENG-20260913-16] Triển Khai Phân Hệ Luân Chuyển 2 Bước (IN_TRANSIT Two-Step Engine via Virtual Hub)
- **Nhánh:** `feat/pwa-mobile-and-offline-pos` (Merge từ `feat/in-transit-two-step`)
- **Nội dung:**
  - **Kho Ảo Chung `wh-in-transit` (`KHO_IN_TRANSIT`):**
    - Tránh bùng nổ tổ hợp kho ảo $N \times (N-1)$ tuyến; toàn bộ xe hàng đang lưu thông trên đường đều lưu chuyển qua trạm trung chuyển logic này.
  - **Migration `0006_transfer_shipments.sql`:**
    - Khởi tạo 2 bảng `transfer_shipments` và `transfer_shipment_items` quản lý mã phiếu `TRF-YYYYMMDD-XXXX`, kho gửi/nhận, người điều phối/người nhận, trạng thái luân chuyển (`IN_TRANSIT`, `RECEIVED_FULL`, `RECEIVED_DISCREPANCY`, `CANCELLED`).
    - Script `scripts/apply-migration-0006.ts` áp dụng vào LibSQL độc lập.
  - **Động Cơ Luân Chuyển 2 Bước Chống Mất Hàng (`TransferService`):**
    - **Bước 1 (Dispatch):** Trừ kho gửi $\rightarrow$ Tăng `wh-in-transit`. Chặn đứng ngay nếu xuất vượt tồn kho gửi (Negative Stock Guard), không sinh phiếu rác.
    - **Bước 2 (Receive):** Biên bản thực nhận bắt buộc bảo toàn phương trình:
      $$\text{Lành (R)} + \text{Hỏng (D)} + \text{Mất (L)} = \text{Tổng hàng gửi (X)}$$
      - Sách lành $(R) \rightarrow$ Cộng kho đích `NEW`.
      - Sách rách/ướt trên đường $(D) \rightarrow$ Đưa thẳng vào condition `'QUARANTINE'` chờ RMA/sửa chữa.
      - Sách thất lạc/rơi thùng $(L) \rightarrow$ Ghi bút toán `'TRANSFER_LOSS'` trừ sạch tồn transit về 0.
      - Trạng thái phiếu: Tự động đánh dấu `RECEIVED_FULL` (nếu nhận đủ) hoặc `RECEIVED_DISCREPANCY` (nếu có chênh lệch/mất/hỏng).
    - **Cơ Chế Cancel & Cảnh Báo Xe Kẹt (Stale Shipments):**
      - Cho phép hủy phiếu khi còn đang `IN_TRANSIT` để thu hồi sách về lại kho xuất an toàn.
      - Hàm `getStaleShipments`: Tự động lọc các chuyến xe đi đường quá 12 tiếng để đội điều phối gọi lái xe đối soát.
  - **API `/api/transfers` & Bảo Mật:**
    - Hỗ trợ đầy đủ hành động: `dispatch`, `receive`, `cancel`, `stale`, tra cứu chi tiết phiếu.
    - Chặn cứng vai trò `ROLE_TAX` với HTTP 403 Forbidden; tự động ghi vết audit logs cho mọi lượt dispatch, receive, cancel.
  - **Kiểm Thử Toàn Diện:**
    - Test suite `scripts/test-in-transit.ts` đạt **17/17 PASS**.
    - Next.js Production Build (`npm run build`): Thành công với **0 lỗi biên dịch**, First Load JS giữ ở mức **132 kB**.

#### 🔹 [Mã: ENG-20260913-17] Triển Khai Phân Hệ Sổ Ký Gửi Đinh Lễ & Biên Bản Công Nợ Phải Thu (Consignment Ledger & AR Engine)
- **Nhánh:** `feat/pwa-mobile-and-offline-pos` (Merge từ `feat/consignment-ledger`)
- **Nội dung:**
  - **Mô Hình Kho Đại Lý Đích Danh & Quyền Sở Hữu:**
    - Mỗi đối tác ký gửi sở hữu một kho ảo riêng `wh-consign-<code>` (ví dụ `wh-consign-ns-mao-dinh-le`).
    - Bút toán ghi nhận rõ quyền sở hữu `ownerId: 'part-formapubli'` $\rightarrow$ Về mặt pháp lý và kiểm toán, hàng ký gửi vẫn thuộc sở hữu của NXB/Nhà sách.
  - **Migration `0007_consignment_ledger.sql`:**
    - Khởi tạo 2 bảng `consignment_statements` và `consignment_statement_items` quản lý kỳ đối soát (mã `STMT-YYYYMM-XXXX`), trạng thái `DRAFT` $\rightarrow$ `CONFIRMED`, `opening_ledger_rowid`, doanh thu bìa, chiết khấu kỳ, công nợ phải thu ròng (AR).
    - Script `scripts/apply-migration-0007.ts` hỗ trợ deploy LibSQL / D1 độc lập.
  - **Tái Sử Dụng Hoàn Toàn Động Cơ Luân Chuyển T1 (IN_TRANSIT):**
    - Xuất gửi hàng đi: Gọi `TransferService.dispatch` $\rightarrow$ Nhận hàng tại quầy đối tác: Gọi `TransferService.receive` theo biên bản ký tay, kế thừa trọn vẹn bảo toàn hao hụt đường đi.
  - **Khóa Kỳ Đối Soát Bất Biến & Chốt Công Nợ Phải Thu (AR):**
    - Phương trình đối soát dòng hàng tại quầy ký gửi:
      $$\text{Tồn đầu} + \text{Gửi thêm} = \text{Báo bán} + \text{Thu hồi} + \text{Hỏng/Mất} + \text{Tồn cuối}$$
    - Tính toán công nợ phải thu:
      $$\text{AR} = \sum (\text{Báo bán} \times \text{Giá bìa} \times (1 - \text{DiscountRate}))$$
    - Hỗ trợ chọn cờ Sổ Kép (`fiscalScope`: mặc định `INTERNAL_MANAGEMENT`, chỉ Manager/Owner được mở `OFFICIAL_TAX`).
    - Khi chốt `CONFIRMED`: Tự động hạch toán xuất kho bán `CONSIGNMENT_SOLD` và xuất kho mất `CONSIGNMENT_LOSS` khỏi kho đại lý; từ chối chốt nếu số liệu có thặng dư bất thường.
  - **Vá Lỗi Nhạy Cảm Đồng Giây (Precision Race Condition Fix):**
    - Phát hiện lỗi `CURRENT_TIMESTAMP` của SQLite chỉ tính tới giây; khắc phục dứt điểm bằng mốc con trỏ thứ tự `opening_ledger_rowid`.
  - **API `/api/consignments` & Audit Trail:**
    - Cung cấp các endpoints: gửi hàng, xác nhận nhận, báo bán lẻ tẻ, thu hồi hàng, tạo kỳ, sửa kỳ nháp, và chốt kỳ đối soát.
    - Phân quyền chặt chẽ, ghi nhận audit logs đầy đủ.
  - **Kiểm Thử Toàn Diện:**
    - Test suite `scripts/test-consignment.ts` đạt **15/15 PASS**.
    - Nâng tổng số test suites lên **11 suites cách ly / 121 test cases đạt chuẩn 100%**.
#### 🔹 [Mã: ENG-20260913-18] Triển Khai Động Cơ Bán Sách Combo/Đóng Hộp & Chặn Điểm Nghẽn Kho (Boxset & Bundle Engine)
- **Nhánh:** `feat/pwa-mobile-and-offline-pos` (Merge từ `feat/boxset-engine`) | **Commit:** `1f39bad`
- **Nội dung:**
  - **Vỏ Hộp Là SKU Thực Tế Trong Kho (Pseudo-SKU):**
    - Đưa quy cách đóng gói vỏ hộp vào CSDL với mã SKU quy ước (ví dụ `BOX-MOLIERE-2026`, `BOX-TEST`).
    - Khấu trừ tồn kho vỏ hộp như sách thật, triệt tiêu rủi ro nhận đơn vượt quá số lượng bao bì đóng gói.
  - **Migration `0008_boxset_bundles.sql`:**
    - Mở rộng bảng `order_items` với 2 cột nullable `bundle_id` và `bundle_qty`.
    - Cho phép POS gom nhóm hiển thị theo từng bộ hộp trên hóa đơn/giao diện, trong khi tầng kế toán và thẻ kho vẫn phân rã trừ từng linh kiện sách lẻ chuẩn xác.
    - Script `scripts/apply-migration-0008.ts` hỗ trợ deploy LibSQL / D1 độc lập.
  - **Phân Bổ Giá Bìa Theo Tỷ Trọng (Weighted Proration Pricing):**
    - Giá bán combo được phân bổ theo tỷ trọng giá bìa của từng linh kiện thành phần:
      `unit_price_i = ROUND(combo_price * (cover_price_i / sum_cover_price))`
    - Phần chênh lệch làm tròn được tự động dồn vào dòng sản phẩm cuối cùng, bảo đảm tổng tiền khớp 100% `comboPrice` và không xuất hiện dòng kế toán 0 VNĐ.
  - **Chặn Cứng Điểm Nghẽn Tồn Kho (Bottleneck Inventory Guard):**
    - Tính toán số lượng combo khả dụng tối đa theo linh kiện có tồn kho hạn chế nhất:
      `available_combos = MIN(FLOOR(stock_i / req_i))`
    - Từ chối tạo đơn ngay lập tức nếu bất kỳ linh kiện nào (hoặc vỏ hộp) bị thiếu hụt, đồng thời nêu đích danh đầu sách bị cạn và số lượng thiếu.
  - **Miễn Trừ Hợp Lệ Với Hard-Cap Chiết Khấu Quầy:**
    - Giá combo là giá niêm yết do ban quản lý quy định trước; các dòng chi tiết combo mang `unitDiscountRate = 0`, ngăn chặn double-dipping chiết khấu và miễn trừ hợp lệ qua trần 15% của thu ngân.
  - **Kiểm Thử Toàn Diện & Tối Ưu:**
    - Test suite `scripts/test-bundle-engine.ts` đạt **10/10 PASS**.
    - Nâng tổng số test suites lên **12 suites cách ly / 131 test cases đạt chuẩn 100%**.
#### 🔹 [Mã: ENG-20260913-19] Xóa Nợ Kỹ Thuật: Đồng Bộ Drizzle Journal & Mã Hóa PIN Quản Lý (Tech-Debt Cleanup)
- **Nhánh:** `feat/pwa-mobile-and-offline-pos` (Merge từ `feat/tech-debt-journal-and-pin`) | **Commit:** `03a22f5`
- **Nội dung:**
  - **Bảo Mật Zero-Dependency: Mã Hóa PIN Quản Lý (`src/lib/manager-pin.ts`):**
    - Tái sử dụng hàm băm thuần TypeScript `sha256(pin + salt)` từ `export-hash.ts`, không phát sinh thêm thư viện ngoài.
    - Chuyển danh sách PIN quản lý sang biến môi trường `MANAGER_PIN_HASHES` (phân tách bởi dấu phẩy).
    - Cơ chế fallback linh hoạt: Tự động cảnh báo và dùng PIN mặc định trên môi trường dev/test khi chưa thiết lập env.
    - Giữ nguyên giao thức POS phía client: gửi plain text qua HTTPS, server băm và so khớp, không làm xáo trộn giao diện bán hàng.
    - Cung cấp file `.env.example` và câu lệnh CLI sinh hash tiện lợi.
  - **Đồng Bộ Drizzle Journal & Khởi Tạo CSDL Sạch (`scripts/migrate-fresh.ts`):**
    - Chẩn đoán chính xác nguyên nhân lỗi SQLite `ADD COLUMN ... REFERENCES` trên migration `0003_slim_caretaker.sql`: các khối chú thích `/* ... */` gây lỗi ảo trong LibSQL engine; giữ nguyên vẹn 100% nội dung SQL đã deploy production.
    - Khôi phục tính toàn vẹn của Drizzle ORM: bổ sung đầy đủ các entries `0005` đến `0008` vào `_journal.json` cùng snapshot chuẩn `0008_snapshot.json` (kiểm tra `drizzle-kit generate` báo "No schema changes").
    - Xây dựng công cụ chạy migration an toàn `migrate-fresh.ts` tự động kiểm tra bảng, loại trừ comment, tuyệt đối chặn nhầm DB production. Chuyển `setup-test-db.ts` sang dùng cơ chế này.
#### 🔹 [Mã: ENG-20260913-20] Động Cơ Dự Báo Tái Bản Theo Vận Tốc Bán Thực Tế (Reprint Runout Forecasting by V_sale)
- **Nhánh:** `feat/pwa-mobile-and-offline-pos` (Merge từ `feat/runout-forecasting-v-sale`) | **Commit:** `b6ca81b`
- **Nội dung:**
  - **Đo Lường Vận Tốc Bán Dựa Trên Sự Thật Vật Lý:**
    - Tính toán $V_{\text{sale}}$ dựa trên các bút toán thẻ kho `DISPATCH_SALE` và `CONSIGNMENT_SOLD` (phản ánh toàn bộ lượng tiêu thụ thật trên toàn mạng lưới phát hành, kể cả quầy nhà và đại lý ký gửi).
    - Cửa sổ quan sát linh hoạt (mặc định 30 ngày, tùy chọn $N$ ngày như 7 ngày, 60 ngày).
  - **Công Thức Tính Số Ngày Tồn Kho (Days of Inventory - DoI):**
    - `DoI = Tong_ton_kho_kha_dung / V_sale`
    - Tồn khả dụng lấy từ các kho vật lý ở tình trạng `NEW`, loại trừ bảo thủ hàng đang đi đường (`wh-in-transit`) và hàng cách ly hỏng hóc để tránh rủi ro đứt hàng ngoài dự tính.
    - Xử lý mượt mà trường hợp $V_{\text{sale}} = 0$: coi là sách chậm luân chuyển (`HEALTHY_NORMAL`, `DoI = Infinity`, `EOQ = 0`), không tạo cảnh báo giả.
  - **Phân Cấp Cảnh Báo Sớm 3 Tầng:**
    - `RED_ALERT` ($\text{DoI} \le 30$ ngày): Nguy cơ đứt hàng trước khi kịp tái bản, cần hành động khẩn cấp.
    - `YELLOW_WARNING` ($30 < \text{DoI} \le 45$ ngày): Bắt đầu chuẩn bị kế hoạch tái bản và liên hệ đối tác in ấn.
    - `HEALTHY_NORMAL` ($\text{DoI} > 45$ ngày): Mức tồn an toàn.
  - **Tính Lượng Đặt Hàng Tối Ưu (EOQ):**
    - `EOQ = CEIL(V_sale * (lead_time + buffer_days + co_so_an_toan_60_ngay))` = `CEIL(V_sale * 105)`.
  - **API `/api/forecast` & RBAC Guard:**
    - Cung cấp API tra cứu theo cờ cảnh báo, kho hàng, và số ngày cửa sổ quan sát; tự động ưu tiên các đầu sách `RED_ALERT` lên đầu.
    - Chặn cứng vai trò `ROLE_CASHIER` và `ROLE_TAX` với HTTP 403 Forbidden.
  - **Kiểm Thử Toàn Diện:**
    - Test suite `scripts/test-forecast.ts` đạt **8/8 PASS**.
    - Nâng tổng số test suites lên **13 suites cách ly / 141 test cases đạt chuẩn 100%**.
    - Next.js Production Build (`npm run build`): Thành công với **0 lỗi biên dịch**, First Load JS giữ vững ở mức **132 kB**.








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

### 🟢 Phase 3: Di Động Hóa Quầy, "Súng" Quét Barcode Camera & Offline Sync - [ĐÃ HOÀN THÀNH 100%]
*Mục tiêu: Đưa ứng dụng lên điện thoại/tablet của nhân viên bán hội chợ với chi phí thiết bị 0 đồng, bán hàng trơn tru kể cả khi rớt mạng 4-8 tiếng.*

#### 📌 3.1. Đóng gói PWA Cài Đặt 1-Chạm (Progressive Web App Standalone) - [ĐÃ HOÀN THÀNH]
- [x] Khai báo `manifest.json` chuẩn PWA (tên formapubli OS, theme color `#4f46e5`, start_url, display: standalone).
- [x] Thiết kế bộ icon ứng dụng đầy đủ kích thước (192px, 512px, maskable icon cho Android/iOS).
- [x] Cấu hình Service Worker cache tài nguyên tĩnh để app khởi động tức thì dưới 0.5s kể cả khi không có mạng.
- [x] Hỗ trợ nút "Thêm vào màn hình chính" (Add to Home Screen) trên Safari iOS và Chrome Android.

#### 📌 3.2. "Súng" Quét Mã Vạch 0 Đồng Bằng Camera PWA (In-App Barcode Scanner) - [ĐÃ HOÀN THÀNH]
- [x] Tích hợp Barcode Detection API / Camera stream (`getUserMedia`) trên thiết bị di động.
- [x] Nút biểu tượng quét mã vạch `[ 📷 ]` tại Quầy POS và phím tắt `Alt + Shift + C`.
- [x] Khung ngắm camera (Viewfinder) nhận diện mã vạch ISBN-13 / EAN-13 sau bìa sách trong 100ms.
- [x] Tự động phát âm thanh "Bíp" xác nhận (Web Audio API) và thêm sách vào giỏ hàng hoặc tăng số lượng +1.
- [x] Khóa 1.5s chống đúp mã và hỗ trợ quét liên tục nhiều cuốn sách (Continuous scanning mode).
- [x] Bảng mã vạch test mẫu 6 cuốn sách kiểm thử ngay lập tức trên mọi thiết bị.

#### 📌 3.3. Động Cơ Bán Hàng Ngoại Tuyến Đa Nhân Viên (Offline-First POS Engine) - [ĐÃ HOÀN THÀNH]
- [x] Xây dựng bộ đệm `IndexedDB` (`formapubli_offline_db`) lưu đơn hàng cục bộ an toàn trên trình duyệt thiết bị (`src/lib/offline-db.ts`).
- [x] Sinh khóa định danh duy nhất bằng UUID v7 chuẩn RFC 9562 (sắp xếp tự nhiên theo thời gian phát sinh đơn) kết hợp `idempotencyKey` (`src/lib/uuidv7.ts`).
- [x] Hàng đợi đồng bộ nền (Sync Queue): Tự động phát hiện khi có mạng trở lại (`online` event) và gửi đơn hàng lên máy chủ theo đúng trình tự thời gian.
- [x] Cơ chế giải quyết xung đột và bảo vệ Idempotency trong `OrderService.createOrder` chống ghi trùng lặp / trừ thẻ kho 2 lần khi sync lại.
- [x] Giao diện POS hiển thị huy hiệu mạng `🟢 Trực tuyến` / `🟡 Mất mạng (Chế độ Offline)` và nút `[ 🔄 Đồng bộ ngay ]`.

#### 📌 3.4. Báo Cáo Doanh Số & Sổ Sách Đa Chiều (Advanced Sales Analytics) - [ĐÃ HOÀN THÀNH]
- [x] Hoàn thiện bộ lọc báo cáo đa chiều theo Preset: Tất cả, Hôm nay, 7 ngày qua, Tháng này, Tùy chọn trên `SalesLedgerView.tsx`.
- [x] Bộ lọc theo Kho hàng: Toàn hệ thống, Kho 1 - Âu Cơ, Kho 3 - Hội Chợ, Kho 2 - Quỳnh Mai.
- [x] Công tắc 1-click chuyển đổi nhanh giữa Góc nhìn Thuế VAT vs Góc nhìn Thực tế Nội bộ.
- [x] Xuất bảng tính Excel / CSV với mã UTF-8 BOM chuẩn xác 100% tiếng Việt có dấu, không lỗi font.

---

### ⚪ Phase 4: Nghiệp Vụ Xuất Bản Mở Rộng & Bán Combo Đóng Hộp - [CHỜ TRIỂN KHAI]
*Mục tiêu: Xử lý các nghiệp vụ đặc thù chiều sâu của ngành sách Việt Nam.*

#### 📌 4.1. Động Cơ Đóng Combo / Hộp Tuyển Tập (Boxset & Bundle Engine) - [ĐÃ HOÀN THÀNH]
- [x] Khai báo cấu trúc sản phẩm phức hợp (Composite Item): 1 mã Combo bao gồm danh sách $N$ mã ấn bản lẻ + 1 vỏ hộp.
- [x] Khi bán 1 Combo tại Quầy POS, hệ thống tự động sinh bút toán Thẻ kho trừ đồng thời toàn bộ các cuốn sách lẻ thành phần và vỏ hộp.
- [x] Cơ chế cảnh báo tồn kho Combo dựa trên thành phần có số lượng tồn ít nhất (Bottleneck Component) và tính toán số lượng khả dụng MIN(FLOOR(stock_i / req_i)).
- [x] Phân bổ giá bán combo theo tỷ trọng giá bìa (Weighted Proration), triệt tiêu dòng 0 VNĐ.

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

#### 📌 5.3. Dự Báo Tái Bản Thông Minh & Điểm Cạn Kho (Reprint Runout Forecasting) - [ĐÃ HOÀN THÀNH]
- [x] Tự động tính toán Vận tốc bán trung bình ($V_{\text{sale}} = \text{Số cuốn bán} / \text{Ngày}$) của từng tựa sách theo thời gian thực từ thẻ kho vật lý.
- [x] Cảnh báo phân cấp 3 tầng: RED_ALERT ($\le$ 30 ngày), YELLOW_WARNING (30-45 ngày), HEALTHY_NORMAL (> 45 ngày).
- [x] Tính số lượng in kinh tế tối ưu EOQ dựa trên tổng chu kỳ lead time + buffer + an toàn 105 ngày.
- [x] API `/api/forecast` phục vụ Dashboard quản trị và báo cáo ban giám đốc.

#### 📌 5.4. Hồ Sơ Độc Giả Thân Thiết & Đọc Sách Theo Mùa (Reader Persona CRM)
- [ ] Quản lý lịch sử mua sắm và sở thích đọc của từng bạn đọc.
- [ ] Phân loại nhóm độc giả sưu tầm (sách bản đặc biệt, bìa cứng) vs độc giả mua combo theo mùa.
- [ ] AI gợi ý danh sách bạn đọc phù hợp nhất khi ra mắt tác phẩm mới cùng dịch giả hoặc cùng chủ đề.

#### 📌 5.5. Báo Cáo Tự Động Hàng Tháng Cho Giám Đốc Qua Email (Automated Monthly Executive Email Dispatcher)
- [ ] Thiết kế mẫu Email HTML Responsive trực quan (Scorecards Doanh thu ròng, Cơ cấu Sổ kép Thuế vs Nội bộ, Top 5 tựa sách bán chạy, Cảnh báo đỏ sách sắp cạn kho).
- [ ] Tích hợp AI Executive Briefing (Gemini Flash tóm lược nhận định 3 dòng: Điểm sáng - Rủi ro - Quyết sách tháng tới).
- [ ] Tự động hóa gửi mail vào 07:00 sáng ngày mùng 1 hàng tháng bằng Cloudflare Cron / Resend API (0đ chi phí).
- [ ] Tự động đính kèm file bảng tính Excel/CSV đối soát chi tiết cho ban điều hành.

---

### ⚪ Phase 6: Tích Hợp Đa Kênh & Bàn Giao Vận Hành Toàn Diện - [TẦM NHÌN DÀI HẠN]
- [ ] Đồng bộ tồn kho 2 chiều với Shopee Open Platform & TikTok Shop theo hạn ngạch an toàn.
- [ ] Kết nối API phần mềm Hóa đơn điện tử chính thức (VNPT / Viettel / MISA) cho các đơn `OFFICIAL_TAX`.
- [ ] Đóng gói tài liệu bàn giao kỹ thuật, thiết lập cơ chế sao lưu CSDL tự động lên Google Drive hàng ngày/hàng tuần linh hoạt.

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
| **Email Báo Cáo Giám Đốc Hàng Tháng** | Cần nắm toàn cảnh doanh thu, dòng tiền, tựa sách hot mà không cần đăng nhập ERP | Email HTML tự động ngày 1 hàng tháng + AI Briefing 3 dòng + File Excel đính kèm (Resend 0đ) | 🟢 Trung hạn | **Phase 5** (Mục 5.5) |

