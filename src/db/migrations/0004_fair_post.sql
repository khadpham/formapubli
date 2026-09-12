CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`actor_role` text NOT NULL,
	`actor_id` text NOT NULL,
	`resource` text NOT NULL,
	`details` text,
	`ip_address` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `cashbox_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`warehouse_id` text NOT NULL,
	`cashier_id` text NOT NULL,
	`opening_cash` real DEFAULT 0 NOT NULL,
	`closing_cash_actual` real,
	`expected_cash` real,
	`cash_discrepancy` real,
	`total_cash_sales` real DEFAULT 0,
	`total_transfer_sales` real DEFAULT 0,
	`total_orders_count` integer DEFAULT 0,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`notes` text,
	`opened_at` text DEFAULT CURRENT_TIMESTAMP,
	`closed_at` text,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `cashbox_session_id` text;--> statement-breakpoint
CREATE INDEX `idx_audit_logs_action` ON `audit_logs` (`action`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_actor` ON `audit_logs` (`actor_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_created_at` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_cashbox_cashier` ON `cashbox_sessions` (`cashier_id`);--> statement-breakpoint
CREATE INDEX `idx_cashbox_status` ON `cashbox_sessions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_cashbox_warehouse` ON `cashbox_sessions` (`warehouse_id`);--> statement-breakpoint
CREATE INDEX `idx_cashbox_opened_at` ON `cashbox_sessions` (`opened_at`);--> statement-breakpoint
CREATE INDEX `idx_orders_cashbox_session` ON `orders` (`cashbox_session_id`);