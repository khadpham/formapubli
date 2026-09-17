CREATE TABLE `sponsorship_drawdowns` (
	`id` text PRIMARY KEY NOT NULL,
	`fund_id` text NOT NULL,
	`order_id` text NOT NULL,
	`edition_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_cover_price` real NOT NULL,
	`drawn_value` real NOT NULL,
	`drawn_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`fund_id`) REFERENCES `sponsorship_funds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`edition_id`) REFERENCES `editions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sponsorship_funds` (
	`id` text PRIMARY KEY NOT NULL,
	`fund_code` text NOT NULL,
	`sponsor_name` text NOT NULL,
	`partner_id` text,
	`amount_received` real NOT NULL,
	`quota_type` text NOT NULL,
	`quota_limit` real DEFAULT 0 NOT NULL,
	`balance_remaining` real DEFAULT 0 NOT NULL,
	`total_drawn_qty` integer DEFAULT 0 NOT NULL,
	`total_drawn_value` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_by` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`closed_at` text,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sponsorship_drawdowns_order_id_unique` ON `sponsorship_drawdowns` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_spd_fund` ON `sponsorship_drawdowns` (`fund_id`);--> statement-breakpoint
CREATE INDEX `idx_spd_edition` ON `sponsorship_drawdowns` (`edition_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sponsorship_funds_fund_code_unique` ON `sponsorship_funds` (`fund_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_spf_code` ON `sponsorship_funds` (`fund_code`);--> statement-breakpoint
CREATE INDEX `idx_spf_status` ON `sponsorship_funds` (`status`);