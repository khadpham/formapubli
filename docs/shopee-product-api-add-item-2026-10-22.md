# Shopee Product API `add_item` - Kết quả nghiên cứu (2026-10-22)

## Tóm tắt

Đã tìm ra cấu trúc ĐÚNG cho `POST /api/v2/product/add_item` và kiểm chứng
thành công trên sandbox (tạo được item_id=803947330, trạng thái NORMAL).

## Vấn đề gốc

Lỗi ban đầu: `product.error_busi - Product Description : invalid field
seller_stock, value must Not Null`

Nguyên nhân: code cũ không gửi `seller_stock` (thử `stock_info_v2` là sai
tên field) và thiếu `logistic_info` (field bắt buộc).

## Cấu trúc đúng (đã kiểm chứng)

```json
{
  "category_id": 301543,
  "item_name": "...",
  "description": "...",
  "item_sku": "COMBO11",
  "original_price": 278000,
  "image": { "image_id_list": ["sg-11134283-..."] },
  "weight": 0.5,
  "seller_stock": [{ "stock": 100 }],
  "logistic_info": [{ "logistic_id": 20001, "enabled": true, "is_free": false }],
  "pre_order": { "is_pre_order": false },
  "condition": "NEW",
  "brand": { "brand_id": 0, "original_brand_name": "NoBrand" },
  "attribute_list": [
    { "attribute_id": 200673, "attribute_value_list": [{ "value_id": 105471 }] },
    { "attribute_id": 200676, "attribute_value_list": [{ "value_id": 103518 }] }
  ],
  "dimension": {
    "package_length": 10, "package_width": 10, "package_height": 10
  }
}
```

### Điểm mấu chốt

1. **`seller_stock` là field TOP-LEVEL** (mảng), không phải `stock_info_v2`.
   `location_id` không bắt buộc - chỉ cần `{ "stock": N }`.

2. **`logistic_info` là BẮT BUỘC**. Lấy `logistic_id` từ
   `GET /api/v2/logistics/get_channel_list` (chọn kênh đang `enabled`).

3. **`original_price`** (số nguyên VND), không phải mảng `price_info`.

4. **`attribute_list` bắt buộc theo category**. Với sách (301543 Adult's Books):
   - 200673 Language = 105471 (Vietnamese) - bắt buộc
   - 200676 Import/Local = 103518 (Local) - bắt buộc
   - Lấy động qua `GET /api/v2/product/get_attribute_tree` với
     `category_id_list` + `language=en`.
   - Lưu ý: response thật là `{ list: [{ attribute_tree: [...] }] }`,
     field là `mandatory`/`name` (không phải `is_mandatory`/
     `original_attribute_name` như SDK mô tả).

5. **Ảnh**: phải upload trước qua `POST /api/v2/media/upload_image`
   (multipart, field `images`), lấy `image_id` rồi mới dùng trong `add_item`.
   KHÔNG dùng URL ngoài trực tiếp được.

## Giới hạn sandbox

Sandbox báo lỗi khi giá vượt giới hạn kênh vận chuyển:
`The max price of the product is over max limit. Channel detail: Sandbox SPX Express`

Test với giá 50000 thì thành công. Production có giới hạn cao hơn
(COMBO11 giá 278000 là bình thường trên shop thật).

## Nguồn tham khảo

- SDK `@congminh1254/shopee-sdk` (GitHub congminh1254/shopee-sdk):
  `src/schemas/product.ts` (AddItemRequest), 
  `src/__tests__/integration/product.integration.test.ts` (ví dụ chạy thật)
- API docs: open.shopee.com (cần đăng nhập console)

## Code

- `src/services/shopee/media.ts`: `uploadImageToShopee()`
- `src/services/shopee/product.ts`: `addShopeeItem()`,
  `getShopeeLogisticChannelId()`, `getShopeeAttributes()`,
  `DEFAULT_BOOK_ATTRIBUTES`
- `scripts/test-shopee-add-item.ts`: test đăng COMBO11
- `scripts/test-shopee-attr-tree.ts`: liệt kê attributes của category
- `scripts/test-shopee-category.ts`: duyệt cây category

## Việc còn lại (production)

1. Kiểm tra giới hạn giá trên production (khác sandbox).
2. Mapping đầy đủ attributes cho từng loại sản phẩm (hiện chỉ có mặc định
   cho sách tiếng Việt nội địa).
3. UI trong ERP để tạo/đăng sản phẩm (chọn ảnh, nhập thông tin, bấm đăng).
4. Lưu `item_id` Shopee trả về vào DB để đối chiếu đơn hàng sau này.
