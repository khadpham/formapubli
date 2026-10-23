-- Thêm chiết khấu vào hóa đơn điện tử
ALTER TABLE einvoices ADD COLUMN discount_percent REAL DEFAULT 0;
ALTER TABLE einvoices ADD COLUMN discount_amount REAL DEFAULT 0;
