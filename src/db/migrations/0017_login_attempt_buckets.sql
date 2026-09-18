CREATE TABLE IF NOT EXISTS `login_attempt_buckets` (
  `key` text PRIMARY KEY NOT NULL,
  `fails` integer DEFAULT 0 NOT NULL,
  `locked_until` integer DEFAULT 0 NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
