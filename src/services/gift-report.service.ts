import { db } from '@/db';
import { sql } from 'drizzle-orm';

/**
 * Báo cáo quà tặng (mục 8.4): tách QUÀ CÒN TỒN vs QUÀ HẾT TỒN.
 *
 * Nguồn: `order_items.is_gift_line = 1`, nhóm theo (sản phẩm, is_gift_shortfall).
 * Không có điều kiện ngày phức tạp: lọc theo `orders.created_at` ở nhanh nhất ở
 * phía SQL với datetime() để chấp cả hai họ timestamp (gotcha 7 của handoff).
 */
export const GiftReportService = {
  async summary(from?: string | null, to?: string | null) {
    // Tối giản: chỉ trả về cả bảng gift grouped. Ngày VN +7 — áp dụng cùng
    // quy ước của toàn hệ thống.
    const rows: any[] = await db.all(sql`
      SELECT
        oi.product_id AS productId,
        p.name AS productName,
        oi.is_gift_shortfall AS isGiftShortfall,
        COUNT(*) AS lineCount,
        SUM(oi.quantity) AS totalQty
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.is_gift_line = 1
        AND (${from} IS NULL OR substr(datetime(o.created_at, '+7 hours'), 1, 10) >= ${from})
        AND (${to} IS NULL OR substr(datetime(o.created_at, '+7 hours'), 1, 10) <= ${to})
      GROUP BY oi.product_id, oi.is_gift_shortfall
      ORDER BY p.name
    `);
    const inStock = rows.filter((r) => Number(r.isGiftShortfall) === 0);
    const shortfall = rows.filter((r) => Number(r.isGiftShortfall) === 1);
    return {
      inStock: inStock.map((r) => ({ productId: r.productId, productName: r.productName, lineCount: Number(r.lineCount), totalQty: Number(r.totalQty) })),
      shortfall: shortfall.map((r) => ({ productId: r.productId, productName: r.productName, lineCount: Number(r.lineCount), totalQty: Number(r.totalQty) })),
      totalQty: rows.reduce((s, r) => s + Number(r.totalQty), 0),
    };
  },
};
