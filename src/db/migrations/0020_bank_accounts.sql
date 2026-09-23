CREATE TABLE IF NOT EXISTS `bank_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`bank_bin` text NOT NULL,
	`account_no` text NOT NULL,
	`account_name` text,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
ALTER TABLE `warehouses` ADD `default_bank_account_id` text;
--> statement-breakpoint
INSERT OR IGNORE INTO `bank_accounts` (`id`, `label`, `bank_bin`, `account_no`, `account_name`, `is_active`)
VALUES ('bank-default', 'TK hội chợ mặc định', '970405', '3180281056609', NULL, 1);
--> statement-breakpoint
