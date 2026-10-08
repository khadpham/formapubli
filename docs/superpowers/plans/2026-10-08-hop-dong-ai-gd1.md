# Contract AI GĐ1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI dựng thư viện mẫu hợp đồng từ con số 0: soạn nháp từ lời mô tả, nhập mẫu thật từ link Google Docs, chốt thành mẫu `.docx` lưu vào `contract_templates`.

**Architecture:** 3 API routes dưới `src/app/api/ai/contracts/` dùng chung `contract-ai.service.ts` (gọi `callGeminiWithFallback`, parse JSON). Luồng nhập Google Docs: fetch `export?format=txt` server-side → LLM cấu trúc hóa + đề xuất placeholder. Chốt mẫu: sinh `.docx` bằng lib `docx` → lưu base64 vào `templateData`, tương thích engine merge hiện tại (docxtemplater).

**Tech Stack:** Next.js API routes, `callGeminiWithFallback` (đã có), lib `docx` (thêm mới — `docxtemplater` chỉ merge, không sinh file), migration SQL.

**Spec:** `docs/superpowers/specs/2026-10-08-hop-dong-ai-design.md` (mục 3a–3c, mục 5, mục 8)

## Global Constraints

- Mọi route dùng `requireSessionRole` theo đúng pattern route contracts hiện tại — không nới quyền.
- Test KHÔNG gọi LLM thật: mock `callGeminiWithFallback` bằng jest/vi mock hoặc inject fetcher.
- Test KHÔNG dùng chung hằng/giá trị với code — placeholder mẫu trong test lấy từ output thật của service.
- Không log nội dung hợp đồng (chỉ log hash/model).
- UI tiếng Việt CÓ DẤU, tên nút ngắn (động từ).
- `git add` từng file, không `-A`. Không commit secret.
- Thêm lib `docx`: `npm install --include=dev` sau khi thêm vào package.json (theo AGENTS.md).

## Review Focus

- Link Google Docs không public / sai ID → phải báo lỗi rõ, không crash, không lộ stack trace.
- LLM trả JSON hỏng / thiếu trường → service phải validate + báo lỗi có nghĩa, UI không treo.
- Placeholder đề xuất phải khớp chính xác chuỗi trong văn bản (sai 1 ký tự là merge lỗi) → test phải assert thay thế thử bằng docxtemplater thành công.
- File .docx sinh ra phải mở được và merge được bằng engine hiện tại.
- Người dùng chốt mẫu chưa qua `legal_reviewed` → UI gắn nhãn "Chưa duyệt pháp lý" rõ ràng, không để nhầm với mẫu đã duyệt.

---

### Task 1: Migration 0050 — cờ AI cho contract_templates

**Files:**
- Create: `src/db/migrations/0050_contract_ai_flags.sql`
- Test: `scripts/test-contract-ai-gd1.ts` (dùng chung cho các task sau)

**Interfaces:**
- Consumes: migration 0046 (`contract_templates`)
- Produces: cột `legal_reviewed INTEGER DEFAULT 0`, `ai_generated INTEGER DEFAULT 0`, `source_url TEXT`

- [ ] **Step 1:** Viết migration `0050_contract_ai_flags.sql`:
  ```sql
  ALTER TABLE contract_templates ADD COLUMN legal_reviewed INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE contract_templates ADD COLUMN ai_generated INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE contract_templates ADD COLUMN source_url TEXT;
  ```
  Copy nguyên văn, không tự chế tên cột khác.
- [ ] **Step 2:** Cập nhật `contractTemplates` trong `src/db/schema.ts` thêm 3 cột tương ứng (khớp tên migration).
- [ ] **Step 3:** Chạy `npx tsc --noEmit` — sạch.
- [ ] **Step 4:** Commit
  ```bash
  git add src/db/migrations/0050_contract_ai_flags.sql src/db/schema.ts
  git commit -m "feat(contract-ai): migration 0050 co legal_reviewed/ai_generated/source_url"
  ```

### Task 2: contract-ai.service.ts — soạn nháp từ mô tả

**Files:**
- Create: `src/services/ai/contract-ai.service.ts`
- Test: `scripts/test-contract-ai-gd1.ts`

**Interfaces:**
- Consumes: `callGeminiWithFallback` từ `@/services/ai/llm-client`
- Produces:
  - `draftTemplateFromDescription(input: { category: string; description: string }): Promise<{ title: string; bodyText: string; suggestedPlaceholders: string[] }>`
  - `CONTRACT_CATEGORIES = ['THUE_DIA_DIEM_SK','DAT_HANG_HOA_SK','TAC_QUYEN','IN_AN','DAI_LY_PHAN_PHOI','KHAC']`

- [ ] **Step 1: Write the failing test** — trong `scripts/test-contract-ai-gd1.ts`, mock `callGeminiWithFallback` trả JSON cố định `{title, bodyText, suggestedPlaceholders}`; assert `draftTemplateFromDescription` parse đúng và `bodyText` chứa placeholder dạng `{{...}}` khớp `suggestedPlaceholders`.
- [ ] **Step 2: Run test** — `npx tsx scripts/test-contract-ai-gd1.ts`, expect FAIL (service chưa tồn tại).
- [ ] **Step 3: Implement** `draftTemplateFromDescription` trong `src/services/ai/contract-ai.service.ts`:
  systemPrompt ép: văn phong pháp lý tiếng Việt, thuật ngữ luật VN, cấm từ thông dụng cho điều khoản; output JSON `{title, bodyText, suggestedPlaceholders}`; validate JSON parse lỗi → throw `ContractAIError('LLM_TRA_JSON_HONG')`.
- [ ] **Step 4: Run test** — PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add src/services/ai/contract-ai.service.ts scripts/test-contract-ai-gd1.ts
  git commit -m "feat(contract-ai): draft mau hop dong tu mo ta bang loi"
  ```

### Task 3: contract-ai.service.ts — nhập từ Google Docs

**Files:**
- Modify: `src/services/ai/contract-ai.service.ts`
- Test: `scripts/test-contract-ai-gd1.ts` (append)

**Interfaces:**
- Consumes: Task 2
- Produces:
  - `fetchGdocText(gdocUrl: string): Promise<string>` — trích doc ID từ URL, fetch `https://docs.google.com/document/d/{id}/export?format=txt`; URL sai/không fetch được → throw `ContractAIError('GDOC_KHONG_DOC_DUOC')`
  - `structureGdocTemplate(rawText: string): Promise<{ title: string; bodyText: string; suggestedPlaceholders: { placeholder: string; originalText: string }[] }>` — LLM giữ nguyên văn điều khoản, chỉ đánh dấu điểm điền thành `{placeholder}`

- [ ] **Step 1: Write the failing test** — mock fetch trả text mẫu có "Công ty ABC" + "100.000.000 đồng"; assert `structureGdocTemplate` trả `suggestedPlaceholders` chứa placeholder mà `originalText` khớp chuỗi thật trong text.
- [ ] **Step 2: Run test** — expect FAIL.
- [ ] **Step 3: Implement** 2 hàm. `fetchGdocText` validate URL bằng regex `/\/document\/d\/([a-zA-Z0-9-_]+)/`, timeout 15s.
- [ ] **Step 4: Run test** — PASS. Thêm test biên: URL sai → throw `GDOC_KHONG_DOC_DUOC`.
- [ ] **Step 5: Commit**
  ```bash
  git add src/services/ai/contract-ai.service.ts scripts/test-contract-ai-gd1.ts
  git commit -m "feat(contract-ai): nhap mau that tu link Google Docs"
  ```

### Task 4: API routes — draft / import / finalize

**Files:**
- Create: `src/app/api/ai/contracts/draft-template/route.ts`
- Create: `src/app/api/ai/contracts/import-gdoc/route.ts`
- Create: `src/app/api/ai/contracts/finalize-template/route.ts`
- Test: `scripts/test-contract-ai-gd1.ts` (gọi HTTP qua route handler với session mock — hoặc test service-level nếu pattern repo không mock session được; theo pattern `verify-pos-live.ts` nếu cần)

**Interfaces:**
- Consumes: Task 2, 3 (service); `requireSessionRole` pattern từ `src/app/api/contracts/templates/route.ts`
- Produces:
  - `POST /api/ai/contracts/draft-template` `{category, description}` → `{title, bodyText, suggestedPlaceholders}`
  - `POST /api/ai/contracts/import-gdoc` `{gdocUrl}` → `{title, bodyText, suggestedPlaceholders}`
  - `POST /api/ai/contracts/finalize-template` `{title, category, bodyText, placeholders: string[], code, sourceUrl?}` → `{templateId}` (sinh .docx, lưu DB, `ai_generated=1`, `legal_reviewed=0`; ghi audit log `recordAuditLog` với ai_model + hash bodyText, KHÔNG log nội dung)

- [ ] **Step 1: Write the failing test** — POST `draft-template` với category sai → 400; POST `import-gdoc` với URL rác → 400/422 có message tiếng Việt.
- [ ] **Step 2: Run test** — expect FAIL.
- [ ] **Step 3: Implement** 3 routes. Sinh `.docx`: dùng lib `docx` — mỗi đoạn văn bản là 1 `Paragraph`, placeholder giữ nguyên `{ten}` trong text. Convert sang base64 → `templateData`. `schemaFields` = JSON từ `placeholders: string[]` (UI tự trích từ 2 luồng: `suggestedPlaceholders` của draft hoặc map `p.placeholder` của import). `code` unique: kiểm tra trùng → 409. Ghi audit log sau khi lưu (ai_model, sha256(bodyText)).
- [ ] **Step 4: Run test** — PASS. Verify thủ công: lấy `templateData` decode → merge thử bằng `contract-engine.service.ts` với data mẫu → ra file không lỗi.
- [ ] **Step 5: Commit**
  ```bash
  git add src/app/api/ai/contracts/
  git commit -m "feat(contract-ai): 3 API route draft/import/finalize mau hop dong"
  ```

### Task 5: UI AITemplateBuilder

**Files:**
- Create: `src/components/contracts/AITemplateBuilder.tsx`
- Modify: tab Hợp đồng hiện tại (gắn nút — executor tự tìm file tab)

**Interfaces:**
- Consumes: 3 API Task 4
- Produces: component với 2 tab con: "Mô tả → Soạn" (textarea + select loại + nút "Soạn nháp") và "Nhập từ Google Docs" (input link + nút "Nhập"); vùng soạn thảo nháp (textarea lớn, sửa được); nút "Chốt thành mẫu" → gọi finalize; nhãn "Chưa duyệt pháp lý" trên mẫu AI.

- [ ] **Step 1:** Tạo component theo đúng luồng: nhập → loading ("Đang soạn...") → nháp hiện ra sửa được → chốt → báo "Đã lưu mẫu".
- [ ] **Step 2:** Gắn vào tab Hợp đồng 1 nút "Tạo mẫu bằng AI" mở builder (modal hoặc panel).
- [ ] **Step 3:** Kiểm tra UI: nút có dấu hiệu bấm rõ, text tiếng Việt có dấu, không nút nào trông như mảng chữ.
- [ ] **Step 4:** `npx tsc --noEmit` sạch.
- [ ] **Step 5: Commit**
  ```bash
  git add src/components/contracts/AITemplateBuilder.tsx <file-tab-hop-dong>
  git commit -m "feat(contract-ai): UI tao mau hop dong bang AI"
  ```

### Task 6: Test tổng + verification

**Files:**
- Test: `scripts/test-contract-ai-gd1.ts` (hoàn thiện)

**Interfaces:**
- Consumes: Task 1–5

- [ ] **Step 1:** Chạy full test file: `npx tsx scripts/test-contract-ai-gd1.ts` — tất cả PASS, không gọi LLM thật (assert bằng cách kiểm tra không có env key nào được dùng hoặc mock chặn).
- [ ] **Step 2:** Chạy các suite hợp đồng hiện tại: `npx tsx scripts/run-isolated.ts --only=<suite-hop-dong-hien-tai>` — xanh (không regression).
- [ ] **Step 3:** `npx tsc --noEmit` sạch.
- [ ] **Step 4:** Đăng ký suite vào `scripts/run-isolated.ts` nếu pattern repo yêu cầu.
- [ ] **Step 5: Commit** (nếu có thay đổi)
