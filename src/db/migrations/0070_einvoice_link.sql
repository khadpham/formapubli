-- 0070: Bổ sung trường hóa đơn điện tử cho liên kết POS/online/bán buôn
-- buyer_*: thông tin người mua trên hóa đơn
-- invoice_kind: SINGLE (1 đơn) | CONSOLIDATED (gom cuối ngày)
-- consolidated_date: ngày gom (cho CONSOLIDATED, YYYY-MM-DD)
-- source_order_ids: JSON array các order id nguồn (cho CONSOLIDATED)

ALTER TABLE einvoices ADD COLUMN buyer_tax_code TEXT;
ALTER TABLE einvoices ADD COLUMN buyer_name TEXT;
ALTER TABLE einvoices ADD COLUMN buyer_address TEXT;
ALTER TABLE einvoices ADD COLUMN invoice_kind TEXT DEFAULT 'SINGLE';
ALTER TABLE einvoices ADD COLUMN consolidated_date TEXT;
ALTER TABLE einvoices ADD COLUMN source_order_ids TEXT;
ALTER TABLE einvoices ADD COLUMN lookup_code TEXT;
ALTER TABLE einvoices ADD COLUMN lookup_url TEXT;
