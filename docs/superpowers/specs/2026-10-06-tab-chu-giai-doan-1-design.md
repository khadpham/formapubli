# SPEC: Tab Chủ giai đoạn 1 — doanh thu online + chi phí khung

- Ngày: 06/10/2026. Nhánh: `main`. Tiếp theo `docs/superpowers/specs/2026-10-06-tab-shopee-design.md`.
- Quyết định của Chủ: tab Chủ phải có cả **chi phí** (lương, chi phí khác). Giai đoạn 1
  làm khung; giai đoạn 2 (lương theo tháng, tổng hợp đầy đủ) brainstorm riêng.

## 1. Tab `chu` — chỉ `ROLE_OWNER`

- Nav: `['chu', 'dashboard', ...]` — tab MẶC ĐỊNH của Chủ, không thêm cho role khác.
- Nội dung 3 khối:
  1. **Doanh thu Shopee**: tổng escrow, tổng phí sàn, lãi ròng — đọc bảng
     `shopee_order_finance` (chỉ ghi khi đơn DELIVERED ⇒ inherently an toàn,
     không đụng tầng báo cáo chung).
  2. **Chi phí**: form thêm (loại/tiền/ghi chú) + danh sách + tổng. Giai đoạn 1
     nhập tay; giai đoạn 2 mới làm lương theo tháng.
  3. **Lãi ròng sau chi phí** = lãi ròng Shopee − tổng chi phí.
- Ruling: bảng `expense_entries` tạo ở giai đoạn 1 PHẢI có UI dùng ngay (form +
  list + tổng) — bảng không ai đọc là code chết, phạm quy ponytail. Khác so với
  thiết kế gốc "chỉ tạo bảng để giành chỗ" — Chủ đã nhấn mạnh muốn theo chi phí.

## 2. Bảng `expense_entries` (migration 0042)

| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | text PK | `exp-<uuid>` |
| category | text NOT NULL | `SALARY` \| `RENT` \| `OTHER` |
| amount | real NOT NULL | > 0, đồng VN |
| note | text | tùy chọn |
| entry_date | text NOT NULL | ngày VN `YYYY-MM-DD` (ngày phát sinh, không phải ngày nhập) |
| created_by | text NOT NULL | actorId |
| created_at | text | CURRENT_TIMESTAMP |

- Ghi/đọc chi phí: CHỈ `ROLE_OWNER` (giai đoạn 1; phê duyệt cho Quản lý để sau).

## 3. API `/api/owner/finance` (OWNER only)

- `GET` → `{ shopee: { orders, escrowTotal, feeTotal, netProfitTotal }, expenses: { total, entries[] }, profitAfterExpenses }`
  (`feeTotal` = commission + transaction + service).
- `POST { category, amount, note?, entryDate? }` → thêm chi phí, trả bản ghi.
- Không trả gì cho role khác (403 qua `requireSessionRole`).

## 4. Ngoài phạm vi (giai đoạn 2+)

- Lương theo tháng/tự nhân viên, tổng hợp chi phí theo tháng, xuất CSV.
- Doanh thu hội chợ/quầy trộn vào tab Chủ (giữ nguyên tầng dashboard).
- Sửa/xoá chi phí (giai đoạn 1: ghi là thật — đúng tinh thần sổ ghi).
