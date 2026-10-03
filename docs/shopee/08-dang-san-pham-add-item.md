# TÀI LIỆU 08: ĐĂNG TẢI SẢN PHẨM NGÀNH SÁCH (ADD ITEM) — SHOPEE API V2 (MODULE 89)

---

## 1. TỔNG QUAN API TẠO SẢN PHẨM: `v2.product.add_item`

Khi FORMApubli có ấn bản sách mới và muốn tự động đẩy sản phẩm lên Shopee mà không cần đăng tay:
* **Phương thức:** `POST /api/v2/product/add_item`
* **Quy trình 2 bước bắt buộc:**
  1. Upload ảnh bìa sách lên Media Space qua `v2.media_space.upload_image` để lấy danh sách `image_id`.
  2. Gọi `v2.product.add_item` truyền đầy đủ thông tin sách, ảnh, giá, tồn kho và thuộc tính bắt buộc của ngành Sách.

---

## 2. CẤU TRÚC REQUEST BODY CHI TIẾT CHO ĐẦU SÁCH

> ⚠️ **LƯU Ý QUAN TRỌNG:** Các giá trị số như `category_id: 100089`, `logistic_id: 50012`, và các `attribute_id` dưới đây là **DỮ LIỆU MẪU ĐỂ MINH HỌA CẤU TRÚC JSON**. Khi gọi API thật trên môi trường Production, bắt buộc phải gọi `v2.product.get_category`, `v2.product.get_attributes` và `v2.logistics.get_channel_list` để lấy các ID thật do Shopee cấp cho gian hàng.

```json
{
  "original_price": 120000,
  "description": "Cuốn sách kinh điển của văn học Áo thế kỷ 20...",
  "item_name": "Sách - Cháu trai Wittgenstein (Bìa mềm)",
  "normal_stock": 50,
  "category_id": 100089,
  "weight": 0.35,
  "item_status": "NORMAL",
  "item_sku": "9786049679377",
  "image": {
    "image_id_list": [
      "vn-11134207-7r98o-xyz12345678"
    ]
  },
  "logistic_info": [
    {
      "logistic_id": 50012,
      "enabled": true
    }
  ],
  "attribute_list": [
    {
      "attribute_id": 100234,
      "attribute_value_list": [
        {
          "value_id": 0,
          "original_value_name": "Thomas Bernhard"
        }
      ]
    },
    {
      "attribute_id": 100235,
      "attribute_value_list": [
        {
          "value_id": 0,
          "original_value_name": "FORMApubli"
        }
      ]
    },
    {
      "attribute_id": 100236,
      "attribute_value_list": [
        {
          "value_id": 0,
          "original_value_name": "Tiếng Việt"
        }
      ]
    }
  ]
}
```

---

## 3. CÁC ĐIỂM CẦN LƯU Ý ĐẶC THÙ NGÀNH SÁCH

1. **Trọng lượng (`weight`):**
   * Đơn vị là Kilogram (kg). Một cuốn sách 350g phải điền `0.35`. Điền nhầm `350` sẽ bị tính phí ship hàng triệu đồng và khách không thể mua.
2. **Mã SKU (`item_sku`):**
   * Luôn luôn là **Mã vạch ISBN-13** (`978604...`) để khớp hoàn toàn với bảng `editions.isbn` trong CSDL FORMApubli.
3. **Danh mục (`category_id`):**
   * Shopee phân loại rất kỹ: *Nhà Sách Online $\rightarrow$ Sách tiếng Việt $\rightarrow$ Tác phẩm kinh điển / Văn học*. Chọn sai category sẽ bị Shopee khóa duyệt sản phẩm.
