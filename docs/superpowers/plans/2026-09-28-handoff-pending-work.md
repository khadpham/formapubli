# BÀN GIAO — công việc tồn đọng (28/09/2026, sau deploy 8a1f2fb)

> Dành cho agent tiếp theo. Đọc `docs/superpowers/plans/2026-09-28-master-bug-summary.md`
> để có bối cảnh 7 lỗi đã sửa. File này **chỉ liệt kê việc CHƯA xong**.

## 0. Trạng thái repo lúc bàn giao

- `main` = **`8a1f2fb`**, đã deploy, worker `dcce8286`, đang chạy prod.
- **CÓ 2 FILE ĐANG SỬA DỞ, CHƯA COMMIT** — đây là việc đã làm xong nhưng chưa lên prod:

| File | Nội dung | Trạng thái |
|---|---|---|
| `src/components/layout/MasterAppShell.tsx` | 5 lỗi D1–D5 (bên dưới) | **XONG, đã verify** |
| `scripts/smoke-mobile-role-navigation.ts` | 13 assert chặn hồi quy cho D1–D4 | **XONG, đã verify** |

Agent đã chạy: `tsc` 0 lỗi · `smoke-mobile-role-navigation` xanh · battery **68/68 xanh** (run 2; run 1 dính crash flaky).
→ **Việc đầu tiên: commit 2 file này rồi deploy.** Không cần sửa thêm.

Các file dirty còn lại (`reports/wave3-pos-ui/*.png`, `eval-executive-ai-report.json`,
`docs/superpowers/plans/2026-09-25-agent-a-review-verdict.md`, `wave3-c3-manual-report.md`)
**thuộc session khác, KHÔNG commit.**

## 1. Việc tồn đọng — xếp theo mức gấp

### ƯU TIÊT 1 — POS (file `src/components/pos/PosCheckoutTerminal.tsx`)

**Cả 2 việc này CHƯA LÀM** (agent bị hủy giữa chừng).

**P1 — Banner lỗi hiện 2 nơi.** `errorMessage` được render bởi cả
`#pos-error-message` (trong container A, panel desktop) và `#mobile-pos-error-message`
(trong container C, sheet mobile). Mở sheet trên điện thoại là thấy lỗi 2 lần.
Cách sửa: banner trong A chỉ hiện ở desktop, banner trong C chỉ ở mobile — dùng **đúng
cờ `isWideCheckout`** đã dùng để khử trùng lặp khối thanh toán, để hai bên không bao giờ
lệch nhau. Giữ nguyên cả hai `id` (test assert chúng).

**P2 — Sheet thiếu nhánh tặng 100%.** Container A có nhánh `isGift` (nhãn nút khác,
tổng tiền hiện `THỰC THU (TẶNG 100%)`, nhãn khi đang xử lý khác). Container C thì không
— `mobileCheckoutButtonLabel` không có nhánh tặng, tổng tiền luôn hiện `finalAmount`
thô. Cần cho C khớp A. **Được phép đổi hành vi lần này** (trước đó agent cố tình không
làm vì sợ đổi hành vi). Khi `isGift === false` thì C phải y hệt hiện tại — đó là trường
hợp phổ biến, tuyệt đối không được hồi quy.

### ƯU TIÊT 2 — lỗi chức năng thật

**P3 — `/api/warehouses` thiếu `ROLE_TAX` trong allowlist.** File
`src/app/api/warehouses/route.ts:19-24`. Nhưng `src/lib/roles.ts:62` cấp tab
`inventory` cho `ROLE_TAX` ⇒ kế toán thuế bấm tab kho **luôn 403**. Sửa allowlist.

**P4 — `getDefaultTabForRole` chưa chống role lạ.** `src/lib/roles.ts:66-68`:
`USER_ROLES[role].allowedNavItems[0]` — không guard. `MasterAppShell.tsx:65` và `:406`
gọi nó trong `useState` initializer, nên role lạ **throw trước khi** guard `isKnownRole`
(D1, đã sửa) kịp chạy. Sửa ở `roles.ts` cho cả nhánh đó. Đây là cùng lớp crash với D1.

**P5 — `getStockMatrix` đếm mọi `condition`.** `src/services/inventory.service.ts:704`
`db.select().from(stockBalances)` không lọc `condition = 'NEW'`, nên tồn hàng hỏng /
cách ly bị cộng vào tổng. `transferBatch` chỉ đụng `NEW` ⇒ tổng ma trận có thể lệch với
tổng tồn thật.

### ƯU TIÊT 3 — lỗi UI nhỏ

**P6 — `BatchTransferModal` báo sai kiểu.** File
`src/components/inventory/BatchTransferModal.tsx`. (a) Thông điệp
`Kho nguồn không còn sách nào có tồn để lấy.` nằm trong **hộp xanh thành công** kèm icon
`CheckCircle2` — rỗng mà trông như thắng. (b) `addNotice` chỉ reset ở đóng modal, nên
`Đã thêm: 40 đầu sách` còn treo sau khi người dùng xoá dòng.

**P7 — `src/lib/transfer-content.ts:15`** có nhánh `if (manualContent !== null) return
manualContent;` là **dead code**: `VietQrPay.tsx` đã return sớm ở effect trước khi gọi
hàm. Hai nguồn sự thật cho một luật. Xoá nhánh, hoặc bỏ return sớm — chọn 1.

**P8 — `Alt+1..8` trước khi đăng nhập bị nuốt im lặng.**
`MasterAppShell.tsx` gọi `e.preventDefault()` **trước** khi kiểm tra
`roleConfig.allowedNavItems.includes(targetTab)`. Chưa đăng nhập thì không mở được tab
nào (đúng), nhưng phím cũng không còn tác dụng gì. Chuyển `preventDefault()` xuống sau
khi kiểm tra.

**P9 — `VietQrPay` vẫn gọi `/api/warehouses?all=true`.** URL nói dối ý định (giờ nó chỉ
cần mẫu nội dung) và bị gọi 2× nếu 2 instance cùng mount. Hiện đã đảm bảo 1 instance
(`isWideCheckout`) nên chỉ còn vấn đề URL.

**P10 — `public/manifest.json` bỏ `maskable`.** Đã đổi từ `"any maskable"` sang `"any"`
vì logo không nằm trong safe zone. Hệ quả: Android mất adaptive icon, có thể letterbox
nền. Nếu muốn có adaptive icon đúng thì phải thiết kế thêm một biến thể icon có dự
phòng trắng.

## 2. Cần DUYỆT RIÊNG — chưa làm vì cần quyết định nghiệp vụ

| # | Việc | Vì sao cần duyệt |
|---|---|---|
| A | **Job nền giải phóng đơn `PENDING_CONFIRMATION` hết hạn.** Hiện chỉ có nút `CLEANUP` bấm tay của Quản lý (`POST /api/orders {action:'CLEANUP'}` → `OrderService.cleanupExpiredPending`). Một đơn kẹt **chặn không cho chốt ngày** cho cả ngày đó (`daily-settlement.service.ts:440-455`). | Cần chọn: cron của Workers, hay chạy lười (lazy) khi vào app, hay chỉ cảnh báo |
| B | **Duyệt chiết khấu bằng QR (`QR_JWT`).** Backend + test đã có (`discount-approval.service.ts:438-448`), cashier thấy QR nhưng **không có UI nào gửi mã** ⇒ QR hiện chỉ để trưng bày. | Cần UI quét mã cho thu ngân |
| C | **Đơn hội chợ giữ tồn 48h thay vì 30 phút + bỏ qua yêu cầu két.** Đã sửa phần chính (cùng `isCounterChannel` với kho chính → 30 phút + bắt buộc mở ca). Kiểm lại xem còn sót gì không. | Đã gần xong, chỉ cần verify |
| D | `StockOverviewMatrix.tsx:105` còn `currentRole = 'ROLE_OWNER'` mặc định. Hiện **không gọi tới được** (shell luôn truyền prop) nên để nguyên là hợp lý. | Không làm |
| E | `check_stock_non_negative` có trong `schema.ts:195` nhưng **không migration nào tạo** ⇒ chỉ có guard trong `UPDATE`. | Cần migration, ảnh hưởng prod |
| F | Deploy làm `.bin` trong `node_modules` **biến mất mỗi lần xoá worktree** (junction trên Windows) → phải `npm install` lại trước khi deploy. | Quy trình, không phải code |

## 3. Lệnh verify bắt buộc trước khi deploy

```powershell
npx tsc --noEmit
npx tsx scripts/run-isolated.ts
```

- Mục tiêu: `tsc` 0 lỗi, battery **68/68 xanh, exit 0**.
- **Có crash flaky** `0xC0000005` (access violation của native libsql) ở suite ngẫu nhiên
  mỗi lần, luôn kèm `SQLITE_BUSY` trước đó; chạy riêng suite đó luôn PASS. Nếu gặp →
  **chạy lại battery**, đừng sửa code.
- Test DB dùng chung cần `npx tsx scripts/run-isolated.ts --only=<tên>`. Quên dọn lease
  hay bucket sẽ đỏ oan.

## 4. Quy trình deploy (bắt buộc theo thứ tự)

1. **Dừng dev server** nếu đang chạy. KHÔNG chạy `next build` khi `next dev` còn sống
   (build đè `.next`, dev phục vụ asset manifest cũ ⇒ mất toàn bộ CSS/JS).
2. `npx tsc --noEmit` + battery xanh.
3. Commit lên branch `agent/b-<ngày>-<mô tả>`, push, merge `--no-ff` vào `main`, push
   main, verify `git ls-remote origin main`.
4. Worktree sạch: `git worktree add --detach <thư mục> <sha-main>`, junction
   `node_modules` → cây chính, **`npm install` lại** (xem mục 2F).
5. Xoá `.next` và `.open-next` trong worktree, rồi `npm run deploy`.
6. BẤT BIẾN: `wrangler.toml` phải còn `[vars] NEXT_PRIVATE_MINIMAL_MODE = "1"` — thiếu
   thì 500 toàn bộ ("Dynamic require of middleware-manifest.json"). `next.config.mjs` giữ
   nguyên twin backslash `@libsql\\client`.

## 5. Bẫy khi verify trên bản live (đã mất thời gian vì nó)

1. Minifier escape ký tự tiếng Việt thành `\xNN` / `\uNNNN` ⇒ `includes('Chụp ảnh xác nhận')`
   **trượt** dù code đã lên. Phải giải escape trước khi so khớp.
2. HTML do Cloudflare cache ⇒ có thể trỏ tới **chunk cũ đã 404**. Luôn fetch kèm
   cache-buster (`?cb=<timestamp>`) rồi lấy chunk từ HTML đó.
3. Đừng tin `.next/static/chunks` cục bộ là bằng chứng — hãy đọc asset từ URL thật.
4. Cảnh báo `EPERM ... symlink ... .next/standalone/node_modules` là hệ quả junction
   Windows, **không chặn deploy** — 11/11 assets vẫn upload, SSR vẫn 200.

## 6. Cấu hình agent (đã xong, không cần làm lại)

| Công cụ | Model |
|---|---|
| opencode subagent (19 agent) | `openrouter/stealth/space-bunny-alpha` — ghim trong `C:\Users\PC\.config\opencode\opencode.json` |
| Kilo CLI | `kilo/stealth/space-bunny-alpha` — `C:\Users\PC\.config\kilo\kilo.jsonc` |
| Cline CLI | provider `cline` — truyền `-P/-m` khi gọi |

Lệnh gọi Kilo không tương tác: `kilo run "<prompt>"`. Cline: `cline "<prompt>"`
(phải là **một** đối số có quote; truyền nhiều từ không quote sẽ báo
`Unknown command or unquoted prompt`).
