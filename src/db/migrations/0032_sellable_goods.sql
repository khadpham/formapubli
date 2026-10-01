-- 0031 tạo `products` nhưng CHƯA mở khóa được tồn kho và dòng đơn cho hàng hóa.
--
-- VÌ SAO PHẢI DỰNG LẠI BẢNG:
-- `stock_balances.edition_id` và `order_items.edition_id` đều NOT NULL +
-- REFERENCES `editions(id)`. Một món hàng hóa không có dòng `editions`, nên:
--   • không tạo được dòng tồn kho cho hàng hóa,
--   • không ghi được dòng đơn có hàng hóa.
-- SQLite KHÔNG có `ALTER TABLE ... DROP NOT NULL`. Muốn bỏ ràng buộc thì phải
-- dựng bảng mới → chép → DROP → đổi tên → dựng lại index và trigger. Đây là
-- 12 lệnh, KHÔNG bọc transaction, và hỏng giữa chừng là mất bảng.
--
-- CHỈ CHẠY SAU KHI KHO ĐÓNG, SAU CỔNG 1b (đã backfill product_id), VÀ SAU KHI
-- CÓ BẢN SAO DB.
--
-- `edition_id` ĐỂ NGUYÊN (nullable) chứ không xoá: 88 sách cũ vẫn trỏ tới
-- `editions`, nên toàn bộ code đang chạy trên production giữ nguyên. `product_id`
-- là khóa mới, luôn khác NULL sau khi backfill.
--
-- UNIQUE của `stock_balances` ĐỔI từ (edition_id,…) sang (product_id,…):
-- SQLite coi NULL là khác NULL, nên unique trên cột nullable sẽ cho phép trùng.
-- Vì `products.id` = `editions.id` cho sách và luôn khác NULL, unique trên
-- `product_id` vừa chặn trùng đúng vừa phục vụ hàng hóa.
--
-- Hai trigger `check_stock_non_negative` / `_ins` phải dựng lại vì DROP TABLE
-- kéo theo trigger. 0027/0029 ĐÃ ÁP production nên không sửa file cũ — thêm
-- file mới này.
--
-- Không dùng `IF NOT EXISTS` cho các câu không idempotent; runner sẽ chạy từng
-- statement một lần và dừng ngay khi lỗi.
PRAGMA foreign_keys = off;
--> statement-breakpoint
CREATE TABLE `stock_balances__0032` (
	`id` text PRIMARY KEY NOT NULL,
	`edition_id` text REFERENCES `editions`(`id`) ON UPDATE no action ON DELETE no action,
	`product_id` text NOT NULL REFERENCES `products`(`id`),
	`warehouse_id` text NOT NULL,
	`condition` text DEFAULT 'NEW',
	`physical_quantity` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `stock_balances__0032` (`id`, `edition_id`, `product_id`, `warehouse_id`, `condition`, `physical_quantity`, `updated_at`)
SELECT `id`, `edition_id`,
       COALESCE(`product_id`, `edition_id`),
       `warehouse_id`, `condition`, `physical_quantity`, `updated_at`
FROM `stock_balances`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS check_stock_non_negative;
--> statement-breakpoint
DROP TRIGGER IF EXISTS check_stock_non_negative_ins;
--> statement-breakpoint
DROP INDEX IF EXISTS `uq_stock_bucket`;
--> statement-breakpoint
DROP TABLE `stock_balances`;
--> statement-breakpoint
ALTER TABLE `stock_balances__0032` RENAME TO `stock_balances`;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_stock_bucket` ON `stock_balances` (`product_id`,`warehouse_id`,`condition`);
--> statement-breakpoint
CREATE INDEX `idx_stock_balances_product` ON `stock_balances` (`product_id`);
--> statement-breakpoint
CREATE INDEX `idx_stock_balances_edition` ON `stock_balances` (`edition_id`);
--> statement-breakpoint
CREATE TRIGGER check_stock_non_negative
BEFORE UPDATE ON stock_balances
FOR EACH ROW WHEN NEW.physical_quantity < 0
BEGIN
  SELECT RAISE(ABORT, 'check_stock_non_negative: physical_quantity >= 0');
END;
--> statement-breakpoint
CREATE TRIGGER check_stock_non_negative_ins
BEFORE INSERT ON stock_balances
FOR EACH ROW WHEN NEW.physical_quantity < 0
BEGIN
  SELECT RAISE(ABORT, 'check_stock_non_negative: physical_quantity >= 0');
END;
--> statement-breakpoint
CREATE TABLE `order_items__0032` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`edition_id` text REFERENCES `editions`(`id`) ON UPDATE no action ON DELETE no action,
	`product_id` text NOT NULL REFERENCES `products`(`id`),
	`quantity` integer NOT NULL,
	`unit_cover_price` real NOT NULL,
	`unit_discount_rate` real DEFAULT 0,
	`unit_selling_price` real NOT NULL,
	`total_amount` real NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`bundle_id` text REFERENCES seasonal_bundles(id),
	`bundle_qty` integer,
	`promotion_id` text REFERENCES `promotions`(`id`),
	`is_gift_line` integer NOT NULL DEFAULT 0,
	`is_manual` integer NOT NULL DEFAULT 0,
	-- B3 = (b*): dòng quà HẾT TỒN vẫn cho thanh toán nhưng KHÔNG ghi
	-- `stock_balances`, nên tồn quà không giảm ⇒ quà ảo không có dấu vết và
	-- báo cáo sẽ nói dối. Cột này là DẤU VẾT bắt buộc: báo cáo phải tách quà
	-- tặng khi còn tồn với quà tặng khi hết tồn. 0031 đã áp production nên cột
	-- này phải nằm ở 0032, không thêm được vào 0031 nữa.
	`is_gift_shortfall` integer NOT NULL DEFAULT 0,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `order_items__0032` (`id`, `order_id`, `edition_id`, `product_id`, `quantity`, `unit_cover_price`, `unit_discount_rate`, `unit_selling_price`, `total_amount`, `created_at`, `bundle_id`, `bundle_qty`, `promotion_id`, `is_gift_line`, `is_manual`, `is_gift_shortfall`)
SELECT `id`, `order_id`, `edition_id`,
       COALESCE(`product_id`, `edition_id`),
       `quantity`, `unit_cover_price`, `unit_discount_rate`, `unit_selling_price`,
       `total_amount`, `created_at`, `bundle_id`, `bundle_qty`,
       `promotion_id`, `is_gift_line`, `is_manual`, 0
FROM `order_items`;
--> statement-breakpoint
DROP TABLE `order_items`;
--> statement-breakpoint
ALTER TABLE `order_items__0032` RENAME TO `order_items`;
--> statement-breakpoint
CREATE INDEX `idx_order_items_order_id` ON `order_items` (`order_id`);
--> statement-breakpoint
CREATE INDEX `idx_order_items_edition_id` ON `order_items` (`edition_id`);
--> statement-breakpoint
CREATE INDEX `idx_order_items_bundle_id` ON `order_items` (`bundle_id`);
--> statement-breakpoint
CREATE INDEX `idx_order_items_product` ON `order_items` (`product_id`);
--> statement-breakpoint
-- GIỮ BẤT BIẾN "sách thì products.id === editions.id" VĨNH VIỄN.
--
-- Cổng 1b backfill 88 ấn bản hiện có. Nhưng bất cứ ấn bản nào tạo SAU đó —
-- test tự sinh id, hay người vận hành thêm sách mới — sẽ không có dòng
-- `products`, và `stock_balances.product_id` / `order_items.product_id` NOT NULL
-- + FK `products(id)` sẽ chặn mọi ghi nhập kho. Đo được: test tạo `ed-s2-a`
-- rồi mọi insert tồn kho chết vì FK.
--
-- Vá 28 chỗ trong test không bền — chỉ cần một chỗ quên là hỏng. Trigger giữ
-- bất biến ở đúng một nơi. `INSERT OR IGNORE` để không đụng 88 dòng đã có.
CREATE TRIGGER `editions_sync_products`
AFTER INSERT ON `editions`
BEGIN
  INSERT OR IGNORE INTO `products` (`id`, `code`, `name`, `product_kind`, `selling_price`, `is_active`)
  SELECT NEW.id,
         NULL,
         COALESCE(NULLIF(NEW.title, ''), (SELECT w.title FROM `works` w WHERE w.id = NEW.work_id), NEW.code),
         'BOOK',
         COALESCE(NEW.cover_price, 0),
         COALESCE(NEW.is_active, 1);
END;
--> statement-breakpoint
PRAGMA foreign_keys = on;
--> statement-breakpoint
PRAGMA foreign_key_check;