-- 0042: chi phí công ty cho tab Chủ (lương, thuê, chi khác) — GĐ1 ghi tay.
CREATE TABLE `expense_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`amount` real NOT NULL,
	`note` text,
	`entry_date` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `idx_expense_entries_date` ON `expense_entries` (`entry_date`);
