-- 0081: Bảng lưu yêu cầu trả hàng/hoàn tiền Shopee.
CREATE TABLE IF NOT EXISTS shopee_returns (
  return_sn TEXT PRIMARY KEY,
  order_sn TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'REQUESTED',
  reason TEXT,
  refund_amount REAL NOT NULL DEFAULT 0,
  buyer_username TEXT,
  seller_due_date INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_shopee_returns_order ON shopee_returns(order_sn);
CREATE INDEX IF NOT EXISTS idx_shopee_returns_status ON shopee_returns(status);
