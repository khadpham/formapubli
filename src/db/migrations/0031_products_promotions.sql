-- Sản phẩm (gốc chung cho sách và hàng hóa) + Khuyến mại quà tặng.
--
-- VÌ SAO CẦN BẢNG `products` KHI ĐÃ CÓ `works` + `editions`:
-- Mô hình cũ giả định MỌI THỨ BÁN ĐƯỢC ĐỀU LÀ SÁCH. `editions` bắt buộc có
-- `work_id` (NOT NULL, FK `works`), `isbn` (NOT NULL), `isbn_last4` (NOT NULL).
-- Một món hàng hóa (móc khỏa, túi, áo, bookmark) không có tác giả, không có
-- ISBN — muốn bán phải bịa tác giả và bịa ISBN. `order_items.edition_id` và
-- `inventory_ledger.edition_id` đều NOT NULL + FK `editions`, còn
-- `pos-catalog.service.ts:71` INNER JOIN `works` nên bản ghi bịa đó còn lọt vào
-- DoI (`forecast.service.ts:179`) và "top tác giả"
-- (`executive-query.service.ts:485`). Bản ghi giả trong dữ liệu là thứ khó gỡ
-- nhất — không có cột nào phân biệt được sau này.
--
-- `products` làm TẦNG GỐC. Sách vẫn nằm ở `works` + `editions`, nhưng mọi thứ
-- bán/tồn kho sẽ trỏ `product_id`.
--
-- VÌ SAO `products.id` CỦA SÁCH BẰNG `editions.id` (`ed-h01`):
-- Nếu phát sinh id mới thì phải viết lại khóa ngoại ở 14 bảng và backfill từng
-- bảng. Đặt id trùng `editions.id` thì backfill chỉ là `SET product_id = id` —
-- một câu, và dữ liệu lịch sử tự nhiên hợp lệ. Hàng hóa mới dùng tiền tố
-- `pr-`.
--
-- VÌ SAO `products.code` ĐỂ NULL KHI BACKFILL SÁCH:
-- `migrate-book-skus.ts` đã từng đổi `editions.code` (H01 → HH001). Nếu copy
-- `code` sang `products` thì có HAI nguồn sự thật cho cùng một SKU, UNIQUE
-- chỉ bắt được trùng trong từng bảng, không có trigger đồng bộ ⇒ chạy lại
-- script đổi SKU là `products.code` thành số cũ. Tra cứu mã sách qua
-- `editions.code` như hiện tại. Chỉ hàng hóa mới có `products.code`.
--
-- VÌ SAO CHƯA SET NOT NULL:
-- Thêm cột → backfill → *rồi mới* siết NOT NULL ở giai đoạn sau. Siết ngay
-- thì đơn cũ đọc được nhưng ghi mất. Giai đoạn này KHÔNG BACKFILL — backfill
-- là Cổng 1b, chạy lúc kho đóng vì `UPDATE` ghi từng dòng một và giữ khoá
-- ghi DB vài giây.
--
-- `when` của entry journal phải CAO HƠN `0030` (1790600006000) vì drizzle bỏ
-- qua im lặng entry có `when` nhỏ hơn bản ghi cuối.
--
-- KHÔNG dùng `IF NOT EXISTS` cho `ALTER TABLE ADD COLUMN`: SQLite không có
-- câu đó, và thêm vào sẽ làm câu sai âm thầm thay vì lộ lỗi. Toàn bộ trigger
-- nếu có phải là MỘT khối, không tách `;` bên trong BEGIN...END.
CREATE TABLE IF NOT EXISTS `products` (
  `id` text PRIMARY KEY NOT NULL,
  `code` text,
  `name` text NOT NULL,
  `product_kind` text NOT NULL DEFAULT 'BOOK',
  `selling_price` real NOT NULL DEFAULT 0,
  `cost_price` real,
  `barcode` text,
  `description` text,
  `is_gift_item` integer NOT NULL DEFAULT 0,
  `is_active` integer NOT NULL DEFAULT 1,
  `created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `products_code_unique` ON `products` (`code`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `products_barcode_unique` ON `products` (`barcode`) WHERE `barcode` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `promotions` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `is_active` integer NOT NULL DEFAULT 1,
  `starts_at` text,
  `ends_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `promotion_gifts` (
  `id` text PRIMARY KEY NOT NULL,
  `promotion_id` text NOT NULL REFERENCES `promotions`(`id`),
  `min_subtotal` real NOT NULL,
  `product_id` text NOT NULL REFERENCES `products`(`id`),
  `gift_quantity` integer NOT NULL DEFAULT 1,
  UNIQUE(`promotion_id`, `min_subtotal`, `product_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_promotion_gifts_lookup` ON `promotion_gifts` (`promotion_id`, `min_subtotal`);
--> statement-breakpoint
ALTER TABLE `editions` ADD `product_id` text REFERENCES `products`(`id`);
--> statement-breakpoint
ALTER TABLE `order_items` ADD `product_id` text REFERENCES `products`(`id`);
--> statement-breakpoint
ALTER TABLE `inventory_ledger` ADD `product_id` text REFERENCES `products`(`id`);
--> statement-breakpoint
ALTER TABLE `stock_balances` ADD `product_id` text REFERENCES `products`(`id`);
--> statement-breakpoint
ALTER TABLE `order_items` ADD `promotion_id` text REFERENCES `promotions`(`id`);
--> statement-breakpoint
ALTER TABLE `order_items` ADD `is_gift_line` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `order_items` ADD `is_manual` integer NOT NULL DEFAULT 0;