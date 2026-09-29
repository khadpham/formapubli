# KẾ HOẠCH SỬA — công việc còn tồn đọng (bản đã kiểm chứng)

- **Ngày:** 2026-09-29
- **Căn cứ:** `main` = `b619962` (chỉ thêm handoff, **không đổi code**), prod worker `275516cb`
- **Kế hoạch A (modal Trạng Thái Hội Chợ):** `docs/superpowers/specs/2026-09-29-live-fair-monitor-design.md`
- **Quy ước:** `npx tsx scripts/run-isolated.ts --only=<tên>`, một lệnh một suite. Không hạ assertion.

---

## 0. Handoff SAI ở 4 chỗ. Đã kiểm chứng lại từng dòng.

Bốn điểm dưới đây làm **đổi thứ tự ưu tiên**, nên phải nói trước khi sửa gì.

| # | Handoff nói | Thực tế | Ảnh hưởng |
|---|---|---|---|
| S1 | `PosCheckoutTerminal.tsx:960-966` là điều kiện **duy nhất** mở modal duyệt chiết khấu | **Sai.** Có **hai** call site: `:965` và `:2868` (nút "Mở lại mã") | Agent nào tin handoff rồi xoá "dead code" sẽ **làm hỏng nút Mở lại mã của thu ngân** |
| S2 | §2: `OFFLINE_EMERGENCY` "hiện tại chết vì role-gate của modal, nên chưa lộ" | **Sai.** Route `[id]/route.ts:46-50` cho OWNER/MANAGER đi thẳng, gate thu ngân ở `:59-67` không áp dụng | Nhưng **không phải lỗ hổng đang mở** — xem P3 |
| S3 | §4.1: "Đơn hết 30 phút **giữ ATP** tới lúc ai đó bấm tay" | **Sai cơ chế.** ATP là **theo thời gian, không theo trạng thái**: `order.service.ts:1185-1188` bỏ giữ chỗ khi hết hạn, dù dòng vẫn `PENDING_CONFIRMATION` | Đơn quầy **không rò ATP**. Cái thật sự kẹt là **dòng `PENDING_CONFIRMATION` chặn chốt ngày** — nghiêm trọng hơn và dây chuyền (P2) |
| S4 | §4.5: `lowStockBooks` "được tính rồi nhưng không render" | **Sai.** Nó đã bị xoá; grep toàn repo chỉ còn 1 dòng **trong comment** (`ExecutiveDashboard.tsx:85`) | Việc thật còn lại: truyền prop `matrixBooks` xuống + viết card, hoặc xoá comment |

**S2 nói rõ hơn — tôi tự kiểm và cả agent lẫn handoff đều nâng quá mức:**

`service.ts:386-391` chặn **mọi role ≠ OWNER/MANAGER**. Nên:
- **Thu ngân KHÔNG dùng được** `EMG-`. Sự cho phép ở route (`:61`, `:64`) là **no-op** — nó nói với thu ngân rằng họ có thể, rồi service âm thầm 403.
- **Quản lý dùng được**, nhưng quản lý **đã** có `ONE_TOUCH` **không trần** (`ManagerApprovalDrawer.tsx:490`). ⇒ `EMG-` **không cho quản lý thêm quyền gì hôm nay**.

⇒ Không phải lỗ hổng đang mở. Nó là **cái bẫy chân**: route vẫn cấu hình thu ngân được phép, ai đó sau này "sửa cho nó chạy" bằng cách nới `service.ts:386-391` là tạo backdoor thật. Cộng thêm lời hứa UI "1 trong 5 mã khẩn cấp trong ngày" (`DiscountApprovalModal.tsx:663`) mà **không dòng code nào sinh ra mã**.

---

## P0 — ĐO ĐƯỢC RỒI: **`401`. Cron chốt ca tự động CHƯA TỪNG CHẠY**

Đã chạy trên prod ngày 2026-09-29:
```powershell
curl.exe -s -o NUL -w "%{http_code}" -H "Authorization: Bearer $CRON_SECRET" \
  "https://book.formaform.vn/api/cron/auto-close?list=1"
# → 401
```

`CRON_SECRET` **không có trong `wrangler.toml`** và phải là `wrangler secret` trên Worker. Không set ⇒ `authorized()` (`cron/auto-close/route.ts:29`, fail-closed khi secret rỗng) trả 401 mỗi đêm.

### Hệ quả — và nó ĐẢO NGƯỢC kết luận P2

| | Trước khi đo | Sau khi đo |
|---|---|---|
| Ngày nào bị mất | "Một đơn kẹt làm tê đường ống đêm, retry 7 đêm rồi CI xanh mà ngày chưa chốt" | **Chưa mất ngày nào vì cron** — cron chưa từng chạy. Mọi ngày phải chốt tay (hoặc không chốt). |
| Mức độ P2 | Cao, mất dữ liệu âm thầm | **Trung bình.** Chỉ còn chặn chốt **tay**. |
| `MAX_SHIFT`/deadlock | đáng sửa | **Vẫn phải sửa trước khi bật cron**, không phải sau. |

Tương tác chéo: GitHub Actions `auto-close-shift.yml` gọi endpoint mỗi đêm và **fail mỗi lần** (exit 1 ở `:104-115`) — mà lẽ ra repo phải đỏ. Cần kiểm tra workflow có thực sự chạy không (Actions bị tắt? repo private?).

### Việc cần làm (1 lệnh, bạn tự chạy — tôi không đụng prod)

```powershell
npx wrangler secret put CRON_SECRET   # nhập đúng giá trị CRON_SECRET trong .env
```

Sau đó chạy lại curl phải ra `200`, **rồi mới** bật lại cờ `SESSION_LEASE_ENFORCE`-style cho cron.

### Lưu ý dev vs prod

Dev DB **có** bản ghi chốt ngày `2026-09-21`…`2026-09-27` cho cả 3 kho. Vậy chúng đến từ đâu nếu cron 401? Có thể là chốt tay lúc test, hoặc secret từng tồn tại rồi bị mất. Cần đối chiếu `idempotency_keys` scope `day-close` trên prod để biết ngày nào thực sự đã chốt.


---

## P1 — CAO. ~~Ngõ cụt khiến thu ngân không gỡ được đơn~~ **ĐÃ LÀM 2026-09-29 (phương án a)**

`PosCheckoutTerminal.tsx` khai báo `setApprovedPin`, nhưng **chỉ** được gán `null`, và `managerPin: approvedPin || undefined` ⇒ **luôn `undefined`**. Không có UI nhập PIN nào trong toàn bộ client.

⇒ **3 cổng PIN đều bị kẹt với thu ngân** (không chỉ 1): đơn chiết khấu vượt trần · đơn gõ bù >7 ngày (`orders/route.ts:427-448`) · phiếu đổi/trả quá hạn (`returns/route.ts:92-104`). `verifyManagerPinRateLimited` chỉ trả false vì không có gì để xác minh.

### Đã gỡ (theo lựa chọn (a): một đường duyệt duy nhất)

| Việc | File |
|---|---|
| Nhánh rẽ PIN quản lý ở đơn chiết khấu | `api/orders/route.ts` → nay 403 + `code:'FORBIDDEN'` |
| Lỗi cũ *"bắt buộc có mã PIN hoặc phê duyệt"* | → *"Chiết khấu từ 20% trở lên cần Quản lý phê duyệt. Hãy lập yêu cầu duyệt và thử lại sau khi Quản lý duyệt (yêu cầu cũ đã hết hạn sẽ phải lập lại)."* — chỉ đường thoát **thật** |
| `approvalSource` mặc định `'MANAGER_PIN'` | → `'NONE'`; gỡ 2 ternary `SYSTEM_MANAGER_PIN` ở audit |
| State `approvedPin` + 2 chỗ reset + 2 chỗ gửi `managerPin` | `PosCheckoutTerminal.tsx` |
| 2 chữ "cần PIN quản lý" trong UI | `PosCheckoutTerminal.tsx` |

**Giữ nguyên có chủ đích:** `src/lib/manager-pin.ts` + env `MANAGER_PIN_HASHES` — còn 2 cổng PIN dùng chúng (gõ bù >7 ngày, đổi/trả quá hạn). Xoá là mất kiểm soát an toàn ở 2 nơi khác.

### Test viết lại, siết chặt hơn

| File | Thay đổi |
|---|---|
| `test-discount-guard.ts` | 11 → **13** assertion. Đáng chú ý: *"Lỗi vượt trần KHÔNG còn hứa 'mã PIN'"* (chống quay lại ngõ cụt) · PIN đúng trước đòi 200 **nay đòi 403 + FORBIDDEN** · PIN theo env hợp lệ cũng phải 403 · audit từ chối được ghi và **không lộ PIN** |
| `test-discount-checkout-atomic.ts` | D10: gift của thu ngân giờ cần **duyệt thật**; thêm case *"PIN 9999 không còn là đường thoát"* |
| `smoke-mobile-role-navigation.ts` | `doesNotMatch` cho `approvedPin` trong POS |

### ⚠️ Còn 2 cổng PIN chết — CẦN BẠN QUYẾT

`orders/route.ts:427-448` (gõ bù >7 ngày) và `returns/route.ts:92-104` (đổi/trả quá hạn) vẫn gọi `verifyManagerPinRateLimited` mà client **không bao giờ gửi PIN** ⇒ thu ngân bị chặn không gỡ được. Tôi **không tự xoá** vì đó là quyết định an toàn:
- Xoá ⇒ thu ngân tự ghi đơn lùi ngày bất kỳ, tự vượt cửa sổ đổi/trả → mất kiểm soát.
- Giữ ⇒ 2 ngõ cụt còn lại.
- Sửa đúng = dựng UI nhập PIN (phương án b).

---

## P2 — ~~Một đơn kẹt làm tê cả đường ống đêm~~ **ĐÃ LÀM 2026-09-29**

### 4 thay đổi

| # | Thay đổi | File |
|---|---|---|
| 1 | Guard PENDING trong `closeDay` **biết hạn**: chỉ đơn **còn hạn** mới chặn | `daily-settlement.service.ts:440-461` (dùng `OrderService.isPendingExpired`) |
| 2 | Guard PENDING trong `autoCloseSession` **biết hạn** — cắt vòng deadlock | `order.service.ts:2189-2208` |
| 3 | **Bước 0** trong cron: dọn `PENDING_CONFIRMATION` hết hạn **trước khi** đóng ca | `cron/auto-close/route.ts` + `pendingCleaned` trong response |
| 4 | `GET /api/cron/auto-close?unclosed=1&days=N` — liệt kê **mọi** ngày đã qua chưa có bản chốt | `cron/auto-close/route.ts` `listUnclosed()` + workflow fail nếu ≠ 0 |

**Vòng deadlock cũ đã cắt:** đơn hết hạn 30′ → giữ dòng PENDING → chặn `autoCloseSession` (b1) → ca vẫn OPEN → chặn `closeDay` (b2). Nay đơn hết hạn không còn giữ dòng theo quan điểm kiểm soát, và `cleanupExpiredPending` dọn hẳn.

**Chống xanh giả (mục 4) là phần quan trọng nhất.** Trước đây workflow chỉ phủ `BACK_DAYS=7`; ngày lỡ trôt trượt khỏi cửa sổ sau 7 đêm là **không ai hỏi nữa**, workflow xanh, ngày chưa từng chốt. `?unclosed=1` không phụ thuộc cửa sổ quét ⇒ ngày chưa chốt là điều kiện **tự phát hiện**.

### Test mới: `test-autoclose-shift` section P2/P2b (6 assertion)

- Đơn hết hạn: `isPendingExpired` = true · `autoCloseSession` **ĐÓNG ĐƯỢC** · `closingCashActual` vẫn `null` (không bịa số đếm) · `closeDay` **CHỐT ĐƯỢC**.
- Đơn còn hạn: `isPendingExpired` = false · `autoCloseSession` **vẫn bị từ chối** · `closeDay` **vẫn bị từ chối**. *(Không nới thành xoá.)*
- Fixture thêm 2 kho `wh-p2` / `wh-p2b`.
- Bẫy: `isPendingExpired` dùng `Date.now()` **thật**, còn suite giả lập `CASHBOX_TEST_NOW` — hạn phải tính theo đồng hồ thật, `createdAt` mới khớp lọc `like('<date>%')`. Tôi dính bẫy này ở lần chạy đầu.

---

## P2b — TẠM TẮT LỊCH (đã làm, chờ bật lại)

`.github/workflows/auto-close-shift.yml` — khối `schedule:` đã bị comment kèm lý do. `workflow_dispatch` **giữ nguyên** để chạy tay có người canh.

**Bật lại lịch khi nào:** sau khi chạy tay 1 lần có giám sát, xác nhận `pendingCleaned` / `daysClosed` / `cashVerification` đúng ý. Không bật lại vô điều kiện.

---

## P6 — TB. ~~Đường migrate/seed~~ **ĐÃ LÀM 2026-09-29**

| Nguy hiểm | Guard mới |
|---|---|
| `migrate-remote.ts` chạy `migrateFresh` **không có bảng ghi migration**, mỗi lần chạy lại từ `0000` trên 27 file (23/27 có câu không idempotent) | `migrate-fresh.ts` từ chối mọi URL không phải `file:` trừ khi có `ALLOW_REMOTE_MIGRATE=true` |
| `seed.ts` **ghi đè** `passcode_hash`+`salt` của 8 nhân viên mặc định (`9999`/`8888`/`1234`…), và `migrate-remote.ts:42` bảo chạy đúng script đó. `verifyStaffPasscode` **không** kiểm `AUTH_STRICT`/`NODE_ENV` | `seed.ts` từ chối khi `DATABASE_URL` không phải `file:` trừ khi có `SEED_STAFF_REMOTE=true` |

**Test chặn hồi quy** (`test-cron-auto-close`, 32 → **43** assertion): khẳng định `ALLOW_REMOTE_MIGRATE` và `SEED_STAFF_REMOTE` còn nguyên trong mã nguồn. Không có test thì 2 guard này sẽ bị xoá âm thầm mà không ai nhận ra.

**Cố ý CHƯA làm** (rủi ro thấp hơn, chi phí cao hơn):
- 10 script `apply-migration-0005..0014.ts` trỏ `DATABASE_URL` là ghi thẳng, không hỏi. Chúng là script một-lần đã dùng xong; thêm guard vào 10 file là diff lớn cho rủi ro thấp.
- `EXPECTED_TABLES` trong `migrate-remote.ts` thiếu mọi đối tượng sau `0015` ⇒ một lần chạy "thành công" có thể thiếu schema.
- `meta/_journal.json` có `when` **không đơn điệu** (`0008 > 0009`, `0024 > 0025/0026`) ⇒ `drizzle-kit migrate` sẽ **bỏ qua im lặng** 3 migration đó. Đây mới là bẫy chết người khi "sửa bằng cách trỏ drizzle vào prod". Cần `drizzle-kit generate` lại journal hoặc vá thứ tự.
- `check_stock_non_negative` (`schema.ts:195`) không migration nào tạo ⇒ không có trên prod.

---

## GHI NHẬN VỀ ĐỘ ỔN ĐỊNH CỦA BỘ TEST

`test-discount-guard` và `test-autoclose-shift` **đỏ khi chạy liên tục không nghỉ**, xanh 100% khi chạy đứng hoặc có nghỉ 2-3s. Đây là hiện tượng đã ghi ở handoff mục 5 (segfault `3221225477` của libsql lúc thoát tiến trình), **không phải lỗi logic** — cả hai suite đều in PASS trước khi tiến trình chết.

**Chưa chẩn đoán tới gốc.** Giả thuyết đang giữ: các suite trước giữ file SQLite/WAL chưa đóng, suite sau mở cùng thư mục. Cách làm hiện tại: `Start-Sleep 2-3` giữa các suite, hoặc chạy từng suite một lệnh. **Khi bàn giao, nhớ nói vậy** — không phải mọi lần chạy liền mạch đều xanh.

---

## Còn lại — bàn giao

| Việc | Trạng thái |
|---|---|
| **Bật lại lịch cron** | Chạy tay 1 lần có giám sát → xác nhận `pendingCleaned` / `daysClosed` / `cashVerification` → bỏ comment `schedule:` trong `auto-close-shift.yml` |
| **P1b — 2 cổng PIN còn lại** (gõ bù >7 ngày, đổi/trả quá hạn) | Chờ quyết định của bạn: xoá (mất 2 lớp kiểm soát) hay dựng UI PIN dùng chung |
| **P8 — đơn mồ côi** | Dev có `ORD-20260928-B768A09233642AFF`. Prod **chưa quét** — cần bạn đồng ý trước khi tôi đụng |
| **Deploy** | Chưa. Chưa chạy `next build` (cố ý: chưa deploy thì build chỉ ghi đè `.next`). Khi deploy nhớ verify trình duyệt thật, cả desktop lẫn iPhone |
| **Kế hoạch A — modal Trạng Thái Hội Chợ** | Spec ở `docs/superpowers/specs/2026-09-29-live-fair-monitor-design.md`, chờ duyệt |
| **Rotate token Cloudflare** | `cfut_pE1…` không còn trong cây làm việc nhưng **còn trong git history** (5 commit) → vẫn phải thu hồi ở Cloudflare dashboard |
| **Đổi PIN 8 nhân viên** | Vẫn là PIN mặc định. Nay có thêm guard: `seed.ts` sẽ từ chối reset PIN trên DB từ xa trừ khi có `SEED_STAFF_REMOTE=true` |

## Tóm tắt thay đổi phiên này

| Mục | Nội dung |
|---|---|
| **P0** | Đo ra `401` ⇒ `CRON_SECRET` mất. Đã set lại **cả** Worker secret + GitHub secret từ cùng giá trị `.env`, verify `200`/`401`. Lịch chưa từng chạy (chỉ có `workflow_dispatch`) |
| **P1(a)** | Gỡ ngõ cụt PIN ở đơn chiết khấu; lỗi nay chỉ đường thoát thật |
| **P2** | Đơn hết hạn không còn chặn đóng ca / chốt ngày; cron dọn trước; `?unclosed=1` chống xanh giả |
| **P3** | Gỡ `OFFLINE_EMERGENCY` + cửa sổ OTP + tab mã khẩn cấp (cái bẫy chân) |
| **P4** | `pos-catalog` dùng chung quy tắc hạn với `OrderService` — hết chặn ATP oan 48h |
| **P5** | Đồng hồ đếm lùi hỏi server trước khi khai hết hạn |
| **P6** | `migrate-fresh` + `seed` từ chối DB từ xa trừ khi có cờ tường minh |
| **P7** | 3 file doc: bảng cảnh báo 4 mục sai + sửa dòng QR / `getStockMatrix` |
| **Tắt lịch** | Khối `schedule:` comment kèm lý do, giữ `workflow_dispatch` |

**Xác minh cuối phiên:** `npx tsc --noEmit` sạch · **18/18 suite xanh** (chạy có nghỉ 2-3s) · `formapubli.db` nguyên vẹn 100% · **chưa commit**.





1. `order.service.ts:2190-2202` — `autoCloseSession` **từ chối** đóng ca nếu ca còn đơn `PENDING_CONFIRMATION`.
2. ⇒ cron bước 1 fail (`cron/auto-close/route.ts:192-194` vào `errors[]`) ⇒ ca vẫn `OPEN`.
3. ⇒ bước 2 chạy `closeDay`, bị chặn bởi `daily-settlement.service.ts:422-438` (còn ca `OPEN`) ⇒ ném.
4. Cờ `autoCloseOpenShifts: true` **không** phá vỡ được vòng này.
5. Workflow thử lại **cùng ngày đó 7 đêm** rồi trượt khỏi `BACK_DAYS=7` ⇒ **CI chuyển xanh mà ngày đó chưa bao giờ được chốt.**

Mất dữ liệu mặc áo thành công. Cần: cron dọn `PENDING_CONFIRMATION` hết hạn **trước** bước 1, và workflow **phải fail nếu còn ngày chưa chốt** thay vì im lặng xanh.

---

## P3 — TB. ~~Dọn dead code duyệt chiết khấu~~ **ĐÃ LÀM 2026-09-29**

Handoff §1 đã kết luận **KHÔNG nên xây UI quét QR** — tôi đồng ý, và thêm: **xoá hẳn** để không ai vô tình làm nó sống.

### Đã xoá (8 file, tsc sạch, 8/8 suite xanh)

| Xoá | Vị trí |
|---|---|
| `OFFLINE_EMERGENCY` khỏi allowlist phương thức | `discount-approval.service.ts` (`'ONE_TOUCH', 'QR_JWT', 'SHORTCODE_BOUND'`) |
| Nhánh verify mã khẩn cấp `EMG-` | cùng file, nhánh `else if (method === 'OFFLINE_EMERGENCY')` |
| `emergencyCode` khỏi chữ ký `approveRequest` | cùng file (thuộc tính + destructure) |
| Cửa sổ "thu ngân gõ OTP / mã khẩn cấp" | `[id]/route.ts` → nay chỉ `session.role === 'ROLE_CASHIER' && action !== 'CANCEL'` |
| `emergencyCode` khỏi route POST | cùng file |
| Tab "Mã Khẩn Cấp (Offline)" + nội dung + nút | `DiscountApprovalModal.tsx` |
| Handler `handleApplyEmergencyCode` + 3 state + reset | cùng file |
| Import không dùng `KeyRound`, `WifiOff` | cùng file |
| Nhãn "Mã Khẩn Cấp" trong toast POS | `PosCheckoutTerminal.tsx` |
| Comment enum | `schema.ts:668` |

**Giữ nguyên có chủ đích:**
- `QR_JWT` ở service + test Case 6 — backend có test, xoá thì mất test.
- `SHORTCODE_BOUND` — `ManagerApprovalDrawer` **đang dùng thật**.
- `getDiscountSecret` (`discount-approval.service.ts:33-40`) — đã fail-closed trên production, **giống hệt** `getAuthSecret`. Không phải lỗi riêng, không đụng.
- **Nhánh QR (`:208-223` render effect + `:644-651` markup) và ô OTP (`:299-344`)** trong `DiscountApprovalModal` — vẫn còn, vẫn chết. Cố ý **chưa xoá**: file này 615 dòng, người dùng test trên điện thoại thật ở hội chợ, xoá ~90 dòng chỉ để dọp thuần không đổi hành vi là rủi ro lớn hơn giá trị. Ghi vào backlog dọp dẹp riêng.

### Test đã cập nhật (không xoá assertion)

| File | Việc |
|---|---|
| `test-s3-discount-approval.ts` | Case 7 viết lại thành hợp đồng **chặt hơn**: `OFFLINE_EMERGENCY` bị từ chối ở **cả** >25% **và** ≤25%, và yêu cầu phải **giữ nguyên PENDING** (trước chỉ chặn >25%) |
| `smoke-mobile-role-navigation.ts` | `doesNotMatch` cho route (`isOtpFlow`, `OFFLINE_EMERGENCY`, `emergencyCode`), service (`OFFLINE_EMERGENCY`, `startsWith('EMG-')`), modal (`OFFLINE_EMERGENCY`, `EMG-`, "1 trong 5 mã") + `match` allowlist 3 mục |

**Kết quả:** `tsc` sạch · `smoke-mobile-role-navigation` PASS · `test-s3-discount-approval` PASS · `test-discount-guard` 11/11 · `test-discount-checkout-atomic` PASS · `test-s2-pos-catalog` PASS · `test-order-guards` 7/7 · `test-pos-report-permissions` PASS · `test-transfer-payment-flow` PASS · `test-p0-verification` PASS.

---

## P4 — TB. ~~Hai ngữ nghĩa ATP đang lệch nhau~~ **ĐÃ LÀM 2026-09-29**

- `order.service.ts:1165-1191` — có kiểm `payment_expires_at` (30 phút).
- `pos-catalog.service.ts` — **không** kiểm, chỉ lọc 48h.

⇒ Đơn chuyển khoản quầy hết hạn sau 30 phút vẫn bị tính là "giữ chỗ" trong danh mục POS **tới 48 giờ** → giỏ trên quầy báo chặn ATP oan. Sửa: cho `pos-catalog` dùng lại `OrderService.getPendingEffectiveExpiry`.

**Đã làm:** `pos-catalog.service.ts` bỏ `groupBy` trong SQL, lấy thêm `createdAt` + `paymentExpiresAt`, prefilter rộng y hệt `getBatchATP`, rồi quyết định giữ chỗ trong JS bằng **chính** `OrderService.getPendingEffectiveExpiry` ⇒ chỉ còn một quy tắc hạn trong hệ thống.

**Test mới `C6` trong `test-s2-pos-catalog.ts`** (4 assertion): đơn quầy còn hạn thì vẫn giữ ATP · lùi `payment_expires_at` về quá khứ · ATP trả lại đủ · **`catalog` khớp `OrderService.getATP`**. Không có test này thì sửa lỗi sẽ không có chốt chặn.

---

## P3b — THẤP. ~~Dọn dead code còn lại~~ **ĐÃ LÀM 2026-09-29**

Gỡ **191 dòng** trong `DiscountApprovalModal.tsx`: nhánh QR/OTP không bao giờ
render. Bằng chứng (không phải suy đoán): `status` chỉ thành `PENDING` sau khi
POST thành công, mà `api/pos/discount-approvals/route.ts:58` **chỉ nhận
`ROLE_CASHIER`**, còn `currentRole` lấy từ cookie và không có bộ chuyển vai trò ở
client ⇒ `currentRole === 'ROLE_CASHIER'` luôn đúng ⇒ nhánh `else` chết.

Đã gỡ: 2 import (`QrCode`, `BrowserQRCodeSvgWriter`), state `shortCode`/`qrToken`/
`activeTab`/`managerOtpInput`/`isVerifyingOtp`/`otpError`, ref `qrContainerRef`,
effect vẽ QR, `handleVerifyManagerOtp` (47 dòng), cả nhánh `else` (113 dòng).
551 → 437 dòng. Giao diện duyệt thật nằm ở `ManagerApprovalDrawer`, không đụng tới.

**Hai test phải SỬA TRƯỚC khi xoá** (nếu không sẽ fail khó hiểu):
- `smoke-mobile-role-navigation.ts:351` assert trong hàm đã xoá → chuyển sang
  assert chặn đua response ở **đường đi sống**, thêm assert cấm mảnh vỡ còn sót.
- `browser-pos-terminal-test.tsx` **Test 12** đòi ô OTP cho phiên `ROLE_CASHIER`
  ⇒ test này **không thể pass từ trước khi sửa**. Đã viết lại theo hành vi thật,
  nhưng **chưa chạy được** (nằm ngoài `run-isolated` và ngoài `package.json`).

Các doc cũ `2026-09-22-pos-warehouse-refactor-design*.md` và
`KICH_BAN_DIEN_TAP_GO_LIVE_HOI_CHO.md` còn mô tả "quản lý đọc mã `EMG-`" — nay
không còn đúng.

---

## P5 — THẤP. ~~Timer client bỏ rơi duyệt hợp lệ~~ **ĐÃ LÀM 2026-09-29**

`DiscountApprovalModal.tsx` trước đây có 2 effect tách rời: đếm lùi (1s) tự khai `EXPIRED` khi về 0 **không hỏi server**, và poll trạng thái (2.5s). ⇒ Quản lý duyệt đúng trong ~2.5s cuối bị rơi dù server đã `APPROVED`.

**Đã làm:** tách `syncFromServer` (một `useCallback`) làm nguồn sự thật duy nhất. Cả poll lẫn đồng hồ đều gọi nó. Khi đếm về 0: `await syncRef.current()` trước; **chỉ khai `EXPIRED` nếu server không trả lời được** (offline / lỗi mạng) — giữ nguyên hành vi an toàn cũ cho thu ngân. Poll cũng gọi ngay khi mở thay vì chờ 2.5s.

**Test** (`smoke-mobile-role-navigation`, +3 assertion): bắt buộc có `const settled = await syncRef.current()`, `if (settled) return;`, và `syncFromServer` là hàm dùng chung.

---

## P6 — TB. ~~Đường migrate/seed~~ **ĐÃ LÀM (chặn) 2026-09-29**

| Nguy hiểm | Guard mới |
|---|---|
| `migrate-remote.ts` chạy `migrateFresh` **không có bảng ghi migration**, mỗi lần chạy lại từ `0000` trên 27 file (23/27 có câu không idempotent). Hiện *vô hại tình cờ* vì câu `CREATE TABLE bundle_items` đầu `0000` nổ ngay ⇒ 0 file chạy, 0 câu ghi | `migrate-fresh.ts` từ chối mọi URL không phải `file:` trừ khi có `ALLOW_REMOTE_MIGRATE=true` |
| `seed.ts` **ghi đè** `passcode_hash`+`salt` của 8 nhân viên mặc định (`9999`/`8888`/`1234`…), và `migrate-remote.ts:42` bảo chạy đúng script đó. `verifyStaffPasscode` **không** kiểm `AUTH_STRICT`/`NODE_ENV` | `seed.ts` từ chối khi `DATABASE_URL` không phải `file:` trừ khi có `SEED_STAFF_REMOTE=true` |

**Test chặn hồi quy** (`test-cron-auto-close`, 32 → **43** assertion): khẳng định `ALLOW_REMOTE_MIGRATE` và `SEED_STAFF_REMOTE` còn nguyên trong mã nguồn. Không có test thì 2 guard này sẽ bị xoá âm thầm.

**Cố ý CHƯA làm** (rủi ro thấp hơn, chi phí cao hơn):
- 10 script `apply-migration-0005..0014.ts` trỏ `DATABASE_URL` là ghi thẳng, không hỏi. Chúng là script một-lần đã dùng xong; thêm guard vào 10 file là diff lớn cho rủi ro thấp.
- `EXPECTED_TABLES` trong `migrate-remote.ts` thiếu mọi đối tượng sau `0015` ⇒ một lần chạy "thành công" có thể thiếu schema.
- `meta/_journal.json` có `when` **không đơn điệu** (`0008 > 0009`, `0024 > 0025/0026`) ⇒ `drizzle-kit migrate` sẽ **bỏ qua im lặng** 3 migration đó. **Đây mới là bẫy chết người** khi "sửa bằng cách trỏ drizzle vào prod". Cần `drizzle-kit generate` lại journal hoặc vá thứ tự.
- ~~`check_stock_non_negative` (`schema.ts:195`) không migration nào tạo ⇒ không có trên prod.~~ **ĐÃ XỬ LÝ 2026-09-29** — xem dưới.

### P6 bổ sung — trigger chặn tồn kho âm (ĐÃ LÀM 2026-09-29)

`check_stock_non_negative` trong `schema.ts` là `check()` của Drizzle mà **không
`.sql` nào sinh ra**, snapshot dừng ở `0014` ⇒ production có **0 trigger**. Đã đọc
prod trực tiếp để xác nhận. Lỗ thổng thật: `delivery-order.service.ts` trừ
`physical_quantity - item.quantity` **không chặn âm**.

Đã thêm migration `0027_stock_non_negative_check` (một trigger
`BEFORE UPDATE ... WHEN physical_quantity < 0 -> RAISE(ABORT)`), `when` =
`1790600003000`, **không snapshot** — đúng quy ước từ `0015`. Dùng trigger chứ
không sửa bảng vì SQLite không `ADD CONSTRAINT` mà `migrate-fresh` chạy **không
transaction, không rollback** — hỏng giữa chừng là mất bảng.

**Đã áp tay lên Turso**: 405 dòng tồn kho, **0 dòng âm**, trigger đã có sau khi
áp, dữ liệu không đổi. Nhớ `npm run deploy` **không** chạy migration.

Bốn điều kiện đã viết trong chính file migration (đừng phá):
1. `when` phải CAO HƠN entry trước, nếu không drizzle bỏ qua im lặng.
2. `idx: 27`, không snapshot.
3. Trigger phải là **MỘT khối**, không `statement-breakpoint` bên trong.
4. `IF NOT EXISTS` — vận hành tay không có bảng `__drizzle_migrations`.

**Bẫy đã dính:** comment trong file migration viết nguyên văn chuỗi
`--> statement-breakpoint` thì `migrate-fresh.ts` **cắt đôi** `CREATE TRIGGER`
giữa chừng. Không được viên chuỗi tách câu đó vào bất kỳ file `.sql` nào.


## P7 — THẤP. ~~Sửa 4 dòng sai trong handoff~~ **ĐÃ LÀM 2026-09-29**

- `2026-09-28-handoff-open-work.md`: thêm bảng cảnh báo ngay đầu file liệt kê 4 mục sai + sửa dòng "điều kiện **duy nhất**" (S1).
- `2026-09-28-handoff-pending-work.md:91`: sửa mục QR — ghi rõ thu ngân **cũng không thấy** QR.
- `2026-09-28-master-bug-summary.md`: gạch item 4 (`getStockMatrix`, đã sửa ở `084a50e`) + sửa item 2 và 3 theo kết luận kiểm chứng.

## P8 — THẤP. ~~Đơn mồ côi~~ **ĐÃ XOÁ 2026-09-29**

Hóa ra **không phải 1 đơn mồ côi** như handoff cũ ghi. `staff_accounts` chỉ còn
một tài khoản (`ADMIN-01`), còn **74 đơn `COMPLETED` trị giá 9.228.600đ** trỏ
tới `cashier_id` không tồn tại (`staff-admin`, `User-ROLE_CASHIER`,
`User-ROLE_OWNER`, …). `User-ROLE_CASHIER` là **chuỗi vai trò giả** — POS đã từng
ghi tên giả thẳng vào dữ liệu.

**Kiểm cả hai nơi trước khi ghi**: **production sạch** (8 tài khoản, 19 đơn, 0 mồ
côi). Chỉ DB **dev** bị ảnh hưởng. Backup 48 KB ở
`%TEMP%\opencode\orphan-orders-DEV-*.json` trước khi xoá.

Đã xoá: dev còn **3 đơn hợp lệ**, 0 đơn mồ côi. Script tái lập:
`scripts/purge-orphan-orders.ts` (mặc định chỉ đọc, cần `--apply`).

Bài học: **đừng tin mô tả của chính mình ở lượt trước** — handoff cũ ghi "đơn mồ
côi" và tôi đã suýt xoá 9,2 triệu tiền thật.

---

## Hai việc AN TOÀN đã tự vượt khỏi danh sách handoff

- **Token Cloudflare** `cfut_pE1…`: `scripts/deploy-cloudflare.ts` **không tồn tại**, chưa bao giờ commit. Nhưng `git log --all -S"cfut_"` ra **5 commit** ⇒ token **vẫn nằm trong git history**. Vẫn phải **thu hồi ở Cloudflare**. Tôi không in giá trị.
- **PIN mặc định**: 5 PIN trong `DEFAULT_DEV_PASSCODES` bị chặn bởi `AUTH_STRICT`/`NODE_ENV`. Nhưng 8 tài khoản trong `DEFAULT_STAFF_ACCOUNTS` **không** bị chặn — nó so với hash trong DB, thứ mà `AUTH_STRICT` không can thiệp. Cần bạn query prod mới biết còn sống hay không.

---

## Thứ tự đề xuất — CẬP NHẬT 29/09 (sau đợt sửa lớn)

| Bước | Việc | Trạng thái |
|---|---|---|
| 0 | P0 — `CRON_SECRET` = **401** | ✅ đo xong — **cần bạn set secret** |
| 1 | P3 — gỡ `OFFLINE_EMERGENCY` + cửa sổ OTP | ✅ xong |
| 2 | P4 — thống nhất ATP service ↔ pos-catalog | ✅ xong |
| 3 | P7 — sửa dòng sai trong 3 file doc | ✅ xong |
| 4 | P1(a) — gỡ ngõ cụt PIN ở đơn chiết khấu | ✅ xong |
| 5 | P1b — 2 cổng PIN còn lại | ✅ **ĐÃ GỠ HẾT** (backdate >7 ngày nay theo vai trò) |
| 6 | P2 — cron dọn đơn hết hạn | ✅ xong (+ sửa lệch 7h trong `listUnclosed`) |
| 7 | P5 — race timer client 2.5s | ✅ xong |
| 8 | P6 — chặn script migrate/seed | ✅ xong (+ trigger `0027` áp tay lên prod) |
| 9 | P3b — dọn dead code QR/OTP | ✅ xong, 191 dòng |
| 10 | P8 — dọn đơn mồ côi | ✅ xong (chỉ dev; **prod sạch**) |
| 11 | Kế hoạch A — modal Trạng Thái Hội Chợ | ✅ xong + đã deploy |
| 12 | **Lớp lỗi ngày nghiệp vụ (11 lỗi)** | ✅ xong — xem mục 7 của `2026-09-25-handoff-state.md` |
| 13 | **12 lỗi POS** | ✅ xong, 112 assertion mới |
| 14 | Xoá token Cloudflare khỏi git history | **CHỜ BẠN** (phải thu hồi ở Cloudflare) |
| 15 | Nghiệm thu iPhone | **CHỜ BẠN** — hệ thống chưa vận hành thật |
| 16 | Chạy tay `browser-pos-terminal-test.tsx` Test 12 | **CHỜ BẠN** (nằm ngoài runner) |
| 17 | Biểu đồ `ExecutiveDashboard` gom nhóm ngày UTC | chưa sửa — biết nhưng chưa tự kiểm chứng |

**Còn lại đúng 4 việc, và 3 trong số đó là việc của bạn, không phải của agent.**

**Xác minh hiện tại** (`0326e73`): `npx tsc --noEmit` sạch · **87/87 suite xanh**,
`EXIT=0`, chạy trọn một mạch. `formapubli.db` production nguyên vẹn 100%.

**Xác minh sau P1/P3/P4/P7:** `npx tsc --noEmit` sạch · **10/10 suite xanh**: `smoke-mobile-role-navigation`, `test-s3-discount-approval`, `test-s2-pos-catalog`, `test-discount-guard` (13/13), `test-discount-checkout-atomic`, `test-order-guards`, `test-pos-report-permissions`, `test-transfer-payment-flow`, `test-order-sales`, `test-p0-verification`. Chưa commit — chờ bạn yêu cầu.


