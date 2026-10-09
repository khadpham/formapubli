# Tích hợp Customer Order Portal → formapubli

## Tổng quan

Customer Order Portal (Next.js, Vercel) là web cho khách lẻ đặt sách.
Khi khách chốt đơn, portal gọi API formapubli để tạo đơn hàng chính thức,
thủ kho xử lý tiếp trong formapubli.

```
Portal (khách)          formapubli (nhân viên)
    │                         │
    │  POST /api/portal-orders│
    │  ──────────────────────>│  Tạo order PENDING_CONFIRMATION
    │                         │  (channel=ONLINE, giữ chỗ ATP)
    │                         │
    │                    Thủ kho thấy đơn mới
    │                         │  → Đóng gói (shippingStatus=CREATED)
    │                         │  → Gửi hàng (shippingStatus=IN_TRANSIT)
    │                         │  → Nhận tiền (status=COMPLETED)
    │                         │
```

## Kênh ghi nhận

Đơn portal vào bảng `orders` với `channel='ONLINE'`, tách bạch khỏi:
- `FAIR_EVENT` (hội chợ)
- `RETAIL_OFFICE` (bán tại quầy)
- `WHOLESALE_PARTNER` (đại lý)

## Trạng thái đơn COD

| Chip thủ kho bấm | `orders.status` | `shippingStatus` | `codStatus` | Tồn kho | Doanh thu |
|---|---|---|---|---|---|
| Mới nhận | PENDING_CONFIRMATION | NONE | NONE | Giữ chỗ ATP | Chưa ghi |
| Đã đóng gói | PENDING_CONFIRMATION | CREATED | NONE | Giữ chỗ ATP | Chưa ghi |
| Đã gửi hàng | PENDING_CONFIRMATION | IN_TRANSIT | PENDING | Giữ chỗ ATP | Chưa ghi |
| Đã nhận tiền | **COMPLETED** | DELIVERED | RECEIVED | Trừ thật | **Ghi nhận** |

**Nguyên tắc:** Doanh thu COD chỉ ghi khi tiền về tay (COMPLETED).
Đơn hủy → `CANCELLED` + nhả ATP giữ chỗ.

## API

### POST /api/portal-orders

Xác thực: `Authorization: Bearer <PORTAL_API_KEY>`

Request:
```json
{
  "madon": "DH-20261009-AB12",
  "email": "khach@gmail.com",
  "name": "Nguyễn Văn A",
  "phone": "0901234567",
  "address": "123 Đường ABC, Hà Nội",
  "items": [{ "portalProductId": "nu-cong-tuoc", "qty": 2 }],
  "paymentMethod": "COD",
  "shippingFee": 22000,
  "hasGift": false
}
```

Response:
```json
{
  "success": true,
  "data": {
    "orderId": "...",
    "orderCode": "ORD...",
    "status": "PENDING_CONFIRMATION"
  }
}
```

Idempotency: dùng `madon` của portal (`idempotencyKey = portal-<madon>`).
Gọi lại cùng madon → trả về đơn cũ, không tạo trùng.

### Map sản phẩm

`PORTAL_PRODUCT_MAP` (env, JSON): portal product ID → formapubli edition ID.
Ví dụ: `{"nu-cong-tuoc-de-langeais":"ed-xxx","nicholas-nickleby":"ed-yyy"}`
Chưa map → API trả 400, portal log lỗi để nhân viên xử lý tay.

## UI Soạn hàng (tab Kho)

Component `PortalOrdersPanel` trong tab Kho (hiện cho Thủ Kho / Shopee, Owner, Manager):
- Danh sách đơn online chờ xử lý (kênh ONLINE, trạng thái PENDING_CONFIRMATION)
- **Search bar**: tìm theo mã đơn, tên, SĐT, ghi chú
- **Cột ghi chú**: hiện nổi bật (yêu cầu đóng gói của khách)
- Hiện tổng tiền đơn, KHÔNG hiện doanh thu/lợi nhuận
- Bấm vào đơn → modal chi tiết: người nhận, địa chỉ, **ghi chú nổi bật**, danh sách sản phẩm cần đóng
- Chip trạng thái: Mới nhận → Đã đóng gói → Đã gửi (nhập tracking SPX) → Đã giao
- Tối ưu desktop

## Role

- `ROLE_WAREHOUSE` đổi thành **"Thủ Kho / Shopee"**, thêm tab `shopee`
- `ROLE_SHOPEE_OPS` ẩn khỏi UI đăng nhập (`hidden: true`), giữ lại để tương thích
- Shopee APIs đã thêm quyền cho ROLE_WAREHOUSE

### Biến môi trường

| Biến | Mô tả |
|---|---|
| `PORTAL_API_KEY` | Bearer token portal dùng để gọi API |
| `PORTAL_WAREHOUSE_ID` | Kho mặc định cho đơn online |

## Phản biện & rủi ro

### 1. Khách đặt lại đơn (upsert)
Portal cho đặt lại (giữ mã đơn). Nếu đơn formapubli còn PENDING →
nên cập nhật. Nếu đã qua các bước sau → tạo đơn mới hoặc báo lỗi.
**Hiện tại:** idempotency trả về đơn cũ. Cần bổ sung logic update sau.

### 2. Hết hàng
formapubli kiểm tra ATP khi tạo đơn. Hết hàng → API 400.
Portal cần hiển thị "Sách tạm hết" thay vì lỗi chung chung.
**Hiện tại:** portal log lỗi, nhân viên xử lý tay.

### 3. Quà tri ân
Portal tặng quà 0đ khi mua đủ 6 cuốn, nhưng chưa xác định quà là
sản phẩm nào trong kho formapubli.
**Cần:** user xác nhận quà là gì → thêm vào PORTAL_PRODUCT_MAP với `isGiftLine: true`.

### 4. Địa chỉ
Portal lưu địa chỉ text tự do → lưu vào `customers.addressDetail`.
Khi cần tách tỉnh/xã cho SPX, dùng logic parse (xem portal `lib/spx.ts`).

### 5. Bảo mật
API key đơn giản. Nên thêm rate limiting nếu portal bị spam.
Không log API key.

### 6. Đồng bộ ngược
Khi thủ kho đổi trạng thái trong formapubli, portal (Google Sheet)
chưa tự cập nhật. **Hiện tại:** nhân viên cập nhật tay trên sheet.
Có thể làm webhook sau nếu cần.
