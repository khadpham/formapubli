# Nghiên cứu Shopee Open Platform API v2 cho ERP formapubli
**Ngày:** 2026-10-20
**Mục đích:** Đánh giá khả năng tích hợp API v2 vào hệ thống ERP của Công ty TNHH Vitanova (xuất bản/phát hành sách), thay thế nhập đơn Shopee thủ công bằng xlsx hiện tại ở tab Shopee.

**Lưu ý về nguồn:** Trong môi trường nghiên cứu này, domain open.shopee.com bị chặn truy cập trực tiếp, nên các cụm nghiên cứu đã đối chiếu qua SDK cộng đồng có trích nguyên văn mô tả và link tài liệu chính thức (ví dụ SDK Go wjp-letgo, SDK @congminh1254/shopee-sdk). Mọi URL dưới đây là URL tài liệu chính thức theo mẫu open.shopee.com/documents/v2/..., NHƯNG cần mở lại trên trình duyệt thật để đối chiếu chi tiết trước khi triển khai. Nội dung chưa đối chiếu được ghi rõ "chưa xác minh được" - không bịa endpoint.

---

## 1. Xác thực, ủy quyền và giới hạn

### 1.1 Partner ID / Partner Key
- Tên: Partner ID (partner_id), Partner Key (partner_key).
- Cấp khi: đăng ký tài khoản tại Shopee Open Platform (open.shopee.com) và tạo app tại App Management > App List. Partner ID và Partner Key hiển thị trong chi tiết app sau khi tạo app xong - không có trước khi tạo app. Đã xác minh thực tế trên console 2026-10-20: tài khoản Vitanova chưa có app nào nên chưa có Partner ID/Key.
- Dùng cho: định danh app trong mọi request API v2 (tham số partner_id) và làm khóa HMAC-SHA256 ký request (partner_key giữ bí mật tuyệt đối).

### 1.2 Cơ chế ký HMAC-SHA256 (sign)
- Thuật toán: HMAC-SHA256, khóa = partner_key, kết quả dạng hex.
- Công thức (request cần access_token - Shop API và Merchant API):
  `sign = HMAC-SHA256(partner_key, partner_id + api_path + timestamp + access_token + shop_id)`
  Thứ tự ghép nối chuỗi không dấu phân tách: partner_id, đường dẫn API đầy đủ (ví dụ `/api/v2/auth/access_token/get`), timestamp (giây, dạng int), access_token, shop_id (hoặc merchant_id).
- Với endpoint không cần access_token (Public API, ví dụ đổi code lấy token, refresh token):
  `sign = HMAC-SHA256(partner_key, partner_id + api_path + timestamp)`
- Tham số tham gia sign luôn nằm trong request: partner_id, timestamp, sign (và access_token, shop_id hoặc merchant_id nếu là shop/merchant API).
- Khác biệt Public API / Merchant API / Shop API: Public API không truyền access_token và không đưa vào chuỗi ký; Shop API dùng shop_id; Merchant API dùng merchant_id thay shop_id.

### 1.3 Ủy quyền shop (authorization flow)
- Bước 1 - Tạo auth URL: `GET {host}/api/v2/shop/auth_partner?partner_id=...&timestamp=...&sign=...&redirect={redirect_url}` - sign tính theo công thức Public (partner_id + path + timestamp) vì chưa có access_token. Auth URL hiệu lực khoảng 5 phút.
- Chủ shop đăng nhập tài khoản seller và xác nhận cấp quyền cho app.
- Bước 2 - Nhận code: Shopee redirect về redirect_url kèm `code` (authorization code ngắn hạn) và `shop_id`.
- Bước 3 - Đổi code lấy token: **POST /api/v2/auth/access_token/get** - tham số: partner_id, code, shop_id (body), kèm sign public. Trả về: access_token, refresh_token, expire_in, request_id; với merchant: merchant_id_list / shop_id_list.
- Thời hạn: access_token 4 giờ (expire_in khoảng 14400 giây); refresh_token khoảng 30 ngày.
- Refresh: **POST /api/v2/auth/access_token/get** (cùng path, body chứa refresh_token thay code) - tham số: partner_id, refresh_token, shop_id, kèm sign. Trả về access_token mới + refresh_token mới (refresh token xoay vòng, phải lưu cả hai giá trị mới).
- Với seller thông thường, token gắn với shop_id (shop-level). Endpoint merchant cụ thể - chưa xác minh được.
- Deauthorize: khi shop hủy ủy quyền trong Seller Center, token bị vô hiệu; ERP nhận lỗi token và phải đưa shop qua lại luồng auth. Webhook khi shop hủy ủy quyền - chưa xác minh được.
- Nguồn: https://open.shopee.com/documents/v2/v2.public.refresh_access_token?module=104&type=1

### 1.4 Sandbox vs Live
- Live (production): base URL `https://partner.shopeemobile.com`
- Sandbox: base URL `https://partner.test-stable.shopeemobile.com`
- Mọi endpoint v2 giữ nguyên path `/api/v2/...`, chỉ đổi host. Đăng ký test account riêng để có app/partner_id/partner_key sandbox, tạo test shop để ủy quyền thử.
- Giới hạn sandbox cụ thể (số test shop, độ trễ, endpoint loại trừ) - chưa xác minh được.

### 1.5 IP whitelist / CIDR
- Không tìm thấy bằng chứng tài liệu về IP whitelist bắt buộc cho API v2. Kết luận: chưa xác minh được - cần kiểm tra trực tiếp trong console (mục cài đặt app / security).

### 1.6 Rate limit
- Shopee áp giới hạn tần suất theo endpoint, nhưng con số cụ thể không thống nhất giữa các nguồn thứ cấp và không trích được bảng chính thức. Cần implement retry với exponential backoff, queue và batch. Mã lỗi và header khi vượt limit - chưa xác minh được.

**Điều chưa xác minh được (cụm 1):** URL cụ thể các trang tài liệu chính thức (trừ 1 link refresh token); chi tiết endpoint merchant; cơ chế deauthorize/webhook; giới hạn sandbox; IP whitelist; rate limit chi tiết; phân loại chính xác Public/Merchant/Shop API. Khuyến nghị: mở lại các trang Developer Guide, Authorization, API Call Limits trên trình duyệt thật trước khi code.

---

## 2. Quản lý sản phẩm

Base: `https://partner.shopeemobile.com/api/v2/product/...` - yêu cầu partner_id, timestamp, sign, access_token, shop_id. Quy ước: endpoint bắt đầu bằng "get_" dùng GET, còn lại dùng POST.

### 2.1 CRUD sản phẩm cơ bản
- **v2.product.add_item - POST /api/v2/product/add_item** - Tạo sản phẩm mới. Tham số: item_name (bắt buộc), description, category_id (bắt buộc, category lá), price (giá gốc khi chưa có biến thể), stock, item_sku, image.image_id_list (tối đa 9 image_id từ bước upload ảnh), dimension (package_length/width/height), weight (kg), logistic_info (mảng logistic_id + enabled), attribute_list (mảng attribute_id + attribute_value_list gồm value_id), condition, brand. Trả về: item_id, warning. Nguồn: https://open.shopee.com/documents/v2/v2.product.add_item?module=89&type=1
- **v2.product.update_item - POST /api/v2/product/update_item** - Cập nhật (item_id bắt buộc, chỉ gửi trường muốn sửa). Nguồn: https://open.shopee.com/documents/v2/v2.product.update_item?module=89&type=1
- **v2.product.delete_item - POST /api/v2/product/delete_item** - Xóa hẳn (phân biệt với unlist_item chỉ ẩn bán tạm thời). Nguồn: https://open.shopee.com/documents/v2/v2.product.delete_item?module=89&type=1
- **v2.product.get_item_list - GET /api/v2/product/get_item_list** - Danh sách sản phẩm: offset, page_size (tối đa 100), update_time_from/to (Unix timestamp), item_status (NORMAL/BANNED/DELETED/UNLIST). Trả về: total_count, item (item_id + item_status), has_next_page. Nguồn: https://open.shopee.com/documents/v2/v2.product.get_item_list?module=89&type=1
- **v2.product.get_item_base_info - GET /api/v2/product/get_item_base_info** - Chi tiết tối đa 50 sản phẩm/lần: item_id_list, need_tax_info, need_complaint_policy. Trả về item_list: item_id, item_name, description, category_id, item_sku, price_info (current_price, original_price, currency), stock_info, image (image_id_list, image_url_list), attribute_list, brand, dimension, weight, logistic_info, item_status, create_time, update_time. Nguồn: https://open.shopee.com/documents/v2/v2.product.get_item_base_info?module=89&type=1
- **v2.product.get_item_extra_info - GET /api/v2/product/get_item_extra_info** - Số liệu vận hành: sale, views, likes. Nguồn: https://open.shopee.com/documents/v2/v2.product.get_item_extra_info?module=89&type=1
- **v2.product.search_item - GET /api/v2/product/search_item** - Tìm theo tên trong shop. Nguồn: https://open.shopee.com/documents/v2/v2.product.search_item?module=89&type=1
- **v2.product.get_item_limit - GET /api/v2/product/get_item_limit** - Hạn mức đăng sản phẩm: current_item_count, item_limit. Nguồn: https://open.shopee.com/documents/v2/v2.product.get_item_limit?module=89&type=1

### 2.2 Category và thuộc tính bắt buộc
- **v2.product.get_category - GET /api/v2/product/get_category** - Cây category: language, parent_category_id. Trả về category_list (category_id, parent_category_id, display_category_name, original_category_name, has_children). Nguồn: https://open.shopee.com/documents/v2/v2.product.get_category?module=89&type=1
- **v2.product.category_recommend - GET /api/v2/product/category_recommend** - Gợi ý category từ tên sản phẩm (item_name). Nguồn: https://open.shopee.com/documents/v2/v2.product.category_recommend?module=89&type=1
- **v2.product.get_attribute_tree - GET /api/v2/product/get_attribute_tree** - Thuộc tính của category kèm cờ bắt buộc: category_id, language. Trả về attribute_list: attribute_id, attribute_name, is_mandatory, attribute_type (TEXT/DROP_DOWN/COMBO_BOX), attribute_value_list (value_id + tên). Cách dùng cho sách: lấy category Sách, lọc is_mandatory = true, đưa attribute_id + value_id vào attribute_list khi add_item. Nguồn: https://open.shopee.com/documents/v2/v2.product.get_attribute_tree?module=89&type=1
- **v2.product.get_brand_list - GET /api/v2/product/get_brand_list** - Thương hiệu hợp lệ cho category: category_id, offset, page_size, status. Trả về brand_id, display_brand_name. Nếu NXB chưa có trong danh sách thì dùng giá trị No Brand theo quy định category (chưa xác minh được). Nguồn: https://open.shopee.com/documents/v2/v2.product.get_brand_list?module=89&type=1
- **v2.product.get_recommend_attribute - GET /api/v2/product/get_recommend_attribute** - Gợi ý giá trị thuộc tính theo tên sản phẩm. Nguồn: https://open.shopee.com/documents/v2/v2.product.get_recommend_attribute?module=89&type=1

### 2.3 Biến thể (tier variation) và model/SKU
Cấu trúc: một item có các tier (ví dụ "Loại bìa"), mỗi tier có option_list; mỗi tổ hợp option tạo một model với model_id, model_sku, giá và tồn kho riêng. Với sách dùng cho bìa mềm/bìa cứng hoặc bản thường/bản đặc biệt.
- **v2.product.init_tier_variation - POST /api/v2/product/init_tier_variation** - Khởi tạo biến thể: item_id, tier_variation (name + option_list, option có thể kèm image.image_id), model (tier_index ví dụ [0,0], normal_stock, original_price, model_sku). Nguồn: https://open.shopee.com/documents/v2/v2.product.init_tier_variation?module=89&type=1
- **v2.product.get_model_list - GET /api/v2/product/get_model_list** - Toàn bộ cấu trúc biến thể: tier_variation, model (model_id, model_sku, tier_index, price_info, stock_info). Nguồn: https://open.shopee.com/documents/v2/v2.product.get_model_list?module=89&type=1
- **v2.product.update_tier_variation / add_model / update_model / delete_model** - Sửa tier, thêm/sửa/xóa model. Nguồn: https://open.shopee.com/documents/v2/v2.product.update_tier_variation?module=89&type=1 (các endpoint còn lại cùng module 89)
- SKU: không biến thể dùng item_sku (cấp item); có biến thể dùng model_sku từng model. Đọc lại qua get_item_base_info và get_model_list.

### 2.4 Giá, tồn kho, khuyến mãi, flash sale
- **v2.product.update_price - POST /api/v2/product/update_price** - Cập nhật giá gốc: item_id, price_list (original_price; có biến thể thì kèm model_id từng model). Nguồn: https://open.shopee.com/documents/v2/v2.product.update_price?module=89&type=1
- **v2.product.update_stock - POST /api/v2/product/update_stock** - Cập nhật tồn kho theo GIÁ TRỊ TUYỆT ĐỐI (không phải delta): item_id, stock_list (normal_stock; có biến thể kèm model_id). ERP là nguồn sự thật về tồn kho, mỗi lần thay đổi thì đẩy số tuyệt đối lên theo từng model_id. Nguồn: https://open.shopee.com/documents/v2/v2.product.update_stock?module=89&type=1
- **v2.product.get_item_promotion - GET /api/v2/product/get_item_promotion** - Kiểm tra khuyến mãi đang áp và giá khuyến mãi hiện tại. Nguồn: https://open.shopee.com/documents/v2/v2.product.get_item_promotion?module=89&type=1
- Nhóm Discount (module 99): **v2.discount.add_discount - POST** (discount_name, start_time, end_time Unix timestamp; start cách hiện tại ít nhất 1 giờ, end cách start ít nhất 1 giờ, dưới 180 ngày, tối đa 1000 discount upcoming+ongoing) -> discount_id. **v2.discount.add_discount_item - POST** (discount_id, item_list gồm item_id, purchase_limit, item_promotion_price hoặc model_list gồm model_id + model_promotion_price). **v2.discount.update_discount / update_discount_item**, **get_discount_list** (discount_status ALL/UPCOMING/ONGOING/EXPIRED), **end_discount** (kết thúc ngay), **delete_discount**, **delete_discount_item**. Nguồn: https://open.shopee.com/documents/v2/v2.discount.add_discount?module=99&type=1
- Nhóm Shop Flash Sale (module 123): **get_time_slot_id** (khung giờ trống), **create_shop_flash_sale**, **add_shop_flash_sale_items** (tối đa 50 item bật/flash sale, tồn kho dành riêng cho campaign), **get_item_criteria** (tiêu chí tham gia), **update/delete_shop_flash_sale**, **update/delete_shop_flash_sale_items**, **get_shop_flash_sale_list**. Nguồn: https://open.shopee.com/documents/v2/v2.shop_flash_sale.create_shop_flash_sale?module=123&type=1
- Flash sale cấp sàn (Shopee tổ chức) - chưa xác minh được endpoint API.

### 2.5 Ảnh và video (media)
- **v2.media_space.upload_image - POST /api/v2/media_space/upload_image** - Gọi TRƯỚC add_item. Tham số: image (multipart, nhiều file/request), scene ("normal" - ảnh vuông xử lý cho ảnh sản phẩm; "desc" - không xử lý cho ảnh mô tả mở rộng), ratio ("1:1" mặc định; "3:4" chỉ whitelist). Giới hạn: tối đa 9 ảnh/request, 10MB/ảnh, JPG/JPEG/PNG. Trả về image_info_list: image_id (gắn vào image.image_id_list khi add_item, tối đa 9), image_url_list. Nguồn: https://open.shopee.com/documents/v2/v2.media_space.upload_image?module=91&type=1
- Video sản phẩm - quy trình 4 bước: **init_video_upload - POST** (file_md5, file_size; giới hạn 10-60 giây, tối đa 30MB) -> video_upload_id; **upload_video_part - POST** (video_upload_id, part_seq từ 0, content_md5, part_content; mỗi phần 4MB trừ phần cuối); **complete_video_upload - POST** (video_upload_id, part_seq_list, report_data.upload_cost ms); **get_video_upload_result - GET** (status: INITIATED/TRANSCODING/SUCCEEDED/FAILED/CANCELLED; khi SUCCEEDED có video_url_list, thumbnail_url_list, duration). **cancel_video_upload - POST** để hủy. Nguồn: https://open.shopee.com/documents/v2/v2.media_space.init_video_upload?module=91&type=1
- **v2.media.upload_image - POST /api/v2/media/upload_image** (module 130) - upload ảnh cho nghiệp vụ khác (ví dụ ảnh chứng từ hoàn hàng: business=2, scene=1, tối đa 3 ảnh, 10MB/ảnh). Nguồn: https://open.shopee.com/documents/v2/v2.media.upload_image?module=130&type=1

### 2.6 Mô tả, trạng thái, unlist, boost
- Mô tả: trường description của add_item/update_item; hỗ trợ mô tả mở rộng dạng ảnh (upload scene "desc").
- item_status: NORMAL (đang bán), UNLIST (ẩn bán tạm thời), BANNED (vi phạm), DELETED (đã xóa).
- **v2.product.unlist_item - POST** (item_id, unlist true/false). Nguồn: https://open.shopee.com/documents/v2/v2.product.unlist_item?module=89&type=1
- **v2.product.boost_item - POST** (item_id_list). **v2.product.get_boosted_list - GET** (item_id, boost_end_time). Nguồn: https://open.shopee.com/documents/v2/v2.product.boost_item?module=89&type=1
- **v2.product.get_item_violation_info - GET** (item_id) - kiểm tra vi phạm (liên quan BANNED). Nguồn: https://open.shopee.com/documents/v2/v2.product.get_item_violation_info?module=89&type=1

**Điều chưa xác minh được (cụm 2):** thuộc tính bắt buộc cụ thể cho category Sách tại VN (Brand/NXB, tác giả, năm XB, số trang có phải thuộc tính có sẵn không; brand_id của các NXB hoặc giá trị No Brand); giới hạn số tier và số model tối đa; cơ chế Shopee tự trừ kho khi phát sinh đơn (trường stock_info chi tiết); tên trường gắn video vào add_item; cấu trúc mô tả mở rộng; endpoint flash sale cấp sàn; giới hạn độ dài tên/mô tả, tồn kho tối đa, rate limit nhóm product; endpoint get chi tiết discount theo discount_id.

---

## 3. Đơn hàng, trả hàng và hoàn tiền

Base: `https://partner.shopeemobile.com/api/v2` - module Order (94), Returns (102), Push (105). Xác thực mọi request bằng partner_id, timestamp, access_token, shop_id và chữ ký sign.

### 3.1 Lấy danh sách đơn hàng
- **v2.order.get_order_list - GET /order/get_order_list** - Tham số: time_range_field (bắt buộc: `create_time` hoặc `update_time` - dùng update_time để poll thay đổi, create_time để lấy đơn mới), time_from, time_to (Unix timestamp, phạm vi tối đa 15 ngày/lần gọi), page_size (tối đa 100), cursor (phân trang dạng cursor, trang đầu để rỗng), order_status (lọc theo trạng thái). Trả về: order_list (order_sn, order_status...), more (bool), next_cursor. Nguồn: https://open.shopee.com/documents/v2/v2.order.get_order_list?module=94&type=1

### 3.2 Chi tiết đơn hàng
- **v2.order.get_order_detail - GET /order/get_order_detail** - Tham số: order_sn_list (tối đa 50 mã đơn), response_optional_fields (chỉ lấy trường cần). Trường có giá trị cho ERP: buyer_user_id, buyer_username, recipient_address (name, phone, town, district, city, state, region, zipcode, full_address), item_list (item_id, item_name, item_sku, model_id, model_name, model_sku, model_quantity_purchased, model_original_price, model_discounted_price, promotion_type), total_amount, estimated_shipping_fee, actual_shipping_fee, payment_method, cod (bool), currency, message_to_seller (ghi chú khách), create_time, pay_time, days_to_ship, ship_by_date, split_up, package_list, invoice_data, note (ghi chú nội bộ người bán), cancel_by, cancel_reason, buyer_cancel_reason. Nguồn: https://open.shopee.com/documents/v2/v2.order.get_order_detail?module=94&type=1

### 3.3 Đơn chờ giao (hỗ trợ kho)
- **v2.order.get_shipment_list - GET /order/get_shipment_list** - Đơn có order_status READY_TO_SHIP hoặc RETRY_SHIP. Phân trang cursor. Mỗi phần tử: order_sn, package_number, logistics_status. Nguồn: https://open.shopee.com/documents/v2/v2.order.get_shipment_list?module=94&type=1

### 3.4 Trạng thái đơn và vòng đời
- **UNPAID**: đặt chưa thanh toán (tự hủy nếu quá hạn).
- **READY_TO_SHIP**: đã thanh toán, sẵn sàng giao - điểm vào cho kho/thủ kho xử lý.
- **PROCESSED**: người bán đã sắp xếp vận chuyển (có tracking number).
- **SHIPPED**: kiện đã giao cho đơn vị vận chuyển.
- **COMPLETED**: đã giao và xác nhận, tiền giải ngân về ví.
- **CANCELLED**: đã hủy.
- **IN_CANCEL**: đang trong yêu cầu hủy (người mua xin hủy, chờ người bán xử lý).
- **TO_RETURN**: có yêu cầu trả hàng/hoàn tiền đang xử lý.
- **RETRY_SHIP**: cần sắp xếp lại giao nhận - ý nghĩa chính xác chưa xác minh được.
- **TO_CONFIRM_RECEIVE**: chờ xác nhận nhận hàng - chưa xác minh được.
- **INVOICE_PENDING**: chờ hóa đơn (ngữ cảnh region BR/PL) - áp dụng VN chưa xác minh được.
- Vòng đời chuẩn: UNPAID -> READY_TO_SHIP -> PROCESSED -> SHIPPED -> COMPLETED; nhánh hủy: CANCELLED.
- Xác định bên hủy: trường cancel_by, cancel_reason, buyer_cancel_reason trong get_order_detail; giá trị enum của cancel_by chưa xác minh được.

### 3.5 Hủy đơn
- Người bán chủ động hủy: **v2.order.cancel_order - POST /order/cancel_order** - order_sn, cancel_reason (OUT_OF_STOCK, CUSTOMER_REQUEST, UNDELIVERABLE_AREA, COD_NOT_SUPPORTED), item_list (item_id, model_id - hỗ trợ hủy một phần). Chỉ hủy được trước khi giao đi. Bổ trợ: **v2.order.get_estimate_cancel_value - POST** (ước tính giá trị hoàn khi hủy một phần). Nguồn: https://open.shopee.com/documents/v2/v2.order.cancel_order?module=94&type=1
- Xử lý yêu cầu hủy của người mua: **v2.order.handle_buyer_cancellation - POST** - order_sn, operation = ACCEPT/REJECT. Không có API chuyển READY_TO_SHIP sang PROCESSED thủ công - trạng thái đổi tự động khi gọi API logistics (ship_order). Nguồn: https://open.shopee.com/documents/v2/v2.order.handle_buyer_cancellation?module=94&type=1

### 3.6 Tách đơn (split order)
- **v2.order.split_order - POST /order/split_order** - order_sn, package_list (mỗi package: item_list với item_id, model_id, order_item_id, promotion_group_id). Response: order_sn và danh sách package đã tách. Nguồn: https://open.shopee.com/documents/v2/v2.order.split_order?module=94&type=1
- **v2.order.unsplit_order - POST /order/unsplit_order** - hoàn tác, chỉ khi đơn còn READY_TO_SHIP. Nguồn: https://open.shopee.com/documents/v2/v2.order.unsplit_order?module=94&type=1

### 3.7 Ghi chú nội bộ
- **v2.order.set_note - POST /order/set_note** - order_sn, note. Nguồn: https://open.shopee.com/documents/v2/v2.order.set_note?module=94&type=1

### 3.8 Trả hàng/hoàn tiền - danh sách và chi tiết
- **v2.returns.get_return_list - GET /returns/get_return_list** - page_no (từ 1), page_size (tối đa 100), create/update_time_from/to, status (REQUESTED/PROCESSING/ACCEPTED/COMPLETED/CANCELLED), negotiation_status, seller_proof_status, seller_compensation_status. Response: response.return (mảng), response.more.
- **v2.returns.get_return_detail - GET /returns/get_return_detail** - return_sn. Trường: return_sn, status, refund_amount, reason, user.username, item, due_date, return_ship_due_date, return_seller_due_date (deadline xử lý), negotiation.negotiation_status (PENDING_RESPOND/ONGOING/TERMINATED), negotiation.offer_due_date, seller_proof.seller_evidence_deadline, seller_compensation.seller_compensation_due_date, is_seller_arrange.
- Nguồn module: https://open.shopee.com/documents?module=102&type=1&id=608&version=2

### 3.9 Trạng thái return
REQUESTED (khởi tạo) -> PROCESSING -> ACCEPTED (chờ hàng trả về) -> COMPLETED (đã hoàn tiền); nhánh CANCELLED.

### 3.10 Xác nhận/từ chối và tranh chấp (dispute)
- **v2.returns.confirm - POST /returns/confirm** - chấp nhận yêu cầu (return_sn).
- **v2.returns.dispute - POST /returns/dispute** - tranh chấp khi return_status là REQUESTED/PROCESSING/ACCEPTED: return_sn, email (bắt buộc), dispute_reason (bắt buộc, lấy ID từ get_return_dispute_reason), dispute_text_reason, images.
- **v2.returns.cancel_dispute - POST** - chỉ hủy compensation dispute (ACCEPTED + COMPENSATION_REQUESTED).
- Thương lượng: **v2.returns.offer - POST** (return_sn, solution: 0 = Return and Refund, 1 = Refund Only, refund_amount), **accept_offer - POST**, **get_available_solutions - GET** (phương án + max_refund_amount).
- **v2.returns.get_return_dispute_reason - GET** - dispute_reason (reason_id, reason_text).
- Bằng chứng: **convert_image - POST** (ảnh base64 dưới 10MB sang URL), **upload_proof - POST** (text/ảnh/video), **query_proof - GET**.
- Tracking chiều ngược: **v2.returns.get_reverse_tracking_info - GET** - return_refund_request_type (0 Normal RR, 1 In-transit RR, 2 Return-on-the-Spot), validation_type (seller_validation/warehouse_validation), reverse_logistics_status, tracking_number, tracking_info.

### 3.11 Webhook trạng thái đơn so với poll (Push Mechanism, module 105)
- **v2.push.set_app_push_config - POST** - callback_url (bắt buộc HTTPS), set_push_config_on (mảng mã bật), set_push_config_off, blocked_shop_id_list (tối đa 500 shop).
- **v2.push.get_app_push_config - GET** - callback_url, live_push_status (Normal/Warning/Suspended), push_config_on_list/off_list.
- **v2.push.get_lost_push_message - GET** - tin nhắn push mất trong 3 ngày gần nhất, tối đa 100/lần, has_next_page, last_message_id. **v2.push.confirm_consumed_lost_push_message - POST** - last_message_id.
- Nguồn: https://open.shopee.com/documents/v2/v2.push.set_app_push_config?module=105&type=1
- Mã push liên quan đơn hàng: **code 3** = Order status update (trạng thái đơn đổi); **code 4** = TrackingNo push (có tracking number mới). Các mã khác: 1 = shop authorization, 2 = shop deauthorization, 5 = Shopee Updates, 6 = banned item, 7 = item promotion, 8 = reserved stock change, 9 = promotion update, 10 = webchat, 11 = video upload, 12 = OpenAPI authorization expiry, 13 = brand register result. Mã push riêng cho return/refund - chưa xác minh được.
- **Khuyến nghị cho ERP nhỏ (formapubli):** webhook làm kênh chính (bật code 3 và 4), endpoint nhận POST, verify chữ ký (header Authorization, HMAC-SHA256 với partner key), trả 200 nhanh và xử lý bất đồng bộ, idempotency theo push message. Chạy get_lost_push_message định kỳ (mỗi 15 phút) bù tin mất khi downtime. Giữ poll dự phòng: get_order_list với time_range_field=update_time mỗi 5-15 phút cho đơn trong ngày, đề phòng webhook bị suspend. Combo webhook + poll dự phòng là đủ, không cần poll dày.

**Điều chưa xác minh được (cụm 3):** không mở trực tiếp được trang tài liệu; URL v2 theo mẫu cho get_order_detail và từng endpoint returns; ý nghĩa RETRY_SHIP/TO_CONFIRM_RECEIVE/INVOICE_PENDING cho VN; enum cancel_by; mã push riêng cho return/refund; cấu trúc payload chính xác của Order Status Push và cơ chế verify chữ ký webhook; rate limit từng endpoint; trường return_request_due_date.

---

## 4. Vận chuyển, tài chính và webhook

### 4.1 Vận chuyển - Logistics (module 95, tiền tố v2.logistics)

Luồng gửi hàng chuẩn:
1. **v2.logistics.get_shipping_parameter** - lấy tham số bắt buộc cho đơn trước khi ship.
2. **v2.logistics.ship_order** (đơn lẻ) hoặc **v2.logistics.batch_ship_order** (hàng loạt) - khởi tạo vận chuyển.
3. **v2.logistics.get_tracking_number** - lấy mã vận đơn.
4. **v2.logistics.create_shipping_document** -> **get_shipping_document_result** -> **download_shipping_document** - in phiếu (bất đồng bộ).
5. **v2.logistics.get_tracking_info** - theo dõi hành trình.

Khuyến nghị tài liệu: nên khởi tạo logistics khoảng 1 giờ sau khi đơn đặt, vì người mua có cửa sổ 1 giờ hủy đơn không cần yêu cầu tới người bán.

#### 4.1.1 Lấy tham số vận chuyển bắt buộc
- **v2.logistics.get_shipping_parameter** - tham số: order_sn. Trả về: khối dropoff (thông tin bưu cục/branch khi mang hàng ra điểm gửi), khối pickup (address_id và khung giờ lấy hàng pickup_time/time_slot), danh sách info_needed cần bổ sung. Bước bắt buộc trước ship_order - thiếu tham số này thì ship_order lỗi. Nguồn: https://open.shopee.com/documents/v2/v2.logistics.get_shipping_parameter
- Phân biệt cho formapubli: Dropoff = kho tự mang kiện đã dán phiếu ra bưu cục SPX (cần branch_id khi ship qua API); Pickup = SPX tới kho Vitanova lấy hàng (cần address_id + pickup_time_id/time_slot). Hình thức theo từng đơn do cấu hình kênh của shop và kết quả get_shipping_parameter quyết định - ERP không nên hard-code.

#### 4.1.2 Khởi tạo vận chuyển - arrange shipment
- **v2.logistics.ship_order - POST** - order_sn, package_number, pickup (address_id, pickup_time_id) cho pickup, dropoff (branch_id, sender_real_name...) cho dropoff, kênh non-integrated thì kèm tracking_number tự cung cấp. Mô tả chính thức: "Use this api to initiate logistics including arrange pickup, dropoff or shipment for non-integrated logistic channels. Should call v2.logistics.get_shipping_parameter to fetch all required param first." Nguồn: https://open.shopee.com/documents?module=95&type=1&id=553&version=2
- **v2.logistics.batch_ship_order - POST** - order_list (mỗi đơn kèm tham số pickup/dropoff tương ứng). Nguồn: https://open.shopee.com/documents?module=95&type=1&id=688&version=2
- **v2.logistics.update_shipping_order** - sửa thông tin pickup/dropoff sau khi đã ship (chi tiết trường chưa xác minh được).

#### 4.1.3 Mã vận đơn - AWB / tracking number
- **v2.logistics.get_tracking_number** - order_sn, package_number (tùy chọn), response_optional_fields (ví dụ first_mile_tracking_number). Trả về tracking_number - với SPX Express là mã tra cứu và in trên phiếu. Nguồn: https://open.shopee.com/documents/v2/v2.logistics.get_tracking_number

#### 4.1.4 In phiếu vận đơn - shipping document
Luồng bất đồng bộ 4 bước:
1. **v2.logistics.get_shipping_document_parameter** - kiểm tra loại document khả dụng theo từng đơn (order_list: order_sn, package_number).
2. **v2.logistics.create_shipping_document - POST** - order_list (order_sn, package_number, tracking_number...), shipping_document_type.
3. **v2.logistics.get_shipping_document_result** - trạng thái tác vụ: READY (tải được), PROCESSING (đang tạo), FAILED (tạo lại).
4. **v2.logistics.download_shipping_document** - tải file khi READY. Bổ trợ: **get_shipping_document_info** (thông tin phiếu đã tạo của 1 đơn). Nguồn: https://open.shopee.com/documents?module=95&type=1&id=548&version=2
- Loại document: NORMAL_AIR_WAYBILL (phiếu thường in giấy A4-A5), THERMAL_AIR_WAYBILL (phiếu nhiệt - phù hợp nếu kho dùng máy in nhãn), NORMAL_JOB_AIR_WAYBILL (gộp nhiều phiếu thường), THERMAL_JOB_AIR_WAYBILL (gộp nhiều phiếu nhiệt). In hàng loạt: truyền order_list nhiều phần tử và chọn loại *_JOB_AIR_WAYBILL để nhận 1 file gộp. Định dạng file chính xác (PDF hay khác) - chưa xác minh được.

#### 4.1.5 Theo dõi hành trình
- **v2.logistics.get_tracking_info** - order_sn, package_number. Trả về trạng thái vận chuyển và lịch sử các mốc tracking. ERP dùng để hiển thị hành trình SPX thay cho tra tay. Với kênh tích hợp (SPX Express), các mốc tự động từ Shopee/SPX, shop không phải đẩy từng mốc.

#### 4.1.6 Kênh vận chuyển của shop
- **v2.logistics.get_channel_list** - logistics_channel_id, logistics_channel_name (SPX Express xuất hiện khi shop đã kích hoạt), enabled, cod_enabled, mask_channel_id, size_list, giới hạn cân/kích thước.
- **v2.logistics.update_channel** - bật/tắt kênh, preferred, cod_enabled.
- **v2.logistics.get_address_list / set_address_config / delete_address** - địa chỉ kho dùng cho pickup.
- Lưu ý: logistics_channel_id chính xác của SPX Express tại shop Vitanova chỉ lấy được khi gọi get_channel_list bằng token thật của shop.

#### 4.1.7 Ngày dự kiến giao hàng
Nằm ở phía đơn hàng (ship_by_date - hạn phải giao cho vận chuyển, estimated delivery time phía người mua trong chi tiết đơn). Endpoint chuyên biệt trong module logistics - chưa xác minh được.

### 4.2 Tài chính và đối soát - Payment / Escrow
Mục đích: đối soát theo từng đơn và từng đầu sách - doanh thu gộp trừ phí sàn/phí thanh toán/phần shop chịu ra số thực nhận, đối chiếu với mức chiết khấu kênh Shopee 25-30% trên giá bìa đã nắm ở nghiệp vụ.
- **v2.payment.get_escrow_detail** - chi tiết ký quỹ theo 1 đơn: order_sn. Trả về order_income gồm escrow_amount (thực nhận sau khấu trừ), item_price/gross amount, buyer_total_amount, các khoản trừ: commission_fee (hoa hồng sàn), service_fee, seller_transaction_fee (phí giao dịch/thanh toán phía người bán), shipping_fee và hỗ trợ vận chuyển (shopee_shipping_rebate, seller_shipping_discount...), voucher/coin shop chịu (voucher_from_seller, coin_from_seller), breakdown theo từng item (item_id/model_id, item_price, discount...) - nguồn chuẩn để tính doanh thu thực theo đầu sách. Nguồn: https://open.shopee.com/documents/v2/v2.payment.get_escrow_detail
- **v2.payment.get_income_statement** (và các endpoint income theo kỳ) - báo cáo thu nhập tổng hợp theo kỳ: khoảng thời gian bắt đầu/kết thúc. Đối chiếu tổng tiền về ví theo kỳ với tổng escrow detail từng đơn.
- Nhóm khác (tên theo cấu trúc v2, chi tiết chưa xác minh được): get_escrow_list, get_payout_detail, get_wallet_transaction_list, get_item_installment_status/get_shop_installment_status.
- Cảnh báo: tên trường chi tiết của escrow detail và income statement chưa đọc trực tiếp từ tài liệu chính thức trong phiên này - trước khi code đối soát phải mở lại 2 URL trên để chốt từng trường và đơn vị tiền.

### 4.3 Push Mechanism - webhook
- Cơ chế: Shopee POST JSON tới Callback URL khai báo trong console (App > Push Mechanism/Callback), thay cho polling liên tục.
- Payload: mã loại sự kiện (code), shop_id, timestamp, khối data riêng theo sự kiện.
- Sự kiện chính cho formapubli: Order status update (đơn mới/thanh toán/hủy/hoàn thành - quan trọng nhất để nhận đơn theo thời gian thực), Tracking/logistics update, Return/refund update, Item promotion, Shop authorization (sắp hết hạn/thu hồi ủy quyền). Danh sách đầy đủ và mã code - chưa xác minh được trực tiếp.
- Xác thực chữ ký: HMAC-SHA256 với Partner Key, chữ ký gửi kèm header của request push; phía nhận tính lại HMAC trên URL callback + body rồi so khớp. Công thức chính xác (thứ tự nối URL và body) - chưa xác minh được, không tự chế khi triển khai.
- Yêu cầu callback URL: HTTPS công khai; trả HTTP 200 nhanh, xử lý nặng đưa vào hàng đợi nội bộ rồi trả 200 ngay; khai báo trong console ở trang chi tiết App mục Push: nhập Callback URL, subscribe từng loại push, dùng test push của console kiểm tra. Shopee gửi push kiểm tra khi cấu hình - server phải trả 200 thì console mới lưu thành công.
- IP whitelist cho chiều nhận push - chưa xác minh được.

### 4.4 Chat / tin nhắn với người mua
- API v2 có nhóm chat cho shop (Shopee Chat): liệt kê hội thoại, đọc tin nhắn, gửi tin nhắn văn bản/hình ảnh, đánh dấu đã đọc. Thường tách quyền riêng và có thể yêu cầu shop được cấp quyền chat API. Tên endpoint cụ thể - chưa xác minh được. Khuyến nghị giai đoạn đầu: chưa đưa chat vào phạm vi, xử lý thủ công trong Seller Center.

**Điều chưa xác minh được (cụm 4):** toàn bộ trang tài liệu chính thức (domain bị chặn trong phiên này; logistics được đối chiếu từ SDK Go mirror có trích dẫn mô tả và link gốc); method và tham số chi tiết từng endpoint logistics; logistics_channel_id và tên chính xác của SPX Express (chỉ biết khi gọi get_channel_list bằng token thật); định dạng file của download_shipping_document và giới hạn số đơn/tác vụ in hàng loạt; tên trường chi tiết của get_escrow_detail và URL income statement; danh sách đầy đủ event type và mã code của Push, công thức ký HMAC chính xác cho push, tên header chứa chữ ký, yêu cầu IP whitelist cho callback, retry khi callback lỗi; bộ endpoint chat chính thức; endpoint ngày dự kiến giao hàng.

---

## 5. Đối chiếu vào ERP formapubli

### 5.1 Bảng đối chiếu nhu cầu nghiệp vụ -> API

| # | Nhu cầu nghiệp vụ formapubli | API tương ứng | Độ khó | Rủi ro / lưu ý |
|---|---|---|---|---|
| 1 | Thay nhập đơn Shopee bằng xlsx thủ công ở tab Shopee: đơn mới về ERP tự động theo thời gian thực | Push code 3 (order status) + v2.push.set_app_push_config; dự phòng v2.order.get_order_list (time_range_field=update_time, poll 5-15 phút) | Trung bình | Webhook có thể bị suspend (live_push_status=Suspended); phải có get_lost_push_message mỗi 15 phút bù tin mất; callback URL phải HTTPS công khai |
| 2 | Lấy chi tiết đơn để tạo đơn ERP (người mua, địa chỉ, dòng hàng, phí ship, ghi chú) | v2.order.get_order_detail (order_sn_list tối đa 50/lần, response_optional_fields) | Dễ | Map model_sku -> SKU đầu sách ERP; địa chỉ Shopee tách sẵn town/district/city; COD vs chuyển khoản qua trường cod và payment_method |
| 3 | Thủ kho xử lý đơn chờ giao | v2.order.get_shipment_list (READY_TO_SHIP/RETRY_SHIP) | Dễ | Đây là danh sách công việc của kho thay cho file xlsx |
| 4 | Gửi hàng SPX: dropoff hoặc pickup tại kho | v2.logistics.get_shipping_parameter -> v2.logistics.ship_order / batch_ship_order | Trung bình | Không hard-code dropoff/pickup - theo từng đơn từ get_shipping_parameter; nên ship sau khi đơn đặt khoảng 1 giờ (cửa sổ hủy 1 giờ của người mua) |
| 5 | Lấy mã vận đơn SPX | v2.logistics.get_tracking_number | Dễ | Lưu tracking_number vào đơn ERP để đối soát và tra cứu |
| 6 | In phiếu vận đơn (máy in nhiệt kho) | create_shipping_document (THERMAL_AIR_WAYBILL) -> poll get_shipping_document_result tới READY -> download_shipping_document; in hàng loạt dùng THERMAL_JOB_AIR_WAYBILL | Trung bình | Luồng bất đồng bộ 4 bước, phải poll trạng thái; định dạng file cần xác minh lại (dự kiến PDF) |
| 7 | Theo dõi hành trình SPX trên ERP | v2.logistics.get_tracking_info | Dễ | Thay cho tra tay trên web SPX |
| 8 | Đồng bộ tồn kho ERP -> Shopee | v2.product.update_stock (giá trị tuyệt đối theo model_id) | Dễ-Trung bình | ERP là nguồn sự thật; mỗi lần tồn kho đổi thì đẩy số tuyệt đối; chú ý Shopee tự trừ kho khi có đơn - cần cơ chế đối soát định kỳ tránh lệch |
| 9 | Lên sản phẩm mới, ảnh, mô tả, giới thiệu | v2.media_space.upload_image (9 ảnh, 10MB/ảnh, scene normal/desc) -> v2.product.add_item (category lá + attribute bắt buộc từ get_attribute_tree) | Trung bình-Khó | Phải lấy đúng category lá ngành Sách và attribute bắt buộc (Brand/NXB); ảnh phải upload trước khi tạo sản phẩm; mô tả dài nên dùng scene desc |
| 10 | Biến thể sách (bìa mềm/bìa cứng, bản đặc biệt) | v2.product.init_tier_variation, add_model, update_model, get_model_list | Trung bình | Mỗi model có model_sku riêng - map 1-1 với SKU ERP; giá/tồn kho theo từng model |
| 11 | Khuyến mãi, giảm giá, flash sale | v2.discount.add_discount/add_discount_item (ràng buộc thời gian chặt); v2.shop_flash_sale.* | Trung bình | Lưu ý: khuyến mãi ERP hiện KHÔNG áp cho Shopee (quyết định 2026-10-14: chỉ kênh chủ động được) - API dùng khi có chương trình riêng cho sàn |
| 12 | Trả hàng/hoàn tiền về ERP | v2.returns.get_return_list/get_return_detail; confirm/dispute/offer | Trung bình | Gắn vào luồng hoàn trả ERP (kho/doanh thu/hóa đơn điều chỉnh); chú ý deadline return_seller_due_date |
| 13 | Đối soát doanh thu theo đầu sách | v2.payment.get_escrow_detail (thực nhận sau phí), v2.payment.get_income_statement (theo kỳ) | Trung bình-Khó | Đây là nguồn chuẩn thay cho ước tính chiết khấu 25-30%; tên trường chi tiết phải mở lại tài liệu chính thức trước khi code |
| 14 | Xuất hóa đơn cho đơn online Shopee | Dùng dữ liệu get_order_detail (người mua, MST nếu có trong invoice_data) -> luồng prepare/push MS-Invoice của ERP đã có | Dễ-Trung bình | Trường invoice_data trong chi tiết đơn - cần kiểm tra thực tế có MST người mua không |
| 15 | Ủy quyền shop và duy trì kết nối | Auth flow: auth_partner URL -> code -> access_token (4 giờ) -> refresh (30 ngày) | Trung bình | access_token hết hạn 4 giờ BẮT BUỘC có cron refresh; shop hủy ủy quyền thì token chết - cần phát hiện qua lỗi API và webhook deauthorize |

### 5.2 Rủi ro kỹ thuật đáng chú ý nhất
1. **Token 4 giờ:** access_token chỉ sống 4 giờ - bắt buộc có cron refresh định kỳ (ví dụ mỗi 3 giờ), lưu refresh_token mới sau mỗi lần refresh (xoay vòng). Mất token = mất toàn bộ đồng bộ đơn/vận chuyển.
2. **Chữ ký HMAC:** sai thứ tự ghép chuỗi hoặc timestamp lệch là lỗi sign ngay. Công thức: partner_id + api_path + timestamp + access_token + shop_id (không dấu phân tách). Cần kiểm tra kỹ trên tài liệu chính thức trước khi code vì nguồn nghiên cứu lần này chưa đọc trực tiếp được trang sign.
3. **Webhook suspend:** Shopee suspend push khi callback lỗi nhiều (live_push_status=Suspended) - bắt buộc có get_lost_push_message định kỳ + poll dự phòng, không phụ thuộc 100% vào webhook.
4. **Tồn kho 2 chiều:** update_stock đặt số tuyệt đối; Shopee tự trừ kho khi có đơn. Nếu ERP và Shopee lệch nhịp sẽ oversell hoặc ẩn hàng. Cần job đối soát tồn kho định kỳ (ví dụ mỗi giờ so sánh tồn ERP với stock Shopee qua get_item_base_info).
5. **Mỗi shop ủy quyền riêng:** có bao nhiêu shop là bấy nhiêu bộ token - thiết kế DB lưu token theo shop_id ngay từ đầu.
6. **Thuộc tính sách chưa rõ:** attribute bắt buộc cho category Sách tại VN (Brand/NXB, tác giả...) và brand_id của các NXB phải tra thực tế bằng get_attribute_tree/get_brand_list khi có token thật - không đoán trước được.
7. **In phiếu bất đồng bộ:** create -> poll READY -> download; phải có hàng đợi và retry, tránh kho bấm in rồi không có phiếu.
8. **Phí và đối soát:** chiết khấu kênh Shopee 25-30% hiện là ước tính nghiệp vụ - escrow detail là nguồn chuẩn, nhưng tên trường chưa xác minh được, không code đối soát khi chưa đọc tài liệu gốc.

### 5.3 Lộ trình triển khai đề xuất
- **P1 (nền tảng + đơn + vận chuyển):** tạo app Shopee (lấy Partner ID/Key) -> auth flow + lưu token theo shop -> cron refresh token -> pull đơn (get_order_list + get_order_detail) đổ về tab Shopee thay xlsx -> get_shipment_list cho kho -> luồng ship SPX (get_shipping_parameter -> ship_order/batch_ship_order) -> get_tracking_number -> in phiếu nhiệt (THERMAL_AIR_WAYBILL, in lẻ và in gộp job) -> get_tracking_info hiển thị hành trình. Webhook code 3+4 + get_lost_push_message + poll dự phòng.
- **P2 (sản phẩm + tồn kho + hoàn trả):** đồng bộ tồn kho 2 chiều (update_stock + job đối soát) -> lên sản phẩm (upload ảnh -> add_item với attribute đúng category Sách) -> biến thể/model/SKU -> discount theo đợt -> returns (get_return_list/detail, confirm/dispute) gắn vào luồng hoàn trả ERP.
- **P3 (tài chính + nâng cao):** escrow detail + income statement -> đối soát doanh thu theo đầu sách (thay ước tính chiết khấu) -> hóa đơn cho đơn Shopee có yêu cầu VAT -> shop flash sale -> chat (nếu cần) -> báo cáo hiệu quả kênh Shopee.

### 5.4 Việc cần làm ngay trước khi code
1. Tạo app trên console Shopee (cần anh Kha chốt: tên app tối đa 30 ký tự, mô tả 250 ký tự, logo png/jpg dưới 3MB, category) để lấy Partner ID/Key.
2. Mở lại trên trình duyệt thật các trang tài liệu chính thức để chốt: công thức sign, chi tiết escrow detail, công thức ký webhook, danh sách event push đầy đủ, attribute category Sách.
3. Đăng ký test account + tạo test shop sandbox, chạy thử toàn bộ luồng P1 trên sandbox trước khi chạm dữ liệu thật.
4. Thiết kế bảng lưu token theo shop_id (access_token, refresh_token, expire_at) và cron refresh.
5. Chuẩn bị server nhận webhook: HTTPS công khai, verify HMAC, trả 200 nhanh, xử lý bất đồng bộ, idempotency.

---
*Tài liệu nghiên cứu - Công ty TNHH Vitanova - 2026-10-20. Nguồn chính: tài liệu chính thức open.shopee.com/documents/v2 (đối chiếu qua SDK cộng đồng do domain bị chặn trong môi trường nghiên cứu); các mục "chưa xác minh được" cần kiểm tra lại trên trình duyệt thật trước khi triển khai.*

---

# BỔ SUNG SÂU (Muse trực tiếp nghiên cứu, 2026-10-20)

Phần này bổ sung các chi tiết đội nghiên cứu trước chưa xác minh được và mở rộng phân tích tiềm năng/cơ hội. Nguồn: tài liệu cộng đồng trích nguyên văn từ open.shopee.com (rollout.com, api2cart.com, publicapis.io) và SDK TypeScript đầy đủ nhất hiện có (@congminh1254/shopee-sdk, npm). Các điểm đánh dấu "khi có token" sẽ kiểm chứng lần cuối bằng credential thật của công ty trước khi code.

## 1. Xác thực - chi tiết đã rõ
- Mọi request API v2 mang tham số: partner_id, timestamp, sign, (shop_id + access_token với API cấp shop).
- Công thức ký (HMAC-SHA256 bằng Partner Key): chuỗi gốc = partner_id + đường dẫn API + timestamp; với API cấp shop cộng thêm access_token + shop_id ở cuối. Hai biến thể này được trích trong nhiều SDK độc lập khớp nhau; kiểm chứng lần cuối khi có token (khi có token).
- access_token sống 4 giờ; refresh_token sống 30 ngày và được cấp MỚI mỗi lần refresh (xoay vòng): phải lưu cả hai sau mỗi lần refresh, mất refresh_token cũ thì phải ủy quyền lại từ đầu.
- Host: live https://partner.shopeemobile.com/api/v2; sandbox https://partner.test-stable.shopeemobile.com/api/v2.

## 2. Webhook (Push) - công thức verify đã rõ
- Shopee gửi đẩy về URL callback của hệ thống, kèm header "x-shopee-signature".
- Verify: HMAC-SHA256(Partner Key, toàn bộ raw body nhận được) so khớp với giá trị trong header. Đây là điểm trước đây ghi "chưa xác minh được", nay đã có cơ sở (khi có token: vẫn test lại bằng một sự kiện thật ở sandbox trước khi go-live).
- Các sự kiện cần đăng ký ít nhất: trạng thái đơn thay đổi, hủy đơn, hoàn trả, sản phẩm thay đổi, tồn kho, ủy quyền sắp hết hạn, tin nhắn chat mới.
- Webhook có thể bị Shopee tạm dừng phía họ (lost push): bắt buộc có job lấy lại tin đã mất + poll danh sách đơn theo cửa sổ thời gian làm kênh dự phòng. Không bao giờ chỉ tin webhook.

## 3. Chat - kênh chăm sóc khách hàng qua API (mới bổ sung)
- Có API Chat riêng: lấy danh sách cuộc trò chuyện, đọc lịch sử tin nhắn, gửi tin (văn bản + media), nhận sự kiện tin mới qua webhook.
- Điều kiện: scope ủy quyền RIÊNG, không tự có kèm quyền đơn hàng - có thể phải xin thêm với đội đối tác Shopee. Đây là điểm cần hỏi ngay khi tạo app.
- Lưu ý chính sách: Shopee KHÔNG khuyến khích chatbot trả lời tự động hoàn toàn; hướng khuyến nghị là công cụ cho nhân viên thật trả lời nhanh (gợi ý mẫu trả lời, gán hội thoại). Chỉ số Chat Response Rate (trả lời trong 12 giờ, tính 30 ngày) ảnh hưởng trực tiếp điểm vận hành shop.
- Có cơ chế gửi voucher theo nhóm khách qua chat (chat broadcast) - kênh remarketing miễn phí tới khách đã mua.

## 4. Phân tích doanh thu và hiệu quả - cách tiếp cận đúng
- Shopee KHÔNG mở API "báo cáo doanh thu tổng hợp" kiểu Seller Centre. Dashboard phân tích của Shopee chỉ có trên giao diện Seller Centre.
- Cách đúng cho ERP: tự xây phân tích từ dữ liệu gốc kéo về:
  - Đơn hàng + chi tiết dòng hàng: GMV, số đơn, giá trị trung bình, theo ngày/kênh/kho.
  - Escrow detail từng đơn: số tiền thực nhận, mọi khoản phí tách dòng (phí cố định/hoa hồng theo ngành hàng, phí xử lý giao dịch, phí dịch vụ chương trình, phí vận chuyển phía người bán) - đây là nguồn chuẩn để tính P&L thực theo từng đầu sách.
  - Hoàn trả + hủy: tỷ lệ, giá trị mất, lý do.
  - Đánh giá khách hàng (reviews): điểm sao, nội dung, media - phục vụ phân tích chất lượng đầu sách và dịch vụ.
- Cấu trúc phí tại Việt Nam (tham chiếu từ tài liệu kế toán Shopee, số liệu 2026): phí xử lý giao dịch 6% trên tổng thanh toán (áp cả COD, từ 01/05/2026); phí cố định theo ngành hàng dao động khoảng 1.21% - 8.1% (sách thuộc nhóm thấp); thêm phí dịch vụ chương trình tự nguyện (Voucher Xtra, hoàn xu, freeship) và hoa hồng tiếp thị liên kết nếu tham gia. Mọi tỷ lệ này phải lấy từ escrow thật của từng đơn khi đối soát, KHÔNG hardcode - chính sách phí thay đổi theo thời gian là nguyên nhân số một gây lệch đối soát.
- Cơ hội: khi có dữ liệu escrow theo đầu sách, ERP tính được lãi gộp thực từng cuốn sách trên kênh Shopee (giá bán thực - chiết khấu shop - tổng phí sàn - COGS), điều mà hiện tại công ty không nhìn thấy khi làm thủ công bằng xlsx.

## 5. Sản phẩm và media - chi tiết bổ sung
- Tối đa 9 ảnh cho mỗi listing (gồm ảnh bìa); hỗ trợ video sản phẩm; mỗi biến thể có ảnh riêng.
- Đăng sản phẩm bắt buộc: danh mục, thuộc tính bắt buộc của danh mục (với sách: nhà xuất bản, tác giả, số trang, năm xuất bản, ISBN, ngôn ngữ, bìa cứng/mềm - cần lấy cây thuộc tính thật của danh mục Sách tại VN bằng API get_attribute_tree khi có token), thương hiệu (NXB phải có trong danh sách brand của Shopee, tra bằng get_brand_list), trọng lượng và kích thước kiện (bắt buộc cho tính phí ship, làm tròn lên số nguyên), ngày gửi hàng / đặt trước.
- Sản phẩm có trường thông tin thuế (loại hóa đơn + thuế suất) - khớp nhu cầu cấu hình sách VAT 5%.
- Cập nhật giá/tồn là GIÁ TRỊ TUYỆT ĐỐI: mọi thay đổi giá/tồn từ ERP phải tính xong số cuối rồi mới đẩy; Shopee tự trừ tồn khi phát sinh đơn, nên phải có vòng đối soát tồn định kỳ hai chiều (ERP là nguồn sự thật cho tồn vật lý; Shopee là nguồn sự thật cho đơn).

## 6. Giới hạn gọi API
- Shopee không công bố con số rate limit cố định cho từng endpoint trong tài liệu công khai; thực hành chuẩn: hàng đợi gửi, thử lại với backoff lũy thừa khi gặp lỗi giới hạn, gom thao tác hàng loạt vào các endpoint batch (batch ship, cập nhật nhiều model), và tránh poll dày - ưu tiên webhook.
- Đây là lý do kiến trúc tích hợp phải có lớp hàng đợi riêng trong ERP, không gọi API trực tiếp từ thao tác người dùng.

## 7. Các module nâng cao đáng chú ý (cơ hội mở rộng)
Theo danh mục module của nền tảng và SDK tham chiếu:
- Marketing: voucher của shop, giảm giá, bundle deal, add-on deal, flash sale của shop, quà khi follow, top picks - tự động hóa khuyến mãi đồng bộ với chiến dịch hội chợ/offline của công ty (lưu ý chính sách nội bộ: khuyến mãi chỉ áp kênh chủ động kiểm soát được).
- Shopee Ads: có API quảng cáo (quản lý chiến dịch) - giai đoạn sau nếu công ty chạy ads.
- Tiếp thị liên kết (AMS): quản lý hoa hồng affiliate cho sản phẩm.
- Merchant/đa shop: quản lý nhiều shop, kho của merchant - hữu ích nếu mở thêm shop chuyên ngành.
- Fulfillment by Shopee (FBS) và kho dịch vụ (SBS): Shopee giữ kho + đóng gói; hiện công ty tự vận hành kho nên chỉ tham khảo.
- First mile: ràng buộc tuyến đầu SPX cho điểm gửi hàng quy mô lớn.
- Livestream/video: ngoài phạm vi hiện tại.

## 8. Tổng hợp cơ hội cho Vitanova khi tích hợp xong
1. Vận hành: đơn về ERP trong vài giây thay vì nhập tay cuối ngày; gửi hàng + in phiếu hàng loạt ngay trong tab Shopee; giảm sai sót địa chỉ/SĐT (nguồn lỗi thủ công hiện tại).
2. Tài chính: đối soát escrow theo từng đơn và từng đầu sách; lãi thực kênh Shopee lần đầu nhìn được; phục vụ luôn nghĩa vụ hóa đơn (đơn online có nhu cầu VAT đi vào cùng pipeline hóa đơn đã làm với MS-Invoice).
3. Kho: tồn Shopee đồng bộ với tồn vật lý, hết cảnh bán vượt khi chạy hội chợ song song; cảnh báo sắp hết hàng theo tốc độ bán thật.
4. Khách hàng: tập hợp đánh giá và lịch sử mua để chăm sóc; phản hồi chat nhanh hơn = điểm vận hành tốt hơn = thứ hạng tìm kiếm tốt hơn.
5. Tăng trưởng: đăng mới sách lên Shopee từ dữ liệu portal/ERP trong một thao tác (cùng một bộ ảnh + mô tả); khuyến mãi đồng bộ các kênh chủ động.

## 9. Điều kiện tiên quyết và thứ tự làm (cập nhật)
1. Tạo app trong console (cần tên app + logo) -> Partner ID/Key.
2. Xin/xác nhận scope: đơn hàng, logistics là mặc định; Chat là scope riêng.
3. Ủy quyền shop thật + sandbox shop để test.
4. Code nền: ký số, quản lý token theo shop (cron refresh), hàng đợi gọi API, nhận webhook + verify.
5. P1: đồng bộ đơn + gửi SPX + in phiếu. P2: sản phẩm/tồn + hoàn trả + chat. P3: đối soát escrow + phân tích + marketing/ads.

---

# XÁC MINH TRỰC TIẾP TỪ TÀI LIỆU CHÍNH THỨC (qua console đã đăng nhập, 2026-10-20)

Các mục dưới đây được đọc nguyên từ cây tài liệu v2 trên open.shopee.com bằng tài khoản thật của công ty - thay thế mọi chỗ trước ghi "chưa xác minh được" về danh mục endpoint.

## A. Cây module v2 đầy đủ (33 module)
AMS, Video, Product, GlobalProduct, MediaSpace, Media, Shop, Merchant, Order, Logistics, FirstMile, Payment, Discount, Bundle Deal, Add-On Deal, Voucher, ShopFlashSale, Follow Prize, TopPicks, ShopCategory, Returns, AccountHealth, Ads, Public, Push, SBS, FBS, Livestream, BrandPortal, Buybox, BusinessInsights.
- Không có module Auth riêng: các endpoint xác thực nằm trong module Public: get_access_token, refresh_access_token, get_token_by_resend_code, get_shops_by_partner, get_merchants_by_partner, get_shopee_ip_ranges (dải IP của Shopee để whitelist webhook chiều về).

## B. Xác thực - xác minh chính thức
- Tham số chung mọi request: partner_id, timestamp (hết hạn sau 5 phút), access_token (dùng được nhiều lần, hết hạn 4 giờ), shop_id, sign.
- sign = HMAC-SHA256 trên chuỗi gồm partner_id + đường dẫn API + timestamp + access_token + shop_id, khóa là Partner Key. (Xác minh: đúng công thức đã ghi ở phần bổ sung.)
- Host live toàn cầu: https://partner.shopeemobile.com; sandbox: https://openplatform.sandbox.test-stable.shopee.sg.

## C. Đơn hàng - xác minh chi tiết
- get_order_list: bắt buộc time_range_field (create_time/update_time), cửa sổ tối đa 15 ngày mỗi lần gọi, page_size 1-100, phân trang cursor (more + next_cursor), lọc order_status: UNPAID, READY_TO_SHIP, PROCESSED, SHIPPED, COMPLETED, IN_CANCEL, CANCELLED, INVOICE_PENDING.
- get_order_detail: tối đa 50 order_sn mỗi lần; trường mở rộng tùy chọn gồm buyer_user_id, buyer_username, recipient_address, estimated/actual_shipping_fee, item_list, pay_time, dropshipper, total_amount, note.
- get_shipment_list: cho kho - chỉ gồm đơn READY_TO_SHIP hoặc RETRY_SHIP, kèm package_number.
- Có split_order/unsplit_order (tách/gộp gói), cancel_order, handle_buyer_cancellation, set_note, get_estimate_cancel_value.
- QUAN TRỌNG cho nghiệp vụ hóa đơn: có nhóm API hóa đơn phía người mua: get_pending_buyer_invoice_order_list, get_buyer_invoice_info, upload_invoice_doc, download_invoice_doc - Shopee cho phép người mua yêu cầu hóa đơn ngay trên sàn và người bán tải hóa đơn lên; điểm nối trực tiếp với pipeline MS-Invoice của ERP.
- Có sẵn FBS invoices (generate/get/download) cho kênh Fulfillment by Shopee.

## D. Logistics - xác minh chi tiết
- Luồng chuẩn: get_shipping_parameter (biết đơn thuộc dropoff/pickup/non-integrated, danh sách điểm gửi, khung giờ lấy hàng) -> ship_order hoặc mass_ship_order/batch_ship_order (gửi hàng loạt) -> get_tracking_number/get_mass_tracking_number -> in phiếu: get_shipping_document_parameter -> create_shipping_document -> get_shipping_document_result -> download_shipping_document; có thêm create_shipping_document_job cho in gộp theo job và download_to_label.
- get_tracking_number có thể trả rỗng lúc đầu vì phụ thuộc 3PL: được phép poll mỗi tối đa 5 phút cho tới khi có mã.
- Khuyến nghị chính thức: khởi tạo logistics khoảng 1 giờ sau khi đơn phát sinh.
- Có get_channel_list/update_channel (bật/tắt kênh vận chuyển của shop), get_address_list/quản lý địa chỉ lấy hàng, get_operating_hours, set_pause_status (tạm dừng shop vận hành).

## E. Sản phẩm - xác minh
- Đủ bộ: get_category, get_attribute_tree, get_brand_list, register_brand, add_item/update_item/delete_item, biến thể (init_tier_variation, model list/add/update/delete), unlist_item, update_price, update_stock, boost_item (đẩy sản phẩm), get_item_promotion, get_comment/reply_comment (đánh giá khách + trả lời), category_recommend, get_recommend_attribute, gợi ý trọng lượng, size chart, get_item_violation_info, kiểm tra nội dung (content diagnosis), kit item (bán combo theo bộ - khớp mô hình combo của công ty), batch_add_item (đăng hàng loạt).
- Upload ảnh ở module MediaSpace; video ở module Media (init/upload part/complete theo từng đoạn).

## F. Payment/Tài chính - xác minh (mạnh hơn kỳ vọng)
- get_escrow_detail + get_escrow_detail_batch + get_escrow_list: chi tiết tiền giữ theo đơn (nguồn đối soát).
- generate_income_statement/get_income_statement, generate_income_report/get_income_report, get_income_overview, get_income_detail: bộ báo cáo thu nhập chính thức của sàn.
- get_payout_detail/get_payout_info: tiền thực chi trả về tài khoản.
- get_wallet_transaction_list, get_billing_transaction_info: giao dịch ví và hóa đơn phí của sàn.
- => ERP có tới 3 tầng đối soát: escrow theo đơn (chi tiết nhất) -> income report theo kỳ -> payout thực nhận. Đây là nền cho phân tích lãi theo đầu sách chính xác đến từng đồng phí.

## G. Hoàn trả - xác minh
- get_return_list/get_return_detail, confirm, dispute + get_return_dispute_reason + cancel_dispute, get_available_solutions, offer/accept_offer (đề xuất phương án cho người mua), upload_proof/query_proof/convert_image (bằng chứng), get_shipping_carrier, upload_shipping_proof, get_reverse_tracking_info (theo dõi chiều hàng quay về).

## H. Push/Webhook - xác minh danh mục sự kiện
- Tài liệu riêng: mục Push Mechanism trên open.shopee.com. API điều khiển: set_app_push_config, get_app_push_config, get_lost_push_message, confirm_consumed_lost_push_message.
- Nhóm sự kiện: Đơn hàng (order_status_push, order_trackingno_push, shipping_document_status_push, package_fulfillment_status_push, booking_*), Sản phẩm (reserved_stock_change_push - mã 8, item_price_update_push, violation_item_push, video_upload_push, brand_register_result), Hoàn trả (return_updates_push), Marketing (item_promotion_push, promotion_update_push), Hệ thống (open_api_authorization_expiry - cảnh báo token sắp hết hạn, shop_authorization_push/canceled, shop_penalty_update_push), Webchat (có nhóm riêng), Consignment và FBS.
- Cơ chế tin cậy: timeout phản hồi 3 giây, thứ tự KHÔNG đảm bảo, cùng một tin có thể gửi lặp, lịch retry 300s/1800s/10800s -> bắt buộc idempotency theo mã sự kiện + xử lý bất đồng bộ (nhận xong trả 200 ngay, xử lý nền).
- Quy tắc đăng ký sự kiện tùy loại app (ERP System, Seller In House System...) - khi tạo app cần chọn đúng loại để được các quyền cần thiết.

## I. Hai module phân tích chuyên biệt (cần đọc sâu ở bước triển khai)
- AccountHealth: điểm vận hành, vi phạm, phạt của shop (liên quan trực tiếp việc duy trì thứ hạng và quyền lợi bán hàng).
- BusinessInsights: module phân tích kinh doanh riêng của nền tảng (khác với tự xây từ order/escrow) - cần đối chiếu phạm vi dữ liệu trước khi quyết định ERP tự tính hay lấy từ đây.
