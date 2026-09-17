# PHASE 5 LANE CONTRACT — Hợp Đồng Phối Hợp 2 Lane (Pre-Phase 5 Hardening + 5.2 Copilot)

> **Trạng thái:** LOCKED v1.0 — Hai bên ký duyệt trước khi code. Mọi thay đổi phải được cả 2 lane đồng thuận.
> **Phạm vi:** 4 bản vá nền tảng (P2, P3, P1a, P4) + Sprint 5.2 Executive Copilot. P1b (default-deny toàn tuyến) tách PR riêng sau.
> **Nguyên tắc xuyên suốt:** Backend sở hữu số liệu, quyền truy cập và quy tắc nghiệp vụ. AI chỉ tra cứu, diễn giải, đề xuất.

---

## 1. Quyết định đã chốt (D1–D5)

| # | Quyết định | Nội dung |
|---|---|---|
| D1 | Cron 5.5 | Cloudflare Worker riêng + Cron Trigger, không cron trên Pages |
| D2 | Voice 5.1 | Chỉ thu giọng thu ngân/nhân viên chủ động, luôn có fallback nhập/dán text |
| D3 | Copilot 5.2 | Chỉ `ROLE_OWNER` + `ROLE_MANAGER` |
| D4 | Phân quyền đọc | **MANAGER = CEO vận hành: toàn quyền đọc như OWNER** (tồn kho toàn hệ thống, cả 2 sổ, két tiền gồm số lệch, forecast). Ranh giới OWNER-only chỉ áp dụng cho *hành động phê duyệt* (chi tiền, quyết định tái bản, ký hợp đồng) ở phase sau |
| D5 | Validator | Cài **Zod chính thức** (`npm i zod`, đưa vào `package.json`) cho mọi schema AI phía server |

---

## 2. Thứ tự merge (bắt buộc)

```text
P2 (Forecast rename) → P3 (llm-client + Zod) → P1a+P4 (Strict Copilot + Tool Matrix + Guardrails)
  → Sprint 5.2 → P1b (Default-deny toàn tuyến, PR riêng)
```

P2/P3 độc lập, làm song song được. P1a+P4 là cặp khóa nhau, cùng một nhịp.

---

## 3. Kiến trúc Copilot (luồng request)

```text
User Question + Session Cookie
  → requireSessionRole(OWNER, MANAGER)      [Team A - route]
  → checkWindowRateLimit(copilot:staffId)   [Team A - HÀM MỚI, xem §7]
  → recordAuditLog(COPILOT_QUERY)           [Team A]
  → System Prompt + Guardrails              [Team B]
  → llm-client (Gemini/OpenAI/Fallback)     [Team B]
  → Zod validate ToolCall                   [Team B]
  → ExecutiveQueryService (4 tool read-only)[Team A]
  → Output post-check                       [Team B]
  → JSON Response
```

**Luật thép:** LLM Engine chỉ sinh `ToolCall` có cấu trúc. Tuyệt đối không để LLM client kết nối DB hay viết SQL.

---

## 4. Bảng 4 Tool Read-only (Locked Schema v1.0)

| Tool | Input (Zod) | Output | Quyền |
|---|---|---|---|
| `query_stock_level` | `{ editionId?: string, warehouseId?: string }` | Tồn khả dụng `NEW` (tổng + theo kho) | OWNER, MANAGER |
| `query_sales_summary` | `{ windowDays: number(1-365), fiscalScope: 'ALL' \| 'OFFICIAL_TAX' \| 'INTERNAL_MANAGEMENT' }` | Doanh thu thực, thuế, số đơn, kênh bán | OWNER, MANAGER (cả 2 sổ) |
| `query_reprint_forecast` | `{ level?: 'RED_ALERT' \| 'YELLOW_WARNING', limit?: number(≤200) }` | Vsale, DoI, số lượng in đề xuất 105 ngày | OWNER, MANAGER |
| `query_cashbox_reconciliation` | `{ sessionId?: string, date?: string }` | Tiền đầu ca, thu bán, thực đếm, số lệch — **chỉ đọc, không mở/đóng két** | OWNER, MANAGER |

Mặc định server-side khi thiếu param: `warehouseId` = toàn hệ thống (trừ `wh-in-transit`), `fiscalScope` = `ALL`, `windowDays` = 30.

---

## 5. Năm lớp guardrails (khóa kèm P4)

1. **Route:** `requireSessionRole` 2 role, không fallback. Ngoài 2 role → 403 + `COPILOT_UNAUTHORIZED_ATTEMPT`.
2. **Rate-limit cửa sổ:** hàm mới `checkWindowRateLimit` — 15 req/phút/staffId, vượt → 429 + mã `RATE_LIMITED`. (Không tái dùng `checkRateLimit` brute-force ở `auth-session.ts:116` — đã kiểm chứng không tương thích.)
3. **Prompt:** mọi con số chỉ từ kết quả tool; cấm tự tính; cấm suy diễn số lệch két thành kết luận gian lận; ngoài 4 tool → từ chối chuẩn.
4. **Output post-check:** số trong câu trả lời phải khớp số tool; bản tin két gắn nhãn "số liệu đối soát, không phải kết luận"; giới hạn độ dài chống moi dần.
5. **Audit + eval:** mỗi phiên ghi `COPILOT_QUERY`, mỗi tool ghi `COPILOT_TOOL_INVOKED` (details cắt 500 ký tự); bộ red-team `scripts/eval-executive-ai.ts` xuất JSON: moi két từng ca, moi sổ thuế, ép tự tính số, ép gọi tool lạ, ép diễn giải lệch.

---

## 6. Ba action audit mới (thêm vào union `AuditLogParams` ở `src/lib/rbac-guard.ts:5`)

```typescript
| 'COPILOT_QUERY'                // user gửi prompt hỏi Copilot
| 'COPILOT_TOOL_INVOKED'          // hệ thống thực thi 1 tool data
| 'COPILOT_UNAUTHORIZED_ATTEMPT'  // vai trò lạ cố gọi API Copilot
```

Giữ nguyên 28 action cũ. `details` cắt tối đa 500 ký tự chống flood.

---

## 7. Đính chính kỹ thuật đã kiểm chứng (2 bên cùng ghi nhận)

- **R1 — Rate-limit:** `checkRateLimit` (`auth-session.ts:116`) là bộ chống brute-force login (khóa 15 phút sau 5 lần sai), không phải limiter theo cửa sổ. Team A viết mới `checkWindowRateLimit` (in-memory sliding window), Team B không tự chế rate-limit trong LLM client.
- **R2 — Forecast test:** `scripts/test-forecast.ts:128-129` assert `computeEOQ(0)===0`, `computeEOQ(1.5)===158`. Giữ `@deprecated computeEOQ = computeReprintSuggestion` → suite PASS ngay, Team A thêm 1 assert cho tên mới.
- **R3 — Edge runtime:** `llm-client.ts` chỉ dùng native `fetch` + `AbortController` (mẫu `ai-order-parser.service.ts:69-75`), không `import https`/module Node. Zod tương thích Edge. `npm run pages:build` phải sạch.
- **R4 — Thuật ngữ:** cấm gọi kết quả là "EOQ". Tên chuẩn: "số lượng in đề xuất theo chính sách bù tồn 105 ngày (Lead 30 + Buffer 15 + Safety 60)".

---

## 8. File Ownership Matrix (một file một chủ)

| File | Chủ sở hữu | Việc |
|---|---|---|
| `src/services/forecast.service.ts` | Team B | Rename + alias deprecated + docstring 105 ngày |
| `package.json` | Team B | Thêm `zod` |
| `src/services/ai/llm-client.ts` | Team B | Client dùng chung (model từ env, timeout 6s, fallback 3 tầng, Zod parse). Model ID chốt ở Sprint 0 sau tra deprecation; thiếu env → báo cấu hình, không default model cũ |
| `src/services/ai/copilot-guardrails.ts` | Team B | System prompt 5 lớp, input/output validator |
| `scripts/eval-executive-ai.ts` | Team B | Red-team + đo chính xác số liệu, báo cáo JSON |
| `scripts/test-forecast.ts` | Team A | Thêm 1 assert tên mới |
| `src/services/ai-order-parser.service.ts` | Team A | Refactor dùng `llm-client.ts`, giữ contract cũ |
| `src/services/executive-query.service.ts` | Team A | 4 hàm query read-only typed cho Copilot |
| `src/lib/rbac-guard.ts` | Team A | Thêm 3 action Copilot (§6) |
| `src/lib/auth-session.ts` | Team A | Thêm `checkWindowRateLimit` (không sửa `checkRateLimit`) |
| `src/app/api/ai/copilot/route.ts` | Team A | Route mới: strict role + rate-limit + audit |
| `docs/PHASE5_LANE_CONTRACT.md` (file này) | Hai bên cùng ký | Không ai tự sửa |

---

## 9. Cổng nghiệm thu (mỗi patch)

1. Bằng chứng tái lập trên commit xác định + DB cách ly (`scripts/run-isolated.ts`), không ô nhiễm prod.
2. `lint` + `build` (+ `pages:build` cho file chạm Edge) sạch.
3. P2: snapshot `suggestedReprintQty` trước/sau giống hệt.
4. P3: JSON lệch schema bị chặn/warning không crash; model 404/timeout/429 đều fallback; hết confidence ghi cứng.
5. P1a+P4: 401/403 đúng; MANAGER=OWNER thấy như nhau; role khác bị chặn + audit; red-team PASS ngưỡng (100% từ chối trái phép; ≥95% số liệu khớp nguồn — ngưỡng cuối do chủ dự án duyệt).
6. Không đổi hành vi route cũ và số liệu forecast ngoài Copilot.

---

## 10. Việc ngoài code (có chủ, có hẹn — không chặn 5.2)

| Việc | Chủ | Hạn |
|---|---|---|
| Xác minh env production (`AUTH_STRICT`, `AUTH_SECRET`) bằng văn bản | Team A | Trước khi Copilot lên prod |
| Chốt model ID + ngân sách quota/tháng + circuit breaker hết quota | Team B (Sprint 0 của 5.2) | Trước khi mở Copilot cho user thật |
| Quy tắc redaction PII khách trong prompt | Hai bên | Trước 5.4 CRM |

---

*Ký duyệt: _______________ (Chủ dự án / trung gian) — Ngày: ___/___/______*
