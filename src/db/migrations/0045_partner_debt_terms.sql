-- 0045: dieu khoan cong no ban dai ly + phieu thu ban dut.
-- partners: han muc no goi dau (0 = thu du khi giao), so ngay han tra, ghi chu.
-- partner_receipts: phieu thu bat bien + VOID (giong consignment_payments
-- nhung cho ban dut, tru no chung FIFO). Additive-only.
ALTER TABLE `partners` ADD `credit_limit` real DEFAULT 0;--> statement-breakpoint
ALTER TABLE `partners` ADD `payment_due_days` integer DEFAULT 30;--> statement-breakpoint
ALTER TABLE `partners` ADD `payment_note` text;--> statement-breakpoint
CREATE TABLE `partner_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`delivery_order_id` text,
	`amount` real NOT NULL,
	`payment_method` text NOT NULL,
	`reference` text NOT NULL,
	`paid_at` text NOT NULL,
	`received_by` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`void_reason` text,
	`idempotency_key` text NOT NULL,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`delivery_order_id`) REFERENCES `delivery_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `partner_receipts_idempotency_key_unique` ON `partner_receipts` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_partner_rcpt_partner` ON `partner_receipts` (`partner_id`);--> statement-breakpoint
CREATE INDEX `idx_partner_rcpt_order` ON `partner_receipts` (`delivery_order_id`);--> statement-breakpoint
CREATE INDEX `idx_partner_rcpt_status` ON `partner_receipts` (`status`);
