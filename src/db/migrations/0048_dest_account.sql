-- 0048: Theo dõi tiền về tài khoản nào (GĐ3-P3). VietQR vẫn về tài khoản cá nhân
-- nhân viên nên cần biết tiền đang phân tán ở đâu. Cột nullable — dữ liệu cũ
-- = "chưa phân loại", luồng mới điền dần.
-- MỌI câu cách nhau bằng statement-breakpoint marker (quy ước migrate-fresh/drizzle);
-- cấm viết literal marker text bên trong comment — split sẽ cắt nhầm chunk.

ALTER TABLE orders ADD COLUMN dest_account_id TEXT REFERENCES bank_accounts(id)
--> statement-breakpoint
ALTER TABLE partner_receipts ADD COLUMN dest_account_id TEXT REFERENCES bank_accounts(id)
