-- 0078: Lop gia von theo dau sach (work_costs)
-- Quyet dinh 2026-10-21 (anh Kha duyet):
--   1. Chi phi vao gia von: 5 hop dong giai doan + tien in an. KHONG cong chi phi chung.
--   2. Gia tri hop dong tinh GROSS (truoc khau tru TNCN 10%).
--   3. Tai ban nhieu dot -> gia von binh quan gia quyen (tinh tu work_costs + inventory_ledger).
--   6. Tinh tu 01/01/2026 tro di.

CREATE TABLE IF NOT EXISTS work_costs (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES works(id),
  cost_type TEXT NOT NULL, -- CONTRACT | PRINTING
  source_type TEXT,        -- contract_documents | manual
  source_id TEXT,          -- id hop dong khi source_type = contract_documents
  amount REAL NOT NULL,    -- VND, so gross
  cost_date TEXT NOT NULL, -- YYYY-MM-DD (ngay ky HD / ngay phat sinh chi phi in)
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_work_costs_work ON work_costs(work_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_costs_source ON work_costs(source_type, source_id);
