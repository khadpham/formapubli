# Implementation Plan — Copilot Revamp GĐ2

**Spec:** `docs/superpowers/specs/2026-10-08-copilot-revamp-design.md` (§6: GĐ2)
**Branch:** `feat/copilot-revamp-gd2` (từ `origin/main` @ `db957ca`)
**Ngày:** 2026-10-08
**Chế độ:** Native — tự triển khai toàn bộ, review một lần cuối.

## Scope GĐ2 (theo spec §6)

1. **Vòng lặp planner nhiều lượt** — planner được gọi lại với kết quả trung
   gian, thay thế `CALL_MANY` cố định tối đa 4 steps. Cho câu hỏi phức tạp
   cần tra cứu tiếp dựa trên kết quả trước (vd "đại lý nào nợ nhiều nhất,
   hợp đồng của họ còn hiệu lực không?").
2. **Tool ghi pilot** — `prepare_transfer_draft` theo mô hình xác nhận
   (§4.2): Copilot chỉ **chuẩn bị** phiếu chuyển kho từ ngôn ngữ tự nhiên,
   render dialog xác nhận với nội dung điền sẵn, người dùng bấm nút mới gọi
   API `dispatch` thật. Không tự ghi lén.
3. **Streaming live tool name** — route stream SSE, drawer hiện tên chính xác
   tool đang chạy (thay loading theo giai đoạn chung chung).

## Ngoài scope

- Tool ghi thứ 2+ (mở rộng sau khi pilot nghiệm thu).
- Lưu draft vào DB / duyệt lại sau nhiều giờ (YAGNI, đã chốt GĐ1).
- Thay đổi RBAC.

---

## Task 1 — Vòng lặp planner nhiều lượt

**File:** `src/services/ai/copilot-guardrails.ts`, `src/app/api/ai/copilot/route.ts`,
`scripts/test-copilot-gd2.ts` (mới).

**Thiết kế:**
- Thêm `CopilotGuardrails.planNextStep(question, previousResults, history)`:
  nhận danh sách `{toolName, summary}` các kết quả đã có, hỏi LLM
  "cần thêm tool nào nữa không, hay đã đủ để trả lời?".
  Trả về `CALL_TOOL` (tool tiếp theo) hoặc `FINISH` (đủ dữ liệu).
- Prompt planner thêm mục: "DỮ LIỆU ĐÃ CÓ" + quy tắc "chỉ gọi tool mới nếu
  dữ liệu hiện tại chưa trả lời được câu hỏi".
- Route: vòng lặp tối đa **3 lượt**:
  ```
  plan = planQuery(question)
  results = []
  repeat max 3:
    if plan.action in (DIRECT_ANSWER, REFUSE...): break → xử lý như hiện tại
    execute plan steps → results.push(...)
    if plan từ heuristic: break  (heuristic giữ single-shot)
    plan = planNextStep(question, results)
    if plan.action == FINISH: break
  synthesize từ results
  ```
- Guard chống lặp vô hạn: tối đa 3 lượt; cấm gọi lại tool đã chạy với args
  y hệt (so sánh `toolName + JSON(args)`).

**Test (TDD):**
- Mock `planNextStep` 2 lượt: lượt 1 `query_agency_debt`, lượt 2 `FINISH` →
  assert cả 2 lượt đều chạy và kết quả gộp đúng.
- Câu đơn giản ("tồn kho HH001") → chỉ 1 lượt, không gọi `planNextStep`.
- Guard: planner đòi gọi lại đúng tool+args cũ → bị chặn, dừng vòng lặp.

## Task 2 — Tool ghi pilot `prepare_transfer_draft`

**File:** `src/services/ai/copilot-guardrails.ts`
(`ToolCallSchema`, prompt catalog, heuristic rule, `executeToolSafely`),
`src/services/executive-query.service.ts` (method mới),
`src/app/api/ai/copilot/route.ts` (`LABEL_BY_TOOL`, formatter),
`src/components/copilot/CopilotDrawer.tsx` (dialog xác nhận + nút thực thi),
`scripts/test-copilot-gd2.ts`.

**Thiết kế (theo đúng mô hình prepare_sale_draft):**
- `ExecutiveQueryService.prepareTransferDraft({q})`:
  - Parse từ ngôn ngữ tự nhiên: kho gửi, kho nhận (match tên/mã kho),
    danh sách `{mã sách, số lượng}`.
  - Resolve mã sách → edition (dùng logic có sẵn của prepare_sale_draft),
    kiểm tra tồn kho khả dụng ở kho gửi.
  - Trả về **draft thuần túy** — KHÔNG ghi DB, KHÔNG gọi dispatch:
    `{ fromWarehouse, toWarehouse, items: [{editionId, code, title,
    quantity, availableStock}], warnings }`.
  - Thiếu thông tin (chưa rõ kho nhận / chưa rõ sách) → `warnings` yêu cầu
    bổ sung, không đoán mò.
- Prompt catalog: `16. prepare_transfer_draft(q?): CHUẨN BỊ PHIẾU CHUYỂN KHO
  — CHỈ tạo nháp, KHÔNG tạo phiếu thật. Người dùng xem lại và bấm "Xác nhận
  tạo phiếu" mới gọi API dispatch.`
- Heuristic keywords (không dấu): "chuyen kho", "luan chuyen",
  "chuyen sang kho" + ngữ cảnh tạo mới ("tao phieu", "lap phieu", "chuyen ...
  cuon"). Cẩn thận không cướp rule `query_transfer_history` (tra cứu lịch sử)
  — phân biệt bằng động từ tạo mới vs tra cứu.
- Drawer: khi `toolUsed === 'prepare_transfer_draft'` và có items → render
  **dialog xác nhận** liệt kê kho gửi/nhận + từng dòng sách (mã, tên, SL,
  tồn kho gửi). Nút **"Xác nhận tạo phiếu"** → gọi `POST /api/transfers`
  `{action: 'dispatch', ...}` với idempotency-key; disable sau khi bấm
  (chống double-click); hiện kết quả (mã phiếu / lỗi).
- RBAC: Copilot chỉ Owner/Manager dùng được (giữ nguyên); API dispatch có
  RBAC riêng (`requireSessionRole`).

**Test (TDD):**
- `prepareTransferDraft({q: 'chuyển 10 cuốn HH001 từ kho Âu Cơ sang kho Hội Chợ'})`
  → draft đúng kho, đúng SL, chưa có phiếu nào trong DB
  (assert `transferShipments` không tăng).
- Thiếu kho nhận → warnings yêu cầu bổ sung.
- Sách không tồn tại → warnings, không có trong items.
- Heuristic: "lập phiếu chuyển 5 cuốn HH001 sang kho Quy Nhơn" →
  `prepare_transfer_draft`; "lịch sử chuyển kho" → vẫn `query_transfer_history`
  (không bị cướp).

## Task 3 — Streaming live tool name (SSE)

**File:** `src/app/api/ai/copilot/route.ts`, `src/components/copilot/CopilotDrawer.tsx`,
`scripts/test-copilot-gd2.ts`.

**Thiết kế:**
- Route trả về `text/event-stream` thay vì JSON một cục:
  - `event: planner` → `{stage: 'planning'}`
  - `event: tool_start` → `{toolName, label}` (label từ `LABEL_BY_TOOL`)
  - `event: tool_done` → `{toolName}`
  - `event: synthesizing` → `{}`
  - `event: done` → `{answer, toolUsed, toolData, engine}` (payload JSON cuối
    giữ nguyên shape cũ để drawer tái dùng logic render)
  - `event: error` → `{message}` khi exception giữa chừng.
- Drawer: `fetch` + `ReadableStream` reader, parse SSE theo dòng;
  text loading hiện **tên tool thật** ("Đang tra cứu: Tồn kho...") thay cho
  3 câu luân phiên chung chung. Khi `done` → render message như cũ.
- Fallback: nếu stream lỗi giữa chừng → hiện `error` event message, không
  treo loading.
- Giữ nguyên: RBAC check trước khi stream (403 JSON như cũ nếu không phận sự),
  audit log trong `executeToolSafely`, grounded check ở synthesis.

**Test (TDD):**
- Gọi route handler với mock session → đọc SSE stream → assert thứ tự events:
  `planner` → `tool_start(query_stock_level)` → `tool_done` →
  `synthesizing` → `done`; payload `done` có `answer` string.
- Tool throw giữa chừng → nhận `event: error`, stream đóng sạch.

## Review Focus

- Vòng lặp planner: không lặp vô hạn (tối đa 3 lượt), không gọi trùng
  tool+args, heuristic không bị lôi vào vòng lặp.
- Tool ghi: **tuyệt đối không** có đường nào gọi `dispatch` mà không qua nút
  xác nhận của user; draft không ghi DB; idempotency-key chống double-click;
  parse sai kho/sách thì warnings chứ không đoán.
- Streaming: client cũ (nếu còn) không break — drawer là client duy nhất,
  chuyển đổi đồng bộ; sự kiện `error` luôn đóng stream.
- Số trong formatter mới qua được `findUngroundedNumbers` (nếu có).
- Không hồi quy: full suite `scripts/run-isolated.ts` xanh, `tsc` sạch.

## Ledger

- Progress: `.superpowers/sdd/2026-10-08-copilot-revamp-gd2/progress.md`
