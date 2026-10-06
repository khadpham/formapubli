# TÀI LIỆU 03: QUẢN LÝ SẢN PHẨM & ĐỒNG BỘ TỒN KHO (WMS)

---

## 1. NGUYÊN TẮC ÁNH XẠ MÃ SẢN PHẨM (SKU MAPPING)

Để hệ thống kho FORMApubli và Shopee "hiểu nhau" mà không cần can thiệp bằng tay:
* **Quy tắc vàng:** Khi tạo sản phẩm sách trên Shopee Seller Center, trường **Mã SKU (Parent SKU / Variation SKU)** BẮT BUỘC phải điền chính xác bằng **Mã vạch ISBN-13** (hoặc Mã ấn bản `editions.code`).
  * Ví dụ:
    * Sách *Tristram Shandy*: SKU = `9786044449869`
    * Sách *Cháu trai Wittgenstein*: SKU = `9786049679377`
* **Xử lý Combo sách:**
  * Nếu bán Combo (VD: *Combo 2 cuốn Văn học Áo*): SKU trên Shopee đặt theo quy ước định dạng: `COMBO_TP0030_HH034`.
  * Bộ giải mã của FORMApubli sẽ tự động tách chuỗi để trừ kho đồng thời 1 cuốn `TP0030` và 1 cuốn `HH034`.

---

## 2. API ĐỒNG BỘ TỒN KHO: `v2.product.update_stock`

API này dùng để đẩy số lượng tồn kho khả dụng từ Kho Chính của FORMApubli lên Shopee.

* **Phương thức:** `POST`
* **Đường dẫn API:** `/api/v2/product/update_stock`
* **Cấu trúc dữ liệu gửi lên (Request Body):**
  ```json
  {
    "item_id": 1982736451,
    "stock_list": [
      {
        "model_id": 0,
        "seller_stock": [
          {
            "stock": 45
          }
        ]
      }
    ]
  }
  ```
  *(Trong đó `stock`: 45 là số lượng sách thực tế còn trong kho vật lý).*
* **Kết quả trả về:**
  ```json
  {
    "error": "",
    "message": "",
    "response": {
      "success_list": [
        {
          "model_id": 0,
          "stock": 45
        }
      ],
      "failure_list": []
    }
  }
  ```

---

## 3. THUẬT TOÁN ĐỒNG BỘ KHO & CHỐNG PHẠT "SAO QUẢ TẠ"

Trên Shopee, nếu một đơn hàng phát sinh mà Shop không có hàng để giao $\rightarrow$ Shop buộc phải hủy đơn $\rightarrow$ Shopee sẽ tính **Tỷ lệ đơn hàng không thành công (NFR)** và phạt **Điểm Sao Quả Tạ**. Bị phạt sẽ mất nhãn Shop Yêu Thích và bị giảm hiển thị tìm kiếm.

Để giải quyết triệt để rủi ro này, FORMApubli áp dụng **Chiến lược Tồn kho An toàn (Safety Buffer Stock)**:

```text
Tồn kho hiển thị trên Shopee = Tồn Kho Chính - Lượng Dự Trữ An Toàn (Buffer)
```

1. **Lượng Dự Trữ An Toàn (Buffer = 2 cuốn):**
   * Nếu trong Kho Chính còn 10 cuốn $\rightarrow$ Báo lên Shopee: 8 cuốn.
   * Nếu trong Kho Chính còn 2 cuốn $\rightarrow$ Báo lên Shopee: 0 cuốn (Hết hàng).
   * 2 cuốn dự trữ này giúp phòng ngừa trường hợp khách tại hội chợ vừa mua cùng lúc với khách trên mạng đặt đơn.
2. **Kích hoạt đồng bộ tức thời (Real-time Event-driven Sync):**
   * Bất cứ khi nào có phiếu xuất kho `DISPATCH_SALE` tại quầy POS hoặc phiếu chuyển kho đi hội chợ $\rightarrow$ Trigger gọi ngay `v2.product.update_stock` cho đầu sách đó.
3. **Quét định kỳ đối soát (Hourly Reconciliation Cron):**
   * Mỗi 60 phút, hệ thống chạy một tác vụ ngầm so sánh tồn kho giữa DB cục bộ và Shopee để đảm bảo không có sự sai lệch nào bị bỏ sót do rớt mạng.
