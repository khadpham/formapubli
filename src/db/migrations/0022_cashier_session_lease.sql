CREATE TABLE IF NOT EXISTS `active_sessions` (
  `staff_id` text PRIMARY KEY REFERENCES `staff_accounts`(`staff_id`),
  `session_id` text NOT NULL UNIQUE,
  `started_at` text DEFAULT CURRENT_TIMESTAMP,
  `last_seen_at` text DEFAULT CURRENT_TIMESTAMP,
  `lease_expires_at` text NOT NULL,
  `device_label` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_active_session_id` ON `active_sessions` (`session_id`);
--> statement-breakpoint
