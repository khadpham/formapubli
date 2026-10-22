-- 0082: Phân loại trả hàng Shopee thành 3 luồng riêng biệt.
-- CANCELLATION: hủy đơn trước khi giao (không có mã yêu cầu riêng, theo dõi qua orders)
-- RETURN_REFUND: trả hàng/hoàn tiền sau khi giao (có mã yêu cầu riêng)
-- FAILED_DELIVERY: giao hàng thất bại, kiện đang hoàn về
ALTER TABLE shopee_returns ADD COLUMN return_type TEXT NOT NULL DEFAULT 'RETURN_REFUND';
CREATE INDEX IF NOT EXISTS idx_shopee_returns_type ON shopee_returns(return_type);
