CREATE TABLE IF NOT EXISTS `counter_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`warehouse_id` text NOT NULL,
	`counter_name` text NOT NULL,
	`cashbox_session_id` text,
	`edition_id` text NOT NULL,
	`allocated_quantity` integer DEFAULT 0 NOT NULL,
	`sold_quantity` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cashbox_session_id`) REFERENCES `cashbox_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`edition_id`) REFERENCES `editions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `rma_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`warehouse_id` text NOT NULL,
	`order_id` text,
	`edition_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`defect_reason` text NOT NULL,
	`quarantine_condition` text DEFAULT 'QUARANTINE' NOT NULL,
	`resolution_action` text DEFAULT 'HOLD_IN_QUARANTINE',
	`inspected_by` text DEFAULT 'staff-admin' NOT NULL,
	`status` text DEFAULT 'QUARANTINED' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`resolved_at` text,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`edition_id`) REFERENCES `editions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_counter_alloc_name` ON `counter_allocations` (`counter_name`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_counter_alloc_edition` ON `counter_allocations` (`edition_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_counter_alloc_warehouse` ON `counter_allocations` (`warehouse_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_counter_alloc_session` ON `counter_allocations` (`cashbox_session_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rma_warehouse` ON `rma_tickets` (`warehouse_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rma_edition` ON `rma_tickets` (`edition_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rma_order` ON `rma_tickets` (`order_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rma_status` ON `rma_tickets` (`status`);
