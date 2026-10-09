-- 0053: portal_settings — cấu hình tích hợp Customer Order Portal
-- key-value store: PORTAL_WAREHOUSE_ID (kho mặc định cho đơn online)
CREATE TABLE IF NOT EXISTS portal_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
