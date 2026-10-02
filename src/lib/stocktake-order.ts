import { STOCK_THRESHOLD_WARNING } from './stock-highlight';

export type StocktakeRow = {
  code?: string | null;
  theoreticalStock?: number | null;
};

/**
 * Tồn null/undefined = 0: ấn phẩm chưa có dòng tồn phải nằm đầu danh sách
 * đếm, vì đó là ấn phẩm dễ bị bỏ sót nhất.
 */
const stockOf = (r: { theoreticalStock?: number | null }): number => Number(r.theoreticalStock || 0);

/**
 * Sắp theo tồn lý thuyết. Trùng tồn thì xếp theo mã để bản in ổn định giữa
 * hai lần mở — không có tie-break thì thứ tự là thứ tự DB trả về, mỗi lần
 * có thể khác nhau và nhân viên tưởng bảng nhảy lung tung.
 *
 * Dùng CHUNG cho màn hình và bản in: đó là cách bảo đảm giấy in khớp đúng
 * cái người dùng đang đọc trên màn.
 */
export function sortByStock<T extends StocktakeRow>(rows: T[], dir: 'ASC' | 'DESC'): T[] {
  const sign = dir === 'ASC' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const diff = (stockOf(a) - stockOf(b)) * sign;
    if (diff !== 0) return diff;
    return (a.code || '').localeCompare(b.code || '');
  });
}

/** Ấn phẩm sắp hết — nhóm phải đếm lúc đóng thùng. */
export function filterLowStock<T extends StocktakeRow>(rows: T[]): T[] {
  return rows.filter((r) => stockOf(r) <= STOCK_THRESHOLD_WARNING);
}

/** Nhãn thứ tự có dấu mũi tên để nhân viên không phải đoán "Bé → Lớn" nghĩa là gì. */
export function sortLabel(dir: 'ASC' | 'DESC'): string {
  return dir === 'ASC' ? 'Bé → Lớn' : 'Lớn → Bé';
}
