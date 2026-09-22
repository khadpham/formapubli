CREATE TABLE IF NOT EXISTS `discount_approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`order_code` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`cashier_id` text NOT NULL,
	`cart_hash` text NOT NULL,
	`cart_snapshot` text,
	`requested_discount_rate` real NOT NULL,
	`original_amount` real NOT NULL,
	`discount_amount` real NOT NULL,
	`final_amount` real NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`approved_by` text,
	`approval_method` text,
	`rejected_reason` text,
	`nonce` text NOT NULL,
	`expires_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_disc_appr_status` ON `discount_approval_requests` (`status`,`expires_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_disc_appr_order` ON `discount_approval_requests` (`order_code`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_disc_appr_warehouse` ON `discount_approval_requests` (`warehouse_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `delivery_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`partner_id` text NOT NULL,
	`from_warehouse_id` text NOT NULL,
	`subtotal` real NOT NULL,
	`discount_rate` real DEFAULT 0 NOT NULL,
	`final_amount` real NOT NULL,
	`fiscal_scope` text DEFAULT 'COMMERCIAL_WHOLESALE' NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`reversal_of` text,
	`note` text,
	`created_by` text NOT NULL,
	`dispatched_by` text,
	`dispatched_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_delivery_orders_code` ON `delivery_orders` (`code`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_delivery_orders_partner` ON `delivery_orders` (`partner_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_delivery_orders_status` ON `delivery_orders` (`status`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `delivery_order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`delivery_order_id` text NOT NULL,
	`edition_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_cover_price` real NOT NULL,
	`unit_selling_price` real NOT NULL,
	`total_amount` real NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`delivery_order_id`) REFERENCES `delivery_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`edition_id`) REFERENCES `editions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_delivery_items_order` ON `delivery_order_items` (`delivery_order_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_delivery_items_edition` ON `delivery_order_items` (`edition_id`);
--> statement-breakpoint
