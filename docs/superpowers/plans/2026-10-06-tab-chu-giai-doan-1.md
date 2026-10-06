# Tab Chủ giai đoạn 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tab `chu` cho Chủ: tổng doanh thu Shopee (escrow − phí − COGS) + chi phí ghi tay + lãi ròng sau chi phí.

**Architecture:** View lọc trên `shopee_order_finance` có sẵn + bảng mới `expense_entries` + 1 API route. Không đụng tầng báo cáo chung, không đụng role khác.

**Tech Stack:** Next 14 App Router, Drizzle + LibSQL, test `scripts/test-owner-tab.ts` + `scripts/run-isolated.ts`.

**Spec:** `docs/superpowers/specs/2026-10-06-tab-chu-giai-doan-1-design.md` — executor đọc cả 2.

## Global Constraints

- Chỉ `ROLE_OWNER` thấy tab + API. Test phải assert Manager/Cashier/Tax/Warehouse/ShopeeOps KHÔNG thấy `'chu'` trong `allowedNavItems`.
- Hằng số (`SALARY|RENT|OTHER`) lấy từ `src/db/schema.ts`, không tự chế trong test.
- Migration = file SQL + entry `_journal.json` (migrate-fresh đọc journal, thiếu 1 trong 2 là chết).
- Mỗi suite đăng ký `scripts/run-isolated.ts`; `tsc` + `npm run build` sạch trước push.
- `git add` từng file; nhãn UI tiếng Việt có dấu, ngãn: `Chủ`, `Chi phí`, `Lương`, `Thuê`, `Khác`, `Lãi ròng`.
- Không in secret; không đụng `formapubli.db` prod (migrate-fresh đã có guard).

## Review Focus

- Manager mò `POST /api/owner/finance` (ghi trực tiếp service) → FORBIDDEN ngay trong service, không chỉ route → test Task 1.
- `amount ≤ 0` hoặc `category` lạ → INVALID, không ghi → test Task 1.
- Tab `chu` là default tab của Chủ (phím tắt/redirect sau đăng nhập rơi đúng chỗ) → test Task 3.
- Tổng escrow khớp từng bản ghi trong bảng (đoạn SUM không lọc nhầm cột) → test Task 2.
- Suite cũ không vỡ (smoke-mobile-role-navigation duyệt registry động) → chạy lại ở Task 4.

---

### Task 1: Migration 0042 + schema + service chi phí

**Files:**
- Create: `src/db/migrations/0042_expense_entries.sql`
- Modify: `src/db/migrations/meta/_journal.json` (idx 42)
- Modify: `src/db/schema.ts` (bảng `expenseEntries`)
- Create: `src/services/expense.service.ts`
- Test: `scripts/test-owner-tab.ts`

**Interfaces:**
- Produces: `listExpenses(limit?)`, `addExpense({ category, amount, note?, entryDate? }, actorRole, actorId)` — role lạ ném `AppError.forbidden`, amount `≤ 0`/category lạ ném `AppError.invalid`; trả `{ id, category, amount, note, entryDate, createdBy }`; bảng `expense_entries` 7 cột như spec.

- [ ] **Step 1: Viết test đỏ.** `scripts/test-owner-tab.ts` theo khung `test-shopee-tab-scope.ts`: (a) Manager gọi `addExpense` → `FORBIDDEN`; (b) amount 0 → `INVALID`; (c) category `'XYZ'` → `INVALID`; (d) Owner thêm `SALARY 5000000` + `OTHER 100000` → `listExpenses` thấy 2 dòng, tổng đúng. Kỳ vọng crash "no such table".
- [ ] **Step 2: Migration + journal + schema + service.** SQL: `CREATE TABLE expense_entries (...)` đúng 7 cột spec (text PK, real, text). Journal idx 42 tag `0042_expense_entries`. Schema: `sqliteTable('expense_entries', ...)` + `category` text NOT NULL. Service: validate + insert; hằng số `EXPENSE_CATEGORIES = ['SALARY','RENT','OTHER']` export từ service (test import từ đó, không tự chế).
- [ ] **Step 3: Chạy XANH** (`DATABASE_URL=file:formapubli_test.db npx tsx scripts/test-owner-tab.ts`) sau khi setup-test-db dựng DB mới. Cắt 1 chỗ validate (đổi `!== 'ROLE_OWNER'`) → phải ĐỎ → hoàn tác.

### Task 2: API `/api/owner/finance`

**Files:**
- Create: `src/app/api/owner/finance/route.ts`
- Test: mở rộng `scripts/test-owner-tab.ts`

**Interfaces:**
- Consumes: `requireSessionRole`, `listExpenses`, `addExpense`, bảng `shopeeOrderFinance`.
- Produces: `GET` → `{ success, data: { shopee: { orders, escrowTotal, feeTotal, netProfitTotal }, expenses: { total, entries }, profitAfterExpenses } }`; `POST` → bản ghi mới. Non-owner → 403 (test gọi service gián tiếp: route bóc session — test chỉ assert service đã chặn + route tồn tại đúng path).

- [ ] **Step 1: Test đỏ:** assert route đọc `shopeeOrderFinance` (nguồn file), `expenses.total` = SUM cột `amount`, service import có `requireSessionRole`. Chạy → ĐỎ.
- [ ] **Step 2: Implement route** (GET tổng hợp bằng SUM SQL, không kéo hết dòng về RAM; POST parse body → `addExpense` với `session.role`/`session.actorId`).
- [ ] **Step 3: XANH + tsc.**

### Task 3: Tab `chu` UI

**Files:**
- Modify: `src/lib/roles.ts` (ROLE_OWNER nav thêm `'chu'` đầu danh sách)
- Modify: `src/components/layout/AppSidebar.tsx` (item `chu`, icon `Crown`, Alt+9 → dịch `shopee` sang Alt+0)
- Modify: `src/components/layout/MasterAppShell.tsx` (keyMap `'9': 'chu'`, tiêu đề, nhánh render)
- Create: `src/components/owner/OwnerTab.tsx`
- Test: mở rộng `scripts/test-owner-tab.ts`

**Interfaces:**
- Produces: `<OwnerTab />` (client, fetch `/api/owner/finance`, render 3 khối: Doanh thu Shopee / Chi phí form+list / Lãi ròng sau chi phí).

- [ ] **Step 1: Test đỏ:** assert `USER_ROLES.ROLE_OWNER.allowedNavItems[0] === 'chu'`; Manager/Cashier không có `'chu'`; source `OwnerTab.tsx` có `Lãi ròng`, form có nhãn `Thêm chi phí`, gọi `/api/owner/finance`. ĐỎ.
- [ ] **Step 2: Implement** theo ShopeeTab pattern (toast trạng thái, aria-label nút, input có nhãn, min-h 44px nút).
- [ ] **Step 3: XANH + tsc + smoke-mobile-role-navigation + test-shopee-tab-scope (hồi quy nav).**

### Task 4: Đăng ký + build + docs + push

- [ ] **Step 1:** Đăng ký suite trong `scripts/run-isolated.ts` cạnh suite shopee.
- [ ] **Step 2:** `npx tsx scripts/run-isolated.ts --only=test-owner-tab,smoke-mobile-role-navigation,test-shopee-tab-scope` XANH; `npx tsc --noEmit` sạch; `npm run build` sạch.
- [ ] **Step 3:** Cập nhật `docs/shopee/README.md` (tab Chủ GĐ1 xong) + bảng trạng thái file 10 (1 dòng). Commit + push từng file rõ ràng.

## Self-Review

1. **Spec coverage:** 3 khối tab → Task 3; bảng + quyền → Task 1; API → Task 2; ngoài phạm vi giữ đúng.
2. **Placeholder scan:** không TBD; mọi step có lệnh + kỳ vọng.
3. **Type consistency:** `expenseEntries`, `EXPENSE_CATEGORIES`, `addExpense/listExpenses`, `/api/owner/finance` — thống nhất.
4. **Review Focus:** 5 dòng đều có test (Task 1, 1, 3, 2, 4).
