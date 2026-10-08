# Contract AI GĐ3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Soạn thảo thông minh từ mẫu đã duyệt: chọn mẫu + điền dữ liệu + ghi chú tình huống → AI điền placeholder và đề xuất điều chỉnh điều khoản (từng đề xuất duyệt riêng) → chốt thành hợp đồng.

**Architecture:** Nguyên tắc "khung cứng" được thực thi bằng cấu trúc: AI trả về `filledText` (giữ nguyên điều khoản gốc, chỉ điền giá trị) + `adjustments[]` (đề xuất riêng biệt, user accept/reject từng cái). Khi chốt: tạo mẫu AI one-off từ văn bản cuối (tái dùng `finalizeAiTemplate` GĐ1, description ghi mẫu gốc) → tạo document qua `ContractService.createDocument` hiện có. KHÔNG migration mới.

**Tech Stack:** Next.js API routes, `callGeminiWithFallback`, tái dùng service GĐ1/GĐ2.

**Spec:** `docs/superpowers/specs/2026-10-08-hop-dong-ai-design.md` (mục GĐ3, mục 5)

## Global Constraints

- Route dùng `requireSessionRole` Owner/Manager. Không nới quyền.
- Test KHÔNG gọi LLM thật (mock). Không log nội dung hợp đồng.
- AI KHÔNG được tự sửa điều khoản gốc trong `filledText` — mọi thay đổi điều khoản phải nằm trong `adjustments[]` để user duyệt.
- UI tiếng Việt CÓ DẤU. `git add` từng file.

## Review Focus

- Template không tồn tại / không active → 404 rõ ràng.
- fieldValues thiếu key so với schemaFields → AI để trống + ghi chú, không bịa giá trị.
- notes rỗng → vẫn điền placeholder bình thường, adjustments rỗng.
- User từ chối hết adjustments → văn bản cuối = filledText nguyên bản.
- LLM trả adjustment trùng lặp / không gắn được vào điều khoản nào → loại bỏ, không để UI vỡ.

---

### Task 1: Service — smartDraft

**Files:**
- Modify: `src/services/ai/contract-ai.service.ts`
- Test: `scripts/test-contract-ai-gd3.ts`

**Interfaces:**
- Consumes: `contractTemplates` (db), `CONTRACT_CATEGORIES`
- Produces:
  - `smartDraft(input: { templateId: string; fieldValues: Record<string,string>; notes: string }, callLlm?): Promise<{ filledText: string; adjustments: DraftAdjustment[] }>`
  - `DraftAdjustment = { id: string; clauseRef: string; original: string; proposed: string; reason: string }`

- [ ] **Step 1: Write the failing test** — mock LLM trả `{filledText, adjustments}`; assert filledText chứa giá trị đã điền (không còn `{placeholder}` tương ứng), adjustments đủ 5 trường; templateId không tồn tại → throw `ContractAIError('MAU_KHONG_TON_TAI')`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** — load template từ DB (chỉ active), extract text từ templateData (.docx → extractDocxText); prompt ép 2 quy tắc: (1) filledText = điền giá trị vào `{placeholder}`, GIỮ NGUYÊN mọi điều khoản; (2) mọi thay đổi điều khoản theo notes → đưa vào adjustments (không sửa trực tiếp). Parse + validate.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit
  ```bash
  git add src/services/ai/contract-ai.service.ts scripts/test-contract-ai-gd3.ts
  git commit -m "feat(contract-ai): smartDraft dien placeholder + de xuat dieu chinh"
  ```

### Task 2: API routes — smart-draft + finalize

**Files:**
- Create: `src/app/api/ai/contracts/smart-draft/route.ts`
- Create: `src/app/api/ai/contracts/smart-finalize/route.ts`

**Interfaces:**
- Consumes: Task 1, `finalizeAiTemplate` (GĐ1), `ContractService.createDocument`
- Produces:
  - `POST /api/ai/contracts/smart-draft` `{templateId, fieldValues, notes}` → `{filledText, adjustments}`
  - `POST /api/ai/contracts/smart-finalize` `{templateId, title, category, finalText, acceptedAdjustments, fieldValues, partnerId?, totalAmount?}` → `{documentId, contractNumber}` — tạo mẫu AI one-off (code `AI-<timestamp>`, description ghi "Soạn thông minh từ mẫu <code gốc>") rồi tạo document

- [ ] **Step 1:** Implement 2 routes — validate templateId/title/category; smart-finalize gọi `finalizeAiTemplate` rồi `ContractService.createDocument`; audit log (chỉ hash).
- [ ] **Step 2:** `npx tsc --noEmit` sạch.
- [ ] **Step 3:** Commit
  ```bash
  git add src/app/api/ai/contracts/smart-draft src/app/api/ai/contracts/smart-finalize
  git commit -m "feat(contract-ai): 2 API route smart-draft + smart-finalize"
  ```

### Task 3: UI — AISmartDraft

**Files:**
- Create: `src/components/contracts/AISmartDraft.tsx`
- Modify: `src/components/contracts/ContractsTab.tsx` (thêm nút)

**Interfaces:**
- Consumes: Task 2, `GET /api/contracts/templates`
- Produces: modal 3 bước — (1) chọn mẫu (ưu tiên hiện mẫu đã duyệt pháp lý) + điền field theo schemaFields + ghi chú tình huống → (2) xem filledText + từng adjustment (chấp nhận/từ chối) → (3) chốt → báo số hợp đồng.

- [ ] **Step 1:** Tạo component — load templates, render form động từ schemaFields, textarea notes.
- [ ] **Step 2:** Bước 2 hiển thị adjustments dạng thẻ (điều khoản gốc → đề xuất + lý do + nút Chấp nhận/Từ chối).
- [ ] **Step 3:** Thêm nút "Soạn Thông Minh" vào ContractsTab.
- [ ] **Step 4:** `npx tsc --noEmit` sạch.
- [ ] **Step 5:** Commit
  ```bash
  git add src/components/contracts/AISmartDraft.tsx src/components/contracts/ContractsTab.tsx
  git commit -m "feat(contract-ai): UI soan thao thong minh tu mau"
  ```

### Task 4: Test tổng + verification

- [ ] **Step 1:** Đăng ký `test-contract-ai-gd3` vào `run-isolated.ts`.
- [ ] **Step 2:** Chạy GĐ1+GĐ2+GĐ3 + contract suites — xanh, không regression.
- [ ] **Step 3:** `npx tsc --noEmit` sạch.
- [ ] **Step 4:** Push → PR → merge theo A-Z.
