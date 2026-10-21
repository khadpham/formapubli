-- 0080: Luồng 4 bước xử lý đơn Shopee - thêm mốc đóng gói và in phiếu.
ALTER TABLE orders ADD COLUMN packed_at TEXT;
ALTER TABLE orders ADD COLUMN packed_by TEXT;
ALTER TABLE orders ADD COLUMN awb_printed_at TEXT;
