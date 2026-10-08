-- 0049: Nợ vay/vốn huy động + khóa sổ kỳ (GĐ3-P4, chỉ chủ).
-- loans: khoản vay (chủ nợ, số tiền, lãi suất, ngày vay, kỳ hạn, trạng thái).
-- loan_payments: lịch trả gốc/lãi từng lần.
-- period_locks: kỳ đã quyết toán bị khóa vĩnh viễn, chỉ chủ mở khóa.
-- MỌI câu cách nhau bằng statement-breakpoint marker (quy ước migrate-fresh/drizzle);
-- cấm viết literal marker text bên trong comment — split sẽ cắt nhầm chunk.

CREATE TABLE loans (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  lender TEXT NOT NULL,
  principal REAL NOT NULL,
  interest_rate REAL,
  borrowed_at TEXT NOT NULL,
  due_at TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)
--> statement-breakpoint
CREATE INDEX idx_loans_status ON loans(status)
--> statement-breakpoint
CREATE TABLE loan_payments (
  id TEXT PRIMARY KEY,
  loan_id TEXT NOT NULL REFERENCES loans(id),
  amount REAL NOT NULL,
  principal_amount REAL NOT NULL DEFAULT 0,
  interest_amount REAL NOT NULL DEFAULT 0,
  paid_at TEXT NOT NULL,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)
--> statement-breakpoint
CREATE INDEX idx_loan_payments_loan ON loan_payments(loan_id)
--> statement-breakpoint
CREATE TABLE period_locks (
  month TEXT PRIMARY KEY,
  locked_by TEXT NOT NULL,
  locked_at TEXT DEFAULT CURRENT_TIMESTAMP,
  note TEXT
)
