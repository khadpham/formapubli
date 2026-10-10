/**
 * Định dạng ngày tháng văn bản hành chính Việt Nam (Nghị định 30/2020/NĐ-CP).
 * Ngày và tháng viết bằng 2 chữ số: "ngày 05 tháng 03 năm 2026".
 *
 * Chuỗi 'YYYY-MM-DD' được tách từng phần trực tiếp (không qua Date UTC) -
 * tránh lệch ngày khi timezone máy/server lùi sau UTC.
 */
export function formatVietnameseDate(dateInput: string | Date, prefixLocation?: string): string {
  let day: number;
  let month: number;
  let year: number;

  if (typeof dateInput === 'string') {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateInput.trim());
    if (iso) {
      year = Number(iso[1]);
      month = Number(iso[2]);
      day = Number(iso[3]);
    } else {
      const d = new Date(dateInput);
      if (isNaN(d.getTime())) return '';
      day = d.getDate();
      month = d.getMonth() + 1;
      year = d.getFullYear();
    }
  } else {
    if (isNaN(dateInput.getTime())) return '';
    day = dateInput.getDate();
    month = dateInput.getMonth() + 1;
    year = dateInput.getFullYear();
  }

  const dayStr = day < 10 ? `0${day}` : `${day}`;
  const monthStr = month < 10 ? `0${month}` : `${month}`;

  const baseDateText = `ngày ${dayStr} tháng ${monthStr} năm ${year}`;
  return prefixLocation?.trim() ? `${prefixLocation.trim()}, ${baseDateText}` : baseDateText;
}
