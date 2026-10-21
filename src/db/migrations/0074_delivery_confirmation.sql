-- 0074: Xác nhận khách đã nhận hàng cho đơn online (quyết định D1, 2026-10-20).
-- Hóa đơn đơn online chỉ phát hành sau khi khách đã nhận hàng. Trước mắt xác
-- nhận thủ công (ghi người + thời gian để kiểm toán); sau này API vận chuyển
-- sẽ tự điền 2 cột này, không đổi quy trình.
ALTER TABLE orders ADD COLUMN delivery_confirmed_at TEXT;
ALTER TABLE orders ADD COLUMN delivery_confirmed_by TEXT;
