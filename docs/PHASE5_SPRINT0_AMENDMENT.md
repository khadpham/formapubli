# PHỤ LỤC SPRINT 0 (v1.1 DRAFT) — Chốt model, quota, giám sát Copilot

> **Trạng thái:** ĐÃ KÝ — có hiệu lực từ 17/09/2026. Không sửa `docs/PHASE5_LANE_CONTRACT.md` v1.0.

## A1. Model Gemini chính thức: `gemini-3.5-flash`

- Căn cứ tra cứu 09/2026: 1.5-flash chết 24/09/2025; 2.0-flash chết 01/06/2026; 2.5-flash retirement 20/10/2026 (đã 404 sớm).
- `gemini-3.5-flash`: stable, retirement ≥ 19/05/2027, hỗ trợ temperature + structured outputs, khớp `llm-client.ts` hiện tại.
- Env production: `GEMINI_MODEL=gemini-3.5-flash`.
- Ràng buộc tương lai: lên 3.6+ phải xóa `temperature` khỏi `generationConfig` trước (Google bỏ tham số này).

## A2. Ngân sách và ngắt mạch

| Tham số | Giá trị chốt | Env |
|---|---|---|
| Ngưỡng mở mạch | 5 lỗi liên tiếp | `LLM_MAX_CONSECUTIVE_FAILURES=5` (default code, không cần đặt) |
| Cooldown half-open trial | 60 giây | `LLM_CIRCUIT_COOLDOWN_MS=60000` (default code, không cần đặt) |
| Ngân sách tháng | 5000 lượt gọi | `LLM_MONTHLY_CALL_BUDGET=5000` (**Team A đặt ở production**) |
| Rate-limit user | 15 req/phút/staffId | Đã có ở route (P1a) |

Vượt budget hoặc mở mạch → rơi về fallback nội bộ, không crash, không đốt thêm quota.

## A3. Giám sát sau mở user thật

- `getLlmHealth()` đã có trong `llm-client.ts` (trạng thái mạch 2 engine + đếm budget). Team A gắn vào endpoint monitoring nội bộ khi có nhu cầu (ngoài phạm vi phụ lục này).
- Hạch toán quota chuẩn theo tháng (ledger DB) hoãn sang đợt sau, cần migration — Team A chủ trì khi tới hạn.

## A4. Điều kiện mở Copilot cho user thật (checklist cuối)

- [ ] 2 bên ký phụ lục này.
- [ ] Production đặt đủ 4 env: `AUTH_STRICT=true`, `AUTH_SECRET` (thật, ≥32 ký tự), `GEMINI_MODEL=gemini-3.5-flash`, `LLM_MONTHLY_CALL_BUDGET=5000`.
- [ ] P1b nghiệm thu đạt (37+ suites PASS, prod DB nguyên vẹn).

---

*Đã ký: Chủ dự án (Ban Điều Phối) — Ngày 17/09/2026. Team A vắng mặt, Team B (tác giả) thi hành. Phụ lục này được phê chuẩn thay cho chữ ký tay theo lệnh trực tiếp của Chủ dự án.*
