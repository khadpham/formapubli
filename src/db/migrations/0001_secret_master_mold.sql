DROP INDEX IF EXISTS `editions_isbn_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_editions_isbn`;--> statement-breakpoint
ALTER TABLE `editions` ADD `code` text NOT NULL;--> statement-breakpoint
ALTER TABLE `editions` ADD `title` text;--> statement-breakpoint
ALTER TABLE `editions` ADD `publisher` text;--> statement-breakpoint
ALTER TABLE `editions` ADD `status` text DEFAULT 'IN_STOCK';--> statement-breakpoint
CREATE UNIQUE INDEX `editions_code_unique` ON `editions` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_editions_code` ON `editions` (`code`);--> statement-breakpoint
CREATE INDEX `idx_editions_isbn` ON `editions` (`isbn`);