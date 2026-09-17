CREATE TABLE `staff_accounts` (
	`staff_id` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`role` text NOT NULL,
	`passcode_hash` text NOT NULL,
	`salt` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `idx_staff_role` ON `staff_accounts` (`role`);--> statement-breakpoint
CREATE INDEX `idx_staff_active` ON `staff_accounts` (`is_active`);
