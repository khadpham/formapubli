-- 0085: Bảng lưu chương trình khuyến mãi Shopee (voucher, discount, bundle, flash sale).
-- Cấu hình chương trình (tên, thời gian, sản phẩm) = vận hành -> tab Shopee.
-- Ngân sách đã chi và hiệu quả (ROAS) = tài chính -> tab Chủ (tính từ escrow, không lưu ở đây).
CREATE TABLE IF NOT EXISTS shopee_marketing (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL, -- VOUCHER | DISCOUNT | BUNDLE | ADDON | FLASH_SALE
  name TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}', -- cấu hình chi tiết theo từng loại
  status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT | SCHEDULED | ONGOING | EXPIRED | CANCELLED
  shopee_id TEXT, -- id trên Shopee (khi đã đẩy lên sàn thành công)
  start_at TEXT,
  end_at TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_shopee_marketing_type ON shopee_marketing(type);
CREATE INDEX IF NOT EXISTS idx_shopee_marketing_status ON shopee_marketing(status);
