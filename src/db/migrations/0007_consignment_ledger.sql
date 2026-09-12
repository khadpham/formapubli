CREATE TABLE `consignment_statement_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`statement_id` text NOT NULL,
	`edition_id` text NOT NULL,
	`opening_qty` integer DEFAULT 0 NOT NULL,
	`sent_qty` integer DEFAULT 0 NOT NULL,
	`reported_sold_qty` integer DEFAULT 0 NOT NULL,
	`returned_new_qty` integer DEFAULT 0 NOT NULL,
	`returned_damaged_qty` integer DEFAULT 0 NOT NULL,
	`lost_qty` integer DEFAULT 0 NOT NULL,
	`closing_qty` integer DEFAULT 0 NOT NULL,
	`unit_cover_price` real DEFAULT 0 NOT NULL,
	`line_amount` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`statement_id`) REFERENCES `consignment_statements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`edition_id`) REFERENCES `editions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `consignment_statements` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`discount_override` real,
	`fiscal_scope` text DEFAULT 'INTERNAL_MANAGEMENT' NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`total_receivable` real DEFAULT 0,
	`opening_ledger_rowid` integer,
	`notes` text,
	`created_by` text NOT NULL,
	`confirmed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_consign_line_stmt` ON `consignment_statement_lines` (`statement_id`);--> statement-breakpoint
CREATE INDEX `idx_consign_line_edition` ON `consignment_statement_lines` (`edition_id`);--> statement-breakpoint
CREATE INDEX `idx_consign_stmt_partner` ON `consignment_statements` (`partner_id`);--> statement-breakpoint
CREATE INDEX `idx_consign_stmt_status` ON `consignment_statements` (`status`);--> statement-breakpoint
CREATE INDEX `idx_consign_stmt_fiscal` ON `consignment_statements` (`fiscal_scope`);
