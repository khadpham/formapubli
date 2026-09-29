-- Chặn tồn kho âm ở TẦNG DB, không chỉ ở tầng ứng dụng.
--
-- `schema.ts` khai báo `check('check_stock_non_negative', physical_quantity >= 0)`
-- nhưng Drizzle KHÔNG BAO GIỜ sinh migration cho thay đổi đó: không .sql nào trong
-- thư mục này tạo ra constraint, và các snapshot chỉ kết thúc ở 0014. Nên trên
-- production hiện có 0 trigger — khai báo đó chỉ là văn bản.
--
-- Vì sao dùng TRIGGER chứ không thêm CHECK thật:
--   SQLite không có `ALTER TABLE ... ADD CONSTRAINT`. Muốn có CHECK thật thì phải
--   dựng bảng mới, chép 405 dòng, drop, rename, tạo lại 2 khoá ngoại và index
--   `uq_stock_bucket` — 12 lệnh. Mà `migrate-fresh.ts` chạy lệnh KHÔNG bọc
--   transaction, KHÔNG rollback: hỏng giữa chừng là mất bảng. Một trigger là
--   MỘT câu lệnh thêm vào, cùng ngữ nghĩa, an toàn trên cả DB cũ lẫn DB dựng mới.
--
-- `IF NOT EXISTS` vì production không có bảng `__drizzle_migrations` và
-- `migrateFresh` từ chối chạy trên DB remote, nên người vận hành phải tự áp dụng.
-- Chạy lại phải không sao, không được abort.
--
-- Toàn bộ trigger phải là MỘT khối, không có dấu ngắt câu (`statement-breakpoint`)
-- bên trong: `migrate-fresh.ts` cắt file theo đúng chuỗi đó rồi `execute()` từng
-- khối một lần. Tách `;` trong BEGIN...END là hỏng. LƯU Ý: đừng viết nguyên văn
-- tên dấu ngắt câu trong comment ở file này — chính nó sẽ cắt đôi câu lệnh.
--
-- `delivery-order.service.ts:236` trừ `physical_quantity - item.quantity` không có
-- chặn âm — đúng lỗ hổng mà trigger này phải bịt. Kiểm tra ứng dụng ở
-- `inventory.service.ts:167` và `:537` vẫn giữ nguyên (báo lỗi thân thiện hơn).
CREATE TRIGGER IF NOT EXISTS check_stock_non_negative
BEFORE UPDATE ON stock_balances
FOR EACH ROW WHEN NEW.physical_quantity < 0
BEGIN
  SELECT RAISE(ABORT, 'check_stock_non_negative: physical_quantity >= 0');
END;
