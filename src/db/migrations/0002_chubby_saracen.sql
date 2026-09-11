CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`edition_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_cover_price` real NOT NULL,
	`unit_discount_rate` real DEFAULT 0,
	`unit_selling_price` real NOT NULL,
	`total_amount` real NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`edition_id`) REFERENCES `editions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`order_code` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`channel` text DEFAULT 'FAIR_EVENT' NOT NULL,
	`partner_id` text,
	`customer_id` text,
	`customer_name` text,
	`subtotal` real NOT NULL,
	`discount_rate` real DEFAULT 0,
	`discount_amount` real DEFAULT 0,
	`final_amount` real NOT NULL,
	`payment_method` text DEFAULT 'CASH' NOT NULL,
	`fiscal_scope` text DEFAULT 'INTERNAL_MANAGEMENT' NOT NULL,
	`vat_rate` real DEFAULT 0,
	`vat_invoice_required` integer DEFAULT false,
	`vat_invoice_code` text,
	`status` text DEFAULT 'COMPLETED' NOT NULL,
	`sync_status` text DEFAULT 'SYNCED' NOT NULL,
	`cashier_id` text DEFAULT 'staff-admin' NOT NULL,
	`idempotency_key` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_order_items_order_id` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_order_items_edition_id` ON `order_items` (`edition_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_order_code_unique` ON `orders` (`order_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_idempotency_key_unique` ON `orders` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_orders_fiscal_scope` ON `orders` (`fiscal_scope`);--> statement-breakpoint
CREATE INDEX `idx_orders_warehouse` ON `orders` (`warehouse_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_created_at` ON `orders` (`created_at`);