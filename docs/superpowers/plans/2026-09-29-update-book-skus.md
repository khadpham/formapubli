# Kế hoạch Triển khai Cập nhật Mã Định danh Sách Mới (SKU Migration)

> **Branch:** `data/update-book-skus`  
> **Mục tiêu:** Cập nhật toàn bộ mã định danh sách (SKU code) trong hệ thống từ mã cũ (`H01`-`H81`) sang mã mới (`HH001`-`HH047`, `TP0004`-`TP105`, `HH0079`) và bổ sung 7 đầu sách mới 2026 (`H82`-`H88`) vào danh mục hệ thống.  
> **Nguyên tắc an toàn:** Giữ nguyên khóa chính `editions.id` (`ed-h01`...) để bảo toàn 100% dữ liệu lịch sử đơn hàng, tồn kho và sổ cái di chuyển kho.

---

## 1. Phân rã công việc (Task Decomposition)

### Task 1: Cập nhật file dữ liệu gốc `data_tabs/sheet1_danhmuc_gid_0.csv`
- Thay thế mã cũ cột `TT` bằng mã mới đã đối chiếu cho 81 đầu sách.
- Bổ sung 7 đầu sách mới 2026 (H82 đến H88) vào cuối file CSV.

### Task 2: Xây dựng Script Migration DB `scripts/migrate-book-skus.ts`
- Tạo script TypeScript an toàn chạy trong một database transaction duy nhất:
  - `UPDATE editions SET code = ? WHERE id = ?` cho 81 ấn bản đã có.
  - `INSERT` cho 7 tác phẩm mới vào bảng `works`.
  - `INSERT` cho 7 ấn bản mới vào bảng `editions`.
- Hỗ trợ chạy cả trên Local SQLite (`formapubli.db`) và Turso Cloud (`DATABASE_URL`).

### Task 3: Chạy thử nghiệm và xác thực tính toàn vẹn trên Local DB
- Chạy script cập nhật trên `formapubli.db`.
- Kiểm tra tính duy nhất (UNIQUE constraint), kiểm tra số lượng ấn bản (tăng từ 81 lên 88).
- Kiểm tra toàn vẹn khóa ngoại (Foreign Key integrity) với các bảng `stock_balances`, `inventory_ledger`, `order_items`.

### Task 4: Cập nhật nhãn và gợi ý tìm kiếm trên Giao diện (UI Placeholders)
- `src/components/pos/PosCheckoutTerminal.tsx`: Đổi gợi ý từ `(H01)` thành `(HH001/TP0006)`.
- `src/components/CatalogTable.tsx`, `StockOverviewMatrix.tsx`: Cập nhật text gợi ý giọng nói và placeholder.
- `src/components/customers/ReaderMatchPanel.tsx`: Cập nhật placeholder SKU.

### Task 5: Kiểm tra và nghiệm thu (Verification Before Completion)
- Chạy kiểm tra TypeScript (`npx tsc --noEmit` hoặc test kiểm thử liên quan).
- Chạy script kiểm tra POS catalog nạp được đúng mã mới và tìm kiếm được theo mã mới.
- Báo cáo kết quả chi tiết kèm hướng dẫn áp dụng lên Turso Production khi user sẵn sàng.
