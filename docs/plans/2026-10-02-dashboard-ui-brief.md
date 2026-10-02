# BRIEF THIẾT KẾ + HỢP ĐỒNG CODE — Overhaul Bảng Quản Trị

> Nguồn chân lý cho **mọi** subagent. Đọc trước khi viết code. Không sửa file ngoài phạm vi được giao.

## 0. Bối cảnh

Bảng quản trị (`src/components/dashboard/ExecutiveDashboard.tsx`) hiện có 3 ô biểu đồ: cột 7 ngày,
donut Sổ Thuế/Nội bộ, Top 5 đơn lớn. Chủ doanh nghiệp đã **duyệt bỏ donut** và thay bằng
"Top 5 bản bán", thêm biểu đồ theo giờ, thêm cơ cấu kênh bán + thanh toán.

Worktree: `D:\Data Project\formapubli-dashboard` — nhánh `feat/dashboard-intelligence`.
TUYỆT ĐỐI: không `git commit`, `git checkout`, `git stash`, `npm run build`, `next dev`.
Chỉ sửa file được giao. `node_modules` là JUNCTION trỏ về repo chính — cấm xoá worktree.

## 1. QUY TẮC UI/UX BẮT BUỘC (áp dụng cho mọi ô biểu đồ)

### 1.1 Vỏ thẻ
```
className="rounded-2xl bg-white border border-slate-200/80 shadow-sm p-5
           hover:shadow-md transition-shadow"
```

### 1.2 Đầu thẻ
- Tiêu đề: `text-xs font-bold uppercase tracking-wider text-slate-500`, kèm icon lucide-react 16px màu nhấn (`w-4 h-4`).
- Phụ đề: `text-[11px] text-slate-400 mt-0.5` — MỘT câu tiếng Việt có dấu, nói rõ cách đọc.
- Vùng nút chuyển: `flex items-start justify-between gap-3`, cụm nút `shrink-0`.

### 1.3 Nút chuyển (segmented control) — dùng cho mọi toggle
```tsx
<div role="group" className="inline-flex rounded-lg bg-slate-100 border border-slate-200 p-0.5 shrink-0">
  <button type="button" aria-pressed={active} aria-label="Hiển thị theo doanh thu"
    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors ${
      active ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
    }`}>
```
Nút dài hơn 4 từ thì viết tắt (`7 ngày`, `Hôm nay`, `Doanh thu`, `Số cuốn`).

### 1.4 Số liệu
- Tiền đầy đủ: `n.toLocaleString('vi-VN')` + `đ`.
- Tiền rút gọn (nhãn nhỏ trên cột): `1,2tr` · `850k` · `0` — viết 1 hàm `fmtCompactVnd(n)`.
- Mọi con số: `font-mono tabular-nums` (chống số nhảy khi đổi số liệu).
- **KHÔNG** nhỏ hơn `text-[10px]`. Nhãn trục SVG tối thiểu `fontSize={10}`.

### 1.5 Bảng màu chạy dữ liệu (nhất quán toàn trang)
| Ý nghĩa | Màu |
|---|---|
| Dữ liệu chính | `#6366f1` (indigo-500) |
| Cao nhất / cao điểm | `#f59e0b` (amber-500) |
| Tăng | emerald-600 · Giảm: rose-600 |
| Đường tham chiếu / trung bình | `#94a3b8`, `strokeDasharray="3 3"` |
| Cột "hôm nay" | viền `#4338ca` + nhãn chữ `Hôm nay` |

### 1.6 Tiếng Việt
CÓ DẤU, NGẮN, động từ làm nhãn. Đúng: `Doanh thu`, `Số cuốn`, `Hôm nay`, `Cao điểm`,
`Thấp điểm`, `Chưa tới`, `Đơn hàng`. Sai: `Doanh thu 7 ngay`, `Bieu do`, `Khoang khung`.

### 1.7 A11y & trạng thái
- Mọi `<svg>` biểu đồ: `role="img"` + `aria-label` mô tả đúng nội dung và đơn vị.
- Vùng bấm rộng bằng cả bề rộng cột (`<rect fill="transparent">` phủ trên cả vùng cột), không bắt buộc trúng thanh.
- `:focus-visible:ring-2 ring-indigo-500` cho mọi nút. Nút dài ≥ 28px.
- **Không** dùng màu đơn độc để truyền đạt — luôn kèm số hoặc chữ.
- Trạng thái rỗng: icon + một câu `text-xs text-slate-400` + hướng dẫn hành động. Không để trống trơn.

### 1.8 Responsive
- Grid: `grid-cols-1 lg:grid-cols-2 xl:grid-cols-3` tuỳ khối.
- Biểu đồ giờ 18 cột: bọc `overflow-x-auto` + `min-w-[520px]` bên trong để không vỡ trên điện thoại.

### 1.9 Không thêm thư viện
Repo KHÔNG có chart lib. Vẽ bằng SVG thuần (`<rect>`, `<text>`, `<line>`, `<polyline>`) hoặc CSS.
Cấm `npm install` mới.

## 2. HỢP ĐỒNG CODE (giữ đúng tên & kiểu — file khác đã phụ thuộc vào)

### C1 — `GET /api/orders` (mỗi phần tử trong `orders[]`)
Bổ sung 3 trường số, thiếu thì 0:
```ts
itemQty: number   // tổng số cuốn/món của mọi dòng hàng
itemLines: number // số dòng hàng
giftQty: number   // số cuốn thuộc dòng quà (is_gift_line = 1)
```

### C2 — `src/lib/vn-time.ts` (file MỚI, do agent B tạo)
```ts
export const VN_TZ: string
export const vnDayFmt: Intl.DateTimeFormat
export function vnBusinessDay(value: string | Date | null | undefined): string | null
export function shiftVnDay(day: string, deltaDays: number): string
export function vnHourOf(value: string | Date | number | null | undefined): number | null
export function vnDayOf(value: string | Date | number | null | undefined): string | null
export const DAY_LABELS_VN: readonly string[] // ['CN','T2','T3','T4','T5','T6','T7] theo 0=Sunday của VN
```
Agent D và agent E2 import trực tiếp từ `@/lib/vn-time` — **không** tự viết lại hàm giờ Việt.

### C3 — `HourlyOrdersChart` (2 prop MỚI, CẢ HAI đều optional)
```ts
baseline?: Array<number | null>  // index = giờ 0..23, giá trị = số đơn bình quân của các ngày trước; null = không vẽ
currentHour?: number | null      // giờ hiện tại 0..23; giờ > currentHour coi là "chưa tới"
```
- Không truyền prop ⇒ hành vi y hệt hiện tại (báo cáo ngày không được đổi).
- `baseline` vẽ `polyline` nét đứt xám CHỈ trên các giờ đã có số liệu.
- `currentHour`: cột `hour > currentHour` vẽ viền đứt `#e2e8f0`, KHÔNG tô màu, KHÔNG ghi số `0`,
  và nhãn giờ đó in mờ hơn.

### C4 — `GET /api/analytics?view=top-editions`
Thêm query param optional `excludeGifts=1`.
- Không truyền ⇒ hành vi cũ 100% (không được phá `TopEditionsPanel` ở tab Bán hàng).
- Có truyền ⇒ `items` loại dòng `is_gift_line = 1`; thêm `totalGiftQty: number` ở cấp `data`.

## 3. Danh sách thẻ mới (tất cả file MỚI)

| File | Nhận | Chức năng |
|---|---|---|
| `dashboard/Revenue7DaysChart.tsx` | `{ orders, className? }` | Biểu đồ cột 7 ngày + toggle Doanh thu / Số cuốn |
| `dashboard/HourlyTodayCard.tsx` | `{ orders, className? }` | Bọc `HourlyOrdersChart`, tự tính dữ liệu giờ + đường TB |
| `dashboard/TopProductsCard.tsx` | `{ warehouseId, className? }` | Top 5 bản/hàng bán chạy, tự fetch |
| `dashboard/TopOrdersCard.tsx` | `{ orders, className? }` | Top 5 đơn giá trị cao + số cuốn |
| `dashboard/ChannelMixCard.tsx` | `{ orders, className? }` | Cơ cấu kênh bán 7 ngày |
| `dashboard/PaymentMixCard.tsx` | `{ orders, className? }` | Cơ cấu hình thức thanh toán 7 ngày |

Mọi thẻ: export default hoặc export named đều được, nhưng **phải** là `export function <Tên>(...)`.
Không được import `ExecutiveDashboard` từ thẻ (tránh vòng phụ thuộc).

## 4. Quy tắc dữ liệu — SỰ THẬT ĐÃ ĐO, ĐỪNG ĐOAN

- `products` TRỐNG và `order_items.product_id` NULL ở toàn bộ dữ liệu hiện có ⇒ tên sản phẩm
  phải lấy từ `editions.title`. Đừng join `products` làm nguồn chính.
- Giờ Việt Nam: `created_at` trong DB là UTC, người đọc là giờ VN (+7, không DST).
  Cột thời gian có cả dòng ISO (`T`) lẫn dòng SQLite (` `) ⇒ luôn đi qua
  `parseDbTimestamp` từ `@/lib/db-timestamp`. Cấm `toISOString().slice(0,10)`.
- `/api/orders` trả **toàn bộ** đơn COMPLETED của phạm vi đang chọn, không giới hạn.
- Đơn hủy (`CANCELLED`) không có trong response ⇒ mọi tính toán chỉ nói về đơn đã chốt.
