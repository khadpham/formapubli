# Handoff — công việc còn tồn đọng (2026-09-28 17:30)

Trạng thái lúc viết: `main` = `7f61072`, prod = worker `275516cb`.
Mọi việc trong tài liệu này **CHƯA** làm. Đọc `AGENTS.md` trước khi bắt tay.

---

## 0. Bối cảnh: những gì đã deploy và đã đóng

Đã xong, không cần làm lại:

| Việc | Commit | Thật ra là gì |
|---|---|---|
| Camera "Chụp ảnh xác nhận" | `93de798` | Modal chuyển khoản bị gate theo `qrSnapshot.dataUrl`; không có QR thì camera không tồn tại. Bỏ gate. |
| Trắng màn hình khi bấm Xác nhận | `8478dd2` | `completedOrder.finalAmount` là `undefined` vì API `CONFIRM` chỉ trả `{orderId, orderCode, status}`. Deref chết render. |
| Đơn PENDING mồ côi | `30ab113` | Đơn tạo *song song* với hộp chọn ảnh. Bấm Huỷ picker ⇒ đơn đã tồn tại, giữ ATP 30 phút, không có UI hủy. Nay: chỉ tạo đơn sau khi có ảnh. |
| Thông báo chết | `3a60859` | Bảng `notification_dismissals` **không tồn tại trên prod**. Route đọc nó trong `try` chính ⇒ mọi thông báo 500. Đã migrate + sửa fail-safe. |
| Nút refresh tab Kho | `3a60859` | `public/sw.js` cache-first cho cả payload RSC ⇒ `router.refresh()` bị trả dữ liệu đóng băng (`transferSize: 0`). Đã bypass RSC, cache `v4`→`v5`. |
| Nút refresh Dashboard | `3a60859` | Fetch thiếu `cache: 'no-store'`; card "sắp hết hàng" nuôi bằng state không ai gán. |
| Drawer duyệt chiết khấu trống | `3a60859` | Fetch thiếu `no-store`; drawer lọc theo kho nhưng chuông đếm mọi kho ⇒ trông như hỏng. Nay hiện phạm vi, có "Xem mọi kho", phân biệt trống/lỗi. |
| `{SL}` mất khỏi nội dung chuyển khoản | `5837d76` | VietQR chỉ mang 23 ký tự, mã đơn dài 29. Nay dồn ngân sách ký tự: `{SL}`+`{MA}` sống, `{KHO}` nhường chỗ. |
| Quản lý tạo yêu cầu duyệt mồ côi | `7f61072` | `POST /api/pos/discount-approvals` cho phép OWNER/MANAGER, nhưng service cấm tự duyệt ⇒ yêu cầu không ai dọn được. Nay `POST` chỉ nhận `ROLE_CASHIER`. |

---

## 1. QUAN TRỌNG: "Duyệt chiết khấu bằng QR" KHÔNG phải tính năng

Chủ cửa hỏi đúng: **không có tính năng này.** Đây là **dead code** + một ghi chú sai trong tài liệu.

**Cái có trong code:**
- `src/services/discount-approval.service.ts:137-160` — `signQrJwt` / `verifyQrJwt` (JWT HS256, payload `{reqId, nonce, cartHash, orderCode, warehouseId, rate, exp}`, TTL 5 phút)
- `src/services/discount-approval.service.ts:438-448` — nhánh `QR_JWT` trong `approveRequest`
- `scripts/test-s3-discount-approval.ts:262-282` (Case 6) — gọi thẳng service, **không** qua HTTP, **không** qua UI

**Vì sao chết — đây là mấu chốt:**
- `src/components/pos/DiscountApprovalModal.tsx:539` — khối QR nằm trong nhánh `currentRole === 'ROLE_CASHIER' ? ... : (QR + OTP + Offline)`. Tức là nhánh **dành cho quản lý**.
- Nhưng modal **chỉ mở được khi vai trò là thu ngân**: `src/components/pos/PosCheckoutTerminal.tsx:960-966`, `isRestrictedCashier = currentRole === 'ROLE_CASHIER' && !isManagerOverride` là điều kiện **duy nhất** gọi `setIsDiscountApprovalModalOpen(true)`.
- ⇒ Khi modal mở, vai trò **luôn** là thu ngân ⇒ nhánh chứa QR **không bao giờ render**.

**Ngoài ra không có endpoint nhận mã quét.** Route `src/app/api/pos/discount-approvals/[id]/route.ts` chỉ chuyển tiếp `qrToken` người dùng gửi lên. Không có `/scan`, `/verify`, `/qr`. `listPending` (`service:713-716`) **không trả `qrToken`** ⇒ phía quản lý không bao giờ có token để quét. `ManagerApprovalDrawer` không có camera, không import scanner.

**Gốc rễ:** spec `docs/superpowers/specs/2026-09-22-pos-warehouse-refactor-design-V4.md:202` nói rõ **luồng chính là ShortCode 4 số**, không phải QR. QR chỉ là hạng mục hardening (§4.2) — backend làm xong, **UI chưa bao giờ được viết**.

Ghi chú sai ở `docs/superpowers/plans/2026-09-28-handoff-pending-work.md:91` nói "cashier thấy QR" — sai, thu ngân cũng không thấy.

### Cách duyệt chiết khấu THẬT SỰ hoạt động hôm nay (2 cách)

Cả hai đều là **quản lý bấm**, thu ngân chỉ đứng chờ:

| Cách | Nơi | Dòng |
|---|---|---|
| 1-chạm | Drawer quản lý → "Duyệt Ngay (1-Chạm)" | `ManagerApprovalDrawer.tsx:145-156`, nút `:490` |
| Mã 4 số | Drawer quản lý → ô "Duyệt nhanh bằng đuôi 4 số" | `ManagerApprovalDrawer.tsx:200-210`, `:283-302` |

Nút mở drawer chỉ hiện cho Manager/Owner: `PosCheckoutTerminal.tsx:2596-2599`.

### Đề xuất xử lý (30 phút)
1. Sửa dòng 91 của `2026-09-28-handoff-pending-work.md` cho đúng: "`QR_JWT` có backend + test, **không có UI, không ai gọi được**; ô QR trong modal là dead code."
2. Xoá `DiscountApprovalModal.tsx:644-651` + `:208-223` (nhánh QR, ~18 dòng).

**KHÔNG nên xây UI quét QR** — drawer đã có nút 1-chạm, quét còn chậm hơn bấm, giá trị kinh doán ≈ 0.

---

## 2. LỖI BẢO MẬT: `OFFLINE_EMERGENCY` là backdoor nếu ai đó mở role-gate

`src/services/discount-approval.service.ts:456` — chỉ kiểm tra chuỗi **bắt đầu bằng `"EMG-"`**:

- Không bảng mã, không single-use, không đối soát, không kiểm tra hạn.
- UI tự mô tả *"1 trong 5 mã khẩn cấp trong ngày"* (`DiscountApprovalModal.tsx:663`) — **lời hứa không có trong code**. Grep `EMG` toàn `src/` chỉ 4 dòng, không dòng nào sinh hay lưu mã.
- Hiện tại chết vì role-gate của modal, nên chưa lộ. **Nhưng nếu ai đó "sửa cho nó chạy" bằng cách nới modal cho quản lý, đây là backdoor**: bất kỳ ai có quyền duyệt gõ `"EMG-x"` là duyệt được mọi mức ≤ 25%.

**Việc cần làm:** hoặc xoá hẳn `OFFLINE_EMERGENCY`, hoặc triển khai thật (bảng mã, hash, single-use, giới hạn số lần/ngày, ghi audit). **Tuyệt đối không chỉ nới role-gate.**

## 3. Ô "Nhập mã cấp phép / OTP" cũng chết — và nếu bật thì hỏng

`DiscountApprovalModal.tsx:299-344` gửi `SHORTCODE_BOUND` từ phía thu ngân, nhưng `service:386-391` chặn mọi role ≠ MANAGER/OWNER. Test `test-s3-discount-approval.ts:592` **assert 403** cho đúng case này. ⇒ Thu ngân không bao giờ tự mở khóa được. Cùng số phận với QR: nằm trong nhánh chết.

---

## 4. CÒN TỒN ĐỌNG (xếp theo mức nguy hiểm)

### 4.1 — CAO. Không có tác vụ nền giải phóng đơn quá hạn
`src/app/api/orders/route.ts:186-196` — chỉ có nút CLEANUP thủ công.
Đơn chuyển khoản hết 30 phút giữ ATP tới lúc ai đó bấm tay. Một đơn kẹt **chặn không cho chốt ngày** cho cả ngày đó (`src/services/daily-settlement.service.ts:96-99`).
Cần: cron (`/api/cron/auto-close` đã tồn tại — kiểm tra xem đã làm gì) hoặc sweep theo lịch. Nhớ: ATP phải được trả lại đúng kho.

### 4.2 — CAO. `scripts/migrate-remote.ts` không an toàn trên prod
Prod **không có bảng ghi migration**. Đã xác minh:
- `npm run db:migrate` → `drizzle.config.ts:8` trỏ `file:formapubli.db` (file local, không bao giờ chạm prod).
- `scripts/migrate-remote.ts:40` → `migrateFresh` (`scripts/migrate-fresh.ts:41`) **không trạng thái**, chạy TỪ ĐẦU 0000 mỗi lần. Câu đầu file `0000` là `CREATE TABLE bundle_items` không `IF NOT EXISTS` ⇒ chết ngay.
- Đã tay-áp 0025 + 0026 lên prod (tạo bảng `notification_dismissals` + cột `expires_at` + index). **Các script không biết 2 thay đổi này tồn tại.**

Cần: chặn script trên prod trừ khi có cờ tường minh, HOẶC thêm bảng ghi migration thật. Ưu tiên chặn — rẻ và ngăn sự cố.

### 4.3 — TB. Đơn PENDING mồ côi tồn đọng
- Dev: `ORD-20260928-B768A09233642AFF` (`PENDING_CONFIRMATION`, 14:54Z) — phát sinh từ lần chạy trước khi sửa. Xoá thủ công.
- Prod: chưa kiểm tra. Nên quét và dọn.

### 4.4 — TB. Dashboard chỉ đếm đơn `COMPLETED`
`src/app/api/orders/route.ts:63` — `status` mặc định `COMPLETED`. Mọi KPI doanh thu, biểu đồ 7 ngày, top 5 đơn bỏ sót mọi đơn `PENDING` / `PENDING_CONFIRMATION` / `CANCELLED`. **Quyết định nghiệp vụ** — có nên đổi sang `?status=ALL` không.

### 4.5 — THẤP. Card "Sách sắp hết hàng" ở Dashboard chưa tồn tại
`ExecutiveDashboard.tsx` có `lowStockBooks` được tính rồi **nhưng không render ở đâu cả**. Dữ liệu ma trận tồn có sẵn (`src/app/page.tsx:57` → `MasterAppShell` prop `matrixBooks`) nhưng **không** truyền xuống `ExecutiveDashboard` (`MasterAppShell.tsx:333-336`).
Cần: truyền prop + viết markup, hoặc xoá hẳn biến chết.

### 4.6 — THẤP. Hai mục trong docs đã cũ, cần sửa để khỏi gây hiểu nhầm
- `2026-09-28-handoff-pending-work.md:91` — mục QR, sai như mô tả ở §1.
- `2026-09-28-master-bug-summary.md` §5 — liệt kê `getStockMatrix` đếm mọi condition và `MasterAppShell` chưa commit. **Cả hai đã sửa và commit** (`084a50e`, `98782e9`). Xoá khỏi danh sách tồn đọng.

### 4.7 — BẢO MẬT, chưa xử lý (cần bạn quyết)
- **KHÔNG còn lỗi token Cloudflare.** Đã kiểm tra toàn cây git ngày 28/09: `scripts/deploy-cloudflare.ts` **không tồn tại** (đã bị xoá). Chỉ còn một chuỗi `cfut_pE1...` dạng đã che trong `docs/superpowers/plans/2026-09-25-handoff-state.md:125` — không phải secret dùng được. Nội dung cũ ghi token còn plaintext là **sai**, đã gỡ.
- **PIN 8 nhân viên vẫn là PIN mặc định dễ đoán** (`9999`, `8888`, `1234`…). Đây là rủi ro thật còn lại.

---

## 5. Quy ước bắt buộc khi làm tiếp

- **Test:** `npx tsx scripts/run-isolated.ts --only=<tên>`. **Không** chạy cả battery khi đang sửa song song — chạy `--only` từng cái, **một lệnh một suite** (nhiều cờ `--only` thì chỉ cờ cuối có hiệu lực).
- **Segfault `3221225477` = 0xC0000005**: client libsql chết lúc thoát tiến trình. Đã gặp nhiều lần, **luôn sau khi suite đã in PASS**. Chạy lại là xanh. Đừng truy tìm nó như lỗi logic.
- **Không hạ assertion để xanh.** Khi một assertion cũ mã hoá hành vi đã cố ý đổi, viết lại nó thành hợp đồng mới và giữ chặt — đừng xoá.
- **Bất biến, cấm đụng:**
  - `[vars] NEXT_PRIVATE_MINIMAL_MODE="1"` trong `wrangler.toml`
  - twin backslash `@libsql\\client` trong `next.config.mjs`
  - Không commit secret/token
- **Nhãn UI tiếng Việt CÓ DẤU.** Cấm nửa Anh kiểu "Chụp ảnh receipt".
- **Deploy:** dừng dev server trước khi build. Worktree sạch, `npm install` (KHÔNG junction `node_modules` — npm sẽ xoá junction rồi báo hỏng). `npm run deploy` chạy nền rồi poll, đừng gọi blocking lâu.
- **Cây làm việc còn artifact chưa commit của session khác** — không commit, không xoá: `docs/superpowers/plans/2026-09-25-agent-a-review-verdict.md`, `eval-executive-ai-report.json`, `reports/wave3-pos-ui/*`.
- **Đo trên trình duyệt thật trước khi tin.** Đã có bug UI ship với suite xanh. Dev server phải là `npm run dev:lan` (0.0.0.0), dừng sau khi xong.
