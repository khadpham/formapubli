# HANDOFF — Trạng thái toàn bộ dự án (cập nhật 29/09/2026, sau đợt sửa lỗi ngày + POS)

> Tài liệu này cho MỌI session mới (agent B tiếp theo, A, C, hoặc người) đọc
> đầu tiên để khôi phục ngữ cảnh. Đọc kèm: `docs/superpowers/plans/2026-09-24-pos-hardening-abc-master-plan.md`
> (kế hoạch gốc 11 bugs + S-01) và `git log`.
>
> **MỐC 29/09 — sửa xong đợt lớn:** quét toàn bộ lỗi "ngày nghiệp vụ VN so với
> mốc UTC" (11 lỗi) + 12 lỗi POS (tiền thật và hiển thị). Xem mục 7 ở cuối tài
> liệu. Nếu bạn đọc mục 2 và thấy commit cũ, đây là nguyên nhân.

## 1. Vai trò & luật phối hợp (đang hiệu lực)

- **A — Giám sát/nghiệm thu**: chỉ review, không code.
- **B — server + tích hợp + deploy**: branch `agent/b-*`, merge, deploy, push
  refspec tường minh + verify `ls-remote`.
- **C — UI**: không checkout/đổi branch; bàn file cho B commit (đã xong toàn bộ).
- Luật sắt: reproduce-first; 1 file 1 chủ; suite DB chung chạy qua
  `run-isolated.ts` (tự dọn lease+buckets); không hạ assertion; không log PIN/secret.

## 2. Trạng thái production (đang chạy BETA)

- URL: **https://book.formaform.vn** (+ formapubli.phamkha9x.workers.dev).
- main = **`9355dc0`**, deploy version **`54deb7cf`**, **90/90 suite xanh** (`EXIT=0`).
- Migration đã áp tay lên Turso: **`0027`** (trigger chặn tồn kho âm khi UPDATE),
  **`0028`** (bảng `daily_order_counters` cho mã đơn 13 ký tự),
  **`0029`** (trigger chặn tồn kho âm khi INSERT — 0027 chỉ chặn UPDATE).
  Nhớ: `npm run deploy` **KHÔNG** chạy migration và app không tự migrate lúc khởi
  động — migration phải áp tay, và **ÁP TRƯỚC** khi deploy nếu code cần nó.
- **Còn lại từ đợt trước**: S-01 rollout đã bật, gate 20/20 PASS, 1 row
  `GATE-W2-*` SUPERSEDED còn trong DB prod (audit trail, vô hại).
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

### ĐÃ SỬA + ĐÃ DEPLOY (25/09, main e8e67b8, worker 97ca60cc)
- **Ma trận kho ĐỘNG** (bạn báo "mới đổi text, code chính chưa đổi" — đúng):
  `InventoryService.getStockMatrix` trước chỉ đếm 3 mã kho cứng nên **kho hội chợ không
  bao giờ có số liệu**. Nay trả `stockByWarehouse` (map theo warehouseId) và UI dựng
  tab từ danh sách kho thật — mở kho mới là tự hiện, không sửa code nữa.
- **Gán kho CÓ ràng buộc thật**: login + `/api/auth/me` trả `assignedWarehouseId`;
  POS mở đúng kho và **khóa** (thay dropdown bằng nhãn "Kho được gán"); **server chặn
  403** khi nhân viên cố xuất hàng từ kho khác (đã verify trên prod).
- **Modal di động**: header "Báo Cáo Chốt Ngày" xuống dòng trên mobile (trước bị ép từng
  chữ), tab strip cuộn ngang gọn thay vì tràn khung.
- **Nút Soạn kệ** chuyển lên Bảng điều khiển kho (trước nằm cuối thanh cuộn ngang,
  không thấy trên điện thoại).
- Bỏ text tiếng Anh còn sót: "Executive View" → "Tổng quan điều hành", "Reset PIN" → "Đổi PIN".
- API kho trả `stockQuantity` tổng tồn thật + nhãn loại kho (Hội chợ / Cố định) trong modal.
- **Kho hội chợ — quản lý đầy đủ** (migration 0023, đã áp Turso prod):
  - `warehouses.qr_transfer_template`: **mẫu nội dung chuyển khoản QR riêng theo từng kho**,
    hỗ trợ biến `{SL}` tổng số lượng · `{MA}` mã đơn · `{KHO}` tên kho · `{KH}` mã kho.
    Sửa ở Quản Lý Kho (có xem trước). Áp dụng tại `VietQrPay` khi dựng QR.
  - `staff_accounts.assigned_warehouse_id`: **gán nhân viên phụ trách kho** (thu ngân hội chợ),
    chọn được ngay trong bảng Nhật sự. API chặn gán kho không tồn tại/đã ngưng.
- **UI kho**: bảng điều khiển QUẢN LÝ KHO đầu tab (Mở kho mới · Quản lý kho & gán nhân sự),
  nhãn "Ma trận N kho" tự đếm, 4 nút hành động nằm **một hàng** (không xuống dòng).
- **Sửa 500 khi xóa kho**: kho đã bán hết còn dòng tồn = 0 làm khóa ngoại chặn xóa → nay dọn
  dòng rỗng trước khi xóa. Có test chặn lại (24/24).
- **Nhật ký hoạt động**: `/api/activity-log` + tab Cài đặt → Nhật Ký Hoạt Động (sổ cái lịch trình,
  lưu lâu trong DB). Đã thêm ghi nhận cho thao tác **mở kho**.
- **Chuông thông báo 5s** hai chiều tại `/api/notifications` (quản lý thấy hết; thu ngân thấy
  việc của mình; người ngoài cuộc không thấy gì).
- **#4 "Chuyển hàng loạt" 500 "Lỗi hệ thống"** — nguyên nhân thật do `wrangler tail`
  bắt được: `Too many subrequests by single Worker invocation` (trần 50 subrequest
  của Workers free plan). `checkBatchAvailability` gọi 1 query ATP/cuốn, và
  `transferBatch` gọi `recordMovement` 2×/dòng (~5 query mỗi lần) = 10 query/dòng.
  Đã sửa cả hai: `OrderService.getBatchATP` (2 query cố định) + ghi gom lô trong
  `transferBatch` (4 query: đảm bảo bucket, insert ledger 2N dòng 1 lệnh, trừ tồn
  nguồn bằng CASE + chặn âm + kiểm `rowsAffected`, cộng tồn đích bằng CASE).
  **Giữ nguyên**: transaction, chặn xuất âm, idempotency, rollback, ledger 2N dòng.
  Verify: test 16/16, 8 suite hồi quy xanh, **live prod 5/5** (commit 200, mã phiếu
  thật `PCK-...`, hoàn tác dọn dẹp thành công).
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

### CHỜ USER (không phải agent) — cập nhật 29/09
1. **PIN đã GỠ khỏi sản phẩm** (hai cổng: backdate >7 ngày và trả hàng quá hạn).
   Backdate nay kiểm theo VAI TRÒ (CASHIER bị 403, Quản lý/Owner được). Không
   còn `src/lib/manager-pin.ts`. Nên các việc "đổi PIN" trong tài liệu cũ **không
   còn ý nghĩa** — đừng làm.
2. **Xóa token plaintext** trong `scripts/deploy-cloudflare.ts` + rotate token
   Cloudflare dashboard. (Việc này CHƯA làm.)
3. Nghiệm thu iPhone: login/logout Safari, camera quét, chuyển khoản, tải ảnh.
4. Báo evidence nếu vẫn thấy: #4 (lỗi chuyển kho — cần message+role+payload),
   #6 (thao tác CRUD quản trị cụ thể nào kẹt — API đã 200 cho manager).
5. Môi trường: hệ thống **chưa vận hành thật**. DB dev đã dọn còn 3 đơn hợp lệ
   (xoá 74 đơn `COMPLETED` trỏ tới tài khoản thu ngân không tồn tại — backup ở
   `%TEMP%\opencode\orphan-orders-DEV-*.json`). **Production thì sạch**: 8 tài
   khoản, 19 đơn, 0 đơn mồ côi.

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
   (lease TTL 10', bucket 15'). Battery hiện tại **87 suite, TOÀN XANH** trên `0326e73`.
   `run-isolated.ts` giờ **mặc định chạy HẾT chuỗi rồi mới tổng kết** (trước dừng
   ngay ở suite lỗi đầu tiên, làm mất thông tin về các suite phía sau);
   dùng `--stop-first` khi thật sự cần dừng sớm.
5. Sự cố đã biết đã fix: Pages/next-on-pages chết (async_hooks);
   rollback an toàn: `npx wrangler versions list` + `npx wrangler rollback <id>`.
6. `createRequest` chiết khấu: giỏ giống hệp → dedup trả request cũ, KHÔNG
   supersede (phải đổi nội dung) — xem test D05c atomic.
7. **NGÀY NGHIỆP VỤ VIỆT NAM vs MỐC UTC — lớp lỗi lớn nhất của repo.**
   Mọi cột thời gian đều là **UTC** (app ghi `toISOString()`, SQLite mặc định
   `CURRENT_TIMESTAMP` cũng UTC), còn ngày nghiệp vụ là ngày VN (UTC+7, không DST).
   Lọc ngày sai kiểu này dễ sót tiền. Cách đúng, dùng khắp nơi:
   ```sql
   substr(datetime(<col>, '+7 hours'), 1, 10)   -- so với ngày trần YYYY-MM-DD
   ```
   `datetime()` của SQLite nhận được **cả hai** họ timestamp đang cùng tồn tại
   (`'YYYY-MM-DD HH:mm:ss'` và ISO `'YYYY-MM-DDTHH:mm:ssZ'`) — đó là lý do dùng
   `datetime()` chứ không so chuỗi. Helper JS: `businessDateOf(new Date())`,
   `cutoffInstantOf(date, 'HH:MM')` trong `src/services/order.service.ts`.
   **CẤM** `substr(col,1,10)`, `col LIKE 'YYYY-MM-DD%'`, và so chuỗi trần để lọc
   ngày nghiệp vụ.
8. **Agent CLI chạy headless được từ terminal** (dùng để làm nhiều việc song
   song, mỗi agent một worktree riêng để không giẫm lên nhau):
   ```powershell
   kilo run --format json "<việc>"       # JSON có cấu trúc, ~5s
   kilo run --session <id> "<việc>"      # TIẾP TỤC session cũ, không tạo lại
   cline --json "<việc>" -c <thư mục>    # có -p (plan mode)
   ```
   Subagent tích hợp (`task`) cũng tái dùng được qua `task_id`. Orca
   `worker-start` **không** hỗ trợ agent id `kilo`/`cline` — đừng thử.
   Kinh nghiệm đợt 29/09: 4 agent `kilo` sửa song song 9 lỗi POS, mỗi agent đều
   tự xác minh trước khi sửa và để lại test chạy được (112 assertion mới).
   Một agent từ chối sửa file ngoài phạm vi được giao và giao lại đoạn sửa — đúng
   cách, giữ được ranh giới 1 file 1 chủ.
9. **`eval-executive-ai-report.json` đã bỏ track** (file sinh tự động, mỗi lần
   chạy eval là đổi → nhiễu diff và làm bẩn cây, phá quy tắc "chỉ deploy khi cây
   sạch"). File vẫn còn trên đĩa. `reports/` cũng đã vào `.gitignore`.
10. **Migration: `when` phải tăng nghiêm ngặt.** Drizzle bỏ qua lặng lẽ entry có
    `when` nhỏ hơn bản ghi cuối. Migration mới phải lấy `when` CAO HƠN entry
    trước, và chỉ cần `.sql` + entry trong `meta/_journal.json` (snapshot đã dừng
    ở `0014`; từ `0015` trở đi không có snapshot — giữ đúng quy ước đó). Entry
    mới nhất hiện là `0029` (`when = 1790600005000`).
    `migrate-fresh.ts` tách file theo đúng chuỗi `-->` + `statement-breakpoint`
    rồi `execute()` **từng khối một lần**: trigger `BEGIN...END` phải nằm trong
    MỘT khối, và **không được viết nguyên văn chuỗi tách câu đó trong comment**
    (đã dính lần: comment của chính tôi cắt đôi `CREATE TRIGGER`).
    `migrateFresh` **không idempotent** (migration `0000` dùng `CREATE TABLE` trần)
    nên đừng chạy lại toàn bộ để kiểm `IF NOT EXISTS` — chạy riêng câu lệnh.
    **Migration đã áp lên production thì KHÔNG được sửa file đó** — phải thêm
    migration mới. Đã dính lần: tôi sửa `0027` để thêm trigger `BEFORE INSERT`,
    phải hoàn nguyên và tạo `0029` thay thế.
11. ⚠️ **FALSE-GREEN TEST — loại nguy hiểm nhất, đã dính một lần.**
    `test-order-code-13.ts` ban đầu chỉ **lặp lại logic cấp số bằng SQL thuần**,
    không gọi hàm thật. Test XANH, đã commit, đã deploy, đã tạo bảng trên
    production — trong khi **POS vẫn gửi `orderCode` tự sinh lên server**, nên
    `params.orderCode` luôn có giá trị ⇒ bộ đếm **không bao giờ chạy** ⇒ tính năng
    là code chết và mục tiêu của user chưa bao giờ đạt tới. Chỉ khi chạy 2 subagent
    review độc lập mới phát hiện ra.
    Nguyên tắc: **test phải đi qua đúng ranh giới mà hành vi nằm ở đó.** "Client có
    gửi mã lên không" là hành vi ở ranh giới client↔server, thì phải kiểm ở đó,
    không kiểm lại logic SQL. Và khi nghi ngờ, **chạy thật trên production rồi đọc
    lại dữ liệu**, đừng tin dòng "thành công" mà script in ra. Mẫu chống lỗi này
    đã thêm vào chính file test đó.
12. **Script ghi production phải có chốt.** Nhiều script trong `scripts/` đọc
    thẳng `TURSO_*` từ `.env` nên chạy là ghi production. Có
    `scripts/prod-write-guard.ts` → `requireProdWriteConsent()`, bắt buộc
    `ALLOW_PROD_WRITE=true`. Cùng quy ước với `ALLOW_REMOTE_MIGRATE` và
    `ALLOW_REMOTE_SKU_MIGRATION`. **Script ghi DB mới phải gọi hàm này ở đầu.**

## 7. Đợt sửa 29/09 — đã xong, không cần làm lại

### A. Lớp lỗi ngày nghiệp vụ (11 lỗi, tìm bằng subagent quét toàn repo)
- `closeDay` dùng `like()` ⇒ **có thể chốt ngày khi còn đơn PENDING_CONFIRMATION
  lúc 00:00–07:00 VN** (đơn nằm ở ngày UTC hôm trước nên vô hình). Nguy hiểm nhất.
- `printedInTerm` / `royaltyStatement` so chuỗi với cận `'${expirationDate} 2'`:
  `'2026-12-31 23:59:59' <= '2026-12-31 2'` là **FALSE** ⇒ mất 22 giờ cuối ngày
  hết hạn, dòng ISO bị loại hẳn cả ngày ⇒ **tiền tác giả bị trễu**.
- Cron `auto-close` quyết định *ngày nào phải chốt* cũng lệch 7 giờ ⇒ có thể
  **bỏ sót một ngày thật sự có đơn**.
- Live-monitor, Sổ Doanh Số (nút "HÔM NAY"), `soldToday`, bảng tổng hợp tháng,
  "tuần này" (lệch theo giờ máy chủ ⇒ dev GMT+7 vs prod UTC cho kết quả khác nhau),
  `paidAt`, số phiếu thu, copilot `query_cashbox_reconciliation(date)`, bộ đếm cron.
- Lưu ý khi sửa: **test cũ có thể đang bảo vệ chính lỗi này** (vd `test-monthly-digest`
  đòi `startDate.startsWith('2026-02-01')` = UTC thuần). Phải sửa test theo hành vi
  đúng, không hạ assertion để xanh.

### B. 12 lỗi POS (4 agent kilo sửa song song + 4 lỗi tự xác minh)
Tiền thật:
1. Chốt ca lỗi làm POS tự kệ két ⇒ đơn tiền mặt ghi `cashboxSessionId = null` ⇒
   báo cáo két **bỏ sót chính đơn đó**.
2. Sau F5, `resetPostCheckoutState` nằm trong `handleCheckout` nên ref còn `null`
   ⇒ đơn kế gửi trùng `idempotencyKey` ⇒ server trả về **đơn cũ** (khách nhận
   sách 2 lần).
3. Ô "Tiền thực đếm" **điền sẵn `expectedCash`** ⇒ chênh lệch **luôn 0 đ**, vô hiệu
   hoá kiểm soát tiền mặt.
4. `VietQrPay` fallback cache 24h khi danh sách tài khoản RỖNG ⇒ mã hoá **tài
   khoản đã đóng** vào QR.
5. Biên bản bàn giao kế toán **ghi nhầm ngày** (race + `selectedDate` thay vì
   `data.reportDate`).
6. Ảnh chứng minh bị ghi đè cho đơn đã trả tiền (watchdog không huỷ promise ghi).
Hiển thị / thường:
7. Mã duyệt 4 số trùng ⇒ quản lý duyệt nhầm đơn của thu ngân khác.
8. Quét ISBN-13 lạ trùng 4 số cuối ⇒ thêm nhầm ấn bản, trừ sai kho, tính sai giá.
9. Phiếu thu thiếu dòng sách sau F5 (items lấy từ giỏ sống, tổng tiền từ phiên).
10. `SmartOrderParser` báo "Đã tạo đơn" và **xoá sạch form** dù giỏ không đổi
    (cha chỉ `return` ⇒ promise luôn resolve; đã đổi sang `throw`).
11. Nội dung chuyển khoản lưu bản thô còn QR mã hoá bản chuẩn hoá ⇒ đối soát hỏng.
12. Nút "Tải ảnh xuống" ra share sheet; ô busy dùng chung làm mất trạng thái thẻ.

### C. Việc dọn khác
- Gỡ **191 dòng code chết** trong `DiscountApprovalModal` (nhánh QR/OTP không bao
  giờ render: endpoint chỉ nhận `ROLE_CASHIER`). Hai test trỏ vào đó phải sửa
  **trước** khi xoá.
- Sửa ô tìm sách "Chuyển Hàng Loạt": dropdown gần như không bao giờ mở (chỗ mở
  duy nhất bị chặn bởi chính điều kiện "đã có kết quả"), và bộ lọc chỉ khớp khi
  gõ **đúng dấu**. Nay dùng `matchesAnyVietnameseField`.
- Tên thu ngân trong modal mở két: in ra chuỗi vai trò giả + tên kho. Nay chỉ hiện
  `fullName` từ `/api/auth/me` (POS **đã** gọi endpoint này, chỉ bị bỏ qua).

### D. Rà soát toàn bằng 2 subagent review (29/09, sau khi deploy mã đơn)

Chạy 2 review **độc lập** bằng `kilo run` (một agent soi commit mới, một agent soi
hệ thống rộng). Cả hai đều tự xác minh bằng cách chạy thử, không tin lời khai.

**Lỗi nghiêm trọng nhất — mã đơn 13 ký tự chưa bao giờ chạy trên POS.**
POS gửi `orderCode` tự sinh lên server, mà server dùng
`params.orderCode || allocateOrderCode(...)` ⇒ bộ đếm không bao giờ chạy. Đã
loại `orderCode` khỏi body POST đơn online (đường offline giữ nguyên vì đơn
offline phải có mã ngay). Chi tiết về false-green test ở gotcha số 11.

Đã sửa thêm:
- `createOrder` trả `cashierId` ⇒ phiếu in không còn mất dòng "Thu ngân" khi
  `/api/auth/me` chậm.
- Mẫu khách "Khách lẻ" đi qua `handleRequestDiscount` (trước gọi thẳng
  `setDiscountRate` ⇒ bypass chốt duyệt ⇒ 409 không bán được), `disabled` khi
  giỏ đang chờ duyệt.
- Bấm "Sách đặc biệt" thì xoá từ khoá đang gõ (trước ghép AND ⇒ "Danh mục (0)").
- CSS in biên bản: `display: none` cho nhánh không chứa biên bản, thay cho quy
  tắc cũ chỉ nới `overflow/max-height` mà **không gỡ khỏi luồng** ⇒ sinh hàng
  chục trang trắng phía sau.
- Trigger `BEFORE INSERT` cho tồn kho âm (migration `0029`, đã áp + thử chèn
  số âm trên Turso để chứng minh bị chặn).
- Phiếu in: kho lạ không còn bị in nhầm thành "Kho Âu Cơ"; còn sót
  "Khách vãng lai" đã đổi.

### E. Dữ liệu production (giai đoạn dựng bộ sách — số liệu sẽ còn đổi)

Theo yêu cầu user: **mã SKU và số lượng tồn SẼ CÒN THAY ĐỔI NHIỀU LẦN NỮA.**
Đừng xem số liệu hiện tại là dữ liệu thật.

- 88 ấn bản; `H85` "Đốt kho" **đã khoá** (`is_active = 0`) vì ISBN sai 14 số;
  dùng `TP104` "Đốt kho" bản đúng thay thế. `pos-catalog.service.ts` có
  `if (e.isActive === false) continue` nên khoá là thật, POS không hiện.
- Mỗi đầu sách **1000 cuốn ở mỗi kho** (87 cuốn còn hoạt động × 5 kho = 435.000).
- Mã cũ `H01`–`H81` đã đổi thành `HH001`/`TP0004`/…; 7 sách mới là `H82`–`H88`.
- 4 ISBN có dấu gạch đã bỏ dấu (quét mã vạch trước đó KHÔNG khớp được).
- `editions.id` giữ nguyên khi đổi mã ⇒ lịch sử đơn không đứt liên kết.

**Bài học từ việc đổi mã**: test phải tra mã hiện hành từ CSDL, không hardcode
`H01` — nếu không lần sau đổi mã là vỡ tiếp. Và `setup-test-db.ts` có một case
đặc biệt (`HH032`/`HH042` chung tác phẩm) mà chính người đổi mã đã bỏ sót.

### F. Việc còn lại / cần kiểm bằng tay
- `scripts/browser-pos-terminal-test.tsx` **Test 12 đã viết lại nhưng chưa chạy
  được** (nằm ngoài `run-isolated` và ngoài `package.json`). Cần chạy tay.
- Chưa nghiệm thu thật trên iPhone: POS luồng chuyển khoản, tải ảnh, camera quét,
  chốt ca. Hệ thống **chưa vận hành thật** nên chưa có dữ liệu thật để đối chiếu.
- Biểu đồ `ExecutiveDashboard` gom nhóm theo ngày UTC (lệch nhãn cột cuối, không mất
  dòng) — biết nhưng **chưa sửa** vì chưa tự kiểm chứng.
- **`H85` cần ISBN 13 số thật** nếu muốn mở lại; hiện đã khoá, dùng `TP104`.
- `npm run build` có lúc báo lỗi TypeScript mà `npx tsc --noEmit` đã báo sạch
  (script tôi viết sai cách gọi `execute`). **Luôn chạy `npm run build` trước khi
  deploy**, không chỉ dựa vào `tsc`.
