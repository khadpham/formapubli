-- 0083: Bảng đồng bộ sản phẩm Shopee 2 chiều (Giai đoạn 2 - masterplan 2026-10-22).
-- Lưu item_id Shopee trả về sau khi đăng sản phẩm từ ERP, phục vụ đối chiếu
-- đơn hàng và đẩy giá/tồn 2 chiều. Không chứa dữ liệu tài chính nhạy cảm.
CREATE TABLE IF NOT EXISTS shopee_products (
  item_id INTEGER PRIMARY KEY,
  item_sku TEXT,
  name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'NORMAL',
  category_id INTEGER,
  image_urls TEXT, -- JSON array các URL ảnh
  erp_edition_id TEXT, -- edition chính (sách lẻ); combo thì NULL, tra qua shopee_sku_components
  last_synced_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_shopee_products_sku ON shopee_products(item_sku);
CREATE INDEX IF NOT EXISTS idx_shopee_products_edition ON shopee_products(erp_edition_id);
