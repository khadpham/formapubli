# BẢNG TỔNG HỢP — mọi lỗi đã báo + kế hoạch (28/09/2026)

Cập nhật sau phiên làm việc 28/09. Nguồn: main `ab99d53`, prod `ea44433f`.
Battery: **68/68 suite xanh, exit 0**. `tsc --noEmit` sạch.

---

## 0. Bảng trạng thái (đọc dọc 1 bảng này)

| # | Lỗi bạn báo | Nguyên nhân gốc | Trạng thái |
|---|---|---|---|
| 1 | iOS không có nút cài PWA | `beforeinstallprompt` **không bao giờ fire trên iOS** (WebKit cố ý không implement) | ✅ Đã xử lý — băng hướng dẫn Chia sẻ · ⏳ chờ test iPhone |
| 2 | Chuyển ngược hàng loạt từ kho hội chợ về kho gốc | Modal chỉ biết 3 mã kho cứng, kho hội chợ rơi về `totalStock` (tổng mọi kho) | ⏳ Đang làm |
| 3 | Thu ngân thấy dashboard trước khi bị giới hạn | `initialSession?.role \|\| 'ROLE_OWNER'` — không có phiên thì mặc định **quyền cao nhất** | ✅ Đã sửa |
| 4 | Mã QR bị hiện 2 lần | 3 `<VietQrPay>` cùng mount, 2 nhánh `&&` giống hệt nhau, không `else` | ✅ Đã sửa |
| 5 | Quản lý có ép đăng xuất máy khác? | **Đã có sẵn 100%** từ trước — chỉ thiếu nhãn + dùng `window.prompt` | ✅ Đã sửa UX |
| 6 | Chiết khấu >20% + chuyển khoản | `order.service.ts` **ném 400** khi đơn chờ xác nhận có approval | ✅ Đã sửa |
| 7 | Nội dung QR là mã đơn dài, không phải mẫu tuỳ biến | 2 effect cùng ghi 1 state, effect mã đơn khai báo sau → **xoá mất mẫu** | ✅ Đã sửa |

## 1. Phát hiện thêm trong lúc điều tra (không phải bạn báo, nhưng là lỗ hổng thật)

| # | Vấn đề | Mức | Trạng thái |
|---|---|---|---|
| A | `/api/warehouses?all=true` chặn theo `?all=true` nhưng **không chặn theo role** → thu ngân lấy tồn thật mọi kho (đúng URL `VietQrPay` dùng) | Cao | ✅ Đã chặn |
| B | Bản QR thứ nhất mang **mã đơn cũ (trước khi tạo đơn)**; khách quét nhầm → chuyển sai nội dung | Cao | ✅ Đã sửa |
| C | Kho hội chợ có ledger là **luôn không xoá được** (409) — phải *Ngưng hoạt động* | Thông tin | ⚠️ Cần nhớ khi dùng |

## 1b. Review độc lập bằng Kilo tìm ra 3 hồi quy do chính tôi gây (đã sửa)

| # | Hồi quy | Nguyên nhân | Đã sửa |
|---|---|---|---|
| P0-1 | Rớt lease (heartbeat 401) làm POS **unmount → mất sạch giỏ hàng** | Tôi gắn `currentRole` thẳng vào `session` nên rớt phiên là mất vai trò | Tách `role` thành state, khởi tạo `initialSession?.role ?? null` (vẫn **không** default OWNER). Chỉ xoá vai trò khi đăng xuất tường minh |
| P0-2 | Gõ tay nội dung QR 1 lần → **đơn sau vẫn mang nội dung đơn cũ** | `manualContent` không bao giờ reset | Reset khi `initialContent` đổi (ref so sánh) |
| P0-3 | QR **vẫn 2 lần** ở bền rộng < 1024px khi mở sheet | Bản trong panel hiện ở mọi bền rộng (`grid-cols-1`), bản trong sheet là `lg:hidden` | Bọc bản trong panel bằng `hidden lg:block` → không bao giờ cùng hiện |
| P1-4 | Sidebar hiện 2 nút **chết** trước khi đăng nhập (do tôi truyền `'ROLE_CASHIER'` giả) | — | Chỉ render sidebar khi có vai trò |
| P1-5 | Bảng Nhật sự bị kéo thành **12 cột** | Subagent thêm `<td colSpan={6}>` thành cell thứ 7 của hàng 6 cột | Tách thành `<tr>` riêng |
| P1-6 | Thiếu `aria-label` ừ `<select>` tài khoản + ô nội dung | — | Đã thêm |

## 1c. Ghi nhận: battery đôi lúc crash `0xC0000005`

Suite khác nhau mỗi lần (`test-s3-delivery-orders`, `test-transfer-payment-flow`), luôn kèm
`SQLITE_BUSY` retry trước đó; mỗi suite chạy riêng đều **PASS 100%**; các lần chạy còn lại
**68/68 xanh**. Kết luận: segfault native của libsql/Turso client khi chạy dồn nhiều suite
cùng lúc — **flaky môi trường, không phải hồi quy code**. Cần theo dõi nếu nó xuất hiện
trên CI.


---

## 2. Chi tiết kỹ thuật từng lỗi đã sửa

### Lỗi 1 — PWA iOS
- `public/icons/*.png` **mới** (180/192/512) sinh từ SVG cũ bằng `scripts/gen-pwa-icons.ts`
  (`sharp` đã có sẵn, **không thêm dependency**; script tự assert kích thước PNG vì iOS **bỏ qua im lặng** icon sai).
- `manifest.json`: icon → PNG, bỏ `maskable` (logo không nằm trong safe zone), thêm `id`/`scope`/`lang`.
- `layout.tsx`: `apple-touch-icon` → PNG (**iOS không nhận SVG**), thêm `viewportFit: 'cover'`
  (trước đó 7 chỗ `env(safe-area-inset-*)` đều ra `0px`).
- `PwaRegister.tsx`: nhánh iOS hiện hướng dẫn *Chia sẻ → Thêm vào màn hình chính*; tự nhớ đã đóng
  (`localStorage`); tự nhích trên thanh home.
- `sw.js` bump `v4` + precache PNG.

### Lỗi 3 — Rò dashboard cho thu ngân
- `MasterAppShell.tsx`: bỏ hẳn fallback `'ROLE_OWNER'`. `currentRole` suy ra từ `session` (một nguồn duy nhất),
  `currentTab` tính **lúc render** qua `effectiveTab` thay vì sửa trong `useEffect`.
- Bỏ 2 effect sửa sai lệch (`:88-93`, `:161-165`).
- Toàn bộ thân app gate bằng `currentRole && effectiveTab === '...'`.
- **Kết quả:** thu ngân → POS ngay khung hình đầu, không có khung hình nào thấy dashboard.
  Sidebar tự ẩn tab (đã có sẵn từ trước, không phải do việc này).
- Chốt hồi quy trong `smoke-mobile-role-navigation.ts`: fail nếu tái xuất hiện `|| 'ROLE_OWNER'`.

### Lỗi 6 — Chiết khấu ≥20% + chuyển khoản
Trước: `createOrder` ném `400 'Đơn chờ xác nhận không được dùng approval chiết khấu'`
→ thu ngân duyệt xong rồi bấm "Tạo đơn & hiện QR" là **chết**, không hiện được QR.
Cách sửa: **xoá chặn**, vì approval vốn đã được tiêu thụ **nguyên tử trong cùng transaction**
(`consumeApproval`) và mức chiết khấu đã **đóng băng vào dòng đơn**; `confirmOrder` không hề
đụng approval. Không cần sửa gì ở TTL.

### Lỗi 7 — Nội dung QR
Tách hàm thuần `src/lib/transfer-content.ts` + test `scripts/test-pos-qr-content.ts` (**17/17**).
Giữ được ô "tự sửa" (biến `manualContent` thắng mẫu).

---

## 3. Còn lại

### 3.1. Kho hội chợ — lấy toàn bộ tồn về kho gốc (đang làm)
Nút mới **"Lấy tồn thật kho nguồn"**: mọi ấn bản có tồn > 0 ở kho nguồn, SL = tồn thật
(bỏ cap 30 của nút cũ). Chỉ bổ sung dòng còn thiếu, không đụng dòng bạn tự sửa.
"Có lựa chọn" thì **không cần code thêm** — sửa SL và xoá dòng đã có sẵn.
Sau khi lấy hết: **Ngưng hoạt động** (không dùng Xoá — xoá luôn 409 vì đã có sổ kho).

### 3.2. Chờ bạn test trên iPhone thật
1. Băng "Thêm vào màn hình chính" có hiện khi mở bằng Chrome iOS không.
2. Đăng nhập thu ngân → có vào thẳng POS, không thấy dashboard.
3. POS → Chuyển khoản → chỉ **1** mã QR, nội dung đúng mẫu đã tuỳ biến.
4. POS → Chuyển kho → Hàng loạt → chọn kho hội chợ làm nguồn → "Tồn Nguồn" đúng riêng kho đó.

### 3.3. Deploy
Sau khi bạn nghiệm thu: `npm run deploy` từ worktree sạch ở commit main.
BẤT BIẾN: `[vars] NEXT_PRIVATE_MINIMAL_MODE = "1"` trong `wrangler.toml`.

---

## 4. Cấu hình agent (đã chỉnh, không cần làm gì)

| Công cụ | Model | Ghi chú |
|---|---|---|
| opencode subagent | `openrouter/stealth/space-bunny-alpha` (19 agent) | Bạn tự setup, tôi chỉ ghim model cho subagent |
| Kilo CLI | `kilo/stealth/space-bunny-alpha` (mọi agent) | Nguyên trạng của bạn, **không sửa** |
| Cline CLI | Provider `cline` | Không sửa; khi dispatch truyền `-P/-m` |

---

## 5. Còn tồn đọng, CHƯA yêu cầu (không tự làm)

Ghi lại để quyết sau, không tự đụng vào:

1. Đơn chuyển khoản ở kho **hội chợ** giữ tồn **48 giờ** thay vì 30 phút
   (`order.service.ts` — `isCounterChannel` chỉ nhận `RETAIL_OFFICE`), và bỏ qua yêu cầu két mở.
2. Duyệt chiết khấu bằng **QR** có backend + test nhưng **UI chưa từng được viết** — không ai gọi được,
   kể cả thu ngân (ô QR nằm trong nhánh quản lý mà modal chỉ mở cho thu ngân). **Không xây UI quét QR.**
3. Không có tác vụ nền giải phóng đơn `PENDING_CONFIRMATION` hết hạn; chỉ có nút bấm tay của Quản lý.
   Đơn kẹt **chặn không cho chốt ngày**, và làm `autoCloseSession` từ chối đóng ca ⇒ tê cả đường ống
   đêm của cron (xem P2 trong `2026-09-29-open-work-corrected-plan.md`).
   *Lưu ý 2026-09-29: đơn quầy hết 30′ **không** giữ ATP — ATP theo thời gian, không theo trạng thái.*
4. ~~`getStockMatrix` đếm TẤT CẢ bản ghi `stock_balances` không lọc `condition='NEW'`.~~
   **ĐÃ SỬA + COMMIT `084a50e`** — nay lọc `condition='NEW'`. Xoá khỏi danh sách tồn đọng.
5. `StockOverviewMatrix.tsx:105` còn `currentRole = 'ROLE_OWNER'` mặc định — hiện **không gọi tới được**
   (shell luôn truyền prop), để nguyên vì thêm guard chỉ là chi phí không sinh lợi.
