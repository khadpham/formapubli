-- 0079: Mapping SKU Shopee -> thành phần ERP (hỗ trợ combo/qua tang).
-- Một SKU Shopee có thể gồm nhiều edition (combo) hoặc một edition (sách lẻ/quà).
CREATE TABLE IF NOT EXISTS shopee_sku_components (
  shopee_sku TEXT NOT NULL,
  edition_id TEXT NOT NULL REFERENCES editions(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (shopee_sku, edition_id)
);
CREATE INDEX IF NOT EXISTS idx_shopee_sku_components_sku ON shopee_sku_components(shopee_sku);
