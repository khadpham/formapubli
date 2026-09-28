# KẾ HOẠCH — Kế hoạch A (nợ còn lại) + Kế hoạch B (chưa viết spec)

- **Ngày:** 2026-09-29
- **Căn cứ:** `main` = `ae51c53` (đã deploy prod worker `779d9857-35f3-448f-93cd-d5bf1c58a79d`)
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

### A5.3 — CHƯA LÀM. 8 suite hồi quy, mới chạy 3

Phải chạy nốt: `test-pos-report-permissions`, `test-s4-settlement`,
`smoke-mobile-role-navigation`, `test-modal-dismiss`, `test-mobile-kho-ui`,
`test-cron-auto-close`, `test-warehouse-stock`.

Có rủi ro thấp vì A không đụng file dùng chung, nhưng spec ghi bắt buộc thì làm.

### A5.5 — CHƯA LÀM. Nghịch thử với tiền thật. **Đây là bước quan trọng nhất còn lại**

Spec A5.5 ghi rõ: *"Không đạt thì dừng, không deploy."* — đã deploy mà chưa làm bước này.
Cần kiểm trên **dev**, không đụng prod:

1. Mở POS ở kho hội chợ, tạo 1 đơn chuyển khoản, **chưa** xác nhận.
2. Mở modal "Xem Trạng Thái" → phải thấy đơn ở khối *Đơn đang chờ tiền* + đếm ngược.
3. Bấm **"Huỷ"** → đơn biến mất khỏi modal.
4. Kiểm ATP: món vừa giữ chỗ phải **được giải phóng** ngay.
5. Mở báo cáo ngày → **không đổi** (đơn bị huỷ không tính doanh thu, trước lẫn sau).

### 6 lỗi còn nợ trong A — CHƯA SỬA

| # | Lỗi | Vị trí | Tác động |
|---|---|---|---|
| **A-1** | `expectedCashLive` gom theo `warehouseId + cashierId` thay vì `cashboxSessionId` | `route.ts:200`, `:220` | Một thu ngân mở **hai** ca cùng kho → hai ca cùng nhận một số tiền. Ca qua nửa đêm → tiền trước nửa đêm của hôm qua bị cộng vào ca, tiền sau nửa đêm bị rớt. **Sai số tiền thật.** |
| **A-2** | `recentClosed` không lọc theo ngày | `route.ts:154-165` | Lệch spec "5 đơn vừa đóng **trong ngày**" — hiện là 5 đơn mới nhất **mọi thời đại** |
| **A-3** | Ca đang mở không có cờ quá giờ | `route.ts:149` chỉ có `overdue` ở đơn chờ | Spec §6 yêu cầu nhãn đỏ "Quá giờ X phút" |
| **A-4** | Khi mở `ManagerApprovalDrawer`, modal monitor không bị `inert` | `LiveFairMonitorModal.tsx` | Cả 2 modal cùng nằm ở `document.body`; hook chỉ inert `#app-main-content` → Tab trôi ra modal dưới |
| **A-5** | `warehouseId` sai/không tồn tại trả `200` + phạm vi rỗng | `route.ts` | Nên `400`/`404` để lộ lỗi cấu hình |
| **A-6** | `date` chỉ kiểm regex, không kiểm ngày có thật | `route.ts` | `2026-02-30` trả `200` rỗng im lặng |

Ngoài ra: `otherRevenue` (COD) được trả về nhưng UI không hiển thị → COD làm doanh thu
biến khỏi tổng "tiền mặt + chuyển khoản" mà không có dòng nào giải thích.

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

| Bước | Việc | Lý do |
|---|---|---|
| 1 | A-1 + A-2: `expectedCashLive` theo `cashboxSessionId`, `recentClosed` lọc ngày | Sai số tiền thật, đã lên prod |
| 2 | A-3 + A-4 + A-5 + A-6 + hiển thị COD | Nhỏ, cùng file, làm một lượt |
| 3 | **A5.5 nghịch thử với tiền thật trên dev** | Spec: "Không đạt thì dừng, không deploy" |
| 4 | A5.3 chạy nốt 8 suite hồi quy | Spec bắt buộc |
| 5 | Dọn worktree/branch đã merge (giữ nguyên mọi thứ dirty) | Đã được user duyệt |
| 6 | Viết **spec Kế hoạch B** rồi mới code | B đụng đối soát két, cần duyệt trước |
| 7 | P1b, P8, P6-journal — cần user quyết hoặc xác nhận | Chặn ở quyết định người dùng |
