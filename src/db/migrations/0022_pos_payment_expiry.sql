ALTER TABLE `orders` ADD `payment_expires_at` text;
--> statement-breakpoint
CREATE INDEX `idx_orders_payment_expires_at` ON `orders` (`payment_expires_at`);
