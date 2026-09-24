# HANDOFF — Trạng thái toàn bộ dự án (cập nhật 25/09/2026 ~07:00, sau wave 2)

> Tài liệu này cho MỌI session mới (agent B tiếp theo, A, C, hoặc người) đọc
> đầu tiên để khôi phục ngữ cảnh. Đọc kèm: `docs/superpowers/plans/2026-09-24-pos-hardening-abc-master-plan.md`
> (kế hoạch gốc 11 bugs + S-01) và `git log`.

## 1. Vai trò & luật phối hợp (đang hiệu lực)

- **A — Giám sát/nghiệm thu**: chỉ review, không code.
- **B — server + tích hợp + deploy**: branch `agent/b-*`, merge, deploy, push
  refspec tường minh + verify `ls-remote`.
- **C — UI**: không checkout/đổi branch; bàn file cho B commit (đã xong toàn bộ).
- Luật sắt: reproduce-first; 1 file 1 chủ; suite DB chung chạy qua
  `run-isolated.ts` (tự dọn lease+buckets); không hạ assertion; không log PIN/secret.

## 2. Trạng thái production (đang chạy BETA)

- URL: **https://book.formaform.vn** (+ formapubli.phamkha9x.workers.dev).
- main = **`ab99d53`** (integrate/wave2) — deploy version **`ea44433f`**.
- Gồm TOÀN BỘ: #1 (A1-H + A1-F), #3, #9, #5, #10, #11, #3-UI, **#7, #8**,
  S-01, config fixes, docs. Migration 0022 đã áp Turso.
- **Rollout S-01 HOÀN TẤT (bước 2 đã bật 25/09 sáng)**: secret
  `SESSION_LEASE_ENFORCE=true` — enforce gate 9/9 PASS (login/lease/heartbeat/
  logout/đổi máy đều ổn). Ai giữ token cũ pre-lease sẽ bị guard đăng xuất đúng
  1 lần, đăng nhập lại là xong.
- Gate live 25/09 sáng: **20/20 PASS** (SSR, anon 401, login A 200, login B
  trùng 403 SESSION_ACTIVE_ELSEWHERE không cookie, máy A không văng,
  heartbeat 200, tạo yêu cầu duyệt, CANCEL→SUPERSEDED, CANCEL lần 2→409,
  cashier khác xem duyệt người khác→403, logout + login lại được,
  active_sessions Turso = 0 dòng sót).
- Một row duy nhất `GATE-W2-*` trạng thái SUPERSEDED còn lại trong DB prod — audit trail
  của lần test CANCEL, vô hại, không cần xóa.

### Deploy (thủ tục chuẩn)
```powershell
# Worktree sạch ở đúng commit main:
npm run deploy   # = opennextjs-cloudflare build && deploy
```
LƯU Ý SỰ CỐ ĐÃ XẢY RA: thiếu `[vars] NEXT_PRIVATE_MINIMAL_MODE="1"` →
500 toàn bộ ("Dynamic require of middleware-manifest.json"). KHÔNG deploy thiếu.

## 3. Worktrees (node_modules = junction về cây chính)

| Thư mục | Branch | Ghi chú |
|---|---|---|
| `D:\Data Project\formapubli` | `agent/c-login-ux` (`3351def`, đã merge) | cây chính; còn untracked `scripts/deploy-cloudflare.ts` (TOKEN PLAINTEXT — cấm commit, chờ user xóa+rotate) |
| `formapubli-deploy` | `integrate/wave2` (= main `ab99d53`) | nơi deploy + verify |
| `formapubli-b-af` | `agent/b-approval-full` (`2ab88f3`, đã merge) | — |
| `formapubli-b-session` | `agent/b-session` (`e3a9df2`, đã merge) | — |
| các worktree lanea/laneb/cp3/kilo/orca | branches khác | của các session/kế hoạch khác — KHÔNG đụng |

## 4. Branches chính (đã verify remote)

| Branch | SHA | Trạng thái |
|---|---|---|
| `main` | `ab99d53` | **ĐÃ DEPLOY** (ea44433f) — dùng được ngay |
| `integrate/wave2` | `ab99d53` | = main (2 merge commit: b-approval-full + c-login-ux) |
| `agent/b-approval-full` | `2ab88f3` | đã merge (A1-F server) |
| `agent/c-login-ux` | `3351def` | đã merge (toàn bộ UI #5/#7/#8/#9/#10/#11/#3 + A1-F UI) |
| `agent/b-order-approval-hotfix` | `f04a8b1` | đã merge (A1-H) |
| `agent/b-report-perms` | `2856d3d` | đã merge (#3) |
| `agent/b-session` | `e3a9df2` | đã merge (S-01) |

## 5. Còn lại (ai làm gì)

### ĐÃ SỬA + ĐÃ DEPLOY (25/09, main 5beb414, worker 9994dfb8)
- **#2 login/logout 2 lần** — 3 nguyên nhân, đều đã sửa:
  1. route login tạo `sessionId` mới mỗi lần bấm → tự chặn 403 chính mình;
     nay tái dùng `sessionId` của cookie hợp lệ (đúng spec S-01 §4.4.1).
  2. service worker trả **HTML cache cũ** (pre-login) sau reload → nay
     navigation luôn ưu tiên mạng, bỏ precache `/`, cache v2.
  3. `PwaRegister` gắn listener `load` trong useEffect nên thường không đăng ký
     SW (và bản cũ kéo dài mãi) → nay đăng ký ngay khi `readyState=complete`.
- **#4 "Kiểm tra tồn kho" luôn lỗi** — route trả `{success,data:{ok}}` nhưng UI
  đọc `data.ok` (undefined). Sửa cả validate và commit (mã phiếu `pckCode` cũng
  đang đọc sai chỗ nên hiện "PCK-SUCCESS" giả).
- **#6 CRUD** — kho: thêm `PATCH/DELETE /api/warehouses/[id]` (xóa chỉ khi kho
  rỗng & chưa có đơn/sổ kho, còn dữ liệu thì 409 kèm lý do + hướng dẫn "Ngưng
  hoạt động"); UI thêm nút Sửa / Ngưng / Bật / Xóa. Nhân sự: thêm nút Sửa tên +
  Đổi vai trò (API đã có sẵn, thiếu UI).
- **Gộp nút kho**: 5 nút rối → 2 nút có menu: **Xuất kho** (bán lẻ/quà tặng,
  cung ứng đối tác) và **Chuyển kho** (1 phiếu, hàng loạt, soạn kệ).
- Test mới `scripts/test-ux-crud-fixes.ts` 21/21; 17 suite cũ xanh; tsc+build
  xanh; gate live 11/11 (API) + 7/7 (Chrome thật: login 1 lần → vào app, logout
  1 lần → ra login).

### CHỜ USER
1. Xóa token `cfut_pE1...` ở Cloudflare dashboard (3 click) — token không còn được
   dùng, deploy chạy bằng wrangler OAuth.
2. Đổi PIN 8 nhân viên (đang mặc định, prod công khai).
3. Nghiệm thu thật iPhone (#2 đã sửa tận gốc, vẫn nên thử 1 lần trên máy bạn).
4. Nếu "Kiểm tra tồn kho" vẫn lỗi: báo câu báo lỗi + kho nguồn/đích + số dòng —
   sẽ tail log Worker để bắt stack thật.

### XONG HẾT PHẦN CODE — không còn WIP nào chưa commit
- #1 (A1-H verify-before-create + A1-F cancel/scoping), #3, #5, #7, #8, #9,
  #10, #11, #3-UI, S-01 + S-OFFLINE — code + test + UI + deploy ĐỀU XONG.
- A1-F API contract (cho tham khảo UI): `POST /api/pos/discount-approvals/[id]`
  body `{action:'CANCEL'}` → 200 SUPERSEDED; lần 2 → 409; cashier khác GET → 403.
  UI nút "Sửa giỏ và hủy phê duyệt" đã wiring API này trong PosCheckoutTerminal.

### CHỜ USER (không phải agent)
1. **Bước 2 rollout**: chọn thời điểm → bảo agent B chạy
   `"true" | npx wrangler secret put SESSION_LEASE_ENFORCE` (không cần deploy lại).
2. **Đổi PIN 8 staff** (đang mặc định: ADMIN-01=9999, QL-01=8888, NV-01/02=1234,
   NV-03=2345, NV-04=3456, KHO-01=5678, THUE-01=7890) — làm trực tiếp trên UI prod.
3. **Xóa token plaintext** trong `scripts/deploy-cloudflare.ts` (cây chính) +
   rotate token Cloudflare dashboard.
4. Nghiệm thu iPhone: #2 (login/logout Safari — desktop đã pass), scanner camera, voice.
5. Báo evidence nếu vẫn thấy: #4 (lỗi chuyển kho — cần message+role+payload),
   #6 (thao tác CRUD quản trị cụ thể nào kẹt — API đã 200 cho manager).

### Agent B (việc nhẹ, khi user gọi)
- Smoke G1-G10 trên head mới (đa số đã phủ qua suite); rà S09-S20 (đã phủ
  gián tiếp qua S21-S25); sau này có yêu cầu mới thì làm tiếp theo quy trình
  brainstorm → plan → subagent → TDD → verify như thường.

## 6. Gotchas kỹ thuật (đọc trước khi đụng code/infra)

1. `wrangler.toml` PHẢI giữ `[vars] NEXT_PRIVATE_MINIMAL_MODE = "1"`.
2. `next.config.mjs`: twin backslash `@libsql\\client` trong
   serverComponentsExternalPackages — fix Windows copy-workerd của OpenNext. CẤM XÓA.
3. Stack: Next 14.2.35 + @opennextjs/cloudflare 1.15.1 (bản mới hơn đòi
   Next ≥15.5) + Turso (không dùng D1).
4. Test: suite DB file riêng chạy trực tiếp; suite DB chung qua
   `npx tsx scripts/run-isolated.ts --only=...`. Quên dọn → đỏ oan
   (lease TTL 10', bucket 15'). Battery 18 suite hiện tại TOÀN XANH trên ab99d53.
5. Sự cố đã biết đã fix: Pages/next-on-pages chết (async_hooks);
   rollback an toàn: `npx wrangler versions list` + `npx wrangler rollback <id>`.
6. `createRequest` chiết khấu: giỏ giống hệp → dedup trả request cũ, KHÔNG
   supersede (phải đổi nội dung) — xem test D05c atomic.
