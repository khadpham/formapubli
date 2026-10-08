# Contract AI GĐ4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trợ lý hợp đồng theo dự án/sự kiện: tạo dự án với các cột mốc, mỗi cột mốc gắn loại hợp đồng cần ký → tới hạn AI nhắc và soạn sẵn từ dữ liệu có sẵn → dashboard theo dõi.

**Architecture:** 2 bảng mới (`contract_projects`, `contract_milestones`). Milestone có `due_date`, `needed_category` (loại HĐ cần), `contract_id` (null cho tới khi ký). Luồng "soạn sẵn": từ milestone → mở AISmartDraft với template gợi ý theo category. Dashboard: API tổng hợp milestones sắp tới hạn + hợp đồng sắp hết hạn (từ `contractDocuments.expiry_date`). Không đụng tới bảng dự án ngoài (chưa tồn tại).

**Tech Stack:** Next.js API routes, drizzle, React.

**Spec:** `docs/superpowers/specs/2026-10-08-hop-dong-ai-design.md` (mục GĐ4)

## Global Constraints

- Route dùng `requireSessionRole` Owner/Manager.
- Test qua run-isolated, không log dữ liệu nhạy cảm.
- UI tiếng Việt CÓ DẤU. `git add` từng file.

## Review Focus

- Milestone quá hạn chưa có hợp đồng → hiện cảnh báo đỏ, không im lặng.
- Xóa dự án → milestones theo (cascade), nhưng hợp đồng đã ký KHÔNG bị xóa (chỉ gỡ liên kết).
- due_date trước start_date của dự án → từ chối.
- Gợi ý "soạn sẵn" khi chưa có template nào thuộc category → báo rõ, gợi ý sang GĐ1 tạo mẫu.

---

### Task 1: Migration 0052 — projects + milestones

**Files:**
- Create: `src/db/migrations/0052_contract_projects.sql`
- Register: `_journal.json` (idx 52), `src/db/schema.ts`

**Interfaces:**
- Produces: `contract_projects` (id, name, description, start_date, end_date, status DRAFT/ACTIVE/DONE, created_by, created_at), `contract_milestones` (id, project_id FK cascade, title, due_date, needed_category, contract_id FK null → contract_documents.id SET NULL, status PENDING/DONE, created_at)

- [ ] **Step 1:** Viết migration 0052.
- [ ] **Step 2:** Journal + schema.ts.
- [ ] **Step 3:** `npx tsc --noEmit` sạch.
- [ ] **Step 4:** Commit
  ```bash
  git add src/db/migrations/0052_contract_projects.sql src/db/migrations/meta/_journal.json src/db/schema.ts
  git commit -m "feat(contract-ai): migration 0052 du an + cot moc hop dong"
  ```

### Task 2: API projects/milestones + suggest

**Files:**
- Create: `src/app/api/ai/contracts/projects/route.ts` (GET list, POST create)
- Create: `src/app/api/ai/contracts/projects/[id]/route.ts` (GET detail + milestones, PATCH, DELETE)
- Create: `src/app/api/ai/contracts/milestones/route.ts` (POST create, PATCH update/link contract)
- Create: `src/app/api/ai/contracts/suggest/route.ts` (GET)
- Test: `scripts/test-contract-ai-gd4.ts`

**Interfaces:**
- Produces:
  - `GET /api/ai/contracts/projects` → list + đếm milestones
  - `POST /api/ai/contracts/projects` `{name, description?, startDate?, endDate?}` → project
  - `GET /api/ai/contracts/projects/[id]` → project + milestones (sắp xếp due_date)
  - `PATCH /api/ai/contracts/projects/[id]` `{name?, status?, ...}`
  - `DELETE` → xóa project + milestones (contract đã ký giữ nguyên, contract_id → null)
  - `POST /api/ai/contracts/milestones` `{projectId, title, dueDate, neededCategory}`
  - `PATCH /api/ai/contracts/milestones` `{id, contractId? | status?}` — link hợp đồng đã ký
  - `GET /api/ai/contracts/suggest` → `{ upcoming: milestones PENDING due trong 14 ngày chưa có contract, overdue: milestones quá hạn chưa có contract }`

- [ ] **Step 1: Write the failing test** — tạo project + 2 milestones (1 sắp tới hạn, 1 quá hạn) → suggest trả đúng 2 nhóm; link contract → milestone DONE; xóa project → contract còn.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** 4 routes.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit
  ```bash
  git add src/app/api/ai/contracts/projects src/app/api/ai/contracts/milestones src/app/api/ai/contracts/suggest scripts/test-contract-ai-gd4.ts
  git commit -m "feat(contract-ai): API du an + cot moc + goi y"
  ```

### Task 3: UI — ProjectsTab + dashboard widget

**Files:**
- Create: `src/components/contracts/ContractProjects.tsx`
- Modify: `src/components/contracts/ContractsTab.tsx` (thêm tab/sub-view)

**Interfaces:**
- Consumes: Task 2
- Produces: view "Dự án" trong tab Hợp Đồng — danh sách dự án → chi tiết (timeline milestones, badge trạng thái, nút "Soạn" mở AISmartDraft với category gợi ý) + panel "Cần chú ý" (sắp tới hạn/quá hạn) ở đầu tab.

- [ ] **Step 1:** Tạo component — CRUD dự án (modal đơn giản), thêm milestone (title + due_date + needed_category).
- [ ] **Step 2:** Panel cảnh báo từ `/suggest` — click milestone → mở chi tiết.
- [ ] **Step 3:** Nút "Soạn" trên milestone → mở AISmartDraft (truyền suggestedCategory).
- [ ] **Step 4:** Gắn vào ContractsTab (toggle view hoặc section).
- [ ] **Step 5:** `npx tsc --noEmit` sạch.
- [ ] **Step 6:** Commit
  ```bash
  git add src/components/contracts/ContractProjects.tsx src/components/contracts/ContractsTab.tsx
  git commit -m "feat(contract-ai): UI du an + cot moc + goi y"
  ```

### Task 4: Test tổng + verification

- [ ] **Step 1:** Đăng ký suite vào run-isolated.ts.
- [ ] **Step 2:** Chạy tất cả suites contract AI + contract — xanh.
- [ ] **Step 3:** `npx tsc --noEmit` sạch.
- [ ] **Step 4:** Push → PR → merge theo A-Z.
