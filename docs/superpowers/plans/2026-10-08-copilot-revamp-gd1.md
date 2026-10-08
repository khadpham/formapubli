# Copilot Revamp GĐ1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Triển khai GĐ1 của spec revamp Copilot: tên hiển thị tiếng Việt + tên
người thật, làm đẹp UI drawer, thêm 2 tools đọc mới (hợp đồng, công nợ đại lý).

**Architecture:** Không phát minh pattern mới. Tool mới đi đúng pipeline hiện có:
`ToolCallSchema` enum → mô tả trong prompt planner → rule keyword trong
`planQuery` → case trong `executeToolSafely` → `LABEL_BY_TOOL` +
`formatFallbackAnswer` ở route. UI chỉ sửa `CopilotDrawer.tsx` (+ prop từ
`MasterAppShell.tsx`).

**Tech Stack:** Next.js + TypeScript, Tailwind (className), Drizzle SQLite,
`npx tsx` cho test scripts.

**Spec:** `docs/superpowers/specs/2026-10-08-copilot-revamp-design.md`

## Global Constraints

- UI tiếng Việt CÓ DẤU, nhãn ngắn gọn; cấm tiếng Việt không dấu (AGENTS.md §0).
- Không còn chuỗi `ROLE_` nào hiện ra trong UI Copilot.
- `npx tsc --noEmit` sạch sau mỗi task; chỉ chạy `npm run build` khi sửa file `.css`
  (đổi className không cần build).
- `git add` ghi rõ từng file, cấm `-A` / `commit -a`.
- Test không dùng chung hằng/giá trị với code — giá trị kiểm tra lấy từ
  `src/db/schema.ts` hoặc dữ liệu DB thật.
- Không log PII/secret; audit log tool mới đi qua `executeToolSafely` có sẵn.

## Review Focus

- Planner nhầm tool khi từ khóa gần nhau ("công nợ" vs "két tiền", "hợp đồng"
  vs "đơn hàng"): rule keyword phải có test pin từng tool, câu hỏi mẫu tiếng
  Việt có dấu/không dấu đều qua.
- Số trong formatter mới phải qua được `findUngroundedNumbers`:
  mọi con số in ra đều có mặt trong `toolData` (kể cả khi format
  `toLocaleString('vi-VN')`).
- `session.fullName` có thể `undefined` (session cũ): UI phải fallback về
  role label, không được trắng/crash.
- `query_agency_debt` gọi `PartnerDebtService.summary` theo từng partner:
  giới hạn `limit` 1..10, cấm N+1 không giới hạn.
- `status` hợp đồng: không hardcode enum; test đọc `distinct status` từ DB thật.

---

### Task 1: Tên hiển thị tiếng Việt + tên người thật

**Files:**
- Modify: `src/components/copilot/CopilotDrawer.tsx` (~dòng 139, 364, 683, nhãn người gửi)
- Modify: `src/components/layout/MasterAppShell.tsx` (chỗ render `<CopilotDrawer>`, ~dòng 470–485)
- Test: `scripts/test-copilot-gd1.ts` (mới)

**Interfaces:**
- Consumes: `USER_ROLES` từ `src/lib/roles.ts` (`USER_ROLES['ROLE_OWNER'].label`
  === `'Chủ Quản Lý (Super Admin)'`, `USER_ROLES['ROLE_MANAGER'].label`
  === `'Quản Lý Vận Hành (Manager)'` — đọc từ source, không hardcode trong test).
- Produces: `CopilotDrawerProps` thêm `displayName?: string`; `MasterAppShell`
  truyền `displayName={session?.fullName}`.

- [ ] **Step 1: Viết test** `scripts/test-copilot-gd1.ts` với 2 assert:
  (1) đọc file `src/components/copilot/CopilotDrawer.tsx` dạng text, assert
  không chứa chuỗi `ROLE_` trong các literal hiển thị cho user (cho phép trong
  comment và so sánh `'ROLE_OWNER' ===`); (2) assert `USER_ROLES` có label cho
  `ROLE_OWNER`/`ROLE_MANAGER` và label không chứa `ROLE_`.
- [ ] **Step 2: Chạy test, xác nhận FAIL** (`npx tsx scripts/test-copilot-gd1.ts`).
- [ ] **Step 3: Implement.**
  - `CopilotDrawer`: prop mới `displayName?: string`; header hiện
    `{displayName || 'Lãnh đạo'} · {USER_ROLES[currentRole].label}`;
    nhãn tin nhắn user: `displayName || 'Quý Lãnh đạo'`;
    banner từ chối (dòng ~683) và message lỗi (dòng ~364): thay
    `<strong>ROLE_OWNER</strong> hoặc <strong>ROLE_MANAGER</strong>` bằng
    "Chủ Quản Lý hoặc Quản Lý Vận Hành"; dòng "Vai trò hiện tại của bạn:
    {currentRole}" → role label.
  - `MasterAppShell`: truyền `displayName={session?.fullName}` vào
    `<CopilotDrawer>`.
- [ ] **Step 4: Chạy test → PASS**, rồi `npx tsc --noEmit` sạch.
- [ ] **Step 5: Commit** `git add <từng file> && git commit -m "feat(copilot): ten hien thi tieng Viet + ten nguoi that trong Copilot"`.

### Task 2: Làm đẹp UI drawer

**Files:**
- Modify: `src/components/copilot/CopilotDrawer.tsx`
- Test: dùng lại `scripts/test-copilot-gd1.ts` (thêm assert)

**Interfaces:**
- Consumes: `displayName`, role label từ Task 1.
- Produces: không đổi interface ngoài; chỉ UI.

- [ ] **Step 1: Thêm assert vào test**: source drawer chứa ít nhất 2 trong 3
  chuỗi trạng thái loading theo giai đoạn ("Đang phân tích", "Đang tra cứu",
  "Đang tổng hợp") và chứa `details` hoặc `cài đặt` cho model picker thu gọn.
- [ ] **Step 2: Chạy test, xác nhận FAIL.**
- [ ] **Step 3: Implement.**
  - Loading: thay spinner một dòng bằng 3 giai đoạn luân phiên mỗi 2.5s
    ("Đang phân tích câu hỏi…" → "Đang tra cứu dữ liệu thực…" →
    "Đang tổng hợp câu trả lời…"). (Live tên tool đang chạy cần streaming →
    để GĐ2, không làm ở task này.)
  - Quick chips: tính theo giờ/ngày — sáng (<12h): "Doanh số hôm qua",
    "Tồn kho cạn"; ngày >= 25: thêm "Công nợ đại lý"; giữ các chip cũ còn lại.
  - Model picker: thu gọn vào `<details>` "Cài đặt bộ não", mặc định đóng;
    giữ `localStorage` key `formapubli.copilot.model` cũ.
  - Mobile: aside drawer `w-full sm:w-[420px] max-w-full` (kiểm tra class hiện
    tại rồi sửa cho đúng).
- [ ] **Step 4: Test PASS + `npx tsc --noEmit` sạch.**
- [ ] **Step 5: Commit** `git commit -m "feat(copilot): lam dep UI drawer — loading theo giai doan, chips theo ngu canh"`.

### Task 3: Tool `query_contracts` (tra cứu hợp đồng)

**Files:**
- Modify: `src/services/executive-query.service.ts` (thêm method)
- Modify: `src/services/ai/copilot-guardrails.ts` (enum, prompt catalog, rule
  keyword, case execute)
- Modify: `src/app/api/ai/copilot/route.ts` (`LABEL_BY_TOOL`, formatter)
- Test: `scripts/test-copilot-gd1.ts` (thêm suite)

**Interfaces:**
- Consumes: bảng `contractDocuments` + `partners` (join lấy tên đối tác);
  `status` đọc từ DB, không hardcode.
- Produces:
  `ExecutiveQueryService.queryContracts(params: { q?: string; status?: string; limit?: number }): Promise<{ items: Array<{ contractNumber: string; title: string; partnerName: string | null; status: string; totalAmount: number; signedDate: string | null; effectiveDate: string | null; expiryDate: string | null }>; total: number; warning?: string }>`
  Tool name: `'query_contracts'`, args `{ q?, status?, limit? }` (limit 1..20,
  mặc định 10). Keyword rule: "hợp đồng", "hop dong", "HD-BQ".

- [ ] **Step 1: Viết test**: (1) gọi `queryContracts({ q: 'HD-BQ' })` trên DB
  test, assert shape đúng (mọi item có `contractNumber` string,
  `totalAmount` number); (2) gọi `CopilotGuardrails.planQuery` (hoặc hàm rule
  tương đương) với "hợp đồng còn hiệu lực" → assert `toolName ===
  'query_contracts'`; (3) gọi với "công nợ đại lý" → assert KHÔNG ra
  `query_contracts`.
- [ ] **Step 2: Chạy test, xác nhận FAIL** (tool chưa tồn tại).
- [ ] **Step 3: Implement** theo checklist: method trong
  `ExecutiveQueryService` (dùng `db.select` + join `partners`, `ilike`/`like`
  theo `q` trên `contractNumber`/`title`, lọc `status` nếu truyền) →
  thêm `'query_contracts'` vào `ToolCallSchema` enum → thêm 1 dòng mô tả vào
  prompt catalog (đánh số tiếp theo) → rule keyword trong `planQuery` →
  case trong `executeToolSafely` (sanitize args như các tool khác) →
  `LABEL_BY_TOOL['query_contracts'] = 'Hợp đồng'` → case trong
  `formatFallbackAnswer` (liệt kê: số HĐ – tiêu đề – đối tác – trạng thái –
  tổng tiền `toLocaleString('vi-VN')`).
- [ ] **Step 4: Test PASS + `npx tsc --noEmit` sạch.** Kiểm tra số trong
  formatter đều có trong toolData (điều kiện của `findUngroundedNumbers`).
- [ ] **Step 5: Commit** `git commit -m "feat(copilot): tool query_contracts — tra cuu hop dong"`.

### Task 4: Tool `query_agency_debt` (công nợ đại lý)

**Files:** như Task 3 (3 file modify + test).

**Interfaces:**
- Consumes: `PartnerDebtService.summary(partnerId)` (đã có, tính FIFO, quá hạn).
- Produces:
  `ExecutiveQueryService.queryAgencyDebt(params: { q?: string; limit?: number }): Promise<{ items: Array<{ partnerId: string; partnerName: string; balance: number; overdue: number; overdueCount: number; oldestOverdueDays: number; creditLimit: number; paymentDueDays: number }>; total: number; warning?: string }>`
  Tool name: `'query_agency_debt'`, args `{ q?, limit? }` (limit 1..10, mặc định
  10). Keyword rule: "công nợ", "cong no", "đại lý", "dai ly", "dư nợ", "quá hạn".

- [ ] **Step 1: Viết test**: (1) `queryAgencyDebt({})` trả về shape đúng, mọi
  `balance`/`overdue` là number; (2) rule "công nợ đại lý A" → toolName
  `'query_agency_debt'`; (3) "két tiền ca quầy" → KHÔNG ra `query_agency_debt`;
  (4) gọi với `limit: 999` → assert số items ≤ 10.
- [ ] **Step 2: Chạy test, xác nhận FAIL.**
- [ ] **Step 3: Implement**: method tìm partners theo `q` (bảng `partners`,
  cột tên — kiểm tra tên cột thật trong schema trước khi code), với mỗi partner
  gọi `PartnerDebtService.summary(partnerId)` (tối đa `limit` partner);
  checklist tích hợp như Task 3; `LABEL_BY_TOOL['query_agency_debt'] =
  'Công nợ'; formatter liệt kê: đối tác – dư nợ – quá hạn (số tiền + số ngày
  quá hạn lâu nhất) – hạn mức.
- [ ] **Step 4: Test PASS + `npx tsc --noEmit` sạch.**
- [ ] **Step 5: Commit** `git commit -m "feat(copilot): tool query_agency_debt — cong no dai ly"`.

---

## Self-review

- **Spec coverage:** §4.3 tên hiển thị → Task 1 ✓; §4.1 UI → Task 2 ✓
  (live tên tool đang chạy cần streaming → ghi rõ để GĐ2, không lặng lẽ bỏ);
  §4.2 mở rộng catalog (hợp đồng, công nợ) → Task 3+4 ✓; §4.4 giữ phân quyền ✓
  (không task nào đổi logic RBAC); §4.5 model ✓ (không đổi allowlist ở GĐ1).
- **Step scan:** mỗi step cho ra đúng một hành động kiểm được; không có dòng
  quyết định hộ implementer ngoài signature và giá trị đã chốt.
- **Type consistency:** `displayName?: string` dùng xuyên suốt Task 1–2;
  shape `items/total/warning` của 2 tools mới khớp formatter ở route.
- **Review Focus:** 5 dòng trên đều đã có test pin trong task sở hữu.
- **Proportion:** plan ngắn hơn spec nhiều; code block chỉ ở mức signature/test.
