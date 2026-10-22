-- 0086: Đối soát payout Shopee theo kỳ (Giai đoạn 4 - chỉ tab Chủ).
-- Tầng 2+3 của đối soát 3 tầng: tổng hợp escrow theo kỳ + khớp sao kê ngân hàng nhập tay.
CREATE TABLE IF NOT EXISTS shopee_payouts (
  id TEXT PRIMARY KEY,
  period TEXT NOT NULL UNIQUE,
  total_revenue REAL NOT NULL DEFAULT 0,
  total_fees REAL NOT NULL DEFAULT 0,
  total_marketing REAL NOT NULL DEFAULT 0,
  total_withholding REAL NOT NULL DEFAULT 0,
  total_cogs REAL,
  net_profit REAL,
  order_count INTEGER NOT NULL DEFAULT 0,
  bank_statement_amount REAL,
  diff REAL,
  reconciled_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_shopee_payouts_period ON shopee_payouts(period);
