# Contract AI GĐ2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI đọc hiểu hợp đồng bất kỳ (upload .docx/.txt) → tóm tắt + trích xuất thực thể → phản biện theo checklist từng loại, đề xuất câu chữ cụ thể.

**Architecture:** 2 API routes (`analyze`, `review`) dùng chung `contract-ai.service.ts` mở rộng. Checklist phản biện lưu DB version hóa (`contract_review_checklists`), seed checklist mặc định cho 3 loại ưu tiên. Text extraction .docx bằng pizzip (dep đã có) — KHÔNG thêm lib PDF ở GĐ2.

**Tech Stack:** Next.js API routes, `callGeminiWithFallback`, pizzip, migration SQL.

**Spec:** `docs/superpowers/specs/2026-10-08-hop-dong-ai-design.md` (mục GĐ2, mục 5)

## Global Constraints

- Mọi route dùng `requireSessionRole` với ROLES Owner/Manager — không nới quyền.
- Test KHÔNG gọi LLM thật (mock), KHÔNG dùng chung hằng với code.
- Không log nội dung hợp đồng — chỉ log hash/model.
- Mọi output phản biện gắn nhãn "tham khảo — cần người có trách nhiệm duyệt".
- Upload giới hạn 5MB, chỉ nhận .docx/.txt (từ chối .pdf với message rõ ở GĐ2).
- UI tiếng Việt CÓ DẤU, nút ngắn.
- `git add` từng file, không `-A`.

## Review Focus

- File .docx hỏng / không phải Word thật → báo lỗi rõ, không crash.
- Văn bản quá dài (>12000 ký tự) → cắt + ghi chú "đã cắt bớt", không im lặng.
- LLM trả issue thiếu trường → validate + loại bỏ, không để UI vỡ.
- Checklist chưa có cho category KHAC → dùng checklist chung tối thiểu, không từ chối.
- Người dùng upload hợp đồng của đối tác (không phải mẫu công ty) → vẫn phân tích được, ghi rõ "tài liệu ngoài".

---

### Task 1: Migration 0051 — checklist + lịch sử review

**Files:**
- Create: `src/db/migrations/0051_contract_review.sql`
- Register: `src/db/migrations/meta/_journal.json` (idx 51)

**Interfaces:**
- Produces: bảng `contract_review_checklists` (id, category, version INTEGER, items TEXT JSON, is_active INTEGER, created_at), bảng `contract_reviews` (id, source_name TEXT, category TEXT, summary TEXT JSON, issues TEXT JSON, ai_model TEXT, content_hash TEXT, created_by TEXT, created_at)

- [ ] **Step 1:** Viết migration 0051 (2 bảng, statement-breakpoint giữa các câu).
- [ ] **Step 2:** Thêm vào `_journal.json` entry idx 51, tag `0051_contract_review`.
- [ ] **Step 3:** Cập nhật `src/db/schema.ts` 2 bảng tương ứng.
- [ ] **Step 4:** `npx tsc --noEmit` sạch.
- [ ] **Step 5:** Commit
  ```bash
  git add src/db/migrations/0051_contract_review.sql src/db/migrations/meta/_journal.json src/db/schema.ts
  git commit -m "feat(contract-ai): migration 0051 checklist + lich su review"
  ```

### Task 2: Checklist mặc định + seed

**Files:**
- Create: `src/services/ai/contract-checklists.ts`
- Test: `scripts/test-contract-ai-gd2.ts`

**Interfaces:**
- Produces:
  - `DEFAULT_CHECKLISTS: Record<string, { version: number; items: ChecklistItem[] }>` cho `THUE_DIA_DIEM_SK`, `DAT_HANG_HOA_SK`, `TAC_QUYEN`
  - `ChecklistItem = { id: string; label: string; hint: string; severity: 'THIEU' | 'MO_HO' | 'RUI_RO' }`
  - `getChecklist(category: string): ChecklistItem[]` — fallback checklist chung nếu chưa có

- [ ] **Step 1: Write the failing test** — assert 3 loại có ≥5 items, mỗi item có id/label/hint/severity hợp lệ; `getChecklist('KHAC')` trả fallback không rỗng.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** — nội dung checklist thực tế:
  - THUE_DIA_DIEM_SK: đặt cọc (tỷ lệ, hoàn trả), phạt hủy (trước bao lâu), ai lo điện/nước/PCCC, bảo hiểm, bàn giao/hòan trả mặt bằng, phụ phí ngoài giờ
  - DAT_HANG_HOA_SK: mô tả hàng hóa/dịch vụ, số lượng, tiêu chuẩn nghiệm thu, tiến độ giao, thanh toán theo đợt, phạt chậm, bảo hành
  - TAC_QUYEN: phạm vi quyền (độc quyền?), thời hạn, lãnh thổ, nhuận bút (tỷ lệ/cách tính), tạm ứng/khấu trừ, quyền chấm dứt, xử lý vi phạm bản quyền
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit
  ```bash
  git add src/services/ai/contract-checklists.ts scripts/test-contract-ai-gd2.ts
  git commit -m "feat(contract-ai): checklist phan bien mac dinh 3 loai hop dong"
  ```

### Task 3: Service — extractDocxText + analyzeContract

**Files:**
- Modify: `src/services/ai/contract-ai.service.ts`
- Test: `scripts/test-contract-ai-gd2.ts` (append)

**Interfaces:**
- Consumes: Task 2, pizzip
- Produces:
  - `extractDocxText(base64: string): string` — unzip, lấy text từ `word/document.xml` (nối các `<w:t>`), lỗi → throw `ContractAIError('DOCX_KHONG_DOC_DUOC')`
  - `analyzeContract(text: string, callLlm?): Promise<{ contractType: string; parties: string[]; valueText: string | null; keyDates: string[]; obligations: string[]; summary: string }>` — cắt 12000 ký tự, prompt ép JSON

- [ ] **Step 1: Write the failing test** — mock LLM trả JSON phân tích; assert parse đúng parties/valueText; `extractDocxText` với base64 tạo từ lib `docx` (text "Bên A: Công ty X") → chứa "Công ty X"; base64 rác → throw.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** — regex `/<w:t[^>]*>([^<]*)<\/w:t>/g` trên document.xml (chỉ đọc text, không phải placeholder nên regex OK).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit
  ```bash
  git add src/services/ai/contract-ai.service.ts scripts/test-contract-ai-gd2.ts
  git commit -m "feat(contract-ai): trich text docx + AI tom tat hop dong"
  ```

### Task 4: Service — reviewContract theo checklist

**Files:**
- Modify: `src/services/ai/contract-ai.service.ts`
- Test: `scripts/test-contract-ai-gd2.ts` (append)

**Interfaces:**
- Consumes: Task 2, 3
- Produces:
  - `reviewContract(text: string, category: string, callLlm?): Promise<{ issues: ReviewIssue[] }>`
  - `ReviewIssue = { checklistId: string; level: 'THIEU' | 'MO_HO' | 'RUI_RO' | 'DAT'; finding: string; suggestion: string }` — `DAT` = điều khoản đã có và ổn

- [ ] **Step 1: Write the failing test** — mock LLM trả 2 issues; assert mỗi issue có đủ 4 trường, level hợp lệ; text rỗng → throw `ContractAIError`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** — prompt: đưa checklist items vào, yêu cầu đánh giá từng item (DAT/THIEU/MO_HO/RUI_RO) + finding ngắn + suggestion câu chữ cụ thể; ép JSON `{issues: [...]}`; validate từng issue, loại bỏ bản ghi thiếu trường.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit
  ```bash
  git add src/services/ai/contract-ai.service.ts scripts/test-contract-ai-gd2.ts
  git commit -m "feat(contract-ai): AI phan bien hop dong theo checklist"
  ```

### Task 5: API routes analyze + review

**Files:**
- Create: `src/app/api/ai/contracts/analyze/route.ts`
- Create: `src/app/api/ai/contracts/review/route.ts`

**Interfaces:**
- Consumes: Task 3, 4; `requireSessionRole`, `recordAuditLog`
- Produces:
  - `POST /api/ai/contracts/analyze` `{fileBase64?, fileName?, text?}` → `{summary data}` + lưu `contract_reviews` (content_hash, ai_model)
  - `POST /api/ai/contracts/review` `{fileBase64?, fileName?, text?, category}` → `{issues}` + lưu review

- [ ] **Step 1:** Implement 2 routes — nhận base64 (.docx → extractDocxText, .txt → decode) hoặc text trực tiếp; từ chối file >5MB và đuôi không hỗ trợ (.pdf → 400 "GĐ2 chưa hỗ trợ PDF, hãy dùng .docx"); validate category.
- [ ] **Step 2:** Lưu `contract_reviews` sau mỗi lần gọi (summary/issues JSON, hash sha256, model từ `resolveGeminiModel`).
- [ ] **Step 3:** `npx tsc --noEmit` sạch.
- [ ] **Step 4:** Commit
  ```bash
  git add src/app/api/ai/contracts/analyze src/app/api/ai/contracts/review
  git commit -m "feat(contract-ai): 2 API route analyze + review hop dong"
  ```

### Task 6: UI — panel phân tích + phản biện

**Files:**
- Create: `src/components/contracts/AIContractReview.tsx`
- Modify: `src/components/contracts/ContractsTab.tsx` (thêm nút)

**Interfaces:**
- Consumes: Task 5
- Produces: modal với upload file (.docx/.txt) hoặc dán text → hiện tóm tắt (loại, các bên, giá trị, ngày quan trọng, nghĩa vụ) → chọn loại → nút "Phản biện" → danh sách issues theo mức (DAT xanh / THIEU đỏ / MO_HO vàng / RUI_RO cam) + gợi ý câu chữ; nhãn "kết quả tham khảo" hiển thị rõ.

- [ ] **Step 1:** Tạo component — 2 bước: (1) nhập liệu + tóm tắt, (2) phản biện.
- [ ] **Step 2:** Thêm nút "AI Đọc & Phản Biện" vào ContractsTab cạnh nút AI builder.
- [ ] **Step 3:** Kiểm tra UI: nhãn tiếng Việt có dấu, nút rõ, mức độ issues có màu phân biệt.
- [ ] **Step 4:** `npx tsc --noEmit` sạch.
- [ ] **Step 5:** Commit
  ```bash
  git add src/components/contracts/AIContractReview.tsx src/components/contracts/ContractsTab.tsx
  git commit -m "feat(contract-ai): UI doc hieu + phan bien hop dong"
  ```

### Task 7: Test tổng + verification

- [ ] **Step 1:** `npx tsx scripts/run-isolated.ts --only=test-contract-ai-gd2` — xanh.
- [ ] **Step 2:** Đăng ký suite vào `run-isolated.ts`.
- [ ] **Step 3:** Chạy suite GĐ1 + contract hiện tại — không regression.
- [ ] **Step 4:** `npx tsc --noEmit` sạch.
- [ ] **Step 5:** Push → PR → merge theo A-Z.
