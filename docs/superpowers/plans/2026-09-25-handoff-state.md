# HANDOFF — Trạng thái toàn bộ dự án (cập nhật 25/09/2026 ~04:00)

> Tài liệu này cho MỌI session mới (agent B tiếp theo, A, C, hoặc người) đọc
> đầu tiên để khôi phục ngữ cảnh. Đọc kèm: `docs/superpowers/plans/2026-09-24-pos-hardening-abc-master-plan.md`
> (kế hoạch gốc 11 bugs + S-01) và `git log`.

## 1. Vai trò & luật phối hợp (đang hiệu lực)

- **A — Giám sát/nghiệm thu**: chỉ review, không code. Mọi merge qua A.
- **B (tôi) — server + tích hợp**: branch `agent/b-*`, worktree riêng, merge
  integration, deploy. Là người duy nhất chạy git branch/push (refspec tường
  minh + verify `ls-remote` sau push).
- **C — UI**: KHÔNG checkout/đổi branch. Sửa file trong cây chính, chạy tsc +
  test, bàn giao cho B commit/push. File mới phải báo ngay để B commit.
- Luật sắt: reproduce-first; 1 file 1 chủ; suite DB riêng chạy song song được,
  suite dùng chung `formapubli_test.db` chạy qua `run-isolated.ts` (nó tự dọn
  lease + buckets giữa các suite); không hạ assertion để xanh; không log PIN/secret.

## 2. Trạng thái production (đang chạy BETA)

- URL: **https://book.formaform.vn** (Worker `formapubli` + route DNS riêng).
- main = `f344aae` — deploy version `69447bb3` (build từ config đã commit).
- Migration Turso: đủ 23 entries (0022 `active_sessions` đã áp lên Turso).
- **Rollout S-01 đang ở BƯỚC 1**: secret `SESSION_LEASE_ENFORCE=false`
  (guard chưa chặn token cũ; login trùng thiết bị ĐÃ chặn — đúng yêu cầu
  "giữ máy cũ, chặn máy mới", đã verify live).
- BƯỚC 2 (còn lại): set `SESSION_LEASE_ENFORCE=true` (hoặc xóa) → người giữ
  token cũ đăng nhập lại đúng 1 lần. Chờ user chọn thời điểm (đêm/không ai
  bán là đẹp nhất). Lệnh: `"true" | npx wrangler secret put SESSION_LEASE_ENFORCE`.

### Deploy (thủ tục đã chạy đúng)
```powershell
# Trong worktree sạch ở đúng commit main:
npx opennextjs-cloudflare build   # hoặc giữ .open-next cũ, chỉ cần wrangler deploy
npx wrangler deploy               # wrangler.toml đã có [vars] NEXT_PRIVATE_MINIMAL_MODE="1"
```
LƯU Ý SỰ CỐ ĐÃ XẢY RA (25/09 rạng sáng): thiếu `NEXT_PRIVATE_MINIMAL_MODE=1`
→ mọi function 500 "Dynamic require of middleware-manifest.json" → đã
rollback + fix + commit `f344aae`. KHÔNG BAO GIỜ deploy thiếu var này.

## 3. Cấu trúc thư mục làm việc (worktrees)

| Thư mục | Branch | Nội dung |
|---|---|---|
| `D:\Data Project\formapubli` | `agent/c-login-ux` (cây chính của C) | UI của C; chứa WIP `src/db/index.ts` của session cũ — CẮM ĐỤNG, CẦN HỎI CHỦ |
| `formapubli-b-session` | `agent/b-session` (`e3a9df2`) | S-01 đã merge vào main |
| `formapubli-b-af` | `agent/b-approval-full` (`2ab88f3`) | A1-F vừa xong, CHỜ A REVIEW |
| `formapubli-integrate` | `integrate/wave1-s01` (đã merge vào main) | worktree ghép cũ |
| `formapubli-deploy` | detached = main `f344aae` | nơi deploy |
| `formapubli-basecheck` | 4a50a2b | worktree chuẩn đoán lỗi, có thể xóa |

Tất cả worktree share `node_modules` qua junction tới cây chính.

## 4. Branches & SHA (đều đã verify remote)

| Branch | SHA | Trạng thái |
|---|---|---|
| `main` | `f344aae` | đã deploy (69447bb3), gồm: #1-hotfix + #3 + #9 + #5 + #10 + S-01 + config fixes |
| `agent/b-approval-full` | `2ab88f3` | **A1-F: cancel API + scoping + D-matrix — CHỜ A NGHIỆM THU, chưa merge** |
| `agent/c-login-ux` | `2e57fc0` | toàn bộ UI của C (#9/#5/#10/#11/#3-UI + tests + manual) — CHỜ A merge vào main sau khi duyệt A1-F |
| `agent/b-order-approval-hotfix` | `f04a8b1` | đã merge vào main |
| `agent/b-report-perms` | `2856d3d` | đã merge vào main |
| `agent/b-session` | `e3a9df2` | đã merge vào main |

## 5. Các hạng mục — ai còn gì

### XONG (verified)
- #1 A1-H: verify-before-create (kể cả line-discount), consume atomic trong
  tx, replay idempotent (D01-D09, D07b, DP1a).
- #1 A1-F (branch `2ab88f3`, chờ review): CANCEL API (SUPERSEDED có điều
  kiện), cashier chỉ xem/hủy duyệt của mình, list lọc theo cashier, bộ test
  D01/D03/D04/D05/D08/D10/D11 + A1.7 + CANCEL flow.
- #3: daily-settlement chỉ Owner/Manager + test ma trận P1-P6.
- #9, #5, #10-CTA, #11, #3-UI: C đã xong (smoke + real component test + manual).
- S-01: lease 1 phiên cashier (giữ máy cũ, chặn máy mới), heartbeat, force-release,
  offline gate fail-closed, flag rollout, PIN-reset xóa lease. Tests S01-S08+S21-S25.
- Go-live: OpenNext Workers + domain riêng + migration + tồn đầu kỳ Turso
  (243 balances, 1000/ấn bản/kho) + secrets 15 biến.

### CÒN (chưa làm)
1. **B**: merge `agent/b-approval-full` sau khi A duyệt (rebase không cần —
   base là main hiện tại, merge sạch sẽ).
2. **C** (giao qua user/A): #7 nút Thanh toán nổi mở sheet (không scroll);
   #8 gộp "Chuyển khoản / QR" (giữ enum cũ + offline + "Đã nhận tiền" =
   xác nhận tay); UI freeze giỏ khi pending/approved + nút "Sửa giỏ và hủy
   phê duyệt" gọi API CANCEL (contract: POST /api/pos/discount-approvals/[id]
   body {action:'CANCEL'} — xem scripts/test-discount-checkout-atomic.ts case
   A1.7); drawer manager hiện `cartSnapshot` (GET [id] đã trả đủ).
3. **B (sau)**: S09-S20 còn thiếu (đa số đã phủ gián tiếp qua S21-S25);
   smoke G1-G10 trên head ghép cuối; deploy bản C sau merge.
4. **User chốt**: thời điểm bật SESSION_LEASE_ENFORCE=true; đổi PIN 8 staff
   (đang mặc định); xóa token plaintext trong `scripts/deploy-cloudflare.ts`
   + rotate token Cloudflare; nghiệm thu iPhone (scanner/POS/voice).
5. **Parked (chờ evidence)**: #2 login/logout 2 lần (desktop đã pass, cần
   retest iPhone Safari); #4 chuyển kho lỗi trên prod (cần message+role+payload
   thật); #6 CRUD quản trị kẹt thao tác nào cụ thể (API đã 200 cho manager).

## 6. Gotchas kỹ thuật (đọc trước khi đụng code/infra)

1. `wrangler.toml` PHẢI giữ `[vars] NEXT_PRIVATE_MINIMAL_MODE = "1"`.
2. `next.config.mjs`: twin backslash `@libsql\\client` trong
   serverComponentsExternalPackages — fix bug Windows copy-workerd của
   OpenNext. CẤM XÓA.
3. Stack chính: Next 14.2.35 + @opennextjs/cloudflare 1.15.1 (bản mới nhất đòi
   Next ≥15.5) + Turso (không dùng D1 binding).
4. Test: suite tự dựng DB riêng (atomic/perms/concurrent-session/S1-S4...) chạy
   trực tiếp được; suite dùng `formapubli_test.db` chung → qua runner
   `npx tsx scripts/run-isolated.ts --only=...` (tự dọn buckets + leases).
   Quên dọn → đỏ oan (leases TTL 10 phút, buckets 15 phút).
5. Session S-01: login cashier luôn claim lease (kể cả khi flag tắt); guard +
   B0c (trong tx createOrder) theo flag; token legacy không sessionId được
   grace tới hết hạn 12h.
6. Sự cố đã biết đã fix: Pages/next-on-pages chết (async_hooks), rollback
   an toàn qua `npx wrangler versions list` + `wrangler rollback <id>`.
