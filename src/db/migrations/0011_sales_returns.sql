CREATE TABLE `return_order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`return_id` text NOT NULL,
	`edition_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_refund` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`return_id`) REFERENCES `return_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`edition_id`) REFERENCES `editions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `return_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`return_code` text NOT NULL,
	`return_type` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'REQUESTED' NOT NULL,
	`refund_amount` real DEFAULT 0 NOT NULL,
	`target_warehouse_id` text NOT NULL,
	`inventory_disposition` text NOT NULL,
	`cashbox_session_id` text,
	`created_by` text NOT NULL,
	`approved_by` text,
	`idempotency_key` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`decided_at` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_return_items_return` ON `return_order_items` (`return_id`);--> statement-breakpoint
CREATE INDEX `idx_return_items_edition` ON `return_order_items` (`edition_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `return_orders_return_code_unique` ON `return_orders` (`return_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `return_orders_idempotency_key_unique` ON `return_orders` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_returns_order` ON `return_orders` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_returns_status` ON `return_orders` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_returns_code` ON `return_orders` (`return_code`);