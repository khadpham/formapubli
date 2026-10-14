-- 0065: Canh bao ton thap - nguong ton kho toi thieu theo san pham.
ALTER TABLE products ADD COLUMN low_stock_threshold INTEGER DEFAULT 0;
--> statement-breakpoint
CREATE INDEX idx_products_low_stock ON products(low_stock_threshold);
