CREATE TABLE `rights_contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_number` text NOT NULL,
	`work_id` text NOT NULL,
	`licensor_id` text,
	`licensor_name` text,
	`royalty_rate` real NOT NULL,
	`print_quota` integer NOT NULL,
	`advance_amount` real DEFAULT 0 NOT NULL,
	`effective_date` text NOT NULL,
	`expiration_date` text NOT NULL,
	`terminated` integer DEFAULT false,
	`terminate_reason` text,
	`notes` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`work_id`) REFERENCES `works`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`licensor_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_rights_contract_number` ON `rights_contracts` (`contract_number`);--> statement-breakpoint
CREATE INDEX `idx_rights_work` ON `rights_contracts` (`work_id`);--> statement-breakpoint
CREATE INDEX `idx_rights_licensor` ON `rights_contracts` (`licensor_id`);--> statement-breakpoint
CREATE INDEX `idx_rights_expiration` ON `rights_contracts` (`expiration_date`);
