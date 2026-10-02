# BẢNG QUẢN TRỊ — KẾ HOẠCH LÀM THÔNG MINH HƠN

Trạng thái: **ĐÃ XONG** (nhánh `feat/dashboard-intelligence`, chưa merge, chưa deploy).
Ngày: 02/10/2026

---

## 0. KẾT QUẢ ĐÃ LÀM

| Hạng mục | Kết quả |
|---|---|
| W1 `/api/orders` trả kèm số lượng | `itemQty` / `itemLines` / `giftQty` cho mọi đơn, gom 1 câu `GROUP BY`, chia lô 500 id để không vượt giới hạn 32766 biến của SQLite |
| W2 Biểu đồ 7 ngày | `Revenue7DaysChart.tsx`: nhãn số trên cột, toggle **Doanh thu / Số cuốn**, cột cao nhất hổ phách, cột hôm nay viền đậm + nhãn `Hôm nay`, thứ trong tuần, đường TB, rê/bấm ghim xem chi tiết + Δ% |
| W3 Biểu đồ theo giờ | `HourlyTodayCard.tsx` bọc `HourlyOrdersChart`, thêm 2 prop optional `baseline` (TB 6 ngày trước) + `currentHour` (giờ chưa tới vẽ khung đứt). Khung giờ cố định theo 7 ngày |
| W4 Top 5 bản bán | `TopProductsCard.tsx` + `AnalyticsService.topEditions(..., excludeGifts)` (tách dòng quà, sửa nhóm `edition_id` NULL thành hàng hóa) |
| W5 Top 5 đơn lớn | `TopOrdersCard.tsx`: thêm `· N cuốn` cạnh mã đơn, ghi rõ số cuốn quà |
| W6 Cơ cấu kênh + thanh toán | `ChannelMixCard.tsx`, `PaymentMixCard.tsx` (thanh ngang theo tiền / theo số đơn) |
| W7 Ô KPI | `468 cuốn · TB 198.844 đ/đơn` dưới số đơn |
| Bỏ donut | Ô donut bị gỡ, đúng phê duyệt của chủ doanh nghiệp |

**Thêm ngoài kế hoạch:** mọi phép tính ngày/giờ dồn về `src/lib/vn-time.ts` (một nguồn chân lý thay vì mỗi màn hình tự quy định).

### Kiểm chứng đã chạy
- `npx tsc --noEmit` → sạch.
- `npx tsx scripts/run-isolated.ts --only=test-executive-reporting` → **28/28 PASS**.
- **Trình duyệt thật** (`http://localhost:3100`, đăng nhập Owner, 31 đơn giả nhập vào bản sao DB cục bộ rồi đã xoá):
  6 thẻ mới dựng đủ, donut không còn, **0 phần tử tràn ngang**, **0 nhãn SVG tràn khung**, **0 cặp nhãn chồng nhau**, biểu đồ 7 ngày có nhãn `360kđ / 1,3trđ / 5,1trđ …` + `Hôm nay` + thứ trong tuần, biểu đồ giờ có 4 đường TB và 9 cột "chưa tới".
- KPI hiện `468 cuốn`; thẻ Top bản bán hiện `Kèm 3 cuốn quà tặng đã phát` ⇒ đường quà chạy đúng từ DB lên UI.

### Bẫy đã dính trong lúc kiểm chứng (đừng lặp lại)
- **Service worker giữ JS cũ.** Sửa `hideHeader` xong, server ĐÃ trả code mới (grep thấy trong chunk) nhưng trình duyệt vẫn render bản cũ. Phải `unregister()` service worker + `caches.delete()` rồi mới reload mới thấy.
- **DB dev không có đơn nào trong 7 ngày gần nhất** ⇒ biểu đồ hiện state rỗng, không kiểm chứng được gì. Đã nhập 31 đơn giả vào **bản sao** `formapubli.db` của worktree để kiểm, xong trả lại bản gốc.
- **Không tự làm mới 60 giây** (đã cân nhắc rồi bỏ): mỗi lần gọi `/api/orders` đều ghi một dòng `VIEW_FISCAL_MANAGEMENT` vào `audit_logs` ⇒ tự làm mới 60s sẽ sinh ~1.400 dòng rác/ngày. Thay bằng nút "Làm mới số liệu" sẵn có, kèm giờ cập nhật.

### Việc còn lại
1. Chủ doanh nghiệp xem trên máy thật (`npm run dev:lan`, điện thoại) rồi duyệt.
2. Merge `feat/dashboard-intelligence` → `main` (chưa làm, chưa deploy).
3. Kiểm tra production xem bước backfill "Cổng 1b" đã chạy chưa: nếu `order_items.product_id` còn NULL thì tên **hàng hóa** trong Top bản bán sẽ trống (tên **sách** vẫn đúng vì lấy từ `editions`).

---

## 1. Đã kiểm tra: dữ liệu nào ta thật sự có

| Nguồn | Tình trạng (đo trên `formapubli.db`) |
|---|---|
| `orders` | 77 đơn COMPLETED. Có sẵn: `channel`, `paymentMethod`, `subtotal`, `discountAmount`, `finalAmount`, `warehouseId`, `createdAt` |
| `order_items` | 86 dòng · 352 cuốn. Có `quantity`, `is_gift_line`, `editionId`, `product_id` |
| `editions` | 88 bản, join OK → lấy được **tên sách** |
| `products` (hàng hóa 0032) | **0 dòng**, và `order_items.product_id` NULL ở 86/86 dòng ⇒ **không được chỉ join `products`** |
| `/api/orders` | Trả **toàn bộ** đơn, không giới hạn → mọi biểu đồ tính client-side, **không cần API mới** |

Kênh bán thật trong dữ liệu:

| Kênh | Số đơn | Doanh thu |
|---|---|---|
| Hội chợ | 34 | 2,22 tr |
| Quầy văn phòng | 22 | 1,84 tr |
| Đại lý sỉ | 18 | **5,17 tr** |

→ Đại lý: ít đơn nhất nhưng doanh thu lớn nhất. Đây là thông tin đáng có biểu đồ riêng.

Giờ bán trong dữ liệu dev: rải ở **0h, 1h, 2h, 18h, 22h, 23h** ⇒ biểu đồ 24 cột sẽ trống lơ lửng. Càng phải có khung giờ cố định.

---

## 2. Trả lời câu hỏi: thay ô donut bằng gì

**Đề xuất: "Top 5 bản bán"** (thanh ngang, kèm số cuốn + tiền).

Lý do: donut Sổ Thuế / Nội bộ nói lại đúng 2 ô Sổ Kép nằm ngay phía trên — thông tin trùng. Còn "bản nào bán chạy" thì Owner/Manager hành động được ngay (in thêm, chuẩn bị hàng), và API `view=top-editions` **đã có sẵn**, đã nhận `warehouseId` nên chạy theo ô chọn kho.

Nếu bạn muốn giữ donut → nói 1 câu, tôi giữ nguyên và xếp chỗ khác.

---

## 3. Bố cục sau khi overhaul

```
┌─ KPI ──────────────────────────────────────────────────────────┐
│ Doanh Thu Thực Tế │ Doanh Thu Thuế │ Tồn Kho │ Đơn + Cuốn + TB/đơn │
└────────────────────────────────────────────────────────────────┘
┌─ BIỂU ĐỒ ──────────────────────────────────────────────────────┐
│  Doanh thu 7 ngày (2c) │ Đơn theo giờ hôm nay (2c) │ Top bản bán (2c) │
├────────────────────────┼──────────────────────┬───────────────────┤
│ Top 5 đơn giá trị cao │ Cơ cấu kênh bán       │ Cơ cấu thanh toán │
└────────────────────────┴──────────────────────┴───────────────────┘
┌─ Bảng đơn gần đây ─────────────────────────────────────────────┐
└────────────────────────────────────────────────────────────────┘
```

---

## 4. 6 hạng mục công việc

### W1 — Server: cho `/api/orders` trả kèm số lượng (15 phút)
Thêm **1 câu gom** rồi gắn vào mỗi đơn:
```
SELECT order_id, COUNT(*) lines, SUM(quantity) qty,
       SUM(CASE WHEN is_gift_line=1 THEN quantity ELSE 0 END) giftQty
FROM order_items WHERE order_id IN (...) GROUP BY order_id
```
Kết quả mỗi đơn có `itemQty`, `itemLines`, `giftQty`. Thêm mới, không phá chỗ cũ.

### W2 — Biểu đồ 7 ngày (30 phút)
- Số trên đầu mỗi cột (`1,2tr` / `850k`), bấm/hover mới hiện số đầy đủ
- **Nút chuyển `Doanh thu` ↔ `Số cuốn`**
- Cột cao nhất màu hổ phách; cột "Hôm nay" viền đậm + nhãn
- Thứ trong tuần (T2…CN) dưới mỗi ngày
- Đường trung bình 7 ngày (nét đứt) + dòng tóm tắt: tổng 7 ngày, TB/ngày

### W3 — Biểu đồ theo giờ (45 phút)
Tái dùng `HourlyOrdersChart.tsx` (đã có số trên cột, cao điểm, vắng nhất). Thêm đúng **2 prop**:
- `baseline`: đường trung bình 6 ngày trước theo từng giờ → **"cao điểm" là so với thường lệ, không phải trong hôm nay**
- `currentHour`: giờ chưa tới vẽ mờ, kẻ vạch giờ hiện tại → không ai đọc nhầm thành "chưa bán được"

Khung giờ **cố định theo tuần** (tính từ 7 ngày, fallback 8h–21h) + nút chuyển `Hôm nay` / `7 ngày`.

### W4 — Ô Top 5 bản bán (30 phút)
Gọi `/api/analytics?view=top-editions&top=5`. Sửa **1 chỗ** trong `AnalyticsService.topEditions`:
- Tách dòng quà (`is_gift_line = 1`) ra khỏi "bán chạy" (quà tốn kho nhưng không phải bán được) — hiện `products` rỗng nên phải join `editions.title` trước, `products.name` làm dự phòng cho hàng hóa.

### W5 — Top 5 đơn giá trị cao (15 phút)
Thêm số lượng cạnh mã đơn: `ORD-20260911-TU3T · 30 cuốn`, có quà thì `(2 quốn quà)`. Dùng `itemQty` từ W1.

### W6 — Cơ cấu kênh bán + Cơ cấu thanh toán (25 phút)
Toán client-side từ `orders` đã có. Mỗi kênh: số đơn, tiền, % và thanh ngang. Thanh toán: Tiền mặt / Chuyển khoản / QR.

### W7 — Ô KPI "Đơn Hàng Đã Chốt" (10 phút)
Gộp 3 số vào 1 ô: `77 Đơn` + phụ đề `352 cuốn · TB 41.000đ/đơn`. Không thêm ô mới.

**Tổng: ~2 giờ 50 phút.**

---

## 5. Rủi ro đã biết

| # | Rủi ro | Xử lý |
|---|---|---|
| R1 | `products` rỗng, `order_items.product_id` NULL ở toàn bộ dữ liệu | Mọi thứ dựng trên `editions`, `products` chỉ là dự phòng |
| R2 | Bước backfill "Cổng 1b" chưa chạy trên dev DB ⇒ tên hàng hóa có thể trống | Tôi **không** tự đụng DB production. Cần bạn/Owner kiểm tra production sau |
| R3 | Dashboard không tự làm mới ⇒ để mở cả buổi thì biểu đồ giờ cũ | Thêm tự làm mới 60 giây (5 dòng) |
| R4 | Cây nguồn hiện có **7 file đang sửa dở của agent khác** | Tôi làm trong worktree riêng, không đụng `main` |

---

## 6. Xác minh trước khi báo xong

1. `npx tsc --noEmit`
2. Thêm test cho các hàm mới vào `scripts/test-executive-reporting.ts` (đã có sẵn pattern)
3. Mở trang thật ở `http://192.168.1.22:3000`, kiểm biểu đồ không chồng chữ, số không tràn

---

## 7. Đã chốt

- **Bỏ ô donut** — chủ doanh nghiệp duyệt ngày 02/10/2026.
- Thực hiện trên worktree riêng `D:\Data Project\formapubli-dashboard`, nhánh `feat/dashboard-intelligence`. **Chưa merge, chưa deploy.**
