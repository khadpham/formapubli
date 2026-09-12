CREATE TABLE `consignment_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`statement_id` text NOT NULL,
	`amount` real NOT NULL,
	`payment_method` text NOT NULL,
	`reference` text NOT NULL,
	`paid_at` text NOT NULL,
	`received_by` text NOT NULL,
	`cashbox_session_id` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`void_reason` text,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`statement_id`) REFERENCES `consignment_statements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_consign_pay_partner` ON `consignment_payments` (`partner_id`);--> statement-breakpoint
CREATE INDEX `idx_consign_pay_stmt` ON `consignment_payments` (`statement_id`);--> statement-breakpoint
CREATE INDEX `idx_consign_pay_status` ON `consignment_payments` (`status`);
