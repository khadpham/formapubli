-- Bộ đếm số phiếu theo ngày, để sinh mã đơn 13 ký tự.
--
-- VÌ SAO KHÔNG ĐẾM Ở MÁY: POS chạy trên nhiều máy ở hội chợ. Nếu mỗi máy tự
-- đếm từ 0001 thì hai máy cùng tạo đơn đầu tiên trong ngày sẽ ra CÙNG một số,
-- mà `orders.order_code` là UNIQUE ⇒ đơn của máy thứ hai KHÔNG GHI ĐƯỢC. Bộ đếm
-- phải nằm ở DB thì mọi máy mới cùng nhìn thấy một số chuỗi.
--
-- Cấp số bằng `UPDATE ... RETURNING` — SQLite/libSQL thực hiện nguyên tử trong
-- một câu lệnh, nên hai phiên chạy song song không thể nhận trùng số. Gọi nó
-- TRONG cùng transaction với lệnh INSERT đơn hàng: nếu insert lỗi (thiếu tồn,
-- trùng idempotency) thì transaction rollback và số đó được dùng lại, không
-- để lại lỗ hổng.
--
-- Chỉ cần 2 cột. `when` của entry journal phải CAO HƠN `0027` (1790600003000)
-- vì drizzle bỏ qua im lặng entry có `when` nhỏ hơn bản ghi cuối.
--
-- Mã sinh ra: 'ORD' + 'YYMMDD' + số thứ tự viết bằng base36 đệm 4 ký tự
-- (1 = '0001' … 9999 = '23P' … 10000 = '23Q' …). 36^4 = 1.679.616 đơn/ngày nên
-- vượt 9999 thì tự động sang chữ cái, không cần nhánh "tràn" riêng.
CREATE TABLE IF NOT EXISTS daily_order_counters (
  day TEXT PRIMARY KEY,
  last_seq INTEGER NOT NULL DEFAULT 0
);
