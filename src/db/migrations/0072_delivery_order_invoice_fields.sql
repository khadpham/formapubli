-- 0072: Thêm trường thông tin hóa đơn vào bảng delivery_orders
-- Để lưu MST, tên công ty, địa chỉ khi đại lý tick "Xuất hóa đơn VAT" trên phiếu xuất kho bán buôn

ALTER TABLE delivery_orders ADD COLUMN invoice_tax_code TEXT;
ALTER TABLE delivery_orders ADD COLUMN invoice_company_name TEXT;
ALTER TABLE delivery_orders ADD COLUMN invoice_address TEXT;
ALTER TABLE delivery_orders ADD COLUMN invoice_status TEXT DEFAULT 'NONE';
