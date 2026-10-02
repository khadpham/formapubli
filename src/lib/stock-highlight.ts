/**
 * src/lib/stock-highlight.ts — Chuẩn hoá ngưỡng cảnh báo tồn kho và màu sắc hiển thị.
 *
 * Tiêu chí thiết kế theo phản hồi thực tế:
 *  - Màu sắc nhẹ nhàng, dịu mắt (pastel nhẹ), không dùng màu đỏ rực gay gắt.
 *  - Đảm bảo độ tương phản cao (High Contrast WCAG), con số hiển thị font mono sắc nét,
 *    dễ đọc rõ ràng ngay cả khi nhìn lướt trên điện thoại ngoài trời tại hội chợ.
 *  - Ngưỡng:
 *      * OUT_OF_STOCK (<= 0): Hết hàng (viền hồng đỏ nhẹ, chữ đỏ sẫm font-black).
 *      * CRITICAL (1..3 cuốn): Khẩn cấp cần tiếp hàng (hồng nhạt pastel, chữ đỏ sẫm font-extrabold).
 *      * WARNING (4..5 cuốn): Chú ý theo dõi (vàng hổ phách nhạt pastel, chữ nâu hổ phách).
 *      * HEALTHY (> 5 cuốn): Tồn an toàn (màu slate/trắng thông thường).
 */

export type StockAlertLevel = 'OUT_OF_STOCK' | 'CRITICAL' | 'WARNING' | 'HEALTHY';

export const STOCK_THRESHOLD_CRITICAL = 3;
export const STOCK_THRESHOLD_WARNING = 5;

export function getStockAlertLevel(qty: number): StockAlertLevel {
  const n = Number(qty) || 0;
  if (n <= 0) return 'OUT_OF_STOCK';
  if (n <= STOCK_THRESHOLD_CRITICAL) return 'CRITICAL';
  if (n <= STOCK_THRESHOLD_WARNING) return 'WARNING';
  return 'HEALTHY';
}

export interface StockBadgeStyle {
  level: StockAlertLevel;
  label: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  /** Dot chỉ báo trạng thái */
  dotClass: string;
}

export function getStockAlertBadge(qty: number): StockBadgeStyle {
  const level = getStockAlertLevel(qty);
  const n = Number(qty) || 0;

  switch (level) {
    case 'OUT_OF_STOCK':
      return {
        level,
        label: 'Hết hàng (0)',
        bgClass: 'bg-rose-50/90',
        textClass: 'text-rose-900 font-mono font-black',
        borderClass: 'border border-rose-300',
        dotClass: 'bg-rose-500',
      };
    case 'CRITICAL':
      return {
        level,
        label: `${n} cuốn`,
        bgClass: 'bg-rose-50/70',
        textClass: 'text-rose-800 font-mono font-extrabold',
        borderClass: 'border border-rose-200',
        dotClass: 'bg-rose-400',
      };
    case 'WARNING':
      return {
        level,
        label: `${n} cuốn`,
        bgClass: 'bg-amber-50/70',
        textClass: 'text-amber-900 font-mono font-bold',
        borderClass: 'border border-amber-200',
        dotClass: 'bg-amber-400',
      };
    case 'HEALTHY':
    default:
      return {
        level,
        label: `${n.toLocaleString('vi-VN')} cuốn`,
        bgClass: 'bg-slate-50',
        textClass: 'text-slate-900 font-mono font-bold',
        borderClass: 'border border-slate-200',
        dotClass: 'bg-emerald-500',
      };
  }
}

/**
 * Trả về class highlight / sorted gradient dịu nhẹ cho dòng bảng.
 * Chỉ áp dụng khi người dùng kích hoạt sắp xếp Bé -> Lớn hoặc lọc Sắp hết hàng.
 * Nền pastel nhẹ nhàng, có vạch viền trái (border-l-4) định vị nhanh bằng mắt.
 */
export function getStockRowHighlightClass(qty: number, isSortedAsc: boolean): string {
  if (!isSortedAsc) return '';
  const level = getStockAlertLevel(qty);
  switch (level) {
    case 'OUT_OF_STOCK':
      return 'bg-rose-50/70 border-l-4 border-l-rose-500 hover:bg-rose-100/60 transition-colors';
    case 'CRITICAL':
      return 'bg-rose-50/40 border-l-4 border-l-rose-300 hover:bg-rose-100/40 transition-colors';
    case 'WARNING':
      return 'bg-amber-50/30 border-l-4 border-l-amber-300 hover:bg-amber-100/30 transition-colors';
    default:
      return '';
  }
}
