# API CONTRACT: PORTAL <-> ERP
Ngày: 2026-10-14. Người duyệt: anh Kha. Điều phối: Muse.
Tài liệu này là hợp đồng kỹ thuật giữa team ERP (Muse) và team Portal (agent local).
Cả hai bên code dựa trên tài liệu này, không tự ý thay đổi format.

---

## 1. THÔNG TIN CHUNG

**ERP dev:** `https://dev.formapubli.vn`
**ERP prod:** `https://app.formapubli.vn`

**Xác thực:** Mọi request từ portal sang ERP gửi header:
```
X-Portal-Api-Key: <PORTAL_API_KEY>
```
Thiếu hoặc sai key: trả về `401 Unauthorized`.

**Format chung:**
- Request body: JSON.
- Response thành công: JSON với dữ liệu trực tiếp.
- Response lỗi: `{ "error": "mô tả lỗi tiếng Việt" }` kèm HTTP status phù hợp.
- Mọi thời gian: ISO 8601, giờ Việt Nam (UTC+7).

---

## 2. SẢN PHẨM

### 2.1. Lấy danh sách sản phẩm
```
GET /api/portal/products
```

Query params:
| Param | Kiểu | Mô tả |
|---|---|---|
| `q` | string | Tìm kiếm theo tên sách / tác giả (optional) |
| `category` | string | Lọc theo thể loại (optional) |
| `sort` | string | `newest` / `bestseller` / `price_asc` / `price_desc` / `custom` (default: `custom`) |
| `page` | number | Trang (default: 1) |
| `limit` | number | Số sản phẩm mỗi trang (default: 20, max: 50) |
| `featured` | boolean | Chỉ lấy sản phẩm nổi bật (optional) |

Response `200`:
```json
{
  "products": [
    {
      "id": "uuid",
      "slug": "ondine-la-motte-fouque",
      "name": "Ondine",
      "author": "La Motte-Fouque",
      "translator": "Cao An Vu",
      "coverPrice": 128000,
      "salePrice": 115000,
      "hasPromotion": true,
      "coverImage": "https://...r2.../ondine-cover.jpg",
      "inStock": true,
      "isFeatured": false,
      "avgRating": 4.5,
      "reviewCount": 12,
      "category": "Văn học dịch"
    }
  ],
  "total": 26,
  "page": 1,
  "totalPages": 2
}
```

Ghi chú:
- Chỉ trả sản phẩm có `isVisible = true`.
- `salePrice = null` nghĩa là bán đúng giá bìa, không khuyến mại.
- `inStock`: true/false. KHÔNG trả số lượng tồn kho cụ thể.
- `productType`: `SINGLE` (sách lẻ), `COMBO` (bộ nhiều cuốn), `GIFT` (quà tặng).
  Loại `GIFT` không hiện để bán, chỉ dùng trong engine khuyến mại.
- Với `COMBO`, response thêm trường `comboItems`: danh sách sách trong combo.

### 2.1b. Ví dụ sản phẩm combo
```json
{
  "id": "uuid",
  "slug": "combo-bo-walser",
  "name": "[Combo] Bộ Walser - Jakob von Gunten & Anh em Tanner",
  "productType": "COMBO",
  "coverPrice": 435000,
  "salePrice": null,
  "coverImage": "https://iili.io/...",
  "inStock": true,
  "comboItems": [
    { "productId": "uuid", "productName": "Jakob von Gunten", "quantity": 1 },
    { "productId": "uuid", "productName": "Anh em Tanner", "quantity": 1 }
  ]
}
```

### 2.2. Chi tiết một sản phẩm
```
GET /api/portal/products/[slug]
```

Response `200`:
```json
{
  "id": "uuid",
  "slug": "ondine-la-motte-fouque",
  "name": "Ondine",
  "author": "La Motte-Fouque",
  "translator": "Cao An Vu",
  "description": "GIỚI THIỆU TÁC PHẨM: Ondine\n\n...",
  "coverPrice": 128000,
  "salePrice": 115000,
  "hasPromotion": true,
  "images": [
    "https://...r2.../ondine-cover.jpg",
    "https://...r2.../ondine-1.jpg",
    "https://...r2.../ondine-2.jpg"
  ],
  "inStock": true,
  "details": {
    "isbn": "9786043689297",
    "pages": 128,
    "size": "13 x 20 cm",
    "publisher": "NXB Hội nhà văn",
    "publishYear": 2022,
    "coverType": "Bìa mềm",
    "language": "Tiếng Việt"
  },
  "avgRating": 4.5,
  "reviewCount": 12,
  "category": "Văn học dịch"
}
```

Lỗi: `404 { "error": "Không tìm thấy sản phẩm." }`

---

## 3. ĐÁNH GIÁ

### 3.1. Lấy đánh giá của sản phẩm
```
GET /api/portal/reviews?productId=[uuid]&page=1&limit=10
```

Response `200`:
```json
{
  "reviews": [
    {
      "id": "uuid",
      "customerName": "Nguyễn Văn A",
      "rating": 5,
      "content": "Sách đẹp, giao nhanh.",
      "createdAt": "2026-10-10T14:30:00+07:00"
    }
  ],
  "total": 12,
  "avgRating": 4.5
}
```

Chỉ trả review đã được duyệt.

### 3.2. Gửi đánh giá mới
```
POST /api/portal/reviews
```

Body:
```json
{
  "productId": "uuid",
  "customerId": "uuid",
  "rating": 5,
  "content": "Sách đẹp, giao nhanh."
}
```

Ràng buộc:
- `rating`: số nguyên 1-5, bắt buộc.
- `content`: tối đa 1000 ký tự, bắt buộc.
- Chỉ khách đã mua sản phẩm này mới được đánh giá (ERP kiểm tra).
- Review mới ở trạng thái chờ duyệt, không hiện ngay.

Response `200`: `{ "ok": true, "message": "Cảm ơn bạn đã đánh giá. Nhận xét sẽ hiển thị sau khi được duyệt." }`
Lỗi: `403 { "error": "Bạn cần mua sản phẩm này trước khi đánh giá." }`

---

## 4. KHÁCH HÀNG

### 4.1. Tra cứu khách hàng
```
GET /api/portal/customers/lookup?phone=[sdt]&email=[email]
```

Chỉ cần một trong hai. Ưu tiên tìm theo email trước, sau đó theo SĐT.

Response `200` (tìm thấy):
```json
{
  "found": true,
  "customer": {
    "id": "uuid",
    "name": "Nguyễn Văn A",
    "phone": "0912345678",
    "email": "a@example.com",
    "addresses": [
      {
        "id": "uuid",
        "label": "Nhà riêng",
        "province": "Hà Nội",
        "district": "Cầu Giấy",
        "ward": "Dịch Vọng",
        "detail": "Số 123 đường ABC",
        "isDefault": true
      }
    ]
  }
}
```

Response `200` (không tìm thấy):
```json
{ "found": false }
```

### 4.2. Tạo hoặc cập nhật khách hàng
```
POST /api/portal/customers
```

Body:
```json
{
  "name": "Nguyễn Văn A",
  "phone": "0912345678",
  "email": "a@example.com",
  "address": {
    "label": "Nhà riêng",
    "province": "Hà Nội",
    "district": "Cầu Giấy",
    "ward": "Dịch Vọng",
    "detail": "Số 123 đường ABC"
  }
}
```

Ràng buộc:
- `name`: bắt buộc, tối thiểu 2 ký tự.
- `phone`: bắt buộc, 10 số, đầu số Việt Nam hợp lệ.
- `email`: optional, nếu có phải đúng format.
- Nếu SĐT đã tồn tại: cập nhật thông tin (upsert theo SĐT).

Response `200`:
```json
{
  "id": "uuid",
  "name": "Nguyễn Văn A",
  "phone": "0912345678",
  "email": "a@example.com",
  "isNew": false
}
```

### 4.3. Lịch sử đơn hàng của khách
```
GET /api/portal/customers/[id]/orders
```

Yêu cầu session hợp lệ của chính khách đó.

Response `200`:
```json
{
  "orders": [
    {
      "orderCode": "ORD2610140001",
      "createdAt": "2026-10-14T10:00:00+07:00",
      "status": "DELIVERED",
      "statusLabel": "Đã giao",
      "totalAmount": 256000,
      "itemCount": 2,
      "items": [
        { "productName": "Ondine", "quantity": 1, "price": 128000 },
        { "productName": "Middlemarch T1", "quantity": 1, "price": 128000 }
      ]
    }
  ]
}
```

Trạng thái: `PENDING` (chờ xác nhận), `CONFIRMED` (đã xác nhận),
`SHIPPING` (đang giao), `DELIVERED` (đã giao), `CANCELLED` (đã hủy).

---

## 5. ĐƠN HÀNG

### 5.1. Lấy mã đơn (reserve-code) - ĐÃ CÓ TRÊN DEV
```
POST /api/orders/reserve-code
```

Body: `{}` (không cần tham số).

Response `200`:
```json
{ "orderCode": "ORD2610140001" }
```

Portal PHẢI gọi API này TRƯỚC khi hiện VietQR cho khách chuyển khoản.
Mã này dùng làm nội dung chuyển khoản và mã đơn xuyên suốt.

### 5.2. Tạo đơn hàng
```
POST /api/portal/orders
```

Body:
```json
{
  "orderCode": "ORD2610140001",
  "customerId": "uuid",
  "items": [
    { "productId": "uuid", "quantity": 2 },
    { "productId": "uuid", "quantity": 1 }
  ],
  "paymentMethod": "COD",
  "shippingAddress": {
    "province": "Hà Nội",
    "district": "Cầu Giấy",
    "ward": "Dịch Vọng",
    "detail": "Số 123 đường ABC"
  },
  "notes": "Giao giờ hành chính",
  "receiptImageUrl": "https://... (chỉ khi chuyển khoản)"
}
```

Ràng buộc:
- `orderCode`: bắt buộc, phải là mã từ reserve-code, chưa được dùng.
- `items`: tối thiểu 1 sản phẩm, mỗi sản phẩm quantity >= 1.
- `paymentMethod`: `"COD"` hoặc `"TRANSFER"`.
- Nếu `TRANSFER`: `receiptImageUrl` bắt buộc (ảnh biên lai đã upload).
- ERP tự kiểm tra tồn kho, tự áp dụng khuyến mại, tự tính tổng tiền.
  Portal KHÔNG tự tính tổng tiền để gửi lên (chỉ hiển thị tạm tính cho khách).

Response `200`:
```json
{
  "ok": true,
  "orderCode": "ORD2610140001",
  "totalAmount": 256000,
  "discountAmount": 0,
  "gifts": [
    { "productName": "Bookmark FORMApubli", "quantity": 1 }
  ],
  "message": "Đặt hàng thành công."
}
```

Lỗi:
- `400 { "error": "Mã đơn đã được sử dụng." }` (gọi reserve-code mới)
- `400 { "error": "Sản phẩm [Tên] đã hết hàng." }`
- `400 { "error": "Thông tin khách hàng chưa đầy đủ." }`

---

## 6. KHUYẾN MẠI

### 6.1. Lấy khuyến mại đang chạy
```
GET /api/portal/promotions/active
```

Response `200`:
```json
{
  "promotions": [
    {
      "id": "uuid",
      "name": "Tặng bookmark cho đơn từ 500k",
      "type": "GIFT_THRESHOLD",
      "threshold": 500000,
      "giftName": "Bookmark FORMApubli",
      "giftImage": "https://...r2.../bookmark.jpg"
    },
    {
      "id": "uuid",
      "name": "Tặng túi vải cho đơn từ 1 triệu",
      "type": "GIFT_THRESHOLD",
      "threshold": 1000000,
      "giftName": "Túi vải FORMApubli",
      "giftImage": "https://...r2.../tote.jpg"
    },
    {
      "id": "uuid",
      "name": "Giảm 10% sách văn học dịch",
      "type": "DISCOUNT_PERCENT",
      "percent": 10,
      "appliesTo": "category:Văn học dịch"
    }
  ]
}
```

Portal dùng để hiển thị "Thêm Xđ nữa để nhận [quà]". Khi tạo đơn, ERP tính
lại chính xác và chốt quà vào đơn.

---

## 7. MOCK DATA CHO TEAM PORTAL (dùng khi API ERP chưa xong)

Team portal KHÔNG chờ API ERP. Dùng dữ liệu giả theo đúng format trên để
phát triển UI. Khi API ERP sẵn sàng trên dev, chỉ cần đổi base URL.

File mock đặt tại `lib/mock-data.ts` trong repo portal, export các hàm:
- `mockProducts()` - trả về đúng format mục 2.1
- `mockProductDetail(slug)` - đúng format mục 2.2
- `mockPromotions()` - đúng format mục 6.1
- `mockCustomerLookup()` - đúng format mục 4.1

---

## 8. LỊCH TRÌNH PHỐI HỢP

| Giai đoạn | Team ERP (Muse) | Team Portal (agent local) |
|---|---|---|
| Tuần 1 | Viết API contract (xong). Tạo bảng DB + API products, customers. | Tạo nhánh dev. Dựng UI catalog + modal chi tiết với mock data. |
| Tuần 2 | API orders, reviews, promotions. Trang Quản trị Portal. Import sheet. | Giỏ hàng + thanh toán + tra cứu khách (mock). |
| Tuần 3 | E-invoice draft flow. Test API trên dev. | Nối API thật. Trang tài khoản khách. |
| Tuần 4 | Test liên thông. Fix bug. | Test liên thông. Fix UI theo feedback anh Kha. |

Mỗi bên push lên nhánh dev của repo mình khi xong từng phần.
Muse kiểm tra chéo: đọc code portal trên GitHub, test API ERP trên dev.
Báo cáo tiến độ cho anh Kha mỗi khi xong một mốc.
