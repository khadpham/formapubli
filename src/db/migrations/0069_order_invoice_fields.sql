-- 0069: Thêm trường thông tin hóa đơn vào bảng orders
-- Để lưu MST, tên công ty, địa chỉ khi khách yêu cầu xuất hóa đơn VAT

ALTER TABLE orders ADD COLUMN invoice_tax_code TEXT;
ALTER TABLE orders ADD COLUMN invoice_company_name TEXT;
ALTER TABLE orders ADD COLUMN invoice_address TEXT;
ALTER TABLE orders ADD COLUMN invoice_status TEXT DEFAULT 'NONE';
