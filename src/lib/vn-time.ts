import { parseDbTimestamp } from '@/lib/db-timestamp';

/**
 * MỐC THỜI GIAN THEO GIỜ VIỆT NAM - nguồn chân lý DÙNG CHUNG.
 *
 * VÌ SAO cần file này: cột thời gian trong DB là UTC (xem `parseDbTimestamp`),
 * còn ngày/giờ người đọc là giờ Việt Nam (UTC+7, không DST). Trước đây mỗi màn
 * hình tự viết một bản, và bản sai đã làm biểu đồ 7 ngày lệch cả 7 tiếng (đơn
 * 06:30 sáng 10/3 rơi vào cột "9/3"). Nay toàn bộ biểu đồ dùng chung một hàm.
 */
export const VN_TZ = 'Asia/Ho_Chi_Minh';

/** Định dạng ngày 'YYYY-MM-DD' theo giờ VN - dùng để làm khoá nhóm. */
export const vnDayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: VN_TZ });

/** Định dạng 'HH:MM' theo giờ VN. */
export const vnHmFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: VN_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Lệch giờ VN so với UTC tính theo mili giây. VN không có DST nên hằng số này đúng mãi. */
const VN_OFFSET_MS = 7 * 3600 * 1000;

/**
 * Ngày nghiệp vụ VN (YYYY-MM-DD) của một mốc thời gian, null nếu dữ liệu hỏng.
 *
 * Cố ý KHÔNG dùng `toISOString().slice(0,10)` - cái đó ra NGÀY UTC, lệch 7 tiếng
 * với ngày mà con người đọc.
 */
export function vnBusinessDay(value: string | Date | null | undefined): string | null {
  const d = value instanceof Date ? value : parseDbTimestamp(value);
  return d && !Number.isNaN(d.getTime()) ? vnDayFmt.format(d) : null;
}

/** Lùi/trượt một ngày nghiệp vụ (số ngày âm = về quá khứ). Không phụ thuộc múi giờ máy. */
export function shiftVnDay(day: string, deltaDays: number): string {
  const [y, mo, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d + deltaDays));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
}

/** Chuẩn hoá mọi dạng mốc thời gian về Date (hỗ trợ cả số epoch). */
function asDate(value: string | Date | number | null | undefined): Date | null {
  const d = typeof value === 'number' ? new Date(value) : parseDbTimestamp(value);
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/**
 * Giờ Việt Nam (0–23) của một mốc thời gian trong DB.
 *
 * Cộng sẵn +7 giờ rồi đọc trường UTC: làm vậy là đúng kể cả lúc cột DB đã lưu
 * sẵn chuỗi ISO có `Z` (parse trả Date đúng mốc) lẫn lúc lưu dạng naive UTC.
 */
export function vnHourOf(value: string | Date | number | null | undefined): number | null {
  const d = asDate(value);
  return d ? new Date(d.getTime() + VN_OFFSET_MS).getUTCHours() : null;
}

/** Ngày nghiệp vụ VN 'YYYY-MM-DD' của một mốc thời gian. */
export function vnDayOf(value: string | Date | number | null | undefined): string | null {
  const d = asDate(value);
  return d ? new Date(d.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10) : null;
}

/**
 * Nhãn thứ trong tuần tiếng Việt, index theo 0 = Chủ nhật (khớp `getUTCDay` sau
 * khi đã cộng +7). Biểu đồ 7 ngày dùng để biết cuối tuần khác ngày thường thế nào.
 */
export const DAY_LABELS_VN: readonly string[] = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/** Nhãn thứ trong tuần của một ngày nghiệp vụ VN 'YYYY-MM-DD'. */
export function dayLabelVn(day: string): string {
  const [y, mo, d] = day.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return '';
  return DAY_LABELS_VN[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()] ?? '';
}

/** Rút gọn tiền Việt cho nhãn nhỏ trên cột: 1.250.000 → "1,2tr", 850.000 → "850k". */
export function fmtCompactVnd(n: number): string {
  const v = Number(n) || 0;
  if (Math.abs(v) < 1000) return String(Math.round(v));
  if (Math.abs(v) < 1_000_000) {
    const k = v / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(0)}k`;
  }
  const m = v / 1_000_000;
  const txt = m >= 10 ? m.toFixed(0) : m.toFixed(1).replace('.', ',');
  return `${txt.replace(/,0$/, '')}tr`;
}
