-- 0075: Tách thuế khấu trừ VN trong đối soát escrow Shopee (chuẩn bị P3).
-- get_escrow_detail trả withholding_vat_tax / withholding_pit_tax /
-- withholding_cit_tax trong order_income - lưu riêng từng khoản để kế toán
-- đối soát thuế, không gộp vào phí sàn (thiết kế P3 yêu cầu).
-- Toàn bộ nullable: đơn cũ và đơn chưa sync giữ nguyên, không đụng dữ liệu cũ.
ALTER TABLE shopee_order_finance ADD COLUMN withholding_vat_tax REAL;
ALTER TABLE shopee_order_finance ADD COLUMN withholding_pit_tax REAL;
ALTER TABLE shopee_order_finance ADD COLUMN withholding_cit_tax REAL;
