# Spec: Revamp AI Copilot (Formapubli) — 2026-10-08

## 1. Bối cảnh & mục tiêu

Executive Copilot hiện tại đã chạy: 13 tools read-only, planner 2 tầng
(plan → execute → synth), RBAC Owner/Manager, model picker. Chủ doanh nghiệp
yêu cầu cải tạo theo 4 trụ: (1) làm đẹp giao diện, (2) tích hợp đầy đủ tool
calling, (3) mọi chức năng thao tác thường đều dùng được qua Copilot,
(4) tên hiển thị phải là tên người thật + vai trò tiếng Việt, không hiện mã
`ROLE_*`. Chỉ Quản lý và Chủ sở hữu được dùng Copilot (giữ nguyên).

## 2. Quyết định đã chốt với chủ doanh nghiệp (08/10/2026)

1. **Phân quyền giữ nguyên.** Route `api/ai/copilot` đã đúng: chỉ
   `ROLE_OWNER` / `ROLE_MANAGER`. Không mở cho vai trò khác.
2. **Mô hình tương tác: Copilot đề xuất → người dùng tự bấm nút hoàn thành.**
   Mọi thao tác ghi (nếu có trong tương lai) đều phải qua bước xác nhận rõ ràng
   của người dùng (bấm nút). Không bao giờ tự ghi lén.
3. **Đơn nháp là tạm thời (ephemeral), KHÔNG lưu database.** Luồng: xem trước
   trong chat → bấm "Áp vào POS" → xem lại trong giỏ → tự bấm Thanh toán.
   Không làm tính năng "lưu nháp sáng, chiều quay lại duyệt" (tồn kho/giá có
   thể đổi trong ngày → nháp cũ thành số liệu sai; phức tạp không xứng lợi).
4. **Model:** `gpt-oss-120b` đủ sức suy luận và chọn tool, nhưng phải đi đường
   Groq (JSON chuẩn, rất nhanh), không đi Cloudflare Workers AI (đo thật 06/10:
   JSON đúng 1/3). Mặc định free giữ `Nemotron 120B` qua CF (JSON 3/3).
   `llama-3.3-70b` đã bị loại (trả văn bản tự do, không theo schema) — muốn thử
   llama khác phải đo lại bằng `scripts/test-copilot-*`, không chốt cảm tính.

## 3. Hiện trạng (tóm tắt kỹ thuật)

- `src/app/api/ai/copilot/route.ts` (611 dòng): auth, rate limit 15 req/phút,
  planner `CopilotGuardrails.planQuery`, thực thi `executeToolSafely`
  (tối đa 4 steps cho `CALL_MANY`), synth qua chuỗi fallback
  Gemini → Groq → OpenAI → CF Workers AI → formatter nội bộ, kiểm grounded số
  (`findUngroundedNumbers`, `findZeroClaimContradiction`).
- `src/services/ai/copilot-guardrails.ts` (1158 dòng): 13 tools —
  `query_stock_level`, `query_sales_summary`, `query_reprint_forecast`,
  `query_cashbox_reconciliation`, `query_catalog`, `query_product_flow`,
  `query_sales_lines`, `prepare_sale_draft`, `query_shift_split`,
  `query_period_compare`, `query_transfer_history`, `query_gift_return`,
  `query_order_lookup`. Tất cả read-only trừ `prepare_sale_draft` (chỉ tạo nháp).
- `src/components/copilot/CopilotDrawer.tsx` (950 dòng): drawer phải, banner
  read-only, chat, quick prompt chips, mic, dropdown "Chọn bộ não".
- Chỗ đang hiện mã `ROLE_*`: `CopilotDrawer.tsx:364` (message từ chối),
  `:683` (banner), và nhãn người gửi "Quý Lãnh đạo" chung chung.
  Session đã có `fullName` (`src/lib/auth-session.ts:10`), `USER_ROLES`
  đã có label tiếng Việt (`src/lib/roles.ts`).

## 4. Thiết kế

### 4.1 UI (làm đẹp)

- Header drawer: hiện **tên người thật + vai trò tiếng Việt**
  (vd "Phạm Đan Khải · Quản lý vận hành") lấy từ session, thay cho mã role.
- Khi đang tra cứu: hiện **tên tool đang chạy** ("Đang tra tồn kho…") để minh
  bạch, thay cho chữ chung chung hiện tại.
- Quick prompt chips theo ngữ cảnh (sáng: doanh số hôm qua; cuối tháng: công
  nợ) thay cho danh sách cứng hiện tại.
- Thu gọn dropdown "Chọn bộ não" vào menu cài đặt; mặt chính chỉ hiện tên
  model đang dùng (dòng `Đang dùng:` đã có).
- Mobile-first: drawer full-screen trên điện thoại, nút mic/gửi đủ to.
  Tên UI tiếng Việt có dấu, ngắn gọn (theo AGENTS.md §0).

### 4.2 Tool calling (tích hợp đầy đủ)

- Giữ nguyên pattern: zod schema + `executeToolSafely` (RBAC + audit) + synth
  có kiểm grounded. Tool mới chỉ việc thêm vào `ToolCallSchema` và `switch`
  trong `executeToolSafely`, không phát minh pattern mới.
- Mở rộng catalog đọc sang module còn thiếu (theo thứ tự ưu tiên):
  1. Hợp đồng (module mới, đang phát triển),
  2. Công nợ đại lý / tiến độ thanh toán (tab Chủ GĐ3),
  3. Chi phí tab Chủ,
  4. Shopee / vận hành sàn.
- Nâng planner: từ `CALL_MANY` tối đa 4 steps cố định lên **vòng lặp nhiều lượt**
  (planner được gọi lại với kết quả trung gian) cho câu hỏi phức tạp.
- Tool ghi (tương lai, GĐ2): tuân mô hình §2.2 — Copilot chỉ **chuẩn bị**
  (draft), render hộp thoại xác nhận với nội dung điền sẵn, người dùng bấm nút
  mới thực thi. Mỗi tool ghi có audit log riêng.

### 4.3 Tên hiển thị

- Thay mọi chỗ in mã `ROLE_*` trong Copilot (drawer + message API) bằng
  `USER_ROLES[role].label`.
- Nhãn người gửi trong chat: dùng `session.fullName` thay cho "Quý Lãnh đạo"
  chung chung. Cần truyền thêm prop tên vào `CopilotDrawer`
  (hiện chỉ nhận `currentRole`).

### 4.4 Phân quyền (giữ nguyên)

Không đổi logic. Chỉ đổi **cách hiển thị** ở thông báo từ chối
(`CopilotDrawer.tsx:364,683` và message 403 ở route).

### 4.5 Model

- Giữ `MODEL_ALLOWLIST` ở route; mặc định free = `cf/nemotron-3-120b-a12b`.
- `groq/gpt-oss-120b` là lựa chọn planner chính khi có `GROQ_API_KEY`.
- Mọi model mới vào allowlist phải qua đo thật `scripts/test-copilot-*`
  (JSON hợp lệ, không bịa mã sách) mới được giữ — như tiền lệ đã loại
  `llama-3.3-70b`, `qwen`, `glm-5.2/5.3`.

## 5. Ngoài phạm vi (YAGNI)

- Lưu đơn nháp vào database / duyệt nháp sau nhiều giờ (§2.3).
- Copilot tự thực hiện thao tác ghi không cần xác nhận.
- Mở Copilot cho vai trò ngoài Owner/Manager.
- Thêm dependency mới cho chat UI nếu CSS hiện tại làm được.

## 6. Lộ trình đề xuất

- **GĐ1** (làm ngay): §4.3 tên hiển thị + §4.1 UI + thêm 2–4 tools đọc
  (hợp đồng, công nợ đại lý).
- **GĐ2** (sau khi GĐ1 nghiệm thu): vòng lặp planner nhiều lượt + tool ghi
  đầu tiên theo mô hình xác nhận (§4.2), áp dụng cho 1 thao tác thí điểm
  (vd duyệt chuyển kho) trước khi mở rộng.

## 7. Tiêu chí nghiệm thu

- Không còn chuỗi `ROLE_` nào hiện ra trong UI Copilot; tên người/vai trò
  tiếng Việt đúng với session.
- Mọi tool mới: có zod schema, qua `executeToolSafely`, có audit log,
  có test trong `scripts/test-copilot-*` xanh.
- Planner chọn đúng tool ≥ 95% trên bộ câu hỏi mẫu hiện có
  (`test-copilot-multistep`, `test-copilot-regressions`).
- Không có hồi quy: `npx tsx scripts/run-isolated.ts` xanh, `tsc` sạch,
  build sạch (`npm run build` nếu đụng CSS).
