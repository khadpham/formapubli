-- 0041: cấu hình Shopee (kho xuất, cờ COD) + hàng đợi đơn lỗi (quarantine).
-- Cấu hình đọc runtime (không restart), thay cho biến env tĩnh.
PRAGMA foreign_keys = off;
--> statement-breakpoint
CREATE TABLE `shopee_settings` (
  `key` text PRIMARY KEY,
  `value` text NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `shopee_quarantine` (
  `id` text PRIMARY KEY,
  `order_sn` text NOT NULL,
  `sku` text NOT NULL DEFAULT '',
  `reason` text NOT NULL,
  `resolved` integer NOT NULL DEFAULT 0,
  `created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `idx_quarantine_unresolved` ON `shopee_quarantine` (`resolved`, `created_at`);
--> statement-breakpoint
PRAGMA foreign_keys = on;
--> statement-breakpoint
PRAGMA foreign_key_check;
