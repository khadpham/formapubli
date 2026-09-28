# KẾ HOẠCH — Kế hoạch A (nợ còn lại) + Kế hoạch B (chưa viết spec)

- **Ngày:** 2026-09-29
- **Căn cứ:** `main` = `57c833e` (đã deploy prod worker `4c45dec8-85d6-4de0-a3de-94347184977c`)
- **Spec Kế hoạch A:** `docs/superpowers/specs/2026-09-29-live-fair-monitor-design.md`
- **Tracker P0–P8:** `docs/superpowers/plans/2026-09-29-open-work-corrected-plan.md`

---

## 0. Lưu ý về trí nhớ

Agent làm việc này **không có** lượt trò chuyện chứa Kế hoạch A/B trong context.
Nội dung dưới đây được **dựng lại từ 2 file spec trong repo**, không phải từ trí nhớ.
Khi nào tài liệu và trí nhớ lệch nhau, tài liệu là chuẩn.

---

## 1. Kế hoạch A — Modal Trạng Thái Hội Chợ — TRẠNG THÁI

### Đã xong (đã deploy `ae51c53`)

| Mục | Nội dung |
|---|---|
| A0 | Bản vá chặn: `ExecutiveDashboard.tsx:73` đọc `warehouseType` thay vì `type` |
| A1 | `GET /api/pos/live-monitor` — đọc-only, RBAC OWNER/MANAGER, ngày VN |
| A2 | `LiveFairMonitorModal.tsx` — 6 khối, poll 10s, dừng khi tab ẩn, backoff 10/20/40 |
| A3 | Nút "Xem Trạng Thái" trên dashboard, không thêm nav/keymap |
| A4 | `scripts/test-live-monitor.ts` — 28 assertion nguồn, đăng ký vào `run-isolated.ts` |
| A5.1 | `tsc --noEmit` sạch |
| A5.2 | `build` sạch (đã dừng dev, build, xoá `.next`, `dev:lan`) |
| A5.4 | **Trình duyệt thật**: desktop + iPhone 12 390×844 — `mainInert=true`, Escape đóng modal và gỡ `inert`, không tràn ngang (390/390), cao 777 ≤ 844, đủ 5 khối + KPI, API 200 poll đều, prod 401 khi chưa đăng nhập |

### A5.3 — 8 suite hồi quy — ĐÃ CHẠY ĐỦ (2026-09-29)

`test-pos-report-permissions` · `test-s4-settlement` · `test-autoclose-shift` ·
`smoke-mobile-role-navigation` · `test-modal-dismiss` · `test-mobile-kho-ui` ·
`test-cron-auto-close` · `test-warehouse-stock` — **8/8 PASS**.

Lưu ý: `test-warehouse-stock` trước đó **chưa được đăng ký** trong
`scripts/run-isolated.ts`, nên không chạy được bằng `--only`. Đã thêm vào.

### A5.5 — nghịch thử với tiền thật — ĐẠT (2026-09-29, trên dev)

Dựng dữ liệu thật bằng `scripts/a55-money-probe.ts seed` (kho `FAIR_EVENT`,
1 ca mở, 5 cuốn tồn, 1 đơn chuyển khoản `PENDING_CONFIRMATION` 2 cuốn 150.000đ
còn hạn), rồi bấm nút **Huỷ** thật trong modal.

| Kiểm | Kết quả |
|---|---|
| Đơn hiện trong modal kèm đếm ngược | ✅ `ORD-A55-PROBE · Thu ngân A5.5 · Kho A55 · Chuyển khoản · 150.000 đ · còn 28 phút` |
| Bấm **Huỷ** → đơn biến mất khỏi modal | ✅ khối *Đơn đang chờ tiền* chuyển sang "Không có đơn nào đang chờ" |
| Trạng thái trong DB | ✅ `PENDING_CONFIRMATION` → `CANCELLED` |
| **Báo cáo ngày không đổi** | ✅ doanh thu `null` trước và sau — đơn bị huỷ không tính vào doanh thu |
| Có ghi audit | ✅ `ORDER_CANCELLED`, `actor_role = ROLE_OWNER` |
| ATP được giải phóng | ⚠️ **không kiểm được** — xem phát hiện mới bên dưới |

Đã khôi phục `formapubli.db` về nguyên trạng sau khi thử
(backup: `%TEMP%\opencode\formapubli.db.bak-before-a55`).

### PHÁT HIỆN MỚI — kho hội chợ ATP KHÔNG trừ đơn đang giữ chỗ

`OrderService.getBatchATP` (`order.service.ts:1152-1155`) **thoát sớm** với kho
`warehouseType = 'FAIR_EVENT'`:

```ts
if (wh?.warehouseType === 'FAIR_EVENT') {
  for (const id of ids) out.set(id, balMap.get(id) || 0);   // ← tồn vật lý, KHÔNG trừ giữ chỗ
  return out;
}
```

Nhánh này nằm **trước** truy vấn `held` ở `:1165`. Đo thật: 5 cuốn tồn, 2 cuốn
đang giữ chỗ bởi đơn chuyển khoản còn hạn ⇒ **ATP vẫn = 5, không phải 3**.

⇒ Ở kho hội chợ, bán 3 cuốn cho 3 khách chờ chuyển khoản đều được ⇒ **bán vượt tồn**.
Phạm vi chưa rõ: `OrderService.createOrder` có tự chặn riêng hay không, cần kiểm
thêm trước khi kết luận là lỗi. **CHƯA SỬA** — nằm ngoài Kế hoạch A, cần quyết
riêng vì đổi semantics ATP là việc lớn.

### 6 lỗi đã sửa (commit `57c833e`)

| # | Lỗi | Vị trí | Sửa |
|---|---|---|---|
| **A-1** | `expectedCashLive` gom theo kho+thu ngân, lọc theo ngày | `route.ts` | gom theo `cashboxSessionId`, không lọc ngày |
| **A-2** | `recentClosed` không lọc ngày | `route.ts` | thêm điều kiện ngày |
| **A-3** | thiếu cờ quá giờ; `elapsedMinutes` sai +7h | `route.ts` | dùng `evaluateShiftCutoff` có sẵn |
| **A-4** | drawer duyệt không inert modal monitor | `LiveFairMonitorModal.tsx` | tự `setAttribute('inert')` + trả focus |
| **A-5** | `warehouseId` sai trả 200 rỗng | `route.ts` | trả 400 |
| **A-6** | ngày giả `2026-02-30` qua được | `route.ts` | `isRealDate()` so ngược Y-M-D |

Ngoài ra: hiện COD trong KPI.

Test chặn hồi quy: `test-live-monitor.ts` 28 → **41** assertion nguồn;
thêm mới `test-live-monitor-runtime.ts` **39** assertion gọi thẳng route handler
(hai ca cùng thu ngân phải ra hai số khác nhau · đơn hôm qua không lọt vào
`recentClosed` · không ghi `audit_logs` · tham số rác trả 400).

### Còn NỢ

| Mục | Trạng thái |
|---|---|
| Test **tạo** đơn qua `POST /api/orders` | Không làm — cần đủ cấu hình POS (lease phiên, gán kho, mở ca). Phần cần kiểm là phần **huỷ**, phần đó đi qua API thật. Ghi rõ giới hạn này. |
| Quyết định về phát hiện ATP ở kho hội chợ | **CHỜ USER** — đổi semantics ATP ảnh hưởng POS nhiều nơi |
| Quyết định có sửa lỗi A-1/A-2 đã lên prod hay để nguyên | Đã sửa và deploy (`57c833e`) |

---

## 2. Kế hoạch B — Báo cáo ngày — CHƯA VIẾT SPEC, CHƯA LÀM

Cố ý tách riêng vì đụng đối soát két + biên bản ký pháp lý: sai một chỗ là mất tiền thật.

### 9 lỗi phải sửa

| Lỗi | Vị trí |
|---|---|
| `w.type` sai tên cột | `ExecutiveDashboard.tsx:73` — **đã sửa ở A0** |
| Nút "Chốt Ngày" **không chốt gì** — mở báo cáo read-only; `closeDay` chỉ cron gọi | `DailyFairSettlementModal.tsx:92` |
| `openShiftAlerts` tính mỗi lần mở nhưng **không màn hình nào đọc** | `daily-settlement/route.ts:59` |
| `expectedCashTotal` cộng cột `totalCashSales` (luôn 0 khi ca mở) | `daily-settlement.service.ts:156` |
| `cashVariance = null` khi còn ca mở → dòng đối soát bị ẩn | `daily-settlement.service.ts:163-165` |
| COD rơi vào nhóm `card` + UI không render nhóm đó → tiền biến mất | `daily-settlement.service.ts:89-92` + `DailyFairSettlementModal.tsx:386-422` |
| Ngày UTC lệch ngày VN ở 3 chỗ; cron lại dùng giờ VN → 2 khung ngày | `:51, :108, :136, :447, :466` |
| `parseDbTimestamp(...)!` non-null assertion có thể ném `TypeError` trong transaction | `daily-settlement.service.ts:402-404` |
| `date` không validate; `_` trong tham số là ký tự đại diện `LIKE` | `daily-settlement/route.ts:36`, `:364` |

### 6 phần người dùng đã yêu cầu

1. Giờ bán chạy nhất
2. Danh sách từng đơn + chi tiết sách
3. Doanh thu theo từng thu ngân
4. Giá trị đơn trung bình
5. Giờ chốt từng đơn
6. **Lưu số đếm kiểm kê thật** — hiện chỉ là state trình duyệt, không tới `closeDay`.
   Bản in hiện là ảnh chụp dữ liệu **chưa lưu**.

### Cố ý KHÔNG làm trong B

Top sản phẩm + giờ bán chạy trong monitor (đã có ở báo cáo ngày) · ATP nhiều kho
(đã có ở Ma trận kho) · đơn quà tặng trong ngày (đã có ở báo cáo ngày) · xuất CSV.

### Phụ thuộc chéo với A

- **Thống nhất ngày VN** giữa monitor và báo cáo ngày (spec A §5.5).
- **Dùng chung định nghĩa `expectedCashLive`** (spec A §5.4). Hiện A đã đúng, B đang sai.

⇒ Làm B **sau khi** sửa xong A-1, để có một định nghĩa chuẩn để cả hai cùng dùng.

---

## 3. Việc khác còn treo

| Mục | Trạng thái |
|---|---|
| P1b — 2 cổng PIN: gõ bù >7 ngày, phiếu đổi/trả quá hạn | **CHỜ USER QUYẾT.** Không tự xoá — xoá là mất kiểm soát |
| P8 — đơn mồ côi `ORD-20260928-B768A09233642AFF` | **CHỜ USER XÁC NHẬN** |
| P3b — dead code nhánh QR + ô OTP 4 số trong `DiscountApprovalModal` | Thấp, rảnh tay làm |
| P6 — `meta/_journal.json` có `when` **không đơn điệu** (`0008 > 0009`, `0024 > 0025/0026`) | **"Bẫy chết người"** — `drizzle-kit migrate` sẽ bỏ qua im lặng 3 migration. Chưa sửa |
| P6 — `EXPECTED_TABLES` thiếu mọi đối tượng sau `0015` | Chưa sửa |
| P6 — `check_stock_non_negative` không migration nào tạo ⇒ không có trên prod | Chưa sửa |
| Token Cloudflare `cfut_…` còn trong git history (5 commit) | **CẦN THU HỒI Ở CLOUDFLARE.** Chưa làm |
| 8 tài khoản `DEFAULT_STAFF_ACCOUNTS` không bị `AUTH_STRICT` chặn | Cần query prod mới biết PIN còn sống |
| 12 cặp kho/ngày chưa chốt (19–20 mọi kho, 28 có 2 kho) | Cần quyết định nghiệp vụ: chốt retroactively hay sửa `listUnclosed()` chỉ yêu cầu ngày có phát sinh |
| 2 kho ngày 28 bị chặn vì còn ca két mở | Cần thu ngân đóng ca thật |

---

## 4. Thứ tự làm tiếp

| Bước | Việc | Trạng thái |
|---|---|---|
| 1 | A-1 … A-6 + test nguồn 41 + test runtime 39 | ✅ xong, deploy `57c833e` |
| 2 | A5.3 chạy 8 suite hồi quy | ✅ 8/8 |
| 3 | A5.5 nghịch thử tiền thật trên dev | ✅ đạt (trừ kiểm ATP — xem phát hiện mới) |
| 4 | Dọn worktree/branch đã merge (giữ nguyên mọi thứ dirty) | đã được user duyệt |
| 5 | Viết **spec Kế hoạch B** rồi mới code | B đụng đối soát két, cần duyệt trước |
| 6 | Quyết ATP kho hội chợ (bán vượt tồn) | **CHỜ USER** |
| 7 | P1b, P8, P6-journal — cần user quyết hoặc xác nhận | **CHỜ USER** |
