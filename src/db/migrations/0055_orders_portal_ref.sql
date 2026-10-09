-- 0055: portal_ref — mã đơn của Customer Portal (datmua) trên bảng orders.
-- Quy ước 2 mã riêng: order_code (nội bộ, tăng tự động, không trùng) +
-- portal_ref (khách tra theo mã portal). NULL = đơn không qua portal.
ALTER TABLE `orders` ADD `portal_ref` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_orders_portal_ref` ON `orders` (`portal_ref`);
--> statement-breakpoint
PRAGMA foreign_key_check;
