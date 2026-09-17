ALTER TABLE `orders` ADD `carrier` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `tracking_code` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `shipping_status` text DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `shipping_fee` real DEFAULT 0;--> statement-breakpoint
ALTER TABLE `orders` ADD `cod_amount` real DEFAULT 0;--> statement-breakpoint
ALTER TABLE `orders` ADD `cod_status` text DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_orders_tracking_code` ON `orders` (`tracking_code`);--> statement-breakpoint
CREATE INDEX `idx_orders_shipping_status` ON `orders` (`shipping_status`);