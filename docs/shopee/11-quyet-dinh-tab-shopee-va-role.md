# QUYẾT ĐỊNH TAB SHOPEE RIÊNG + ROLE MỚI (06/10/2026)

> Ghi nhớ để khỏi quên. Chủ chốt cùng agent trên nhánh `feat/shopee-skeleton`.

## 1. Tab Shopee riêng (không nhét vào Kho chung)

- Tab Kho hiện tại là kho chung toàn công ty (ma trận 3 kho + ledger + chuyển kho).
- Nhân viên Shopee chỉ thấy lát cắt: đơn `channel='SHOPEE'` + kho được cấp + nút
  Gói/Giao/In A6 + đơn lỗi quarantine. Không thấy ma trận chung, không thấy
  doanh thu tổng.
- Tab mới chỉ là **view lọc** trên service có sẵn (`order-sync`,
  `recordMovementsBatch`, `revenue-guard`). Cấm nhân đôi logic.

## 2. Role: THÊM, không bớt

- Giữ nguyên `ROLE_WAREHOUSE` (Thủ Kho Chuyên Trách, PIN 5678) + toàn bộ 15 chỗ
  check quyền kho chung. Không đổi ngữ nghĩa, không xóa.
- Thêm `ROLE_SHOPEE_OPS` (Nhân viên Shopee): nav `['shopee','settings']`,
  PIN riêng, **HIỆN** trong picker nhanh cho dễ bấm.
- `ROLE_WAREHOUSE` đã ẩn khỏi picker nhanh (`LoginModal.tsx:24`) — giữ nguyên,
  thực tế thay thế dần bằng role Shopee mới.

## 3. Kho nhân viên thấy do quản lý cấp (linh hoạt)

- Tách 2 cấu hình, cấm gộp:
  - (a) **Kho xuất đơn Shopee**: 1 kho, mặc định Âu Cơ (`warehouse_id`).
    Chỉ Chủ đổi.
  - (b) **Kho nhân viên được thấy**: NHIỀU kho, quản lý trở lên cấp qua
    multi-select, sửa lúc nào cũng được, không deploy lại.
- Mặc định (b) = (a). Lưu dạng danh sách trong `shopee_settings`
  (key riêng, JSON array), không cần bảng mới.

## 4. Ai xem tab Shopee

| Role | Quyền |
|---|---|
| `ROLE_OWNER` | Full: cấu hình + hàng đợi + link doanh thu (chờ tab Chủ) |
| `ROLE_MANAGER` | Hàng đợi + cấp kho cho nhân viên + giao hàng |
| `ROLE_SHOPEE_OPS` | Hàng đợi trong kho được cấp + Gói/Giao/In |
| `ROLE_CASHIER`, `ROLE_TAX`, `ROLE_WAREHOUSE` | Không thấy tab mới (API cũ giữ nguyên cho khỏi vỡ) |

## 5. Thứ tự + tránh xung đột tab Chủ

- Ưu tiên tab Shopee trước. Tab Chủ chưa làm — sẽ làm sau.
- Tab Shopee chỉ hiện vận hành; thẻ doanh thu để chỗ trống link chờ,
  không code UI Chủ trong đợt này. Dịch vụ `escrow-sync` (data) đã có sẵn
  trên nhánh, UI Chủ dùng sau.
