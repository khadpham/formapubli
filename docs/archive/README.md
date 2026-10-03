# ARCHIVE — Tài liệu đã lỗi thời

Thư mục này chỉ để **tra cứu lịch sử**, **KHÔNG** phải nguồn ngữ cảnh cho công việc mới.

Chuyển vào đây ngày **03/10/2026** vì các tài liệu này mô tả trạng thái đã không còn đúng
với code: nêu sai hệ quản trị CSDL, sai tên bảng/sự kiện, sai số suite, hoặc trỏ tới
file/script **không còn tồn tại**.

| File | Vì sao lỗi thời |
|---|---|
| `2026-09-23-KICH_BAN_DIEN_TAP_GO_LIVE_HOI_CHO.md` | Luồng OTP / duyệt khẩn cấp và ngưỡng chiết khấu 12% **không còn trong hệ thống** |
| `2026-09-30-handoff-state.md` | Handoff mốc 30/09. **ĐÃ BỊ THAY** bằng các doc 01–02/10. Giữ vì chứa phân tích gốc rễ 40+ lỗi |
| `2026-09-28-handoff-open-work.md` | D1–D5 đã xong |
| `2026-09-28-handoff-pending-work.md` | P1–P10 phần lớn đã xong; battery "68/68" đã cũ |
| `2026-09-29-master-bug-summary.md` | Số suite ghi trong đây đã cũ |
| `2026-09-29-open-work-corrected-plan.md` | Tự mâu thuẫn: nhắc giữ `src/lib/manager-pin.ts` (file **không tồn tại**) rồi lại nói đã gỡ |
| `2026-09-29-plan-a-gaps-plan-b.md` | Snapshot 29/09 — tất cả gap đã có code + test |

## Đã XOÁ (không giữ)

| File | Vì sao xoá hẳn |
|---|---|
| `FORMAPUBLI_KNOWLEDGE_BASE.md` | Mô tả **PostgreSQL / Supabase / Neon**; repo thật là libSQL (Turso) + Drizzle. Tên sự kiện sổ kho sai hoàn toàn (`RECEIVE`/`SALE_FULFILL`/`STOCKTAKE_ADJUST` — thật là `RECEIPT`/`DISPATCH_SALE`/`DISPATCH_GIFT`/`RETURN_INBOUND`/`ADJUSTMENT`) |
| `PHASE0_CONTRACT.md`, `PHASE0_ACCEPTANCE_MATRIX.md` | Hợp đồng Phase 0, đã qua 36 migration |
| `PHASE5_LANE_CONTRACT.md`, `PHASE5_SPRINT0_AMENDMENT.md` | Đòi `npm run pages:build` — **script không tồn tại**; trỏ `ai-order-parser.service.ts` đã đổi tên |
| `CP3_EXECUTION_PLAN.md` | Ghi "32/36 suite"; toàn bộ task đã PASS |

## Nguồn sự thật hiện tại

- **Trạng thái + việc còn treo:** `docs/superpowers/plans/2026-10-02-trang-thai-toan-bo.md` (mục 10)
- **Bài học đã mắc:** cùng file, mục 10
- **Số suite thật:** đếm trong `scripts/run-isolated.ts` — **đừng đọc số trong docs**
- **HEAD hiện tại:** `git log --oneline -1`