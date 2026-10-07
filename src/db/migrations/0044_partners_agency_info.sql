-- 0044: thong tin giao nhan dai ly (ban dai ly). Additive-only, nullable.
ALTER TABLE partners ADD COLUMN address TEXT;--> statement-breakpoint
ALTER TABLE partners ADD COLUMN phone TEXT;--> statement-breakpoint
ALTER TABLE partners ADD COLUMN email TEXT;--> statement-breakpoint
ALTER TABLE partners ADD COLUMN tax_code TEXT;--> statement-breakpoint
ALTER TABLE partners ADD COLUMN receiver_name TEXT;--> statement-breakpoint
ALTER TABLE partners ADD COLUMN ship_note TEXT;
