# SPEC — Modal "Trạng Thái Hội Chợ" (giám sát bán hàng thời gian thực)

- **Ngày:** 2026-09-29
- **Trạng thái:** chờ duyệt
- **Phân loại:** architectural (subsystem mới) — đã brainstorm + duyệt bằng lời
- **Phạm vi:** Kế hoạch A (spec này). Kế hoạch B = sửa & làm đủ báo cáo ngày — **spec riêng**, xem §9.

---

## 1. Vấn đề & mục đích

Quản lý cần biết **ngay lúc đang bán** thì tình hình thế nào: ai đang ở gian hàng nào,
đơn nào đang chờ chuyển khoản, đơn nào vừa đóng, có đơn nào cần duyệt chiết khấu.

Hệ thống hiện tại **không** có màn hình này:

- Dashboard (`ExecutiveDashboard.tsx`) fetch **đúng 1 lần lúc mở** (`:62-64`), không tự
  làm mới, và số liệu lấy từ `/api/orders`.
- `/api/orders` **không có `LIMIT`**, query bảng `orders` **2 lần**, và **ghi 1 dòng
  `audit_logs` mỗi lần quản lý gọi** (`api/orders/route.ts:90-98`). Poll nó 5 giây =
  17.280 dòng nhật ký/ngày/người. → **Không được poll `/api/orders`.**
- Báo cáo chốt ngày là tài liệu **1 kho × 1 ngày đã đóng**, chỉ tính `COMPLETED`, không
  tự làm mới. **Không thay thế được** màn hình trạng thái hiện tại.

Hệ thống **không có SSE / WebSocket** (0 match `EventSource` / `WebSocket` /
`text/event-stream` trong `src/`). Kiến trúc là **100% polling**. Mọi poll hiện có:

| Chu kỳ | Chỗ |
|---|---|
| 2.5s | `DiscountApprovalModal.tsx:253` |
| 4s | `ManagerApprovalDrawer.tsx:135` |
| 5s | `NotificationBell.tsx:120` |
| 15s | `PosCheckoutTerminal.tsx:236` |

---

## 2. Quyết định thiết kế đã chốt

| # | Quyết định | Vì sao |
|---|---|---|
| D1 | **"Đơn đang mở" = `orders.status = 'PENDING_CONFIRMATION'`** | Giỏ chưa chốt **không** nằm trong DB (`PosCheckoutTerminal.tsx:261` chỉ `useState`). Đây là trạng thái chưa đóng duy nhất đã tồn tại. |
| D2 | **Modal mở từ nút trên Dashboard** (không thêm tab, không đụng `keyMap` `Alt+1..8`) | Hội chợ không phải ngày nào, không phải cả buổi → modal đúng hình thức. Chi phí = 0 khi đóng. Không phá thói quen phím tắc của 4-5 người dùng. |
| D3 | **Poll 10s, chỉ khi modal mở** | 4-5 máy × 10s = 30 request/phút. Chu kỳ nhanh hơn thì lãng phí, vì mục đích là **đúng trạng thái**, không phải độ trễ. |
| D4 | **Duyệt chiết khấu ngay trong modal** | `ManagerApprovalDrawer` tự fetch, tự POST, **không phụ thuộc POS** (2 props string đều optional, thiếu thì phạm vi = "Mọi kho"). Tái dùng nguyên xi, 0 dòng logic mới. |
| D5 | **Chỉ kho hội chợ** (`warehouseType = 'FAIR_EVENT'`). Tham số `warehouseId` lọc vào đúng 1 kho; **bỏ trống = tất cả kho hội chợ**. Xem kho vật lý (`PHYSICAL_MAIN`) **không nằm trong phạm vi**. | Khớp mục đích "bán hàng hội chợ". |
| D6 | **5 dòng** cho danh sách đơn vừa đóng | Đủ để xác nhận hệ thống còn sống. |
| D7 | **Monitor KHÔNG nhân bản** những gì đã thuộc về báo cáo ngày: giờ bán chạy nhất, doanh thu theo từng thu ngân, đối soát két, kiểm kê đóng thùng, giám sát chiết khấu trong ngày | Hai màn hình cùng tính một con số = tự tạo ra 2 con số khác nhau để tranh cãi. Những thứ này đã có trong báo cáo ngày. |
| D8 | **Có Top 5 sản phẩm bán chạy tích luỹ trong ngày** — đây là **ngoại lệ duy nhất** của D7 | Yêu cầu trực tiếp của người dùng. Dùng đúng logic đã có ở báo cáo ngày (`daily-settlement.service.ts:187-208`), chỉ khác phạm vi gộp kho. |

---

## 3. Ràng buộc kỹ thuật bắt buộc tuân thủ

1. **Trần 50 subrequest / Worker invocation** (Workers free plan). Endpoint mới: **7**.
2. **2 file mới + 1 file sửa.** Không refactor file cũ.
3. **Không ghi DB ở endpoint đọc.** Không `recordAuditLog`.
4. **Không đụng 3 endpoint đang chạy:** `/api/orders`, `/api/notifications`,
   `/api/pos/daily-settlement`.
5. **`cache: 'no-store'`** mọi fetch (service worker đã không cache `/api/*` —
   `public/sw.js:71` — nhưng HTTP cache của trình duyệt là tầng riêng).
6. **UI: tiếng Việt CÓ DẤU, nhãn ngắn, icon + viền + `title` + trạng thái sau khi bấm**
   (AGENTS.md).
7. **Không dùng class `animate-in` / `zoom-in-95` / `fade-in`** — `tailwind.config.ts:12`
   là `plugins: []` và `tailwindcss-animate` **không có trong `package.json`** → các class
   này không sinh CSS. Nếu cần hiệu ứng thì dùng `animate-slide-up`
   (`src/app/globals.css:52`), đã có thật.
8. **Không hạ assertion** (AGENTS.md). Không log PIN/giá trị secret.

---

## 4. Kế hoạch A0 — Bản vá chặn (làm trước tiên)

**File:** `src/components/dashboard/ExecutiveDashboard.tsx:73`

```
- const fairWh = json.data.find((w: any) => w.type === 'FAIR_EVENT');
+ const fairWh = json.data.find((w: any) => w.warehouseType === 'FAIR_EVENT');
```

`/api/warehouses` trả `warehouseType` (`api/warehouses/route.ts:60`), không có `type`.
→ `fairWh` luôn `undefined` → `selectedSettlementWarehouseId` **không bao giờ** rời khỏi
giá trị ghim cứng `'wh-du-phong'` (`:38`). Nếu kho đó không tồn tại → API trả 400 → modal
báo *"Không có dữ liệu báo cáo cho ngày đã chọn."* và người dùng tưởng không có dữ liệu.

Đây là **sửa lỗi**, không phải đổi tính năng: hiện tại nút chỉ có thể trỏ tới 1 kho ghim
cứng; sau khi sửa nó mới chọn được đúng kho hội chợ.

---

## 5. Kế hoạch A1 — Endpoint `GET /api/pos/live-monitor`

**File mới:** `src/app/api/pos/live-monitor/route.ts`

### 5.1 Thuộc tính

| Thuộc tính | Giá trị | Căn cứ |
|---|---|---|
| Phân quyền | `requireSessionRole(req, ['ROLE_OWNER','ROLE_MANAGER'])` | copy `api/pos/daily-settlement/route.ts:29-32` |
| Động | `export const dynamic = 'force-dynamic'` | `notifications/route.ts:8` |
| Ghi DB | **không ghi gì** | khác `/api/orders` |
| Tham số | `date` (YYYY-MM-DD, mặc định **ngày VN**), `warehouseId` (mặc định tất cả kho hội chợ) | `cron/auto-close/route.ts:110` |
| Ngày VN | `new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })` | `cron/auto-close/route.ts:110, 114` |
| Lỗi | `handleApiError(error)` | `api/warehouses/route.ts:69` |

`ROLE_TAX` / `ROLE_CASHIER` / `ROLE_WAREHOUSE` → **403**. Không cookie → **401**.

### 5.2 Sáu truy vấn, thứ tự cố định

| # | Bảng / điều kiện | Mục đích |
|---|---|---|
| 1 | `warehouses` WHERE `warehouse_type='FAIR_EVENT' AND is_active=1` | danh sách kho hội chợ (vài chục bản ghi) |
| 2 | `orders` WHERE `warehouse_id IN (…) AND status='COMPLETED' AND created_at LIKE 'D%'` **GROUP BY `payment_method`**, kèm `SUM(discount_amount)` và `SUM(CASE WHEN discount_rate >= 0.2 THEN 1 ELSE 0 END)` | KPI tổng hợp + tổng chiết khấu + số đơn vượt trần |
| 3 | `orders` WHERE `status='PENDING_CONFIRMATION'` ORDER BY `created_at` DESC `LIMIT 50` | đơn đang chờ tiền |
| 4 | `orders` WHERE `status='COMPLETED'` ORDER BY `created_at` DESC `LIMIT 5` | đơn vừa đóng |
| 5 | `cashbox_sessions` WHERE `status='OPEN'` LEFT JOIN `staff_accounts` | ai đang bán ở đâu (+ **tên**, hiện chỉ có mã) |
| 6 | `order_items` ⋈ `orders` ⋈ `editions` ⋈ `works` GROUP BY `editionId` ORDER BY `SUM(quantity)` DESC `LIMIT 5` | Top 5 sản phẩm bán chạy |

**Tổng: 6 truy vấn + 1 `validateSessionAccount` = 7 subrequest.** Không vòng lặp, không phụ
thuộc số đơn. Xa trần 50.

**Không có truy vấn cho duyệt chiết khấu** — khối 5 của UI nhúng `ManagerApprovalDrawer`
và nó tự fetch. Không badge số trên nút dashboard (YAGNI).

Lọc `created_at` bằng **tiền tố 10 ký tự `LIKE 'D%'`** — an toàn cho cả 2 họ định dạng
đang cùng tồn tại trong bảng (`YYYY-MM-DDTHH:MM:SS.sssZ` của app và
`YYYY-MM-DD HH:MM:SS` của `CURRENT_TIMESTAMP`). Đây là pattern an toàn đã có sẵn trong
dự án (`order.service.ts:1156-1161`, `pos-catalog.service.ts:93-95`). **Không dùng `>=`/`<=`**
với chuỗi ISO.

`overdue` / `minutesLeft` **tính bằng chính helper `OrderService.isPendingExpired`** và
`paymentExpiresAt` — cùng cách server quyết định, để monitor không bao giờ báo "quá hạn"
khác với điều server thật sự làm. `paymentExpiresAt = null` (đơn chờ không phải chuyển
khoản quầy, `order.service.ts:463-470`) → `minutesLeft = null`, UI hiện "—", không đếm
ngược.

### 5.3 Hình dạng trả về

```ts
{ success: true, data: {
  businessDate: string;              // 'YYYY-MM-DD' theo giờ VN
  timezoneNote: string;              // 'Tính theo ngày làm việc Việt Nam (UTC+7)'
  fairWarehouses: Array<{ id; code; name }>;
  today: {
    orderCount: number;
    revenue: number;                 // Σ finalAmount
    cashRevenue: number;             // paymentMethod = 'CASH'
    transferRevenue: number;         // 'BANK_TRANSFER' | 'QR_CODE'
    otherRevenue: number;            // còn lại (COD…) — hiện POS không tạo, chừa để không đếm sai
    transferPct: number;             // transferRevenue / revenue, 1 chữ số
    avgOrderValue: number;           // revenue / orderCount
    totalDiscount: number;
    overCapCount: number;            // discountRate >= 0.2
  };
  openShifts: Array<{
    id; warehouseId; warehouseName; cashierId; cashierName;
    openedAt; elapsedMinutes; overdue;
    expectedCashLive;                // openingCash + cashSalesTrongCa  (xem 5.4)
  }>;
  pending: Array<{
    id; orderCode; cashierId; cashierName; warehouseName;
    finalAmount; paymentMethod;      // 'CASH' | 'BANK_TRANSFER' | 'QR_CODE' | 'COD'
    createdAt; expiresAt;           // expiresAt = null nếu không phải chuyển khoản quầy
    minutesLeft: number | null;     // null khi expiresAt = null → UI hiện "—", không đếm ngược
    overdue: boolean;
  }>;
  recentClosed: Array<{ orderCode; warehouseName; finalAmount; paymentMethod; createdAt }>;
  topSellers: Array<{ code; title; copies; revenue }>;
  generatedAt: string;               // ISO
}}
```

### 5.4 Ba chỗ cố ý khác báo cáo ngày — và vì sao

| Chỗ | Báo cáo ngày hiện tại | Monitor | Lý do |
|---|---|---|---|
| `expectedCashLive` | `daily-settlement.service.ts:156` cộng cột `totalCashSales`, cột này là **bản chốt lúc đóng ca** nên **luôn = 0 khi ca còn mở** → "tiền kỳ vọng" thấp hơn thực tế, đối chiếu với dòng "doanh số tiền mặt" ngay bên cạnh và **mâu thuẫn** | tính đúng = `openingCash + Σ cashSales(cashierId, warehouseId)` từ query 2 | Là định nghĩa đúng. **Kế hoạch B sẽ sửa báo cáo ngày theo định nghĩa này** → một định nghĩa, hai nơi. |
| `businessDate` | `daily-settlement.service.ts:51` lọc theo **ngày UTC** | ngày **Việt Nam** | `cron/auto-close/route.ts:110` đã dùng giờ VN. Hai quy ước đang cùng tồn tại trong cùng một tính năng. |
| `otherRevenue` | không tách; mọi thứ không phải CASH/BANK_TRANSFER/QR_CODE rơi vào nhóm `card` (`:89-92`), và **UI không render nhóm `card`** → tiền COD biến mất khỏi màn hình | tách riêng, có thể = 0 | Tránh mất tiền khi POS bắt đầu cho COD. |

### 5.5 Sai lệch ngày VN vs UTC — nói thẳng, không giấu

Báo cáo ngày lọc `LIKE 'D%'` theo **ngày UTC**; monitor dùng **ngày VN**. Hai con số
**có thể lệch nhau trong khung 00:00–07:00 giờ VN**: đơn lúc 03:00 ngày 26 VN được
tính vào ngày 25 của báo cáo ngày.

Hội chợ VN bán 8h–21h nên tình cờ không xảy ra. Nhưng **im lặng là cách chắc chắn sinh ra
2 con số khác nhau**. Vì vậy:

- Modal **hiện rõ** dòng chữ *"Tính theo ngày làm việc Việt Nam (UTC+7)"*.
- Ghi vào response `timezoneNote` để test A4-5 kiểm được.
- **Kế hoạch B thống nhất cả hai về ngày VN.**

---

## 6. Kế hoạch A2 — Component `LiveFairMonitorModal`

**File mới:** `src/components/dashboard/LiveFairMonitorModal.tsx`

### 6.1 Props

```ts
{ isOpen: boolean; onClose: () => void; }
```

### 6.2 Quyết định kỹ thuật, kèm tiền lệ bắt buộc theo

| Quyết định | Tiền lệ trong repo |
|---|---|
| `PortalToBody` | `src/components/PortalToBody.tsx` — docblock gọi đây là pattern duy nhất |
| **`useModalFocusTrap(isOpen && mounted, onClose)`** | `src/hooks/useModalFocusTrap.ts`, 6 chỗ đang dùng. `ManagerApprovalDrawer` và `DailyFairSettlementModal` đều **quên** → bấm Tab mất chỗ. Modal mới **không được quên**. |
| Poll: `if (!isOpen) return;` → gọi ngay → `setInterval(10000)` → `clearInterval` khi đóng | `ManagerApprovalDrawer.tsx:131-137` |
| Dừng khi `document.hidden` | `TransferPaymentModal.tsx:140-155` — nơi **duy nhất** trong repo xử lý `visibilitychange` (comment `:136-139`: `setInterval` bị throttle khi màn hình điện thoại khoá) |
| Refetch ngay khi `window` focus | `NotificationBell.tsx:121-122` |
| Giãn dần 10s → 20s → 40s khi lỗi mạng, reset khi thành công | chống dội trên mạng hội chợ yếu |
| Chân modal: "Cập nhật lúc HH:MM:SS · Tự làm mới mỗi 10 giây" + nút "Làm mới" | `ManagerApprovalDrawer.tsx:512-528` |
| `<640px`: **1 thẻ/đơn** xếp dọc · `≥640px`: bảng | Repo **không có** bản mẫu card-cho-mobile (49 chỗ `sm:hidden` đều bọc header, không cái nào bọc `<tbody>`; mọi bảng rộng đều `<table>` + `overflow-x-auto`, vd `StockOverviewMatrix.tsx:1096` 9 cột `min-w-[640px]`). Bảng 5 cột cuộn ngang trên iPhone là không dùng được. |

### 6.3 Sáu khối nội dung

1. **KPI hôm nay** — `Đơn hôm nay` · `Doanh thu` · `Tiền mặt` / `Chuyển khoản` + `Tỷ lệ chuyển khoản` · `Đơn TB` · `Chiết khấu hôm nay` + `N đơn ≥ 20%`.
   - `Tỷ lệ chuyển khoản` tụt về 0% là tín hiệu QR / tài khoản ngân hàng hỏng — cảnh báo sớm.
2. **Ai đang bán ở đâu** — `Tên thu ngân · Kho · Mở ca lúc HH:MM · Tiền mặt dự kiến trong két`.
   - Ca quá giờ → nhãn đỏ **"Quá giờ X phút"**. *(Route báo cáo ngày đã tính sẵn `openShiftAlerts` mỗi lần mở nhưng **không màn hình nào hiện** — sẽ hiện ở đây, và ở báo cáo ngày ở kế hoạch B.)*
3. **Đơn đang chờ tiền** — `Mã đơn · Thu ngân · Kho · Giá trị · Hình thức · đếm ngược`.
   - Quá hạn (hạn 30 phút, `order.service.ts:463-470`) → nhãn đỏ.
   - Nút **"Huỷ"** (xem §6.5). **KHÔNG có nút "Xác nhận"** (xem §6.4).
4. **Đơn vừa đóng** — 5 dòng `Mã đơn · Kho · Giá trị · Hình thức · Giờ chốt`.
5. **Top 5 sản phẩm bán chạy hôm nay** — `Mã · Tên · Số cuốn · Doanh thu`.
6. **Cần duyệt chiết khấu** — nút mở, bên trong nhúng `ManagerApprovalDrawer` (không truyền `warehouseId` → phạm vi "Mọi kho").

### 6.4 Vì sao KHÔNG có nút "Xác nhận" ở khối 3

Đây là phát hiện chặn một lỗ hổng, đã kiểm chứng:

1. **Mọi đơn `PENDING_CONFIRMATION` đều là chuyển khoản/QR.** Tiền mặt chốt là
   `COMPLETED` thẳng. POS chỉ tạo đơn chờ khi `isDigitalPayment`
   (`PosCheckoutTerminal.tsx:1510, 1356`).
2. **Server bắt buộc có ảnh xác nhận**: `order.service.ts:1311-1313` — thiếu thì
   `400 "Phải lưu ảnh xác nhận trước khi xác nhận đơn chuyển khoản/QR."`
3. **Ảnh chỉ nằm trong điện thoại của thu ngân**: `src/lib/offline-db.ts:219` — store
   IndexedDB `payment_proof_photos`. Không có bản ghi nào trên máy chủ; audit log chỉ ghi
   chuỗi `proof=<id>` (`order.service.ts:1394`).

→ **Không quản lý nào, trên máy nào khác máy thu ngân, xác nhận được đơn đó.** Nút
"Xác nhận" sẽ luôn báo lỗi. Thay bằng chữ **"Cần NV-xx chụp ảnh xác nhận"** — đúng giá
trị giám sát: quản lý thấy đơn kẹt và biết gọi ai.

### 6.5 Nút "Huỷ" — đường ghi đã có sẵn, không tạo lỗ hổng mới

`POST /api/orders` với `{ action: 'CANCEL', orderId, reason }`. Đã kiểm:

- `paymentProofError` trả `null` khi không gửi proof (`api/orders/route.ts:31`) → CANCEL
  không đòi ảnh.
- `cancelOrder` kiểm quyền trong transaction: `assertOrderActor` (`order.service.ts:1428`),
  Owner/Manager mọi đơn, CASHIER chỉ đơn của mình.
- Chỉ nhận `status = 'PENDING_CONFIRMATION'` (`:1433`), tự chống gọi lại (`isIdempotent`, `:1430`).
- Có chặn đóng két: đơn gắn `cashboxSessionId` không được huỷ sau khi ca đóng (`:1440-1443`).
- Đã ghi `audit_logs` sẵn.

**Không tạo đường ghi mới, không tạo lỗ hổng mới.**

### 6.6 Ràng buộc UI

- Mọi nút: icon lucide-react + nhãn tiếng Việt **có dấu**, ngắn, động từ + `title` +
  trạng thái sau khi bấm (vd `"Đã huỷ: ORD-…"`).
- Trạng thái lỗi: hiện rõ, không nuốt. Hiện tại `DailyFairSettlementModal.tsx:106-108` nuốt
  lỗi vào `console.error` rồi hiện *"Không có dữ liệu"* — modal mới **không được làm vậy**.
- Trạng thái mạng yếu: `generatedAt` cũ hơn 30s → nhãn cảnh báo.

---

## 7. Kế hoạch A3 — Nút trên Dashboard

**File sửa:** `src/components/dashboard/ExecutiveDashboard.tsx` — **đúng 3 thứ**:

1. 1 `useState<boolean>` cho `isLiveMonitorOpen`.
2. 1 nút trong cụm `:158-224` (cụm đã `flex-wrap` nên tự xuống dòng trên màn hình hẹp).
3. 1 mount cạnh `DailyFairSettlementModal` ở `:614-623` — đúng pattern mount có sẵn.

Nút: icon `Activity`, nhãn **"Xem Trạng Thái"**, `aria-label="Xem trạng thái bán hàng hội chợ"`,
chỉ hiện cho OWNER/MANAGER (đã có `isOwnerOrManager` ở `:134`).

**Không** thêm `allowedNavItems`, **không** sửa `keyMap` `Alt+1..8` (D2).

---

## 8. Kế hoạch A4/A5 — Test & Verify

### A4 — `scripts/test-live-monitor.ts` (đăng ký vào `scripts/run-isolated.ts`)

| # | Assertion |
|---|---|
| 1 | MANAGER/OWNER → 200; CASHIER/WAREHOUSE/TAX → 403; không cookie → 401 |
| 2 | Payload có đủ 6 khối + `timezoneNote` |
| 3 | `pending` chỉ chứa `PENDING_CONFIRMATION`; không lẫn `COMPLETED` |
| 4 | `recentClosed` đúng 5 dòng, thứ tự `created_at` giảm dần |
| 5 | **Bắt lỗi UTC:** đơn lúc `2026-09-25T20:00Z` (= 03:00 ngày 26 VN) phải thuộc `businessDate = '2026-09-26'` |
| 6 | **Không ghi thêm dòng `audit_logs`**: đếm trước/sau, phải bằng nhau |
| 7 | `overCapCount` đếm đúng số đơn `discount_rate >= 0.2` |
| 8 | `expectedCashLive` = `openingCash + Σ cashSales` (không phải cột `totalCashSales`) |
| 9 | UI: có `useModalFocusTrap`, có `visibilityState`, có nhãn `Xem Trạng Thái`, **không** có `animate-in` |

Chạy: `npx tsx scripts/run-isolated.ts --only=test-live-monitor`

### A5 — Verify (bắt buộc, không bỏ được)

1. `npx tsc --noEmit`
2. `npm run build` — **dừng `next dev` trước**, xoá `.next`, rồi mới `npm run dev:lan`
   (AGENTS.md §0: build khi dev đang chạy làm hỏng trang, không thể bỏ qua)
3. 8 suite hồi quy cũ: `test-pos-report-permissions`, `test-s4-settlement`,
   `test-autoclose-shift`, `smoke-mobile-role-navigation`, `test-modal-dismiss`,
   `test-mobile-kho-ui`, `test-cron-auto-close`, `test-warehouse-stock`
4. **Trình duyệt thật** ở `http://192.168.1.246:3000` — desktop + viewport iPhone
   390×844, chụp ảnh trước/sau. Bắt buộc: AGENTS.md ghi đã có 1 lần ship UI hỏng mà
   assertion vẫn xanh (menu nằm 6597px dưới viewport). Test nguồn **không** chứng minh
   được modal hiện đúng.
5. **Test nghịch với tiền thật:** tạo 1 đơn chuyển khoản trên POS → mở modal → thấy
   đếm ngược → bấm **"Huỷ"** → đơn biến mất khỏi modal, tồn kho được giải phóng, và
   **báo cáo ngày không đổi** (đơn bị huỷ không tính vào doanh thu cả trước lẫn sau).
   Không đạt thì dừng, không deploy.

---

## 9. Ngoài phạm vi — Kế hoạch B (báo cáo ngày, spec riêng)

Tách riêng vì đụng đối soát két + biên bản ký pháp lý: sai một chỗ là mất tiền thật và
khó phát hiện.

**Sửa 9 lỗi:**

| Lỗi | Vị trí |
|---|---|
| `w.type` sai tên cột | `ExecutiveDashboard.tsx:73` (đã ở A0) |
| Nút "Chốt Ngày" **không chốt gì** — mở báo cáo read-only; `closeDay` chỉ được cron gọi, UI không gọi POST | `DailyFairSettlementModal.tsx:92` |
| `openShiftAlerts` tính mỗi lần mở nhưng **không màn hình nào đọc** | `daily-settlement/route.ts:59` |
| `expectedCashTotal` cộng cột `totalCashSales` (luôn 0 khi ca mở) | `daily-settlement.service.ts:156` |
| `cashVariance = null` khi còn ca mở → dòng đối soát bị ẩn | `:163-165` |
| COD rơi vào nhóm `card` + UI không render nhóm đó → tiền biến mất | `:89-92` + `DailyFairSettlementModal.tsx:386-422` |
| Ngày UTC lệch ngày VN ở 3 chỗ; cron lại dùng giờ VN → 2 khung ngày | `:51, :108, :136, :447, :466` |
| `parseDbTimestamp(...)!` non-null assertion có thể ném `TypeError` trong transaction | `:402-404` |
| `date` không validate; `_` trong tham số là ký tự đại diện `LIKE` | `route.ts:36`, `:364` |

**Thêm 6 phần người dùng yêu cầu:** giờ bán chạy nhất · danh sách từng đơn + chi tiết sách
· doanh thu theo từng thu ngân · giá trị đơn trung bình · giờ chốt từng đơn · **lưu số đếm
kiểm kê thật** (hiện chỉ là state trình duyệt, không tới `closeDay` — bản in A4 là ảnh
chụp dữ liệu chưa lưu).

**Thống nhất ngày VN** giữa monitor và báo cáo ngày (xem §5.5) và dùng chung định nghĩa
`expectedCashLive` (xem §5.4).

**Cố ý KHÔNG làm:** Top sản phẩm và giờ bán chạy trong monitor (đã ở báo cáo ngày), ATP
nhiều kho (đã có ở Ma trận kho), đơn quà tặng trong ngày (đã có ở báo cáo ngày), xuất CSV.

---

## 10. Rủi ro đã biết

| Rủi ro | Mức | Xử lý |
|---|---|---|
| Số liệu monitor (ngày VN) lệch báo cáo ngày (ngày UTC) trong khung 00:00–07:00 VN | Thấp | Ghi rõ trên modal + `timezoneNote`; Kế hoạch B thống nhất |
| "Xanh giả": test nguồn xanh nhưng modal hỏng trên trình duyệt thật | **Cao** | A5.4 bắt buộc, không bỏ |
| Bảng 5 cột không dùng được trên iPhone | Trung bình | Biến thể card-cho-mobile ở `<640px` (§6.2) |
| Đơn chuyển khoản kẹt → thu ngân không thấy modal | Thấp | Chuông đã báo sẵn (`notifications/route.ts:110-125`); modal cho biết cần gọi ai |
| `getStaleOpenShiftCheck` tốn 1+3N truy vấn | Thấp | Không tái dùng; monitor tự tính `overdue` từ `openedAt` (query 5), 0 truy vấn phụ |

---

## 11. Ước lượng

| Hạng mục | Thời gian |
|---|---|
| A0 bản vá | 10 phút |
| A1 endpoint | 1.5 giờ |
| A2 component (nhiều nhất là biến thể mobile) | 3-4 giờ |
| A3 nút dashboard | 15 phút |
| A4 test | 1.5 giờ |
| A5 verify | 1 giờ |
| **Tổng** | **~2 ngày công** |
