# TÀI LIỆU 06: ĐỐI SOÁT TÀI CHÍNH & BÁO CÁO LỢI NHUẬN (ESCROW PAYMENT)

---

## 1. KHÁI NIỆM TÀI KHOẢN ĐẢM BẢO (SHOPEE ESCROW)

Khi khách hàng mua sách trên Shopee, tiền thanh toán của khách không chảy về tài khoản FORMApubli ngay lập tức. Tiền được giữ trong **Tài khoản Đảm bảo (Escrow)** của Shopee cho đến khi:
1. Đơn hàng giao thành công.
2. Khách bấm "Đã nhận được hàng" hoặc hết hạn 3 ngày đổi trả.

Sau thời điểm này, Shopee sẽ **trừ các loại phí sàn**, sau đó giải ngân số tiền còn lại vào Ví Người Bán / Tài khoản ngân hàng của FORMApubli.

---

## 2. API ĐỐI SOÁT TÀI CHÍNH: `v2.payment.get_escrow_detail`

API này trả về bảng kê chi tiết từng đồng của một đơn hàng sau khi hoàn tất.

* **Phương thức:** `GET`
* **Đường dẫn:** `/api/v2/payment/get_escrow_detail`
* **Tham số:** `order_sn`
* **Cấu trúc dữ liệu phản hồi quan trọng:**
  ```json
  {
    "response": {
      "order_income": {
        "items": [
          {
            "item_name": "Sách: Cháu trai Wittgenstein",
            "discounted_price": 96000,
            "quantity_purchased": 2,
            "original_price": 120000
          }
        ],
        "buyer_total_amount": 192000,
        "cost_of_goods_sold": 192000,
        "shopee_discount": 20000,
        "seller_discount": 0,
        "commission_fee": 15360,
        "service_fee": 9600,
        "transaction_fee": 7680,
        "escrow_amount": 179360
      }
    }
  }
  ```

---

## 3. BÓC TÁCH CÁC KHOẢN PHÍ SÀN CẦN LƯU VÀO TAB "CHỦ"

Khi tích hợp vào tab **"Chủ"** của FORMApubli, hệ thống sẽ bóc tách các chỉ số tài chính sau:

1. **Doanh số gộp (Gross Sales):** `buyer_total_amount` (Tổng tiền bìa/giá bán sách).
2. **Chi phí sàn Shopee (Platform Fees):**
   * **Phí thanh toán (`transaction_fee`):** Thường ~4% trên tổng tiền khách trả.
   * **Phí cố định / Hoa hồng (`commission_fee`):** Phí sàn tính trên đơn hàng thành công (tùy ngành sách, thường 4% - 6%).
   * **Phí dịch vụ (`service_fee`):** Phí nếu tham gia gói Freeship Xtra hoặc Hoàn Xu Xtra (thường 4% - 8%).
3. **Tiền thực nhận (Net Settlement / `escrow_amount`):**
   ```text
   Tiền về tài khoản = Doanh số - (Phí thanh toán + Phí cố định + Phí dịch vụ) + Tiền Shopee trợ giá (nếu có)
   ```
4. **Lợi nhuận ròng của đơn Shopee:**
   ```text
   Lợi nhuận ròng = Tiền về tài khoản - Tiền vốn in sách (COGS) - Chi phí đóng gói (hộp carton, màng xốp)
   ```

Toàn bộ các con số này sẽ tự động đổ về biểu đồ **Báo cáo Kênh Online** trong tab **"Chủ"**, giúp chủ doanh nghiệp nhìn thấy chính xác: *"Bán trên Shopee tháng này thực tế lãi ròng bao nhiêu tiền sau khi trừ sạch phí sàn?"*.
