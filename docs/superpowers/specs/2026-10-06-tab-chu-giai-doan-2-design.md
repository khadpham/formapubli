# SPEC: Tab Chủ GĐ2 — overhaul chi phí + bảng biểu (06/10/2026)

- Nền: GĐ1 đã chạy (`8130d95`): tab `chu`, bảng `expense_entries`, API `/api/owner/finance`.
- Quyết định của Chủ (4 câu đã chốt): chỉ tab Chủ; **cho sửa + audit**; lương **chi tiết
  từng NV**; kỳ = **tháng VN + chọn**. Hướng đã duyệt: mở rộng bảng hiện có (Hướng 1).

## 1. Dữ liệu (migration 0043 — CHỈ THÊM)

- `ALTER TABLE expense_entries ADD COLUMN`:
  - `staff_id` text — nullable, gắn nhân viên cho SALARY/BONUS.
  - `recurrence` text NOT NULL DEFAULT 'ONE_TIME' — `MONTHLY` (định kỳ hàng tháng =
    phí cố định) | `ONE_TIME` (phát sinh). Dòng cũ giữ nguyên.
  - `updated_by` text, `updated_at` text — do PATCH ghi.
- Không xoá/đổi cột cũ. Dòng cũ: recurrence='ONE_TIME', updated_* = NULL.
- `EXPENSE_CATEGORIES` mở thành 7 (nguồn sự thật ở `expense.service.ts`):
  `SALARY, BONUS, RENT_LOCATION, UTILITIES, EQUIPMENT, OPERATIONS, OTHER`.
  Nhãn UI: Lương, Thưởng, Thuê địa điểm, Điện nước–Mạng, Thiết bị, Vận hành, Khác.

## 2. Service (`expense.service.ts` mở rộng)

- `addExpense` nhận thêm `staffId?`, `recurrence?` (validate trong `['MONTHLY','ONE_TIME']`).
  `staffId` bắt buộc khi category là `SALARY`/`BONUS` (không cho lương không người).
- Mới: `updateExpense(id, patch, actorRole, actorId)` — CHỈ `ROLE_OWNER`; ném
  `NOT_FOUND` khi thiếu dòng; ghi audit vào bảng `audit_logs` có sẵn (actorId,
  action `EXPENSE_UPDATED`, resource `/api/owner/finance`, details trước→sau).
- Mới: `listExpensesMonth(month: 'YYYY-MM')` — lọc theo tháng VN từ `entry_date`.

## 3. API (`/api/owner/finance`, OWNER only)

- `GET ?month=YYYY-MM` (mặc định tháng VN hiện tại) → tổng theo kỳ + bảng chi tiết:
  `{ shopee: { orders, escrowTotal, feeTotal, netProfitTotal }, expenses: { total,
  byRecurrence: { MONTHLY, ONE_TIME }, entries }, profitAfterExpenses }`.
  Shopee lọc theo tháng `synced_at` (thời gian đối soát); chi phí theo `entry_date`.
- `POST` nhận thêm `staffId?`, `recurrence?`.
- Mới: `PATCH /api/owner/finance/[id]` — sửa được: `amount`, `category`, `note`,
  `entryDate`, `staffId`, `recurrence`. Ghi audit mỗi lần sửa.

## 4. UI (`OwnerTab.tsx` redesign)

1. Bộ chọn tháng (`<input type="month">`, mặc định tháng VN hiện tại) — đổi là load lại.
2. Hàng 4 thẻ theo kỳ: Đơn đã giao / Tiền về (escrow) / Phí sàn / Lãi ròng Shopee.
3. Bảng chi phí: nhóm **theo loại** (7 nhóm, tổng từng nhóm) + badge
   `Định kỳ`/`Phát sinh` + mỗi dòng nút **Sửa** (inline: đổi tiền/note/NG/kỳ/NV).
4. Thẻ cuối: **Lãi ròng sau chi phí** (theo tháng) — vẫn là nhãn rõ, số thật.
5. Dòng lương/ thưởng hiện tên nhân viên (tra từ danh sách NV có sẵn nếu có API;
   GĐ2 chỉ hiển thị staffId nếu chưa có API danh sách — không tự chế API mới).

## 5. Test + nghiệm thu

- Mở rộng `scripts/test-owner-tab.ts` + suite mới nếu cần:
  staffId bắt buộc cho SALARY/BONUS; recurrence validate; PATCH Owner-only +
  `NOT_FOUND` + audit có dòng; GET ?month lọc đúng kỳ (seed 2 tháng, assert chỉ
  tháng được chọn vào tổng); hồi quy: suite cũ + smoke nav.
- `tsc` + `build` sạch → deploy → kiểm Workers thật (đăng nhập, đổi tháng, thêm/sửa
  chi phí, số khớp từng đồng).

## 6. Ngoài phạm vi

- Lương tự động theo ca làm việc, xuất CSV, phê duyệt chi phí cho Quản lý.
- Tab Shopee, dashboard tổng quan, tầng báo cáo chung — không đụng.
