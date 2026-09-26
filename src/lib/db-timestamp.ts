/**
 * ĐỌC TIMESTAMP CỦA DB — LUÔN LUÔN THEO UTC.
 *
 * VÌ SAO CẦN: 41 cột trong schema có `default CURRENT_TIMESTAMP`. SQLite ghi
 * CURRENT_TIMESTAMP theo UTC với định dạng "YYYY-MM-DD HH:MM:SS" — KHÔNG kèm
 * múi giờ. `new Date("2026-09-26 17:52:00")` trong Node được đọc là GIỜ ĐỊA
 * PHƯƠNG, nên ở GMT+7 một bản ghi vừa ghi bị lệch -7 tiếng. Ca két vừa mở
 * trông già 7 tiếng, chốt ca tự động nhảy lên chặn bán ngay lúc mở app.
 *
 * Dùng hàm này cho MỌI cột có default CURRENT_TIMESTAMP. Không parse tay.
 * Hàm trả null cho dữ liệu hỏng — đúng như quy ước của luồng hạn đơn PENDING
 * (`OrderService.getPendingEffectiveExpiry` trả null / rơi về TTL thay vì ném).
 */
export function parseDbTimestamp(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  if (!raw) return null;

  // "YYYY-MM-DD HH:MM:SS[.sss]" hoặc "YYYY-MM-DDTHH:MM:SS[.sss]" — không múi giờ.
  const naive = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?$/.exec(raw);
  const d = naive ? new Date(`${naive[1]}T${naive[2]}${naive[3] || ''}Z`) : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
