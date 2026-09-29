-- Chặn tồn kho âm khi CHÈN MỚI, không chỉ khi cập nhật.
--
-- Migration 0027 chỉ có `BEFORE UPDATE`. Nếu một dòng `stock_balances` mới được
-- chèn với số âm thì trigger đó không bắt. `stock_balances` không chỉ được ghi
-- qua update: seed và các script nạp dữ liệu có thể chèn thẳng.
--
-- VÌ SAO LÀ MIGRATION MỚI chứ không sửa 0027: 0027 ĐÃ áp lên production. Sửa
-- một file migration đã chạy sẽ khiến DB cũ và DB dựng mới lệch nhau — đúng cái
-- bẫy đã ghi trong tài liệu. Migration đã áp thì giữ nguyên, thêm cái mới.
--
-- Vẫn là MỘT khối, không có dấu tách câu bên trong: `migrate-fresh.ts` execute
-- từng khối một lần, tách `;` trong BEGIN...END là hỏng. Và không viết nguyên văn
-- tên dấu tách câu vào comment ở file này.
CREATE TRIGGER IF NOT EXISTS check_stock_non_negative_ins
BEFORE INSERT ON stock_balances
FOR EACH ROW WHEN NEW.physical_quantity < 0
BEGIN
  SELECT RAISE(ABORT, 'check_stock_non_negative: physical_quantity >= 0');
END;
