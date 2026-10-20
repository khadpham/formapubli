-- 0061: Doi soat sao ke ngan hang tu dong.
-- bank_statements: 1 dong = 1 dong sao ke import tu file xlsx MB Bank.
-- but_toan UNIQUE de import lap khong tao trung.
CREATE TABLE bank_statements (
  id TEXT PRIMARY KEY,
  ngay_giao_dich TEXT NOT NULL, -- YYYY-MM-DD (cot C4)
  ngay_hach_toan TEXT, -- cot C5 (co the trong)
  phat_sinh_no REAL NOT NULL DEFAULT 0, -- tien ra (cot C8)
  phat_sinh_co REAL NOT NULL DEFAULT 0, -- tien vao (cot C9)
  so_du REAL, -- cot so du cuoi dong
  don_vi TEXT, -- don vi thu huong/chuyen (cot C12)
  noi_dung TEXT, -- noi dung CK, chua ma don (cot C13)
  but_toan TEXT NOT NULL UNIQUE, -- ma giao dich ngan hang (cot C18)
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX idx_bank_statements_ngay ON bank_statements(ngay_giao_dich);
--> statement-breakpoint
-- bank_statement_matches: ket qua khop (tu dong hoac tay) giua dong sao ke va don.
-- Khong co dong match = CHUA_XU_LY. Match chua xac nhan (AUTO, confidence
-- thap) = hang doi review. Xac nhan = doi match_type MANUAL + matched_by.
CREATE TABLE bank_statement_matches (
  id TEXT PRIMARY KEY,
  statement_id TEXT NOT NULL REFERENCES bank_statements(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  match_type TEXT NOT NULL DEFAULT 'AUTO', -- AUTO | MANUAL
  confidence TEXT NOT NULL DEFAULT 'LOW', -- HIGH | MEDIUM | LOW
  matched_at TEXT DEFAULT CURRENT_TIMESTAMP,
  matched_by TEXT, -- staff id xac nhan tay, NULL neu tu dong
  note TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_bank_match_statement ON bank_statement_matches(statement_id);
--> statement-breakpoint
CREATE INDEX idx_bank_match_order ON bank_statement_matches(order_id);
