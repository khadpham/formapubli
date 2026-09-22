ALTER TABLE `warehouses` ADD `is_sellable_on_pos` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `warehouses` ADD `warehouse_type` text DEFAULT 'PHYSICAL_MAIN' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `document_sequences` (
  `id` text PRIMARY KEY NOT NULL,
  `doc_type` text NOT NULL,
  `fiscal_year` integer NOT NULL,
  `current_val` integer DEFAULT 0 NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_doc_seq UNIQUE(`doc_type`,`fiscal_year`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `idempotency_keys` (
  `key` text PRIMARY KEY NOT NULL,
  `scope` text NOT NULL,
  `response_json` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
UPDATE `warehouses` SET `is_sellable_on_pos` = 1, `warehouse_type` = 'PHYSICAL_MAIN' WHERE `id` IN ('wh-au-co', 'wh-quynh-mai', 'wh-du-phong');
--> statement-breakpoint
