-- 0064: Combo components - dinh nghia sach thanh phan cua combo/box set (bang products ERP).
-- 1 combo = N sach thanh phan, moi sach co so luong trong 1 bo.
-- Ton combo = min(ton tung thanh phan / so luong yeu cau). Combo khong co ton rieng.
CREATE TABLE combo_components (
  id TEXT PRIMARY KEY,
  combo_product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_combo_components_unique ON combo_components(combo_product_id, component_product_id);
--> statement-breakpoint
CREATE INDEX idx_combo_components_combo ON combo_components(combo_product_id);
