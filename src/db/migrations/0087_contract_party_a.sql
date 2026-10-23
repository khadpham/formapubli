-- Bảng bên A (nhiều đối tượng) cho hợp đồng
CREATE TABLE IF NOT EXISTS contract_party_a (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  representative TEXT,
  position TEXT DEFAULT 'Giám đốc',
  address TEXT,
  tax_code TEXT,
  phone TEXT,
  email TEXT,
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- Seed bên A mặc định từ thông tin công ty hiện tại
INSERT OR IGNORE INTO contract_party_a (id, name, representative, position, address, tax_code, phone, email, is_default)
VALUES (
  'party-a-default',
  'Công ty TNHH Vitanova',
  'Phạm Đan Kha',
  'Giám đốc',
  '',
  '',
  '',
  '',
  1
);
