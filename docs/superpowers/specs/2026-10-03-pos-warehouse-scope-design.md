# POS Warehouse Scope Design — 2026-10-03

## 1. Vấn đề
- Kho Núi Trúc production `active=true, sellable=false` nên vắng khỏi POS; panel Quản Lý Kho không có nút bật/tắt `isSellableOnPos` (chỉ API PATCH có).
- POS chỉ có 2 chế độ: hiện TẤT CẢ kho sellable, hoặc khóa cứng 1 kho theo `staff.assignedWarehouseId`. Không có "POS này chỉ lấy những kho A, B, C".

## 2. Mục tiêu
- Người dùng tự bật/tắt kho lên POS, không cần dev.
- Quản lý tick nhiều kho cho mỗi tài khoản thu ngân; POS của tài khoản đó chỉ hiện các kho được tick.

## 3. Thiết kế
### A. Công tắc "Bán POS" trong Quản Lý Kho
- Mỗi dòng kho thêm toggle `isSellableOnPos` (nhãn ngắn "Bán POS").
- Dùng PATCH `/api/warehouses/[id]` đã có (`route.ts:49`); không thêm API.
- Tắt → kho biến khỏi mọi POS (listSellable lọc), tồn/sổ/quá khứ giữ nguyên.
- Hiển thị trạng thái text ("Đang bán"/"Đã ẩn"), không chỉ màu.

### B. Danh sách kho được phép theo tài khoản
- Migration mới: `staff.allowed_warehouse_ids TEXT NOT NULL DEFAULT '[]'` (JSON array id).
- Giữ `assignedWarehouseId` nguyên (tương thích cũ). Luật hiệu lực:
  1. `allowedWarehouseIds` non-empty → POS chỉ hiện giao của (sellable ∩ allowed).
  2. Trống + `assignedWarehouseId` có → khóa cứng 1 kho (hành vi cũ).
  3. Cả hai trống → mọi kho sellable (hành vi cũ).
- API: `PATCH /api/staff/[staffId]` nhận `allowedWarehouseIds` (validate id tồn tại, Owner/Manager only); `/api/auth/me` + login trả thêm trường; `/api/cashbox` OPEN chặn kho ngoài list (như `route.ts:110` nay).
- UI Cài đặt → Nhân sự: dropdown đơn → multi-check (checkbox + nhãn tick), tối đa ~6 kho thì list gọn.
- POS: lọc `sellableWarehouses` theo allowed; kho allowed nhưng ngưng/không sellable → hiện cảnh báo 1 dòng ("Kho X đã ngưng, liên hệ quản lý"), không im lặng mất; mở két sai kho → server 403 + tin nhắn tiếng Việt.
- Kho mặc định khi mở POS: kho đầu tiên trong (allowed ∩ sellable), thay hardcode `wh-au-co`.

## 4. Ràng buộc
- Giá trị hằng tra `schema.ts`/migration; test không dùng chung hằng với code.
- Nhãn tiếng Việt có dấu, ngắn; toggle có text trạng thái.
- Không log PIN/passcode; `allowedWarehouseIds` validate phía server (client chỉ là UX).
- Tương thích ngược: migration default `[]`, mọi tài khoản cũ giữ nguyên hành vi.

## 5. Nghiệm thu
1. Tắt "Bán POS" Núi Trúc → mất khỏi POS, bật lại → hiện lại, tồn không đổi.
2. Tick 2 kho cho thu ngân A → POS A chỉ hiện 2 kho; mở két kho thứ 3 → 403 + tin nhắn rõ.
3. Tài khoản không tick gì → hành vi y như cũ.
