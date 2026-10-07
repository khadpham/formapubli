# Tab Chủ GĐ2 — overhaul chi phí + bảng biểu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tab Chủ đầy đủ: bộ chọn tháng VN, bảng chi phí theo loại × định kỳ/phát sinh, sửa chi phí có audit, lương gắn nhân viên.

**Architecture:** Mở rộng bảng `expense_entries` (0043 ADD COLUMN) + service `updateExpense` ghi audit vào `audit_logs` có sẵn + PATCH/GET-month API + UI redesign. Không đụng tầng báo cáo chung.

**Tech Stack:** Next 14 App Router, Drizzle + LibSQL, test `scripts/test-owner-tab.ts` + `scripts/run-isolated.ts`.

**Spec:** `docs/superpowers/specs/2026-10-06-tab-chu-giai-doan-2-design.md` — executor đọc cả 2.

## Global Constraints

- Chỉ `ROLE_OWNER` (PATCH cả trong service, không chỉ route). Test assert Manager FORBIDDEN.
- Hằng số `EXPENSE_CATEGORIES` (7 loại) + `['MONTHLY','ONE_TIME']` lấy từ `expense.service.ts`, test import từ đó.
- Migration = file SQL + entry `_journal.json` idx 43. `ALTER TABLE ADD COLUMN` KHÔNG có `IF NOT EXISTS` (SQLite không có — script báo và bỏ qua nếu đã có).
- Audit dùng bảng `audit_logs` có sẵn (`recordAuditLog` ở `src/lib/rbac-guard.ts:103`), action `EXPENSE_UPDATED`. Cấm bảng audit mới.
- `staffId` bắt buộc khi category `SALARY`/`BONUS`.
- Mỗi suite đăng ký `scripts/run-isolated.ts`; `tsc` + `npm run build` sạch trước push; deploy sau cùng + kiểm Workers thật.
- `git add` từng file; nhãn UI tiếng Việt có dấu; không in secret; `migrate-fresh` cấm trỏ prod (đã có guard).

## Review Focus

- Lương không người (SALARY/BONUS thiếu staffId) — mong đợi: INVALID, không ghi dòng mù → test Task 1.
- Quản lý mò PATCH — mong đợi: FORBIDDEN ngay trong service → test Task 1.
- GET ?month lọc nhầm kỳ (chi phí theo entry_date, Shopee theo synced_at) — mong đợi: seed 2 tháng, chỉ tháng được chọn vào tổng → test Task 2.
- Sửa chi phí không ghi audit — mong đợi: mỗi PATCH có dòng `EXPENSE_UPDATED` trong audit_logs → test Task 1.
- Dòng cũ (recurrence default) bị đổi số sau migration — mong đợi: tổng không đổi → test Task 1.

---

### Task 1: Migration 0043 + service mở rộng (staffId/recurrence + updateExpense + audit)

**Files:**
- Create: `src/db/migrations/0043_expense_expand.sql` + journal idx 43
- Modify: `src/db/schema.ts` (4 cột mới)
- Modify: `src/services/expense.service.ts`
- Test: `scripts/test-owner-tab.ts` (mở rộng)

**Interfaces:**
- Produces: `EXPENSE_CATEGORIES` 7 phần tử; `addExpense({..., staffId?, recurrence?})`; `updateExpense(id, patch, actorRole, actorId)` (Owner-only, `NOT_FOUND`, audit `EXPENSE_UPDATED`); `listExpensesMonth(month)`; cột `staffId/recurrence/updatedBy/updatedAt` trong `expenseEntries`.

- [ ] **Step 1: Test đỏ.** Thêm vào suite: (a) `SALARY` thiếu staffId → INVALID; (b) `recurrence 'WEEKLY'` → INVALID; (c) Manager gọi `updateExpense` → FORBIDDEN; (d) Owner sửa amount 100000→200000 → list thấy 200000 + audit_logs có dòng `EXPENSE_UPDATED`; (e) sửa id lạ → `NOT_FOUND`; (f) seed 2 tháng (10-2026, 09-2026) → `listExpensesMonth('2026-10')` chỉ thấy tháng 10; (g) dòng cũ (recurrence ONE_TIME) tổng không đổi. Chạy → crash "no such column".
- [ ] **Step 2: Migration + journal + schema.** SQL: 4 `ALTER TABLE ADD COLUMN` (staff_id text; recurrence text NOT NULL DEFAULT 'ONE_TIME'; updated_by text; updated_at text) — không `IF NOT EXISTS`, script áp tay báo nếu cột đã có. Journal idx 43 tag `0043_expense_expand`. Schema: 4 cột nullable/default.
- [ ] **Step 3: Service.** `EXPENSE_CATEGORIES = ['SALARY','BONUS','RENT_LOCATION','UTILITIES','EQUIPMENT','OPERATIONS','OTHER']`; `addExpense` thêm validate `staffId` (bắt buộc SALARY/BONUS, tồn tại trong staff_accounts? — chỉ kiểm có người khi có API danh sách; GĐ2 kiểm non-empty + GĐ3 tra DB sau) + `recurrence`; `updateExpense` theo spec + `recordAuditLog` (import `src/lib/rbac-guard`); `listExpensesMonth` dùng `like(entryDate, '${month}-%')` (tiền tố 7 ký tự an toàn cho kỳ tháng).
- [ ] **Step 4: Chạy XANH + setup-test-db dựng DB mới (journal idx 43 chạy).** Cắt validate → ĐỎ → hoàn tác.

### Task 2: API GET ?month + PATCH /[id]

**Files:**
- Create: `src/app/api/owner/finance/[id]/route.ts`
- Modify: `src/app/api/owner/finance/route.ts`
- Test: mở rộng `scripts/test-owner-tab.ts`

**Interfaces:**
- Produces: `GET ?month=` tổng theo kỳ (`byRecurrence`); `PATCH /[id]` trả bản ghi sau sửa.

- [ ] **Step 1: Test đỏ:** assert route `[id]` tồn tại + có `updateExpense` + audit; route GET có `month` param + `byRecurrence`. ĐỎ.
- [ ] **Step 2: Implement.** GET: month param → Shopee lọc `synced_at LIKE 'YYYY-MM%'` + chi phí `listExpensesMonth`; POST: truyền thêm staffId/recurrence. PATCH: bóc id → `updateExpense`.
- [ ] **Step 3: XANH + tsc.**

### Task 3: UI redesign OwnerTab

**Files:**
- Modify: `src/components/owner/OwnerTab.tsx`
- Test: mở rộng `scripts/test-owner-tab.ts`

**Interfaces:**
- Produces: bộ chọn `<input type="month">` + bảng nhóm theo loại + badge `Định kỳ`/`Phát sinh` + nút Sửa inline + thẻ Lãi ròng sau chi phí theo tháng.

- [ ] **Step 1: Test đỏ:** source assert: `type="month"`, `Định kỳ`, `Phát sinh`, `Sửa`, nhãn 7 loại (`Lương`, `Thưởng`, `Thuê địa điểm`, `Điện nước–Mạng`, `Thiết bị`, `Vận hành`, `Khác`), gọi `/api/owner/finance?month=`. ĐỎ.
- [ ] **Step 2: Implement** theo mẫu OwnerTab hiện tại (toast, aria-label, min-h 44px nút; form thêm mở rộng 2 ô: NV + Kỳ).
- [ ] **Step 3: XANH + tsc + hồi quy test-shopee-tab-scope, smoke nav, test-bank-list-inactive.**

### Task 4: Suite + build + docs + deploy + verify Workers

- [ ] **Step 1:** Đăng ký + chạy `--only=test-owner-tab,smoke-mobile-role-navigation,test-shopee-tab-scope,test-bank-list-inactive` XANH; `tsc` sạch; `npm run build` sạch (tắt dev trước nếu đang chạy).
- [ ] **Step 2:** Cập nhật file 10 (dòng Tab Chủ GĐ2) + docs/shopee/README (GĐ2 xong). Commit + push.
- [ ] **Step 3:** `npm run deploy` → version ID → probe live: đăng nhập Owner, GET ?month, PATCH 1 chi phí, số khớp. Ghi kết quả.

## Self-Review

1. **Spec coverage:** 4 mục spec → Task 1 (data+service), 2 (API), 3 (UI), 5 (test+deploy). Ngoài phạm vi giữ đúng.
2. **Placeholder scan:** không TBD; mọi step có lệnh + kỳ vọng.
3. **Type consistency:** `EXPENSE_CATEGORIES`, `updateExpense`, `listExpensesMonth`, `/api/owner/finance/[id]` — thống nhất.
4. **Review Focus:** 5 dòng đều có test (Task 1, 1, 2, 1, 1).
