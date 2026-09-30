# Kế hoạch — Sửa sạch bảng quản trị tổng quan (30/09, đêm)

## Vấn đề người dùng báo
1. Thẻ "Tồn Kho Vật Lý" trên bảng quản trị hiện **81 Đầu Sách** — sai, đã
   thêm đầu sách mới.
2. Còn **tiếng Anh trong ngoặc** ở một số tiêu đề, ví dụ
   `Phân Tách Dòng Tiền Sổ Kép (Dual Projection Architecture)`.

## Nguyên nhân gốc (đã xác minh bằng cách đọc code, không đoán)

### 1. Số liệu dashboard **GHI CỨNG**, không phải số tính
`ExecutiveDashboard.tsx:363` là **chữ viết thẳng trong JSX**: `81 Đầu Sách`.
Kèm theo, cả hai dòng dưới cũng ghi cứng:
- `Tồn Kho Vật Lý (3 Kho)` — production có **5 kho**.
- `Kho 1 Âu Cơ | Kho 2 Quỳnh Mai | Kho 3 Hội Chợ` — tên kho viết thẳng.

⇒ Không phải "số cũ chưa cập nhật", mà là **thẻ này chưa từng lấy dữ liệu**.
Thẻ ngay bên cạnh (`Đơn Hàng Đã Chốt`) thì dùng `summary?.totalOrders` — số thật.
Đây là lỗi nghiêm trọng: bảng quản trị **nói dối người dùng**.

### 2. Tiếng Anh trong ngoặc
Quét toàn bộ `src/**/*.tsx`, chỉ lấy **text hiển thị cho người dùng** (bỏ qua
comment trong code và biểu thức JSX). Kết quả: **8 chỗ thật**, 8 chỗ kia là false
positive (comment, tên biến, mã kho).

## Cách sửa

### Bước 1 — Số liệu thật cho thẻ tồn kho
Thêm `view=stock-summary` vào `GET /api/analytics` (dùng lại chốt phân quyền
`OWNER/MANAGER` sẵn có, **không tạo route mới**).
`AnalyticsService.stockSummary()` trả về:
- `titlesWithStock` — số ấn bản **đang có tồn vật lý > 0** (chỉ `is_active`)
- `totalUnits` — tổng số cuốn tồn
- `totalSkus` — tổng số ấn bản đang hoạt động
- `warehouseCount` / `warehouseNames` — từ bảng kho (lọc `is_active`)

Rồi thẻ trên dashboard dùng số này, và danh sách tên kho sinh từ
`warehouses` mà dashboard **đã có sẵn** (đã fetch `/api/warehouses?all=true`).

### Bước 2 — Gỡ tiếng Anh trong ngoặc (8 chỗ)
Xoá phần tiếng Anh, giữ tiếng Việt. Không thay bằng từ khóa kỹ thuật tiếng Anh
khác (ví dụ đổi `(Official VAT)` thành `(VAT)` là **vẫn sai** — phải bỏ hẳn hoặc
viết tiếng Việt).

### Bước 3 — Chốt tái phát (đây là phần chống lặt vặt)
Thêm test `test-dashboard-ui-text.ts` canh **3 bất biến**:
1. Dashboard **không được** có số liệu ghi cứng dạng `<số> Đầu Sách` trong JSX.
2. Thẻ tồn kho phải lấy từ API, không phải chữ viết thẳng.
3. Không còn tiếng Anh trong ngoặc ở **text UI** (loại trừ comment/mã kỹ thuật).

Không có test này thì 3 tháng sau lại có người ghi cứng số và lại lộ ra lần nữa.

## Kiểm chứng (không được bỏ bước này)
1. `npx tsc --noEmit` sạch.
2. Test mới **chạy thật**: `test-analytics-doanhso.ts` kiểm `stockSummary()` trả số
   khớp với SQL đếm độc lập, trên DB test có dữ liệu thật.
3. Test dashboard canh lỗi xanh giả: **phá** một bất biến → phải ĐỎ, rồi khôi phục.
4. `npx tsx scripts/run-isolated.ts` — toàn bộ suite.
5. `npm run build` sạch → deploy → gọi HTTP thật xác nhận API trả 200 và số liệu
   khớp với đối chiếu tay.

## Rủi ro đã cân nhắc
- **Không** đụng logic tiền/đơn hàng — thẻ này chỉ hiển thị, nằm ngoài luồng bán.
- **Không** sửa số liệu trong DB. Chỉ thay cách hiển thị lấy số thật.
- API mới dùng chung `requireSessionRole(['ROLE_OWNER','ROLE_MANAGER'])` — không
  mở rộng quyền.
- 8 chỗ tiếng Anh nằm ở 5 file khác nhau; sửa tay từng chỗ, không regex hàng loạt,
  để không lỡ xoá nhầm comment kỹ thuật.
