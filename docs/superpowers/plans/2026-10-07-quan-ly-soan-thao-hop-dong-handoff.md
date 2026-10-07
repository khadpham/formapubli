# HANDOFF — Quản Lý & Soạn Thảo Hợp Đồng (bàn giao giữa chừng)

**Ngày:** 07/10/2026
**Agent bàn giao:** Kilo (inline executor, skill executing-plans + TDD)
**Agent nhận:** bất kỳ agent nào tiếp tục theo plan bên dưới
**Plan (nguồn sự thật số 1):** `docs/superpowers/plans/2026-10-07-quan-ly-soan-thao-hop-dong.md` — có 11 quyết định thiết kế D1–D11 ở đầu file, BẮT BUỘC đọc trước khi làm gì.
**Spec (nguồn sự thật số 2):** `docs/superpowers/specs/2026-10-07-quan-ly-soan-thao-hop-dong-design.md` (+ Bổ sung v2 cuối file)
**Ledger SDD (nguồn sự thật số 3):** `.superpowers/sdd/2026-10-07-quan-ly-soan-thao-hop-dong.md/progress.md` — ghi từng task + ruling; các dòng `Task N: complete` là XONG, không làm lại.

---

## 1. Trạng thái hiện tại (đọc đầu tiên)

| Task | Trạng thái | Commit | Ghi chú |
| :--- | :--- | :--- | :--- |
| Plan + Spec v2 | ✅ XONG | `abe3c72` | docs(contracts): design spec and implementation plan v2 |
| Task 1: Helper đọc số + ngày ND30 | ✅ XONG | `49f60ff` | test `npx tsx scripts/test-contract-helpers.ts` → PASS 15/15; tsc sạch; đã đăng ký `ALL_SUITES` |
| Task 2: Migration & Schema | 🔶 **ĐANG LÀM — dừng ở Step 3** | chưa commit | Chi tiết mục 2 bên dưới |
| Task 3–7 | ⬜ CHƯA BẮT ĐẦU | — | Làm theo plan, TDD từng bước |

**Nhánh:** `main` (làm một mình → commit thẳng main theo quy tắc chủ). `git worktree list` chỉ có 1 cây `D:/Data Project/formapubli`.

**Working tree lúc bàn giao** (ngoài 3 file Task 2 mục 2): chỉ còn `thong tin dai ly.csv` untracked (dữ liệu kinh doanh — KHÔNG commit, giữ nguyên).

---

## 2. Task 2 đang dở — tiếp tục từ đây (bước kế tiếp chính xác)

**Đã xong trong Task 2 (đã commit `e1c4a68` — wip):**
1. `src/db/migrations/0046_contract_management.sql` — 5 bảng (templates, documents, counters, company_profile, presets) + 4 index + 2 dòng seed (company_profile 'main' = Phạm Đam Ca/Giám đốc; preset 'preset-giam-doc' = "Giám đốc — Phạm Đam Ca"). **Đã chạy được**: migrate-fresh báo `✓ 0046: 12 statements, ✓ Đủ 5 bảng kỳ vọng`.
2. `src/db/migrations/meta/_journal.json` — đã thêm entry `idx 46, tag "0046_contract_management", version 7, breakpoints true` ngay sau entry idx 45. **ĐẦU BẮT BUỘC** — migrate-fresh đọc journal, file .sql một mình là vô nghĩa.
3. `scripts/test-contract-schema.ts` — test đã viết (5 nhóm assert), **đang RED ở tầng cuối**.

**Trạng thái RED hiện tại (chạy thật):**
```
npx tsx scripts/test-contract-schema.ts
→ ✓ 0046: 12 statements, ✓ Đủ 5 bảng kỳ vọng
→ ❌ FAIL: Cannot read properties of undefined (reading 'Symbol(drizzle:Columns)')
```
= đúng RED kỳ vọng: **`src/db/schema.ts` chưa có Drizzle mapping cho 5 bảng mới**.

**Bước kế tiếp (Task 2 Step 3):**
- Mở `src/db/schema.ts`, thêm vào CUỐI file (sau `shopeeQuarantine`, khoảng dòng 967) Drizzle schema cho 5 bảng: `contractTemplates`, `contractDocuments`, `contractCounters` (composite PK `primaryKey({ columns: [t.category, t.year] })`), `contractCompanyProfile`, `contractPresets`.
- Field name khớp snake_case trong DDL: `templateFilename`, `templateData`, `schemaFields`, `templateVersion`, `renderedDocx`, `finalDocx`, `finalFilename`, `totalAmount` (**integer, KHÔNG real**), `signedDate`, `payloadData`, `createdBy`, `valuesJson`, `sortOrder`, `isActive` (`integer mode: 'boolean'`), `daiDien`, `chucVu`, `tenCongTy`, `mst`, `sdt`...
- Import helper nếu thiếu: file đã có sẵn `index`, `sqliteTable`, `text`, `integer`, `real`, `sql` ở đầu file.
- Sau đó: `npx tsx scripts/test-contract-schema.ts` → PASS; đăng ký `'scripts/test-contract-schema.ts'` vào `ALL_SUITES` trong `scripts/run-isolated.ts` (thêm cuối mảng, trước `]`, có comment); `npx tsc --noEmit` sạch; **commit** `git add src/db/migrations/0046_contract_management.sql src/db/migrations/meta/_journal.json scripts/test-contract-schema.ts scripts/run-isolated.ts` — message `feat(contracts): add contract tables migration 0046`.
- Lưu ý: nếu chủ yêu commit WIP trước thì tôi đã commit sẵn (xem git log); kiểm `git log --oneline -5` trước khi làm.

---

## 3. Landmines đã va (đừng va lại)

1. **Migration .sql PHẢI có marker statement-breakpoint giữa MỌI câu** — thiếu ⇒ libsql chỉ chạy câu đầu (`0046: 1 statements`), các bảng sau mất.
2. **CẤM viết literal marker text bên trong comment của .sql** — `migrate-fresh` split chunk theo marker text TRƯỚC khi lọc comment ⇒ comment chứa marker gây `SQLITE_ERROR: unrecognized token`. (Đã va, đã sửa trong 0046 — comment hiện ghi "statement-breakpoint marker" chữ thường, không kèm dấu mũi tên.)
3. **`migrate-fresh` đọc `src/db/migrations/meta/_journal.json`** — migration mới = phải thêm entry journal (idx tăng dần, tag = tên file không đuôi). Snapshot `meta/0046_snapshot.json` KHÔNG cần tạo — repo chỉ có snapshot tới 0014, sau đó mọi migration viết tay + journal.
4. **`migrate-fresh` REFUSED `formapubli.db`** — chỉ chạy `file:` DB; tên test DB phải chứa `formapubli_test` (test-guard chặn theo chuỗi này).
5. **Quy tắc repo (AGENTS.md) bắt buộc**: `npm install` phải `--include=dev`; test không dùng chung hằng với code; sửa CSS phải `npm run build`; tsc không validate CSS; `git add` từng file, không `-A`; KHÔNG commit `next-env.d.ts` (revert trước khi commit); KHÔNG commit secret; nhãn UI tiếng Việt CÓ DẤU.
6. **Môi trường máy này**: bash tool = pwsh; script `.superpowers/sdd` + `task-start` (sh) KHÔNG chạy được (WSL bash missing) — ledger/briefs maintain thủ công theo đúng format; background_process bỏ qua `workdir` — luôn `Set-Location` trong lệnh hoặc dùng `workdir` của bash tool; `172.20.x.x` là adapter ảo, IP Wi-Fi thật phải `Get-NetIPAddress -AddressFamily IPv4`.
7. **`libsql file:` DB giữ handle tới khi tiến trình thoát** — file .db tạm của 1 test KHÔNG xoá được trong chính tiến trình đó (đã có pattern `fs.unlinkSync` trước khi chạy — giữ nguyên).

---

## 4. Sẽ làm (Task 3–7 — tóm tắt, chi tiết ở plan)

1. **Task 3 — Engine**: `npm install --include=dev docxtemplater pizzip`; `src/services/contract-engine.service.ts` (D4: dùng `docxtemplater/js/inspect-module` — CẤM regex tự viết trên XML; nếu tsc thiếu type thì tạo shim `src/types/docxtemplater-inspect.d.ts` — snippet có trong plan); test 4 nhóm assert (split-run, ngoặc lởm, validate, merge).
2. **Task 4 — Service**: `src/services/contract.service.ts` — cấp số bằng `contract_counters` `INSERT ... ON CONFLICT ... RETURNING` trong transaction (D2, snippet có trong plan); autofill từ `contractCompanyProfile` + partners/works/editions (D8); snapshot `renderedDocx` (D3); `uploadFinalDocx` (D9). Test: seed + assert số 01→02 + snapshot + final override.
3. **Task 5 — API**: 9 route files (bảng ở plan), MỌI route `requireSessionRole(['ROLE_OWNER','ROLE_MANAGER'])` (pattern `src/app/api/bank-accounts/route.ts:16`); test gọi HANDLER THẨT với session ký bằng `signSession` từ `src/lib/auth-session.ts` (tra interface `SessionPayload` + `SESSION_COOKIE_NAME` + `validateSessionAccount` trước khi viết — seed 1 staff_accounts row active trong test DB).
4. **Task 6 — UI**: 5 components + CompanyProfileForm; sửa `roles.ts` (chèn `'contracts'` vào allowedNavItems của OWNER+MANAGER — GIỮ nguyên các mục khác); `AppSidebar.tsx` + `MasterAppShell.tsx`; `npm install --include=dev docx-preview`; Live Preview = POST `/api/contracts/preview` (debounce 400ms) + `renderAsync` (D1); print CSS A4 ND30; nghiệm thu bằng **orca browser thật + `npm run build`**.
5. **Task 7 — Seed + E2E**: 3 mẫu .docx seed (builder PizZip như test); E2E full flow; verify HTTP tầng 3 `scripts/verify-contracts-live.ts` theo pattern `scripts/verify-pos-live.ts`; `npm run build`; **SAU DEPLOY: apply migration 0046 lên production DB TRƯỚC khi dùng endpoint** (bài học 0042/0043).
6. **Sau tất cả**: review-package toàn branch (script sdd không chạy trên máy này → review thủ công theo `code-reviewer.md` của skill requesting-code-review), ghi `Final review: self-review` vào ledger, báo chủ.

## 5. Quyết định đã chốt với chủ (không được đổi ngược)

- Bên A: người đại diện **Phạm Đam Ca** (Giám đốc); tên công ty hiển thị `FORMApubli`, tên pháp lý đầy đủ chờ chủ — `ben_a_ten` sửa tay được nên không chặn.
- Mọi nội dung tuỳ biến, KHÔNG khóa: sửa mẫu / sửa biến / sửa ngoài Word + "Tải bản cuối lên" (D9).
- Bộ preset nhanh tuỳ biến (D11): bảng `contract_presets`, chip trong composer, quản lý CRUD trong UI.
- Live Preview = server merge + docx-preview render (D1); bản in pháp lý chính thức = file Word.
- Tiền INTEGER; `signed_date` người dùng nhập; `gia_tri_hd_chu` tự sinh khi gõ số tiền (D7).

---

## 6. Lệnh nhanh

```bash
# Test riêng từng suite
npx tsx scripts/run-isolated.ts --only=test-contract-helpers
npx tsx scripts/test-contract-helpers.ts          # Task 1 — PASS hiện tại
npx tsx scripts/test-contract-schema.ts           # Task 2 — RED hiện tại (đúng tầng schema.ts)

# Kiểm tra + vá DB dev
npx tsx scripts/check-dev-db-schema.ts
npx tsx scripts/fix-dev-db-schema.ts

# Typecheck / build
npx tsc --noEmit
npm run build   # KHÔNG chạy khi next dev đang sống: stop dev -> build -> xoá .next -> npm run dev:lan

# Dev server (LAN + HTTPS cho camera/scanner)
npm run dev:https   # cert tự ký trong certificates/ — bấm "Vẫn truy cập" trên điện thoại
```
