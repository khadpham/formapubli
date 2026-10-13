-- 0062: Doi soat bao cao tai chinh SPX.
-- spx_settlements: 1 dong = 1 van don trong file bao cao SPX.
-- ma_van_don UNIQUE de import lap khong tao trung.
CREATE TABLE spx_settlements (
  id TEXT PRIMARY KEY,
  ma_van_don TEXT NOT NULL UNIQUE, -- tracking number
  trang_thai TEXT, -- trang thai van don tren bao cao
  tien_thu_ho REAL NOT NULL DEFAULT 0, -- COD SPX thu (cot A)
  tong_phi REAL NOT NULL DEFAULT 0, -- tong phi phai tra (cot C)
  phi_giao_hang REAL NOT NULL DEFAULT 0,
  phi_bao_hiem REAL NOT NULL DEFAULT 0,
  phi_hoan_hang REAL NOT NULL DEFAULT 0,
  so_tien_dieu_chinh REAL NOT NULL DEFAULT 0, -- cot D
  ly_do_dieu_chinh TEXT,
  tong_tien_ve REAL NOT NULL DEFAULT 0, -- tong tien vao so du tai khoan
  ngay_import TEXT NOT NULL, -- YYYY-MM-DD ngay chay import
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX idx_spx_settlements_ngay ON spx_settlements(ngay_import);
--> statement-breakpoint
-- spx_settlement_matches: ket qua khop van don voi don ERP.
CREATE TABLE spx_settlement_matches (
  id TEXT PRIMARY KEY,
  settlement_id TEXT NOT NULL REFERENCES spx_settlements(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  cod_khop INTEGER NOT NULL DEFAULT 0, -- 1 = COD thu ho khop cod_amount
  phi_bat_thuong INTEGER NOT NULL DEFAULT 0, -- 1 = phi lech qua nguong
  match_type TEXT NOT NULL DEFAULT 'AUTO', -- AUTO | MANUAL
  matched_at TEXT DEFAULT CURRENT_TIMESTAMP,
  matched_by TEXT,
  note TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_spx_match_settlement ON spx_settlement_matches(settlement_id);
--> statement-breakpoint
CREATE INDEX idx_spx_match_order ON spx_settlement_matches(order_id);
