# Tài Liệu Hướng Dẫn Thao Tác & Báo Cáo Nghiệm Thu UI — Wave 3 (Agent C)

Bản tài liệu này tổng hợp hướng dẫn thao tác (User & Cashier Operations Manual - C3) cùng báo cáo kiểm chứng giao diện cho toàn bộ các tính năng UI do **Agent C** triển khai xuyên suốt **Wave 1, Wave 2 và Wave 3**.

---

## 1. Hướng Dẫn Thao Tác Chi Tiết (User Manual - C3)

### 1.1. Đăng Nhập Nhanh & Bảo Mật PIN (Ticket #9)
- **Lưới chọn tài khoản**:
  - Trên thiết bị di động (Mobile), danh sách tài khoản nhân viên hiển thị dạng 2 cột, chiều cao cố định tối đa 3 hàng. Nếu có nhiều hơn 6 tài khoản, danh sách hỗ trợ cuộn mượt mà mà không làm vỡ bố cục màn hình.
  - Trên máy tính (Desktop), lưới mở rộng 3 hoặc 4 cột tận dụng tối đa không gian màn hình.
- **Ẩn / Hiện mã PIN**:
  - Ô nhập mã PIN mặc định luôn ở chế độ ẩn dấu sao (`••••`).
  - Nút con mắt bên phải là nút trợ năng riêng biệt (`type="button"`, không kích hoạt submit form khi nhấn). Nhấn vào để xem rõ mã PIN đã nhập.
  - **Cơ chế bảo mật tự động**: Ngay khi người dùng chuyển sang chọn tài khoản khác, chuyển sang chế độ nhập tay, đóng modal hoặc nhấn nút Hủy, trạng thái con mắt sẽ tự động reset về chế độ ẩn, đảm bảo mã PIN không bị lộ cho nhân viên kế tiếp.

---

### 1.2. Chuyển Kho Hàng Loạt & Thao Tác Nhanh (Ticket #5)
- **Thêm nhanh hàng tồn**:
  - Trong modal Chuyển kho hàng loạt, nhấn nút **"Thêm nhanh toàn bộ sách có tồn"** để tự động đưa toàn bộ các đầu sách có sẵn tồn kho tại kho nguồn vào danh sách chuyển.
- **Chọn hàng loạt (Bulk Selection)**:
  - Checkbox ở tiêu đề bảng hỗ trợ 3 trạng thái (Tri-state): *Chưa chọn gì* $\rightarrow$ *Chọn một phần* (hiện dấu trừ `-`) $\rightarrow$ *Chọn tất cả* (hiện dấu tích `✓`).
  - Huy hiệu (Badge) hiển thị rõ số lượng dòng đang được chọn (ví dụ: `Đã chọn: 5 / 20 dòng`).
- **Gán số lượng hàng loạt (Bulk Quantity)**:
  - Khi đã chọn ít nhất 1 dòng, ô nhập số lượng hàng loạt trên thanh công cụ sẽ sáng lên.
  - Nhập số lượng mong muốn (chỉ chấp nhận số nguyên dương $> 0$) và bấm **"Áp dụng"**. Toàn bộ các dòng được chọn sẽ được cập nhật số lượng ngay lập tức.
- **Xóa dòng linh hoạt**:
  - Nút **"Xóa (N)"**: Xóa chính xác $N$ dòng đang được đánh dấu chọn mà không làm ảnh hưởng đến các dòng khác.
  - Nút **"Xóa tất cả"**: Làm trống toàn bộ giỏ chuyển kho (có hộp thoại xác nhận nhanh để tránh thao tác nhầm).
- **Hạ về tồn tối đa (Cap to Max)**:
  - Khi kho nguồn không đủ số lượng cho một số mặt hàng, bấm nút này để tự động giảm số lượng chuyển về bằng tồn khả dụng tối đa. Các mặt hàng có tồn bằng 0 sẽ được tự động loại bỏ khỏi phiếu với thông báo rõ ràng.
- **Cơ chế bảo vệ mạng (P1 & P2 Invalidation)**:
  - Bất kỳ thao tác chỉnh sửa số lượng, xóa dòng, thêm dòng hoặc thay đổi kho nguồn/đích nào cũng sẽ lập tức hủy bỏ request kiểm tra tồn đang chạy dở và mở khóa nút giao diện, ngăn chặn hoàn toàn tình trạng kẹt nút hoặc nhận nhầm kết quả cũ.

---

### 1.3. Tạo Kho Mới & CTA Chuyển Hàng Trực Tiếp (Ticket #10)
- **Thông báo tạo kho rõ ràng**:
  - Khi Quản lý tạo mới một kho hàng (ví dụ: Kho Gian hàng Hội chợ 2026), hệ thống hiển thị thông báo thành công (Toast) nêu rõ tên kho vừa tạo.
- **Nút CTA hành động nhanh**:
  - Ngay trên thông báo có nút **"Chuyển hàng vào kho này →"**.
  - Nhấn vào nút này sẽ tự động mở modal Chuyển kho hàng loạt với **Kho đích** được chọn sẵn chính là kho vừa tạo, giúp thu ngân và quản lý xuất hàng vào kho mới chỉ với 1 cú nhấp chuột.

---

### 1.4. Lưới Danh Mục Nhanh Mobile 2x2 (Ticket #11)
- **Bố cục 2 cột x 2 hàng gọn gàng**:
  - Trên màn hình di động (viewport 320px – 414px), danh mục sách ở màn hình bán hàng POS được thu gọn mặc định thành lưới 2 cột, 2 hàng (hiển thị 4 sách đầu tiên).
  - Thiết kế này giúp tiết kiệm tối đa diện tích màn hình để nhường không gian cho khu vực quét mã vạch và giỏ hàng.
- **Xem tất cả & Thu gọn**:
  - Bấm nút **"Xem tất cả"** để mở rộng danh sách sách đầy đủ trong lưới 2 cột có thanh cuộn độc lập.
  - Bấm nút **"Thu gọn"** để quay trở lại khung 2x2 ban đầu.
- **Trợ năng & Chống tràn chữ**:
  - Tên sách dài được tự động hiển thị tối đa 2 dòng kèm dấu chấm lửng (`line-clamp-2`), đồng thời thẻ có thuộc tính `title` đầy đủ để người dùng có thể chạm giữ hoặc rê chuột xem toàn bộ tựa sách.
  - Nút bấm `+ Thêm` có `aria-label` đạt chuẩn tiếp cận cho người dùng màn hình đọc.

---

### 1.5. Phân Quyền Nút Báo Cáo Chốt Ngày (Ticket #3-UI Button)
- **Giao diện sạch sẽ cho Thu ngân**:
  - Nút **"Chốt Ngày"** trên thanh tiêu đề POS được ẩn hoàn toàn đối với vai trò Thu ngân (`ROLE_CASHIER`), Nhân viên kho (`ROLE_WAREHOUSE`) và Kế toán thuế (`ROLE_TAX`).
  - Chỉ có Quản lý (`ROLE_MANAGER`) và Chủ cửa hàng (`ROLE_OWNER`) mới nhìn thấy nút này để thực hiện mở báo cáo đối soát và chốt sổ cuối ngày.

---

### 1.6. Nút Thanh Toán Nổi & Bottom Sheet Thanh Toán Mobile (Ticket #7)
- **Thanh thanh toán nổi (Sticky Cart Checkout Bar)**:
  - Trên giao diện di động (`lg:hidden`), khi giỏ hàng có ít nhất 1 sản phẩm, một thanh nổi cố định xuất hiện ở đáy màn hình hiển thị tổng số món và tổng tiền cần thanh toán.
  - Nhấn nút **"Thanh toán ngay"** (`#btn-open-mobile-checkout-sheet`) sẽ trượt mở bảng **Bottom Sheet Thanh toán** (`#mobile-checkout-sheet`) từ dưới lên mượt mà, thay vì chỉ cuộn trang xuống giỏ hàng.
- **Quy trình thanh toán an toàn, không tự tạo đơn khi mở sheet**:
  - Việc mở sheet chỉ nhằm mục đích cho phép thu ngân/khách rà soát lại đơn hàng và chọn phương thức thanh toán.
  - Tuyệt đối **không gọi tạo đơn tự động** khi mở sheet. Chỉ khi thu ngân nhấn nút xác nhận cuối cùng **"Xác nhận thanh toán"** (`#btn-confirm-mobile-checkout`) bên trong sheet thì đơn hàng mới được gửi đi xử lý.
  - Hỗ trợ đóng sheet linh hoạt thông qua nút đóng (`#close-mobile-checkout-sheet`) hoặc bấm ra vùng backdrop.

---

### 1.7. Gộp Lựa Chọn "Chuyển Khoản / Quét QR" & VietQR Động (Ticket #8)
- **Hợp nhất trải nghiệm thanh toán không dùng tiền mặt**:
  - Menu phương thức thanh toán loại bỏ sự phân mảnh giữa hai lựa chọn "Chuyển khoản" và "Quét mã QR".
  - Giờ đây chỉ gồm 2 lựa chọn trực quan:
    1. **💵 Tiền mặt** (`CASH`)
    2. **💳 Chuyển khoản / Quét QR** (`BANK_TRANSFER`)
- **Hiển thị thông tin chuyển khoản & VietQR đồng thời**:
  - Khi chọn "Chuyển khoản / Quét QR", hệ thống tự động kích hoạt component [`VietQrPay.tsx`](file:///d:/Data%20Project/formapubli/src/components/pos/VietQrPay.tsx).
  - Khách hàng có thể quét mã VietQR động được tạo chuẩn theo số tiền và mã đơn, hoặc xem trực tiếp thông tin số tài khoản / ngân hàng thụ hưởng để chuyển khoản thủ công.
  - Toàn bộ dữ liệu mã QR và số tài khoản thụ hưởng được đóng gói đầy đủ vào payload đơn hàng (`qrDataUrl`, `qrAccountNo`).

---

### 1.8. Đóng Băng Giỏ Hàng Khi Chờ Phê Duyệt Chiết Khấu (Ticket A1-F / #1 UI)
- **Cơ chế Freeze giỏ hàng an toàn**:
  - Khi thu ngân chọn mức chiết khấu vượt thẩm quyền (cần Quản lý phê duyệt), hệ thống tự động đưa giỏ hàng vào trạng thái **"Đóng băng" (Frozen Cart)**:
    - Khóa toàn bộ các nút tăng/giảm số lượng (`+`, `-`) của từng món trong giỏ hàng.
    - Khóa các nút xóa từng mặt hàng và nút xóa trắng giỏ hàng.
    - Khóa các nút chọn chiết khấu và ô nhập chiết khấu thủ công.
    - Khóa việc bấm thêm sách mới từ danh mục (`handleAddToCart` bị chặn kèm thông báo).
- **Banner cảnh báo trực quan & Nút Hủy duyệt**:
  - Một banner màu hổ phách cảnh báo nổi bật xuất hiện ngay đầu giỏ hàng (`#pos-cart-frozen-banner`): *"Giỏ hàng đang đóng băng chờ quản lý duyệt chiết khấu. Không thể sửa số lượng hoặc thêm sách mới."*
  - Banner tích hợp sẵn nút **"Hủy duyệt để sửa giỏ"** (`#btn-cancel-approval`). Thu ngân có thể chủ động hủy yêu cầu duyệt bất kỳ lúc nào để giỏ hàng lập tức được rã đông, cho phép tiếp tục bán hàng hoặc chỉnh sửa số lượng bình thường mà không bị kẹt.

---

## 2. Bằng Chứng Kiểm Thử UI & Viewport Responsive

### 2.1. Danh Sách Ảnh Chụp Màn Hình Thực Tế (Chrome Headless)
Toàn bộ các ảnh PNG dưới đây đều được chụp trực tiếp từ component thực tế [`PosCheckoutTerminal.tsx`](file:///d:/Data%20Project/formapubli/src/components/pos/PosCheckoutTerminal.tsx) được mount và render hoàn chỉnh bằng Google Chrome Headless thông qua test harness [`scripts/run-real-pos-terminal-test.ts`](file:///d:/Data%20Project/formapubli/scripts/run-real-pos-terminal-test.ts), lưu tại thư mục [`reports/wave3-pos-ui/`](file:///d:/Data%20Project/formapubli/reports/wave3-pos-ui/):

1. [`pos-mobile-checkout-sheet.png`](file:///d:/Data%20Project/formapubli/reports/wave3-pos-ui/pos-mobile-checkout-sheet.png): Mobile Checkout Bottom Sheet mở từ nút nổi, hiển thị tóm tắt giỏ hàng, chọn phương thức và nút xác nhận thanh toán.
2. [`pos-combined-payment.png`](file:///d:/Data%20Project/formapubli/reports/wave3-pos-ui/pos-combined-payment.png): Giao diện phương thức thanh toán gộp "Chuyển khoản / Quét QR" kèm khối VietQR Pay động.
3. [`pos-cart-frozen.png`](file:///d:/Data%20Project/formapubli/reports/wave3-pos-ui/pos-cart-frozen.png): Trạng thái đóng băng giỏ hàng khi chờ phê duyệt chiết khấu, các nút số lượng bị vô hiệu hóa kèm banner cảnh báo và nút "Hủy duyệt để sửa giỏ".
4. [`pos-mobile-320px.png`](file:///d:/Data%20Project/formapubli/reports/wave3-pos-ui/pos-mobile-320px.png): Hiển thị lưới 2x2 trên thiết bị màn hình siêu nhỏ (320px CSS width, không tràn mép).
5. [`pos-mobile-375px.png`](file:///d:/Data%20Project/formapubli/reports/wave3-pos-ui/pos-mobile-375px.png): Hiển thị lưới 2x2 trên iPhone tiêu chuẩn (375px CSS width).
6. [`pos-mobile-390px.png`](file:///d:/Data%20Project/formapubli/reports/wave3-pos-ui/pos-mobile-390px.png): Hiển thị lưới 2x2 trên iPhone 12/13/14 Pro (390px CSS width).
7. [`pos-manager-topbar.png`](file:///d:/Data%20Project/formapubli/reports/wave3-pos-ui/pos-manager-topbar.png): Ảnh chụp trực tiếp khi đăng nhập vai trò Manager (hiển thị nút "📅 Chốt Ngày").
8. [`pos-cashier-topbar.png`](file:///d:/Data%20Project/formapubli/reports/wave3-pos-ui/pos-cashier-topbar.png): Ảnh chụp trực tiếp khi đăng nhập vai trò Cashier (nút "Chốt Ngày" ẩn hoàn toàn khỏi DOM).

### 2.2. Kết Quả Kiểm Tra Tự Động Trên Component Thực Tế & Kiểm Soát Tràn Ngang
- `npx tsx scripts/run-real-pos-terminal-test.ts`: **10/10 PASS** (Exit code: 0) — Test trực tiếp trên DOM của component thật trong Chrome Headless:
  - Test 1: Lưới danh mục sử dụng responsive 2 cột (`grid-cols-2`).
  - Test 2: Mặc định trên mobile chỉ hiển thị đúng 4 cuốn sách (khung 2×2).
  - Test 3: Nhấn nút "Xem tất cả" mở rộng toàn bộ danh mục lên 6 sách.
  - Test 4: Nhấn nút "Thu gọn" đưa về lại khung 2×2 (4 sách).
  - Test 5: Nút "Chốt Ngày" hoàn toàn không có trong DOM khi là `ROLE_CASHIER`.
  - Test 6: Nút "Chốt Ngày" xuất hiện hợp lệ trong DOM khi chuyển sang `ROLE_MANAGER`.
  - Test 7: **Kiểm tra tràn ngang (Horizontal Overflow & Boundary Check)** tại cả 3 kích thước 320px, 375px và 390px (`scrollWidth <= clientWidth`, thẻ sách nằm gọn trong khung nhìn).
  - Test 8: **Gộp phương thức thanh toán (Ticket #8)**: Tùy chọn `BANK_TRANSFER` hiển thị nhãn "Chuyển khoản / Quét QR", không có tùy chọn `QR_CODE` riêng lẻ, kích hoạt khối VietQR component.
  - Test 9: **Đóng băng giỏ hàng & Hủy duyệt (Ticket A1-F / #1 UI)**: Khi kích hoạt phê duyệt chiết khấu, các nút tăng/giảm/xóa bị disable (`aria-disabled="true"` hoặc `disabled`), banner cảnh báo `#pos-cart-frozen-banner` xuất hiện; bấm `#btn-cancel-approval` mở khóa giỏ hàng thành công.
  - Test 10: **Mobile Checkout Floating Sheet (Ticket #7)**: Nhấn nút nổi mở `#mobile-checkout-sheet`, kiểm tra nút xác nhận thanh toán `#btn-confirm-mobile-checkout`, đóng sheet qua nút `#close-mobile-checkout-sheet`.
- `npx tsc --noEmit`: **PASS** (Exit code: 0, 0 type errors).
- `npm run build`: **PASS** (Exit code: 0, Next.js optimized production build thành công 100%).
- Phạm vi thay đổi (Scope boundary): Chỉ chỉnh sửa giao diện người dùng POS trong [`PosCheckoutTerminal.tsx`](file:///d:/Data%20Project/formapubli/src/components/pos/PosCheckoutTerminal.tsx) và test harness, tuân thủ nghiêm ngặt ranh giới Agent C (không chạm vào server, offline sync logic hay database migrations).
