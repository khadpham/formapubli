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

## 2. Bằng Chứng Kiểm Thử UI & Viewport Responsive

### 2.1. Danh Sách Ảnh Chụp Màn Hình Thực Tế (Chrome Headless)
Các ảnh chụp thực tế đã được xuất vào thư mục [`reports/wave3-pos-ui/`](file:///d:/Data%20Project/formapubli/reports/wave3-pos-ui/):
1. [`pos-mobile-320px.png`](file:///d:/Data%20Project/formapubli/reports/wave3-pos-ui/pos-mobile-320px.png): Hiển thị lưới 2x2 trên thiết bị màn hình siêu nhỏ (320px CSS width).
2. [`pos-mobile-375px.png`](file:///d:/Data%20Project/formapubli/reports/wave3-pos-ui/pos-mobile-375px.png): Hiển thị lưới 2x2 trên iPhone tiêu chuẩn (375px CSS width).
3. [`pos-mobile-390px.png`](file:///d:/Data%20Project/formapubli/reports/wave3-pos-ui/pos-mobile-390px.png): Hiển thị lưới 2x2 trên iPhone 12/13/14 Pro (390px CSS width).
4. [`pos-manager-topbar.png`](file:///d:/Data%20Project/formapubli/reports/wave3-pos-ui/pos-manager-topbar.png): Đối chiếu giao diện Topbar khi đăng nhập vai trò Manager (hiện nút Chốt ngày) so với Cashier (ẩn nút Chốt ngày).

### 2.2. Kết Quả Kiểm Tra Tự Động
- `npx tsx scripts/smoke-pos-mobile-grid.ts`: **4/4 PASS** (Exit code: 0).
- `npx tsc --noEmit`: **PASS** (Exit code: 0).
- `npm run build`: **PASS** (Exit code: 0).
- Git diff: Chỉ thay đổi đúng vùng danh mục và nút chốt ngày trong [`PosCheckoutTerminal.tsx`](file:///d:/Data%20Project/formapubli/src/components/pos/PosCheckoutTerminal.tsx), không đụng chạm logic thanh toán hay server.
